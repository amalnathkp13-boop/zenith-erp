// Real service/HTTP/SQL regression on the disposable, loopback POS runtime only.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{chromium}=require('playwright');
const base='http://127.0.0.1:18084',out=process.env.POS_DRIVE_OUT,java=process.env.POS_QA_JAVA,runtime=process.env.POS_QA_NATIVE_ROOT;
if(!out||!java||!runtime)throw Error('Disposable native fixture paths required');
fs.mkdirSync(out,{recursive:true});const classes=path.join(out,'classes');fs.mkdirSync(classes,{recursive:true});
cp.execFileSync(path.join(path.dirname(java),'javac.exe'),['-d',classes,path.join(__dirname,'../pos-runtime/PosDbProbe.java')],{windowsHide:true});
const q=sql=>JSON.parse(cp.execFileSync(java,['-cp',classes+path.delimiter+path.join(runtime,'WEB-INF/lib/h2-2.4.240.jar'),'PosDbProbe'],{input:sql,encoding:'utf8',windowsHide:true,env:{...process.env,POS_QA_DB_URL:'jdbc:h2:tcp://127.0.0.1:19096/mem:pos-qa;IFEXISTS=TRUE'}}));
const checks=[];function check(name,passed){checks.push({name,passed:!!passed});console.log((passed?'PASS ':'FAIL ')+name);}
(async()=>{let browser;try{
 for(let n=0;n<120;n++){try{if((await fetch(base+'/Login')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,1000));}
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 async function actor(name){const c=await browser.newContext({viewport:{width:1366,height:900}});const r=await c.request.get(base+(name==='pos.cashier.qa'?'/apps/zenith/pos/Terminal':'/apps/zenith/Contacts/Customers'),{headers:{Authorization:'Basic '+Buffer.from(name+':moqui').toString('base64')}});const token=(await r.text()).match(/name="moquiSessionToken"[^>]*value="([^"]+)"/)?.[1];if(!token)throw Error('Fixture login failed');const post=(screen,transition,data={})=>c.request.post(base+'/apps/zenith/pos/'+screen+'/'+transition,{form:{moquiSessionToken:token,...data},maxRedirects:0});return{c,token,post,invoke:async(op,data={})=>(await post('PosQaAcceptance','invoke',{op,...data})).json()};}
 const admin=await actor('john.doe');if(!q("SELECT * FROM party WHERE party_id='POS_QA_A'").length){if(!(await (await admin.post('PosQaAcceptance','initialize')).json()).initialized)throw Error('Fixture initialization failed');}
 const manager=await actor('pos.qa'),cashier=await actor('pos.cashier.qa'),foreign=await actor('pos.b.qa');
 const session=(await manager.invoke('open',{terminalId:'POS_QA_A_TERM1',openingCash:'0'})).result;
 if(!session?.sessionId)throw Error('Free-item verifier requires a fresh disposable runtime');
 async function cart(mixed=false){const id=(await manager.invoke('cart',{sessionId:session.sessionId,reuseOpenCart:'false'})).result.transactionId;await manager.c.request.get(base+'/apps/zenith/pos/Terminal?sessionId='+session.sessionId+'&transactionId='+id+'&taxOn=N');await manager.invoke('add',{transactionId:id,productId:'POS_QA_A_P5',quantity:'1',discountPercent:'100',taxOn:'N'});if(mixed)await manager.invoke('add',{transactionId:id,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});return id;}
 const id=await cart(true),free=await cart(),credit=await cart(true);
 const pay=await cashier.invoke('pay',{transactionId:id,paymentMethod:'Cash',amount:'100'});
 check('Unapproved free item blocks tender before any money is recorded',pay.errors?.length>0&&q(`SELECT * FROM pos_payment WHERE transaction_id='${id}'`).length===0);
 const complete=await cashier.invoke('complete',{transactionId:free});
 check('Direct zero-total completion requires explicit approval',complete.errors?.length>0&&q(`SELECT status_id FROM pos_transaction WHERE transaction_id='${free}'`)[0].status_id==='PtCreated');
 const cr=await cashier.invoke('credit',{transactionId:credit,customerName:'Synthetic Free Approval',customerPhone:'9990001234'});
 check('Credit completion cannot bypass free-item approval',cr.errors?.length>0&&q(`SELECT status_id FROM pos_transaction WHERE transaction_id='${credit}'`)[0].status_id==='PtCreated');
 const get=await manager.c.request.get(base+'/apps/zenith/pos/Terminal/approveFreeItems?transactionId='+id,{maxRedirects:0});
 check('GET cannot grant free-item approval',!(get.headers()['content-type']||'').includes('application/json'));
 if(process.env.POS_FREE_BASELINE==='true')return;
 await require('./free-items-policy.cjs')({manager,cashier,foreign,session,id,free,credit,cart,q,check,out,base});
 }catch(e){check('Free-item workflow verifier completes: '+e.message,false);}
 finally{if(browser)await browser.close();const report={productionAccess:false,checks,failures:checks.filter(c=>!c.passed)};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:checks.length,failures:report.failures.length}));if(report.failures.length)process.exitCode=1;}
})();
