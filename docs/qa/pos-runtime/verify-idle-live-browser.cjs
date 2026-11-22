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
  const url=base+'/apps/zenith/pos/'+(kind==='POS'?'Terminal':'Kitchen/KotBilling')+'?sessionId='+sessionId;
  await page.goto(url);
  await page.locator(kind==='POS'?'#cartInlineSearch':'#kb-wrap[data-ready=true]').waitFor();
  return {page,sessionId,url,kind,layout};
 }
 function touchResponse(page,activity) {
  return page.waitForResponse(r=>r.url().endsWith('/touchSession')&&
   new URLSearchParams(r.request().postData()||'').get('activity')===activity);
 }
 async function arm(f) {
  const clock=await post('PosQaAcceptance','idleClock',{sessionId:f.sessionId,remainingSeconds:'15'});
  check(f.kind+' '+f.layout+' uses a controlled server deadline',(await clock.json()).backdated===true);
  const response=touchResponse(f.page,'N');
  await f.page.reload();
  const idle=await (await response).json();
  check(f.kind+' '+f.layout+' initial heartbeat reports remaining server time without resetting it',
   idle.success&&idle.open===true&&idle.idleCloseAfterMs>0&&idle.idleCloseAfterMs<=15000,idle);
  if(f.kind==='KOT'&&f.layout==='grid') {
   // Select the presentation without generating a trusted cashier gesture that would reset the deadline.
   await f.page.locator('[data-kb-view=grid]').evaluate(button=>button.click());
   check('KOT expiry case uses the grid layout',await f.page.locator('#kb-wrap').evaluate(root=>root.classList.contains('kg-grid')));
  }
 }
 // Real browser timers, not a direct close endpoint: both POS layouts and both KOT layouts.
 for(const [kind,layout] of [['POS','normal'],['POS','advanced'],['KOT','list'],['KOT','grid']]) {
  const f=await fixture(kind,layout);
  try {
   await arm(f);
   await f.page.locator('#pos-idle-closed[open]').waitFor({timeout:25000});
   const row=session(f.sessionId);
   check(kind+' '+layout+' closes automatically at its server deadline without a cashier click',
    row.status_id==='PsClosed'&&row.close_reason==='IdleUnverifiedCash'&&row.closing_cash===null,row);
   check(kind+' '+layout+' explains automatic closure instead of asking for manual cash close',
    await f.page.getByRole('heading',{name:'Session closed automatically',exact:true}).isVisible());
   await f.page.screenshot({path:path.join(out,'idle-auto-close-'+kind+'-'+layout+'.png')});
  } finally {await f.page.close();}
 }
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
   await f.page.waitForTimeout(16000);
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
