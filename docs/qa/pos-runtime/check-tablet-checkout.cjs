// Actual checkout CSS with the wrapped toolbar height captured by the failed CI run.
// No ERP requests, credentials, payments or database writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../../..');
const css=fs.readFileSync(path.join(root,'component/zenith-erp-app/screen/zenithstatic/css/pos-checkout.css'),'utf8');
const methods=['Discount / Round-off','Cash','Card','Credit','UPI','Split Payment','Hold','Void / Cancel','AI Copilot'];
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.POS_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});let checks=0;
 try{const page=await browser.newPage();
  for(const mode of ['normal','advanced'])for(const width of [901,1024,1150])for(const height of [640,720,768,800,801,820,900,901,941]){
   await page.setViewportSize({width,height});
   await page.setContent('<style>'+css+'</style><body class="Terminal pos-mode-'+mode+'"><div class="z-pos-page"><main id="pos-terminal-root" class="pos-checkout-reference"><header class="nb-hrow">Synthetic checkout</header><nav class="nb-actionbar" style="min-height:111px">Wrapped billing controls</nav><section class="pos-left-panel">Catalog</section><div class="pos-cart-heading">Bill items</div><div id="cartScroll">Saved cart</div><div class="pos-cart-search"><input id="cartInlineSearch" aria-label="Search"></div><div class="pos-sum-strip">Last amount</div><div class="pos-sum-total"><span>Total</span><span>0</span></div><aside class="nb-side"></aside><footer class="pos-reference-payments">'+methods.map(name=>'<button type="button">'+name+'</button>').join('')+'</footer></main></div></body>');
   const g=await page.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {root:box('#pos-terminal-root'),pay:box('.pos-reference-payments'),cart:box('#cartScroll'),buttons:[...document.querySelectorAll('.pos-reference-payments button')].map(e=>e.getBoundingClientRect().toJSON())};});
   assert.ok((height<768||g.pay.bottom<=height+2)&&g.cart.height>=150,mode+' '+width+'x'+height+' payment/cart fit: '+JSON.stringify(g));
   assert.ok(g.buttons.length===9&&g.buttons.every(r=>r.height>=44&&r.left>=0&&r.right<=width+1),'Every payment control stays legible and within the width');
   for(const button of await page.locator('.pos-reference-payments button').all()){
    await button.scrollIntoViewIfNeeded();
    assert.ok(await button.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;}),'Every payment control remains reachable on shorter screens');
   }
   checks+=3;
  }
  console.log(JSON.stringify({test:'wrapped tablet checkout',checks,failed:0}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
