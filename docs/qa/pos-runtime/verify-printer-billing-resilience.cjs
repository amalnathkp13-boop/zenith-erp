const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async ({a, base, check, q, invoke, post, out}) => {
 const failures = [];
 async function exercise(name, run) {
  try { await run(); check(name, true); }
  catch (error) { failures.push({name, error:error.message}); }
 }
 const productId = 'POS_QA_A_P18';
 const terminalId = 'POS_QA_RESILIENCE_' + Date.now().toString(36);
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable resilience counter',
  facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
 const {sessionId} = await invoke('open',{terminalId,openingCash:'0'});
 const context = await a.c.browser().newContext({storageState:await a.c.storageState(),viewport:{width:1366,height:768}});
 const page = await context.newPage();
 page.setDefaultTimeout(12000);
 page.setDefaultNavigationTimeout(25000);
 try {
  for (const [shell,module,width] of [['qapps','pos',1366],['apps','kot',390]]) {
   await exercise(shell+' '+module+' Add Printer fits in one solid panel',async()=>{
    await page.setViewportSize({width,height:750});
    await page.goto(base+'/'+shell+'/zenith/'+module+'/PrinterConfig',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:/Add Printer/i}).first().click();
    const geometry = await page.locator('#pm-printerId').evaluate(input=>{
     const form = input.closest('form');
     const panel = input.closest('dialog') || form;
     const {left,right,width} = panel.getBoundingClientRect();
     return {fits:left>=0 && right<=innerWidth+1 && width>0,
      stacked:input.getBoundingClientRect().top>=panel.querySelector('button').getBoundingClientRect().top,
      solid:getComputedStyle(panel).backgroundColor!=='rgba(0, 0, 0, 0)' && getComputedStyle(form).display==='block'};
    });
    await page.screenshot({path:path.join(out,shell+'-'+module+'-add-printer.png'),timeout:8000});
    assert.deepEqual(geometry,{fits:true,stacked:true,solid:true});
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.locator('#pm-printerId').isVisible(),false);
   });
  }
  await page.setViewportSize({width:1366,height:768});
  await exercise('Printer settings save and can be filtered, edited and deleted',async()=>{
   const printerId='QA_'+Date.now().toString(36);
   const printers=()=>q("SELECT printer_name, connection_type, ip_address, port, terminal_id FROM printer_configuration WHERE printer_id='"+printerId+"'");
   await page.goto(base+'/qapps/zenith/pos/PrinterConfig',{waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:/Add Printer/i}).first().click();
   await page.locator('#pm-printerId').fill(printerId);
   await page.locator('#pm-printerName').fill('Disposable network printer');
   await page.locator('#pm-connType').selectOption('Network');
   await page.locator('#pm-terminal').selectOption(terminalId);
   const invalid=await post('PrinterConfig','createPrinter',{printerId,printerName:'Invalid network printer',
    printerTypeEnumId:'PrtThermal',connectionType:'Network',port:'70000',isActive:'Y'});
   assert.ok(invalid.status()>=300);
   assert.equal(printers().length,0);
   await page.locator('#pm-ip').fill('192.0.2.10');
   await page.locator('#pm-port').fill('9100');
   const create=page.waitForResponse(response=>/\/createPrinter(?:\?|$)/.test(response.url())&&response.request().method()==='POST');
   await page.locator('#pm-save').click();
   await create;
   const [saved]=printers();
   assert.ok(saved,'Created printer is stored');
   assert.equal(saved.connection_type,'Network');
   assert.equal(Number(saved.port),9100);
   assert.equal(saved.terminal_id,terminalId);
   await page.goto(base+'/apps/zenith/pos/PrinterConfig?termFilter='+terminalId,{waitUntil:'domcontentloaded'});
   const row=page.locator('#PrinterListForm_table tr').filter({hasText:printerId});
   await row.locator('input[name=printerName]').fill('Renamed thermal printer');
   const update=page.waitForResponse(response=>/\/updatePrinter(?:\?|$)/.test(response.url())&&response.request().method()==='POST');
   await row.getByRole('button',{name:'Update',exact:true}).click();
   await update;
   assert.equal(printers()[0].printer_name,'Renamed thermal printer');
   await post('PrinterConfig','deletePrinter',{printerId});
   assert.equal(printers().length,0);
  });
  const productName=q("SELECT product_name FROM product WHERE product_id='"+productId+"'")[0].product_name;
  for (const kot of [false,true]) {
   const route = kot?'**/searchMenu':'**/lookupProducts';
   const label = kot?'KOT':'POS';
   await exercise(label+' search shows cached products during a stalled online request',async()=>{
    await page.goto(base+'/apps/zenith/'+(kot?'kot/KotBilling':'pos/Terminal')+'?sessionId='+sessionId,{waitUntil:'domcontentloaded'});
    if(kot) await page.locator('#kb-wrap[data-offline-ready=true]').waitFor();
    else await page.waitForFunction(id=>window._posOffline?.lookup(id),productId);
    let release;
    const stalled = new Promise(resolve=>{release=resolve;});
    await page.route(route,async request=>{await stalled;await request.abort().catch(()=>{});});
    try {
     const search=page.locator(kot?'#kb-search':'#cartInlineSearch');
     const matches=page.locator(kot?'#kb-suggestions [data-result]':'#cartSearchDropdown .cart-dd-item');
     await search.fill(productName);
     await matches.filter({hasText:productName}).first().waitFor({timeout:1500});
     await search.fill('');
     assert.equal(await matches.filter({hasText:productName}).first().isVisible(),false);
    } finally {
     release();
     await page.unroute(route);
    }
   });
  }
 } finally {
  await context.close();
  await invoke('close',{sessionId,closingCash:'0'});
 }
 check('Printer form and cached billing search regressions',failures.length===0,{failures});
};
