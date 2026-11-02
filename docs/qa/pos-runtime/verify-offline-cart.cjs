const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{chromium}=require('playwright');
const source=fs.readFileSync(process.env.POS_QA_SOURCE||path.resolve(__dirname,'../../../component/zenith-erp-app/screen/zenithstatic/js/pos-terminal.js'),'utf8');
const begin=source.indexOf('window._posOffline ='),end=source.indexOf('\n})();',begin);
assert(begin>=0&&end>begin);let ackMode='none',calls=0;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/offline-module.js'){res.setHeader('Content-Type','application/javascript');res.end(source.slice(begin,end+6));return;}
 if(url.pathname.endsWith('/exportPosCatalog')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:2,userId:'QA_USER',organizationPartyId:'QA_ORG',terminalId:'QA_TERM',canOverride:true,state:'33',modes:[{id:'RETAIL',name:'Retail'}],products:[{productId:'P1',productName:'Water Cup',printName:'தண்ணீர் கப்',listPrice:100,taxRate:18,taxRates:[9,9],interstateRates:[18],prices:{RETAIL:{price:100,disc:0}},uom:'Nos'}]}));return;}
 if(url.pathname.endsWith('/ajaxCart')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,transactionId:'',items:[]}));return;}
 if(url.pathname.endsWith('/syncOfflineTransactions')){let body='';for await(const chunk of req)body+=chunk;const sales=JSON.parse(body).transactions.map(JSON.parse);calls++;res.statusCode=ackMode==='error'?503:200;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(ackMode==='all'?{syncedIds:sales.map(s=>s.offlineId)}:ackMode==='partial'?{syncedIds:[sales[0].offlineId]}:{syncedCount:1}));return;}
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta charset="utf-8"><title>Disposable offline storage regression</title><form id="cartInlineAddForm"><input name="posOrganizationPartyId" value="QA_ORG"><input name="posTerminalId" value="QA_TERM"><input name="sessionId" value="QA_SESSION"><input name="salesModeId" value="RETAIL"><input name="transactionId" value=""><input name="moquiSessionToken" value="qa"><input id="pos-offline-user" value="QA_USER"></form><div class="pos-cart"><table><tbody></tbody></table></div><div class="pos-summary"></div><input id="cartInlineSearch"><script>window._posCurrentTax=()=> 'Y';</script><script src="/offline-module.js"></script>`);
});
(async()=>{
 server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.POS_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext();try{
  const page=await context.newPage();await page.goto(base+'/apps/zenith/pos/Terminal');await page.waitForFunction(()=>window._posOffline?.lookup('P1'));
  await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('.pos-offline-payments'));
  await page.evaluate(()=>window._posOffline.add('P1'));await page.locator('.ofl-price').waitFor();await page.locator('.ofl-price').fill('80');
  await context.setOffline(false);await page.reload();await page.locator('.ofl-price').waitFor();assert.equal(await page.locator('.ofl-price').inputValue(),'80','draft survives reload');
  const second=await context.newPage();await second.goto(base+'/apps/zenith/pos/Terminal');await second.waitForFunction(()=>window._posOffline?.paused());assert.match(await second.locator('body').innerText(),/another tab/);await second.close();
  await context.setOffline(true);await page.locator('.ofl-qi').fill('');await page.locator('#pos-pay-cash').click();assert.equal(await page.locator('#oflReceived').count(),0,'invalid visible quantity blocks payment');await page.locator('.ofl-qi').fill('2');
  await page.locator('#cartInlineSearch').focus();await page.keyboard.press('Space');assert.equal(await page.locator('#pos-pay-cash').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Enter');assert.equal(await page.locator('#oflReceived').inputValue(),'189.00');await page.keyboard.press('Enter');await page.locator('#oflPrintReceipt').waitFor();
  assert.equal((await page.evaluate(()=>window._posOffline.getQueue())).length,1,'confirmed sale is durable');assert.equal(await page.locator('.ofl-price').count(),0,'queued sale clears draft');await page.locator('.ofl-cancel').click();
  await page.evaluate(()=>window._posOffline.add('P1'));await page.locator('#pos-pay-upi').click();await page.locator('#oflConfirmPayment').click();await page.locator('#oflPrintReceipt').waitFor();await page.locator('.ofl-cancel').click();assert.equal((await page.evaluate(()=>window._posOffline.getQueue())).length,2);
  await context.setOffline(false);await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('retained'));assert.equal((await page.evaluate(()=>window._posOffline.getQueue())).length,2,'missing acknowledgement never removes sales');
  ackMode='partial';assert.equal(await page.evaluate(()=>window._posOffline.sync()),1);assert.equal((await page.evaluate(()=>window._posOffline.getQueue())).length,1);
  ackMode='error';assert.equal(await page.evaluate(()=>window._posOffline.sync()),0);assert.equal((await page.evaluate(()=>window._posOffline.getQueue())).length,1,'HTTP failure retains sale');
  ackMode='all';assert.equal(await page.evaluate(()=>window._posOffline.sync()),1);assert.equal((await page.evaluate(()=>window._posOffline.getQueue())).length,0);assert(calls>=4);
  console.log('PASS offline draft reload, single-tab ownership, invalid input, keyboard cash, durable checkout, partial acknowledgement and retry.');
 }finally{await context.close();await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
