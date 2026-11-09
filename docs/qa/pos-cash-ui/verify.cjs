// Isolated browser regression of the actual production modal function and CSS.
// No ERP server, credentials, database or real payment is used by this test.
const fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright');
const root=path.resolve(__dirname,'../../..'),out=process.env.POS_CASH_OUT;
if(!out)throw Error('Set POS_CASH_OUT to an evidence directory');fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(root,'component/zenith-erp-app/screen/zenithstatic/js/pos-terminal.js'),'utf8');
const start=source.indexOf('function submitPosPaymentForm(form)'),end=source.indexOf('window.posPayDigital = function(form)',start);
if(start<0||end<start)throw Error('Production modal function not found');
const css=['zenith-theme-v4.css','pos-checkout.css'].map(n=>fs.readFileSync(path.join(root,'component/zenith-erp-app/screen/zenithstatic/css',n),'utf8')).join('\n');
const shared=fs.readFileSync(path.join(root,'component/zenith-erp-app/screen/zenithstatic/js/pos-till-dialogs.js'),'utf8');
const results=[];
async function run(){for(const engine of (process.env.POS_CASH_BROWSERS||'chrome,edge,webkit').split(',')){
 if(!['chrome','edge','webkit'].includes(engine))throw Error('Unknown browser');
 const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='webkit'?{}:engine==='chrome'&&process.env.POS_QA_CHROME?{executablePath:process.env.POS_QA_CHROME}:{channel:engine==='edge'?'msedge':'chrome'})});
 try{for(const dark of [false,true])for(const due of [247,118]){
  const p=await browser.newPage({viewport:{width:800,height:900}}),name=`${engine} ${dark?'dark':'light'} due ${due}`;
  try{
   await p.setContent('<body><form id="cash"><input name="amount" type="hidden" value="'+due+'"></form></body>');
   await p.addStyleTag({content:css});await p.evaluate(d=>document.body.classList.toggle('body--dark',d),dark);
   await p.addScriptTag({content:shared});
   await p.evaluate(d=>document.body.insertAdjacentHTML('beforeend',window.PosTillDialogs.cashMarkup(d)),due);
   await p.addScriptTag({content:source.slice(start,end)});
   await p.evaluate(()=>{const f=document.getElementById('cash');f.addEventListener('submit',e=>{e.preventDefault();window.submits=(window.submits||0)+1;});window.posPayCash(f);});
   for(const selector of ['#posCashRecv','.pos-cash-input'])for(const state of ['default','focused','filled','blurred']){
    const field=p.locator(selector);if(state==='focused')await field.focus();if(state==='filled')await field.fill('300');if(state==='blurred')await field.blur();
    const style=await field.evaluate(e=>{const c=getComputedStyle(e);return{background:c.backgroundColor,color:c.color,scheme:c.colorScheme,caret:c.caretColor,outline:c.outlineStyle};});
    const channels=style.color.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});
    const contrast=1.05/(.2126*channels[0]+.7152*channels[1]+.0722*channels[2]+.05);
    if(style.background!=='rgb(255, 255, 255)'||contrast<4.5||style.scheme==='dark')throw Error(selector+' '+state+' '+JSON.stringify(style));
   }
   await p.locator('#posCashRecv').fill(String(due-1));if(!await p.locator('#posCashConfirm').isDisabled())throw Error('Insufficient amount enabled confirmation');
   await p.locator('#posCashRecv').fill('300');if(!(await p.locator('#posCashChange').innerText()).includes((300-due).toFixed(2)))throw Error('Change calculation');
   await p.locator('#posCashExact').click();if(Number(await p.locator('#posCashRecv').inputValue())!==due)throw Error('Exact amount');
   await p.locator('.posCashDeno[data-deno="50"]').click();if(Number(await p.locator('#posCashRecv').inputValue())!==due+50)throw Error('Denomination');
   await p.screenshot({path:path.join(out,engine+'-'+(dark?'dark':'light')+'-'+due+'.png')});
   await p.locator('#posCashConfirm').click();if(!await p.evaluate(d=>window.submits===1&&Number(document.querySelector('#cash [name=amount]').value)===d+50,due))throw Error('Confirmation did not preserve tender');
   results.push({name,passed:true,version:browser.version()});
  }catch(e){results.push({name,passed:false,error:e.message});}finally{await p.close();}
 }}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(results,null,2));}
}console.log(JSON.stringify({checks:results.length,failed:results.filter(x=>!x.passed).length}));if(results.some(x=>!x.passed))process.exitCode=1;}
run().catch(e=>{console.error(e.stack);process.exitCode=1;});
