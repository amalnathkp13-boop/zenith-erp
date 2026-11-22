const {randomUUID}=require('node:crypto');
const path=require('node:path');

module.exports=async function({a,base,check,q,invoke,post,out}) {
 const session=id=>q(`SELECT * FROM pos_session WHERE session_id='${id}'`)[0];
 await post('PosSessions','saveIdlePolicy',{enabled:'Y'});
 await post('PosQaAcceptance','invoke',{op:'idleJobState',paused:'Y'});
 async function fixture(kind,layout) {
  const terminalId='QA_IDLE_WORK_browser_'+randomUUID().slice(0,8);
  await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable idle browser '+kind+' '+layout,
   facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
  const {sessionId}=await invoke('open',{terminalId,openingCash:'0'});
  const page=await a.c.newPage();
  if(kind==='POS')await page.addInitScript(mode=>localStorage.setItem('posLayoutMode',mode),layout);
  const url=base+'/apps/zenith/'+(kind==='POS'?'pos/Terminal':'kot/KotBilling')+'?sessionId='+sessionId;
  await page.goto(url);
  await page.locator(kind==='POS'?'#cartInlineSearch':'#kb-wrap[data-ready=true]').waitFor();
  return {page,sessionId,terminalId,url,kind,layout};
 }
 function touchResponse(page,activity) {
  return page.waitForResponse(r=>r.url().endsWith('/touchSession')&&
   new URLSearchParams(r.request().postData()||'').get('activity')===activity);
 }
 async function arm(f) {
  const clock=await post('PosQaAcceptance','idleClock',{sessionId:f.sessionId,remainingSeconds:'20'});
  check(f.kind+' '+f.layout+' uses a controlled server deadline',(await clock.json()).backdated===true);
  const response=touchResponse(f.page,'N');
  await f.page.reload();
  const idle=await (await response).json();
  check(f.kind+' '+f.layout+' initial heartbeat reports remaining server time without resetting it',
   idle.success&&idle.open===true&&idle.idleCloseAfterMs>0&&idle.idleCloseAfterMs<=20000,idle);
  if(f.kind==='KOT'&&f.layout==='grid') {
   // Select the presentation without generating a trusted cashier gesture that would reset the deadline.
   await f.page.locator('[data-kb-view=grid]').evaluate(button=>button.click());
   check('KOT expiry case uses the grid layout',await f.page.locator('#kb-wrap').evaluate(root=>root.classList.contains('kg-grid')));
  }
 }
 async function addUnsentKotCart(f) {
  // DOM events intentionally remain untrusted: fixture entry must not restart the controlled idle clock.
  await f.page.locator('#kb-search').evaluate(input=>{
   input.value='Disposable POS A P18';input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await f.page.locator('#kb-suggestions [data-result]').filter({hasText:'Disposable POS A P18'}).first().evaluate(button=>button.click());
  for(const [field,value] of [['rate','137.5'],['qty','3.5']])await f.page.locator('#kb-cart [data-kb-edit='+field+']').first().evaluate((input,value)=>{
   input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));
  },value);
  await f.page.locator('#kb-instr').evaluate(input=>{input.value='Disposable idle retained manual rate';});
  await f.page.waitForFunction(()=>document.querySelector('#kb-grand')?.textContent.includes('₹'));
  check('KOT '+f.layout+' retains an unpaid online cart before expiry',
   await f.page.locator('#kb-cart [data-kb-edit=rate]').first().inputValue()==='137.5'&&
   await f.page.locator('#kb-cart [data-kb-edit=qty]').first().inputValue()==='3.5');
 }
 async function assertRestoredKotCart(f) {
  const saved=await f.page.evaluate(()=>{
   const cfg=document.getElementById('kb-data').dataset;
   return JSON.parse(sessionStorage.getItem('zenith-kot-back-terminal:'+JSON.stringify([cfg.org,cfg.user,cfg.terminal])));
  });
  check('KOT '+f.layout+' automatically preserves the online cart in terminal-scoped browser storage',
   saved?.items[0].manualRate===137.5&&saved.items[0].qty===3.5&&saved.order.billingView===f.layout,saved);
  await f.page.locator('#pos-idle-closed button').click();
  await f.page.waitForURL(url=>!url.pathname.endsWith('/KotBilling'));
  const next=await invoke('open',{terminalId:f.terminalId,openingCash:'0'});
  check('KOT '+f.layout+' reopens a new shift after idle closure',next.sessionId!==f.sessionId);
  const submissions=[];
  f.page.on('request',request=>{if(/\/(checkoutKot|createKot)$/.test(new URL(request.url()).pathname))submissions.push(request.url());});
  await f.page.goto(base+'/apps/zenith/kot/KotBilling?sessionId='+next.sessionId);
  await f.page.locator('#kb-cart [data-kb-edit=qty]').first().waitFor();
  check('KOT '+f.layout+' restores the unsent manual rate, quantity, note and layout in the new shift',
   await f.page.locator('#kb-cart [data-kb-edit=rate]').first().inputValue()==='137.5'&&
   await f.page.locator('#kb-cart [data-kb-edit=qty]').first().inputValue()==='3.5'&&
   await f.page.locator('#kb-instr').inputValue()==='Disposable idle retained manual rate'&&
   await f.page.locator('#kb-wrap').evaluate((root,grid)=>root.classList.contains('kg-grid')===grid,f.layout==='grid'));
  check('KOT '+f.layout+' restoring a cart never replays checkout',submissions.length===0&&
   Number(q(`SELECT count(*) AS n FROM pos_transaction WHERE session_id='${next.sessionId}'`)[0].n)===0,submissions);
  await invoke('close',{sessionId:next.sessionId,closingCash:'0'});
 }
 // Real browser timers, not a direct close endpoint: both POS layouts and both KOT layouts.
 for(const [kind,layout] of [['POS','normal'],['POS','advanced'],['KOT','list'],['KOT','grid']]) {
  const f=await fixture(kind,layout);
  try {
   await arm(f);
   if(kind==='KOT')await addUnsentKotCart(f);
   await f.page.locator('#pos-idle-closed[open]').waitFor({timeout:25000});
   const row=session(f.sessionId);
   check(kind+' '+layout+' closes automatically at its server deadline without a cashier click',
    row.status_id==='PsClosed'&&row.close_reason==='IdleUnverifiedCash'&&row.closing_cash===null,row);
   check(kind+' '+layout+' explains automatic closure instead of asking for manual cash close',
    await f.page.getByRole('heading',{name:'Session closed automatically',exact:true}).isVisible());
   await f.page.screenshot({path:path.join(out,'idle-auto-close-'+kind+'-'+layout+'.png')});
   if(kind==='KOT')await assertRestoredKotCart(f);
  } finally {await f.page.close();}
 }
 const failedStorage=await fixture('KOT','list');
 try {
  await arm(failedStorage);await addUnsentKotCart(failedStorage);
  await failedStorage.page.evaluate(()=>{
   const original=Storage.prototype.setItem;
   window.restoreIdleStorage=()=>Storage.prototype.setItem=original;
   Storage.prototype.setItem=function(key,value){
    if(key.startsWith('zenith-kot-back-terminal:'))throw new DOMException('Disposable QA storage failure','SecurityError');
    return original.call(this,key,value);
   };
  });
  await failedStorage.page.locator('#pos-idle-closed[open]').waitFor({timeout:25000});
  check('KOT idle closure explains a browser-storage failure',
   (await failedStorage.page.locator('#pos-idle-closed p').innerText()).includes('The browser could not save this cart'));
  const url=failedStorage.page.url();
  await failedStorage.page.locator('#pos-idle-closed button').click();
  check('KOT storage failure blocks navigation and keeps the unsent cart visible',failedStorage.page.url()===url&&
   await failedStorage.page.locator('#pos-idle-closed[open]').isVisible()&&
   await failedStorage.page.locator('#kb-cart [data-kb-edit=qty]').first().inputValue()==='3.5');
  await failedStorage.page.evaluate(()=>window.restoreIdleStorage());
  await failedStorage.page.locator('#pos-idle-closed button').click();
  await failedStorage.page.waitForURL(url=>!url.pathname.endsWith('/KotBilling'));
 } finally {await failedStorage.page.close();}
 // A real keystroke resets the hour; status polling and revisiting the screen do not.
 for(const kind of ['POS','KOT']) {
  const f=await fixture(kind,kind==='POS'?'normal':'list');
  try {
   await arm(f);
   const old=session(f.sessionId).last_activity_date;
   const response=touchResponse(f.page,'Y');
   await f.page.keyboard.press('Shift');
   const active=await (await response).json();
   const touched=session(f.sessionId).last_activity_date;
   check(kind+' trusted keyboard input starts a new full idle hour',
    active.open===true&&active.idleCloseAfterMs>3590000&&new Date(touched)>new Date(old),active);
   await f.page.waitForTimeout(21000);
   const later=session(f.sessionId);
   check(kind+' background polling preserves the activity timestamp and survives the old deadline',
    later.status_id==='PsOpen'&&later.last_activity_date===touched&&await f.page.locator('#pos-idle-closed').count()===0,later);
  } finally {
   await f.page.close();
   for(const bill of q(`SELECT transaction_id FROM pos_transaction WHERE session_id='${f.sessionId}' AND status_id='PtCreated'`))
    await invoke('void',{transactionId:bill.transaction_id});
   await invoke('close',{sessionId:f.sessionId,closingCash:'0'});
  }
 }
};
