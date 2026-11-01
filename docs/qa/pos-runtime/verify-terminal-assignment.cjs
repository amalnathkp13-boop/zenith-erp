// Full assignment workflow against the isolated POS_QA fixture. Never production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {chromium}=require('playwright');
const base=process.env.POS_QA_BASE||'http://127.0.0.1:18084';assert.match(base,/^http:\/\/127\.0\.0\.1:18084$/);
const out=process.env.POS_QA_OUT||path.resolve('output/receipt-terminal');fs.mkdirSync(out,{recursive:true});
const root=process.env.POS_QA_NATIVE_ROOT,java=process.env.POS_QA_JAVA;assert.ok(root&&java,'explicit disposable native runtime required');
const classes=path.join(out,'db-probe');fs.mkdirSync(classes,{recursive:true});
cp.execFileSync(path.join(path.dirname(java),'javac.exe'),['-d',classes,path.join(__dirname,'PosDbProbe.java')],{windowsHide:true});
function q(sql){return JSON.parse(cp.execFileSync(java,['-cp',path.join(root,'WEB-INF/lib/h2-2.4.240.jar')+path.delimiter+classes,'PosDbProbe'],{input:sql,encoding:'utf8',windowsHide:true,env:{...process.env,POS_QA_DB_URL:'jdbc:h2:tcp://127.0.0.1:19096/mem:pos-qa;IFEXISTS=TRUE'}}));}
const checks=[];function check(name,value){assert.ok(value,name);checks.push(name);console.log('PASS '+name);}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.POS_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  if(!process.env.POS_QA_SKIP_INIT){const bootstrap=await browser.newContext();
  await bootstrap.request.get(base+'/apps/zenith/Contacts/Customers',{headers:{Authorization:'Basic '+Buffer.from('john.doe:moqui').toString('base64')}});
  let html=await (await bootstrap.request.get(base+'/apps/zenith/Contacts/Customers')).text();
  const token=html.match(/name="moquiSessionToken" value="([^"]+)"/)[1];
  const init=await bootstrap.request.post(base+'/apps/zenith/pos/PosQaAcceptance/initialize',{form:{moquiSessionToken:token}});
  assert.equal(init.status(),200);check('fresh disposable fixture initialized',(await init.json()).initialized);await bootstrap.close();}
  async function actor(username){const c=await browser.newContext({viewport:{width:1366,height:900}});await c.route('**/qz-tray@*/qz-tray.js',r=>r.fulfill({contentType:'text/javascript',body:'/* no hardware in QA */'}));await c.request.get(base+'/apps/zenith/pos/Terminal',{headers:{Authorization:'Basic '+Buffer.from(username+':moqui').toString('base64')}});const p=await c.newPage();await p.goto(base+'/apps/zenith/pos/Terminal');return {c,p,t:await p.locator('[name=moquiSessionToken]').first().inputValue()};}
  const admin=await actor('pos.qa'),cashier=await actor('pos.cashier.qa'),foreign=await actor('pos.b.qa');
  const post=(a,screen,transition,fields={},shell='apps')=>a.c.request.post(`${base}/${shell}/zenith/pos/${screen}/${transition}`,{form:{moquiSessionToken:a.t,...fields},maxRedirects:0});
  async function invoke(a,op,fields={},denied=false){const r=await post(a,'PosQaAcceptance','invoke',{op,...fields});const b=await r.json().catch(()=>({}));check(op+(denied?' denied':' accepted'),denied?r.status()===403||!!b.errors?.length:r.status()===200&&!b.errors?.length);return b.result||{};}
  const count=table=>Number(q('SELECT count(*) AS n FROM '+table)[0].n);
  if(process.env.POS_QA_SKIP_INIT)for(const row of q("SELECT session_id FROM pos_session WHERE organization_party_id='POS_QA_A' AND operator_party_id='POS_QA_CASHIER' AND status_id='PsOpen'"))await invoke(cashier,'close',{sessionId:row.session_id,closingCash:'0'});
  await invoke(admin,'assignTerminal',{userId:'POS_QA_CASHIER',terminalId:''});await cashier.p.reload();
  check('unassigned login has no terminal dropdown',await cashier.p.locator('select[name=terminalId]').count()===0);
  check('unassigned login is told to ask its admin',await cashier.p.locator('.pos-terminal-assignment-empty').isVisible());
  const before=count('pos_session');await invoke(cashier,'open',{terminalId:'POS_QA_A_TERM2'},true);check('rejected open writes no session',before===count('pos_session'));
  await invoke(cashier,'assignTerminal',{userId:'POS_QA_CASHIER',terminalId:'POS_QA_A_TERM1'},true);
  check('cashier cannot self-assign',count('pos_terminal_assignment')===0);
  await invoke(admin,'assignTerminal',{userId:'POS_QA_MANAGER_B',terminalId:'POS_QA_A_TERM1'},true);
  await invoke(admin,'assignTerminal',{userId:'POS_QA_CASHIER',terminalId:'POS_QA_B_TERM1'},true);
  check('foreign user and terminal assignments leave no records',count('pos_terminal_assignment')===0);
  await invoke(admin,'assignTerminal',{userId:'POS_QA_CASHIER',terminalId:'POS_QA_A_TERM1'});
  check('assignment persists in the database',q("SELECT terminal_id FROM pos_terminal_assignment WHERE user_id='POS_QA_CASHIER' AND organization_party_id='POS_QA_A'")[0].terminal_id==='POS_QA_A_TERM1');
  for(const shell of ['apps','qapps']){
   const response=await cashier.p.goto(`${base}/${shell}/zenith/pos/Terminal`);check(shell+' assigned login renders',response.status()===200);
   check(shell+' assigned terminal is fixed',await cashier.p.locator('select[name=terminalId]').count()===0&&await cashier.p.locator('input[name=terminalId]').inputValue()==='POS_QA_A_TERM1');
   check(shell+' terminal management denied',(await cashier.c.request.get(`${base}/${shell}/zenith/pos/PosTerminals`)).status()>=400);
   await admin.p.goto(`${base}/${shell}/zenith/pos/PosTerminals`);await admin.p.getByRole('button',{name:'Save terminal assignment',exact:true}).waitFor();check(shell+' admin assignment controls render',await admin.p.getByRole('button',{name:'Save terminal assignment',exact:true}).isVisible());
   await admin.p.screenshot({path:path.join(out,shell+'-assignments.png')});
  }
  const s=await invoke(cashier,'open',{terminalId:'POS_QA_A_TERM1',openingCash:'0'});
  check('session records assigned shop terminal',q(`SELECT terminal_id FROM pos_session WHERE session_id='${s.sessionId}'`)[0].terminal_id==='POS_QA_A_TERM1');
  await invoke(admin,'assignTerminal',{userId:'POS_QA_CASHIER',terminalId:'POS_QA_A_TERM2'},true);
  check('open session prevents reassignment',q("SELECT terminal_id FROM pos_terminal_assignment WHERE user_id='POS_QA_CASHIER'")[0].terminal_id==='POS_QA_A_TERM1');
  const other=await invoke(admin,'open',{terminalId:'POS_QA_A_TERM2',openingCash:'0'});
  await invoke(cashier,'terminalAccess',{sessionId:other.sessionId},true);
  const ct=await invoke(cashier,'cart',{sessionId:s.sessionId});const ot=await invoke(admin,'cart',{sessionId:other.sessionId});
  const amounts=JSON.stringify(q('SELECT transaction_id,payable_amount,status_id FROM pos_transaction ORDER BY transaction_id'));
  await invoke(cashier,'add',{transactionId:ot.transactionId,productId:'POS_QA_A_P18',quantity:'1',unitPrice:'5'},true);
  check('forged cart leaves saved amounts unchanged',amounts===JSON.stringify(q('SELECT transaction_id,payable_amount,status_id FROM pos_transaction ORDER BY transaction_id')));
  await invoke(cashier,'add',{transactionId:ct.transactionId,productId:'POS_QA_A_P18',quantity:'1',unitPrice:'5',taxOn:'N'});
  await invoke(cashier,'pay',{transactionId:ct.transactionId,paymentMethod:'Card',amount:'5'});await invoke(cashier,'complete',{transactionId:ct.transactionId});
  await invoke(cashier,'receipt',{transactionId:ct.transactionId});
  await cashier.p.goto(base+'/apps/zenith/pos/Terminal?sessionId='+s.sessionId);
  check('billing header has no counter switch for a locked login',await cashier.p.locator('details.nb-counter').count()===0);
  await cashier.p.screenshot({path:path.join(out,'locked-billing.png')});
  await invoke(cashier,'close',{sessionId:s.sessionId,closingCash:'0'});
  await invoke(admin,'close',{sessionId:other.sessionId,closingCash:'0'});
  await invoke(admin,'assignTerminal',{userId:'POS_QA_CASHIER',terminalId:'POS_QA_A_TERM2'});
  const historyResponse=await post(cashier,'Terminal','ajaxCart',{action:'billHistory'});
  const history=await historyResponse.json();
  check('history follows the current assignment without an explicit session',history.success&&history.bills.every(b=>b.txId!==ct.transactionId));
  await invoke(cashier,'receipt',{transactionId:ct.transactionId},true);
  const sessionsBefore=count('pos_session');await invoke(cashier,'open',{terminalId:'POS_QA_A_TERM1'},true);check('old terminal cannot be reopened after reassignment',sessionsBefore===count('pos_session'));
  const last=await invoke(cashier,'open',{terminalId:'POS_QA_A_TERM2'});
  await invoke(foreign,'terminalAccess',{terminalId:'POS_QA_A_TERM2'},true);
  await invoke(cashier,'close',{sessionId:last.sessionId,closingCash:'0'});
  for(const [shell,terminalId] of [['apps','POS_QA_A_TERM1'],['qapps','POS_QA_A_TERM2']]){
   await post(admin,'PosTerminals','saveAssignment',{userId:'POS_QA_CASHIER',terminalId},shell);
   check(shell+' assignment form transition persists the selected terminal',q("SELECT terminal_id FROM pos_terminal_assignment WHERE user_id='POS_QA_CASHIER'")[0].terminal_id===terminalId);
  }
  await post(admin,'PosTerminals','saveAssignment',{moquiSessionToken:'invalid',userId:'POS_QA_CASHIER',terminalId:'POS_QA_A_TERM1'});
  check('invalid CSRF cannot change assignments',q("SELECT terminal_id FROM pos_terminal_assignment WHERE user_id='POS_QA_CASHIER'")[0].terminal_id==='POS_QA_A_TERM2');
  fs.writeFileSync(path.join(out,'runtime-results.json'),JSON.stringify({productionWrites:false,checks},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
