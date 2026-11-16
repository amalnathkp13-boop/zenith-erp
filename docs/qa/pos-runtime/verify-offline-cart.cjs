const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{chromium}=require('playwright');
const staticDir=path.resolve(__dirname,'../../../component/zenith-erp-app/screen/zenithstatic/js');
const source=fs.readFileSync(process.env.POS_QA_SOURCE||path.join(staticDir,'pos-terminal.js'),'utf8');
const till=fs.readFileSync(path.join(staticDir,'pos-till-dialogs.js'),'utf8');
let ackMode='none',calls=0;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/offline-module.js'){res.setHeader('Content-Type','application/javascript');res.end(till+'\n'+source);return;}
 if(url.pathname.endsWith('/exportPosCatalog')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:2,userId:'QA_USER',organizationPartyId:'QA_ORG',terminalId:'QA_TERM',canOverride:true,state:'33',modes:[{id:'RETAIL',name:'Retail'}],products:[{productId:'P1',productName:'Water Cup',printName:'தண்ணீர் கப்',listPrice:100,taxRate:18,taxRates:[9,9],interstateRates:[18],prices:{RETAIL:{price:100,disc:0}},uom:'Nos'}]}));return;}
 if(url.pathname.endsWith('/posAssetVersion')){res.setHeader('Content-Type','application/json');res.end('{"ver":1}');return;}
 if(url.pathname.endsWith('/ajaxCart')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,transactionId:'',items:[]}));return;}
 if(url.pathname.endsWith('/syncOfflineTransactions')){let body='';for await(const chunk of req)body+=chunk;const sales=JSON.parse(body).transactions.map(JSON.parse);calls++;res.statusCode=ackMode==='error'?503:200;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(ackMode==='all'?{syncedIds:sales.map(s=>s.offlineId)}:ackMode==='partial'?{syncedIds:[sales[0].offlineId]}:{syncedCount:1,failures:[{index:0,error:'The original draft changed.'}]}));return;}
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta charset="utf-8"><title>Disposable offline storage regression</title><div id="pos-terminal-root" class="pos-checkout-reference"><form id="cartInlineAddForm"><input name="posOrganizationPartyId" value="QA_ORG"><input name="posTerminalId" value="QA_TERM"><input name="sessionId" value="QA_SESSION"><input name="salesModeId" value="RETAIL"><input name="transactionId" value="${url.searchParams.get('tx')==='NEW'?'NEW':''}"><input name="moquiSessionToken" value="qa"><input id="pos-offline-user" value="QA_USER"></form><div class="pos-cart" id="cartScroll"><table><tbody></tbody></table></div><div class="pos-summary"></div><input id="cartInlineSearch"></div><script>window._posCurrentTax=()=> 'Y';</script><script src="/offline-module.js"></script>`);
});
(async()=>{
 server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.POS_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext();try{
  const page=await context.newPage();await page.goto(base+'/apps/zenith/pos/Terminal');await page.waitForFunction(()=>window._posOffline?.lookup('P1'));
  await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('.pos-reference-payments'));
  await page.evaluate(()=>window._posOffline.add('P1'));await page.locator('.aj-p').waitFor();await page.locator('.aj-p').fill('80');
  await context.setOffline(false);await page.reload();await page.locator('.aj-p').waitFor();assert.equal(await page.locator('.aj-p').inputValue(),'80','draft survives reload');
  const second=await context.newPage();await second.goto(base+'/apps/zenith/pos/Terminal');await second.waitForFunction(()=>window._posOffline?.paused());assert.match(await second.locator('body').innerText(),/another tab/);await second.close();
  await context.setOffline(true);await page.locator('.aj-qi').fill('');await page.locator('#pos-pay-cash').click();assert.equal(await page.locator('#pos-cash-received').count(),0,'invalid visible quantity blocks payment');await page.locator('.aj-qi').fill('2');
  await page.locator('#cartInlineSearch').focus();await page.keyboard.press('Space');assert.equal(await page.locator('#pos-pay-cash').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Enter');await page.locator('.pos-cash-quick[data-amt="189"]').click();await page.locator('#pos-cash-received').press('Enter');await page.locator('#oflPrintReceipt').waitFor();
  assert.equal((await page.evaluate(()=>window._posOffline.getQueue())).length,1,'confirmed sale is durable');assert.equal(await page.locator('.aj-p').count(),0,'queued sale clears draft');await page.locator('.ofl-cancel').click();
  await page.evaluate(()=>window._posOffline.add('P1'));await page.locator('#pos-pay-upi').click();await page.locator('#oflConfirmPayment').click();await page.locator('#oflPrintReceipt').waitFor();await page.locator('.ofl-cancel').click();assert.equal((await page.evaluate(()=>window._posOffline.getQueue())).length,2);
  await context.setOffline(false);await page.getByRole('status').filter({hasText:'Review in History: 1'}).waitFor();assert.equal((await page.evaluate(()=>window._posOffline.getQueue())).length,2,'missing acknowledgement never removes sales');
  await page.reload();await page.getByRole('status').filter({hasText:'Review in History: 1'}).waitFor();
  assert.doesNotMatch(await page.locator('body').innerText(),/Offline sales retained for review/,'pending sales do not trigger the old opening popup');
  ackMode='partial';assert.equal(await page.evaluate(()=>window._posOffline.sync()),1);assert.equal((await page.evaluate(()=>window._posOffline.getQueue())).length,1);
  ackMode='error';assert.equal(await page.evaluate(()=>window._posOffline.sync()),0);assert.equal((await page.evaluate(()=>window._posOffline.getQueue())).length,1,'HTTP failure retains sale');
  ackMode='all';assert.equal(await page.evaluate(()=>window._posOffline.sync()),1);assert.equal((await page.evaluate(()=>window._posOffline.getQueue())).length,0);assert(calls>=4);
  async function staleSnapshot(tab,id='OLD'){await tab.evaluate(id=>new Promise((resolve,reject)=>{const r=indexedDB.open('ZenithPosOffline-QA_ORG');r.onsuccess=()=>{const tx=r.result.transaction('state','readwrite'),store=tx.objectStore('state'),all=store.getAll();all.onsuccess=()=>{const config=all.result.find(x=>x.key.startsWith('config:')),scope=config.key.slice(7);store.put({key:'draft:'+scope,value:null});store.put({key:'snapshot:'+scope,value:{success:true,transactionId:id,sourceRevision:'saved-revision',paid:0,items:[{pid:'P1',name:id==='OLD'?'PREVIOUS BILL ITEM':'CURRENT BILL ITEM',qty:1,price:99,mode:'RETAIL',disc:0}]}});};tx.oncomplete=()=>{r.result.close();resolve()};tx.onerror=reject;};r.onerror=reject;}),id);}
  await staleSnapshot(page);await page.close();
  const changed=await context.newPage();await changed.route('**/exportPosCatalog',route=>route.abort());
  const changedBoot=changed.waitForRequest('**/exportPosCatalog');await changed.goto(base+'/apps/zenith/pos/Terminal?tx=NEW');await changedBoot;
  await context.setOffline(true);await changed.waitForFunction(()=>window._posOffline?.paused());
  assert.equal(await changed.evaluate(()=>window._posOffline.paused()),true,'a different bill cannot reuse an older cached snapshot');
  assert.doesNotMatch(await changed.locator('body').innerText(),/PREVIOUS BILL ITEM/);
  assert.equal((await changed.evaluate(()=>window._posOffline.getQueue())).length,0);
  await context.setOffline(false);await staleSnapshot(changed);await changed.close();
  const fresh=await context.newPage();await fresh.route('**/exportPosCatalog',route=>route.abort());
  const freshBoot=fresh.waitForRequest('**/exportPosCatalog');await fresh.goto(base+'/apps/zenith/pos/Terminal');await freshBoot;
  await context.setOffline(true);await fresh.waitForFunction(()=>document.querySelector('.pos-reference-payments'));
  assert.equal(await fresh.locator('.aj-p').count(),0,'a fresh bill starts empty despite an older cached snapshot');
  await fresh.evaluate(()=>window._posOffline.add('P1'));assert.equal(await fresh.locator('.aj-p').count(),1);
  assert.doesNotMatch(await fresh.locator('body').innerText(),/PREVIOUS BILL ITEM/);
  await context.setOffline(false);await staleSnapshot(fresh,'NEW');await fresh.close();
  const matching=await context.newPage();await matching.route('**/exportPosCatalog',route=>route.abort());
  const matchingBoot=matching.waitForRequest('**/exportPosCatalog');await matching.goto(base+'/apps/zenith/pos/Terminal?tx=NEW');await matchingBoot;
  await context.setOffline(true);await matching.locator('.aj-p').waitFor();
  assert.equal(await matching.evaluate(()=>window._posOffline.paused()),false,'the current bill remains editable using its matching snapshot');
  assert.equal(await matching.locator('.aj-p').inputValue(),'99');assert.match(await matching.locator('body').innerText(),/CURRENT BILL ITEM/);
  console.log('PASS offline draft reload, single-tab ownership, invalid input, keyboard cash, durable checkout, acknowledgements, retry and current/previous-bill snapshot isolation.');
 }finally{await context.close();await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
