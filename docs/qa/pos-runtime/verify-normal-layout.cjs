const path=require('node:path');
module.exports=async({a,base,check,q,invoke,post,out})=>{
 const terminalId='POS_QA_A_NORMAL';
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable normal layout counter',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
 const session=await invoke('open',{terminalId,openingCash:'0'});
 const cart=await invoke('cart',{sessionId:session.sessionId});
 const page=await a.c.newPage();
 const snapshot=()=>JSON.stringify(q(`SELECT product_id,quantity,unit_price,line_total FROM pos_transaction_item WHERE transaction_id='${cart.transactionId}' ORDER BY item_seq_id`));
 const choose=async mode=>{await page.locator('.nb-modes summary').click();await page.locator(`[data-pos-layout="${mode}"]`).click();};
 try{
  for(const shell of ['apps','qapps']){
   await page.setViewportSize({width:1366,height:768});
   let terminalUrl=new URL('/apps/zenith/pos/Terminal',base);
   if(shell==='qapps'){
    await page.goto(`${base}/qapps/zenith/pos/Dashboard`,{waitUntil:'networkidle'});
    const href=await page.locator('#zq-subnav a[href*="/Terminal"]').first().getAttribute('href');
    check('Quasar billing entry uses the registered native terminal',href.startsWith('/apps/zenith/pos/Terminal'));
    terminalUrl=new URL(href,base);
   }
   terminalUrl.searchParams.set('sessionId',session.sessionId);terminalUrl.searchParams.set('transactionId',cart.transactionId);terminalUrl.searchParams.set('taxOn','N');
   await page.goto(terminalUrl.href,{waitUntil:'networkidle'});
   await choose('normal');
   check(shell+' normal billing hides catalogue and shows customer/summary panels',!await page.locator('.pos-left-panel').isVisible()&&await page.locator('.nb-side').isVisible()&&await page.locator('.nb-summary').isVisible());
   check(shell+' normal billing has an always-visible full-width scanner',await page.locator('#cartInlineSearch').evaluate(e=>{const r=e.getBoundingClientRect(),root=document.getElementById('pos-terminal-root').getBoundingClientRect();return r.width>root.width*.9&&r.height>=38&&getComputedStyle(e.closest('.pos-cart-search')).position==='relative';}));
   if(shell==='apps'){
    await page.locator('#cartInlineSearch').fill('POS_QA_A_P18');
    await page.locator('#cartSearchDropdown .cart-dd-item[data-pid="POS_QA_A_P18"]').waitFor();
    const added=page.waitForResponse(r=>r.url().includes('/ajaxCart')&&new URLSearchParams(r.request().postData()||'').get('action')==='addItem');
    await page.locator('#cartInlineSearch').press('Enter');await added;
    await page.waitForFunction(()=>document.getElementById('pos-side-subtotal')?.textContent==='₹100.00');
    check('normal scanner adds one authoritative item',q(`SELECT quantity,unit_price FROM pos_transaction_item WHERE transaction_id='${cart.transactionId}'`).length===1);
   }
   const before=snapshot();
   await choose('advanced');
   check(shell+' advanced billing restores catalogue and hides sidebar',await page.locator('.pos-left-panel').isVisible()&&!await page.locator('.nb-side').isVisible()&&snapshot()===before);
   await page.reload({waitUntil:'networkidle'});
   check(shell+' advanced layout persists on reload',await page.locator('body').evaluate(e=>e.classList.contains('pos-mode-advanced'))&&await page.locator('.pos-left-panel').isVisible());
   await choose('normal');await page.reload({waitUntil:'networkidle'});
   await page.waitForFunction(()=>{const catalog=document.querySelector('.pos-left-panel'),side=document.querySelector('.nb-side');return document.body&&document.body.classList.contains('pos-mode-normal')&&catalog&&side&&!catalog.checkVisibility()&&side.checkVisibility();});
   const normalState={catalogVisible:await page.locator('.pos-left-panel').isVisible(),sidebarVisible:await page.locator('.nb-side').isVisible(),before,after:snapshot(),layout:await page.locator('body').getAttribute('class'),stored:await page.evaluate(()=>localStorage.getItem('posLayoutMode'))};
   check(shell+' normal layout persists without changing saved items',!normalState.catalogVisible&&normalState.sidebarVisible&&normalState.after===normalState.before,normalState);
   await page.locator('#pos-customer-btn').click();
   check(shell+' normal Change customer opens the existing picker',await page.locator('#posCustomerOverlay').isVisible());
   await page.locator('#cust-close').click();
   for(const width of [1672,1366,800,390,320]){
    await page.setViewportSize({width,height:width<800?844:941});
    const geometry=await page.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();return{width:innerWidth,document:document.documentElement.scrollWidth,cart:box('#cartScroll'),side:box('.nb-side'),scanner:box('#cartInlineSearch'),pay:box('.pos-reference-payments')};});
    check(shell+' normal '+width+'px panels fit without overlap',geometry.document<=width+2&&geometry.cart.height>=150&&(width>900?geometry.cart.right<=geometry.side.left+2:geometry.side.top>=geometry.cart.bottom-2),geometry);
    for(const selector of ['#cartInlineSearch','.nb-summary','#pos-pay-cash']){
     await page.locator(selector).scrollIntoViewIfNeeded();
     check(shell+' normal '+width+'px '+selector+' remains reachable',await page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0;}));
    }
    if(width===1366||width===390)await page.screenshot({path:path.join(out,`${shell}-normal-${width}.png`),fullPage:false});
   }
  }
 }finally{
  await page.close();await invoke('void',{transactionId:cart.transactionId});await invoke('close',{sessionId:session.sessionId,closingCash:'0'});
 }
};
