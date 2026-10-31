// Disposable loopback only; no production accounts or writes.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base='http://127.0.0.1:18084',runtime=process.env.POS_QA_NATIVE_ROOT,java=process.env.POS_QA_JAVA,out=process.env.POS_QA_OUT;
assert(runtime&&java&&out,'Disposable runtime, Java and evidence directory are required');fs.mkdirSync(out,{recursive:true});
const classes=path.join(out,'classes');fs.mkdirSync(classes,{recursive:true});cp.execFileSync(path.join(path.dirname(java),'javac.exe'),['-d',classes,path.join(__dirname,'../pos-runtime/PosDbProbe.java')],{windowsHide:true});
const q=sql=>{assert.match(sql,/^SELECT /);return JSON.parse(cp.execFileSync(java,['-cp',classes+path.delimiter+path.join(runtime,'WEB-INF/lib/h2-2.4.240.jar'),'PosDbProbe'],{input:sql,encoding:'utf8',windowsHide:true,env:{...process.env,POS_QA_DB_URL:'jdbc:h2:tcp://127.0.0.1:19096/mem:pos-qa;IFEXISTS=TRUE'}}));};
const results=[],check=(name,ok,data={})=>{results.push({name,passed:!!ok,...data});console.log((ok?'PASS ':'FAIL ')+name);assert(ok,name);};
(async()=>{let browser;const contexts=[];try{
 for(let attempt=0;;attempt++){try{if((await fetch(base+'/Login',{signal:AbortSignal.timeout(5000)})).status<500)break;}catch{}if(attempt>=90)throw Error('Disposable runtime did not start');await new Promise(r=>setTimeout(r,1000));}
 browser=await chromium.launch({headless:true,executablePath:process.env.POS_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 async function actor(user){const c=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(c);const p=await c.newPage();await c.request.get(base+'/apps/zenith/Contacts/Customers',{headers:{Authorization:'Basic '+Buffer.from(user+':moqui').toString('base64')}});await p.goto(base+'/apps/zenith/Contacts/Customers',{waitUntil:'networkidle'});const token=await p.locator('[name=moquiSessionToken]').first().inputValue();return{c,p,token};}
 const admin=await actor('john.doe');
 if(!Number(q("SELECT count(*) n FROM party WHERE party_id='POS_QA_A'")[0].n)){const r=await admin.c.request.post(base+'/apps/zenith/pos/PosQaAcceptance/initialize',{form:{moquiSessionToken:admin.token}});check('Synthetic fixtures initialize',(await r.json()).initialized);}
 const a=await actor('pos.qa'),b=await actor('pos.b.qa'),product='POS_QA_A_P18',route='/zenith/Inventory/EditProduct',url=s=>`${base}/${s}${route}?productId=${product}`;
 const post=(actor,values,shell='apps',csrf=true)=>actor.c.request.post(`${base}/${shell}${route}/updateProduct`,{form:{...(csrf?{moquiSessionToken:actor.token}:{}),productId:product,...values},maxRedirects:0});
 const row=()=>q(`SELECT product_name,print_name,mrp_amount,owner_party_id,hsn_code,description FROM product WHERE product_id='${product}'`)[0];
 await post(a,{printName:''});
 const financialBefore=JSON.stringify(q('SELECT invoice_id,invoice_total,status_id FROM invoice ORDER BY invoice_id'));
 for(const shell of ['apps','qapps']){
  await a.p.goto(url(shell),{waitUntil:'networkidle'});await a.p.waitForSelector('#productEditor[data-bound=true]');
  check(shell+' editor exposes all reference sections',await a.p.locator('#productEditor .pe-card').count()===8&&await a.p.locator('#productEditor .pe-tabs a').count()===5);
  check(shell+' print name defaults to product name',await a.p.locator('[name=printName]').inputValue()===row().product_name);
  await a.p.locator('[name=productName]').fill('Disposable editor product');check(shell+' automatic print name follows typing',await a.p.locator('[name=printName]').inputValue()==='Disposable editor product');
  await a.p.locator('[name=printName]').fill('Custom receipt name');await a.p.locator('[name=productName]').fill('Disposable editor product renamed');check(shell+' explicit print name survives product rename',await a.p.locator('[name=printName]').inputValue()==='Custom receipt name');
  await a.p.locator('[data-pe-reset-name]').click();check(shell+' reset returns to automatic name',await a.p.locator('[name=printName]').inputValue()==='Disposable editor product renamed');
  await a.p.locator('[name=description]').fill('Synthetic editor save');
  await Promise.all([a.p.waitForNavigation({waitUntil:'networkidle'}),a.p.locator('button[type=submit][form=productEditorForm]').click()]);
  check(shell+' real form save persists and uses null automatic override',row().product_name==='Disposable editor product renamed'&&row().print_name===null&&row().description==='Synthetic editor save',row());
  await a.p.waitForSelector('#productEditor[data-bound=true]');
  for(const width of [1440,1024,768,390]){await a.p.setViewportSize({width,height:900});await a.p.waitForTimeout(100);const sizes=await a.p.locator('#productEditor').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));check(shell+' editor no horizontal overflow at '+width,sizes.scroll<=sizes.width+2,sizes);}
  await a.p.setViewportSize({width:1440,height:1000});await a.p.screenshot({path:path.join(out,`editor-${shell}.png`),fullPage:true});
 }
 await a.p.goto(`${base}/apps${route}?productId=POS_QA_A_UNPRICED`,{waitUntil:'networkidle'});await a.p.waitForSelector('#productEditor[data-bound=true]');
 check('Unpriced product keeps a blank MRP input',await a.p.locator('[name=mrpAmount]').inputValue()==='');
 await Promise.all([a.p.waitForNavigation({waitUntil:'networkidle'}),a.p.locator('button[type=submit][form=productEditorForm]').click()]);
 check('Saving unpriced product does not turn it into a free item',q("SELECT mrp_amount FROM product WHERE product_id='POS_QA_A_UNPRICED'")[0].mrp_amount===null);
 await post(a,{printName:'Synthetic printed cup'});check('Custom print name persists',row().print_name==='Synthetic printed cup');
 await post(a,{productName:'Synthetic renamed cup'});check('Partial product rename preserves explicit print name',row().print_name==='Synthetic printed cup');
 const before=row();for(const values of [{productName:''},{mrpAmount:'bad'},{mrpAmount:'-1'},{reorderPoint:'-1'},{printName:'x'.repeat(256)},{gstSlabId:'not-a-slab'},{productTypeEnumId:'wrong'},{pseudoId:'POS_QA_A_P5'},{imageData:'data:image/png;base64,ZmFrZQ=='}]){await post(a,values);check('Invalid input rejected '+Object.keys(values)[0],JSON.stringify(row())===JSON.stringify(before));}
 await post(a,{ownerPartyId:'POS_QA_B',mrpAmount:'100'});check('Forged ownership ignored',row().owner_party_id==='POS_QA_A');
 await post(b,{productName:'Foreign attempt'});check('Foreign update rejected',row().product_name==='Synthetic renamed cup');
 await post(a,{productName:'No token'},'apps',false);check('Missing CSRF rejected',row().product_name==='Synthetic renamed cup');
 await b.p.goto(url('apps'),{waitUntil:'networkidle'});check('Foreign page hides product identity',await b.p.locator('#productEditor').count()===0&&!(await b.p.locator('body').innerText()).includes('Synthetic renamed cup'));
 // A small valid PNG is generated in memory, never copied from real customer assets.
 await a.p.goto(url('apps'),{waitUntil:'networkidle'});await a.p.waitForSelector('#productEditor[data-bound=true]');
 const image=await a.p.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;const c=canvas.getContext('2d');c.fillStyle='#7437ff';c.fillRect(0,0,20,20);return canvas.toDataURL('image/png');});
 await a.p.locator('[data-pe-file]').setInputFiles({name:'synthetic-product.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')});await a.p.waitForFunction(()=>document.querySelector('#productEditorForm [name=imageData]').value.startsWith('data:image/png;'));
 await Promise.all([a.p.waitForNavigation({waitUntil:'networkidle'}),a.p.locator('button[type=submit][form=productEditorForm]').click()]);
 check('Real image upload form persists separately from catalogue rows',Number(q(`SELECT count(*) n FROM product_editor_image WHERE product_id='${product}' AND organization_party_id='POS_QA_A'`)[0].n)===1);
 await a.p.goto(url('qapps'),{waitUntil:'networkidle'});check('Saved image survives reload',await a.p.locator('[data-pe-image]').getAttribute('src').then(v=>v?.startsWith('data:image/png;base64,')));
 await post(a,{removeImage:'Y'});check('Explicit image removal persists',Number(q(`SELECT count(*) n FROM product_editor_image WHERE product_id='${product}'`)[0].n)===0);
 await post(a,{mrpAmount:'110'});check('Price changes retain real audit history',Number(row().mrp_amount)===110&&Number(q(`SELECT count(*) n FROM price_change_log WHERE product_id='${product}' AND previous_price=100 AND new_price=110 AND organization_party_id='POS_QA_A'`)[0].n)>0);await post(a,{mrpAmount:'100'});
 check('Editor changes do not modify invoices',JSON.stringify(q('SELECT invoice_id,invoice_total,status_id FROM invoice ORDER BY invoice_id'))===financialBefore);
 await post(a,{printName:'Synthetic receipt cup'});
 async function invoke(op,values={}){const r=await a.c.request.post(base+'/apps/zenith/pos/PosQaAcceptance/invoke',{form:{moquiSessionToken:a.token,op,...values}});const body=await r.json();check('POS '+op+' succeeds',r.status()===200&&!body.errors?.length&&!body.validation?.length,body);return body.result;}
 const session=await invoke('open',{terminalId:'POS_QA_A_TERM1',openingCash:'0'}),sale=await invoke('cart',{sessionId:session.sessionId});
 await invoke('add',{transactionId:sale.transactionId,productId:product,quantity:'1',salesModeId:'RETAIL',taxOn:'N'});
 check('New POS item snapshots custom print name',q(`SELECT product_name FROM pos_transaction_item WHERE transaction_id='${sale.transactionId}'`)[0].product_name==='Synthetic receipt cup');
 await invoke('pay',{transactionId:sale.transactionId,paymentMethod:'Cash',amount:'100'});await invoke('complete',{transactionId:sale.transactionId});
 const issued=JSON.stringify(q(`SELECT invoice_id,invoice_total,status_id FROM invoice WHERE invoice_id=(SELECT invoice_id FROM pos_transaction WHERE transaction_id='${sale.transactionId}')`));
 await post(a,{printName:'Changed for future bills',productName:'Changed product identity'});
 const receipt=await invoke('receipt',{transactionId:sale.transactionId});check('Reprinting issued bill retains its saved custom name',receipt.receipt.items[0].name==='Synthetic receipt cup');
 check('Editing names does not alter or renumber issued invoice',issued===JSON.stringify(q(`SELECT invoice_id,invoice_total,status_id FROM invoice WHERE invoice_id=(SELECT invoice_id FROM pos_transaction WHERE transaction_id='${sale.transactionId}')`)));
 await post(a,{printName:''});await post(a,{productName:'Synthetic automatic cup'});check('Blank override follows later rename',row().print_name===null&&row().product_name==='Synthetic automatic cup');
 const next=await invoke('cart',{sessionId:session.sessionId});await invoke('add',{transactionId:next.transactionId,productId:product,quantity:'1',salesModeId:'RETAIL',taxOn:'N'});check('New default-name bill uses renamed product',q(`SELECT product_name FROM pos_transaction_item WHERE transaction_id='${next.transactionId}'`)[0].product_name==='Synthetic automatic cup');
 await invoke('void',{transactionId:next.transactionId});await invoke('close',{sessionId:session.sessionId,closingCash:'100'});
 const role=mode=>a.c.request.post(base+'/apps/zenith/Inventory/ProductEditorQa/role',{form:{moquiSessionToken:a.token,mode}});
 try{
  check('Disposable view-only role enabled',(await (await role('view')).json()).changed);
  const c=await browser.newContext();contexts.push(c);const p=await c.newPage();
  await c.request.get(url('apps'),{headers:{Authorization:'Basic '+Buffer.from('pos.cashier.qa:moqui').toString('base64')}});await p.goto(url('apps'),{waitUntil:'networkidle'});
  check('View-only editor disables changes',await p.locator('#productEditor fieldset[disabled]').count()===1&&await p.locator('#productEditor button[type=submit]').count()===0);
  const token=await p.locator('#productEditor [name=moquiSessionToken]').first().inputValue(),prior=JSON.stringify(row());
  await c.request.post(`${base}/apps${route}/updateProduct`,{form:{moquiSessionToken:token,productId:product,productName:'View-only write'}});
  check('Direct view-only update cannot change data',JSON.stringify(row())===prior);
 }finally{check('Synthetic cashier role restored',(await (await role('restore')).json()).changed);}
 }catch(error){results.push({name:'Runtime verification completed',passed:false,error:error.stack});throw error;}finally{for(const c of contexts)await c.close();await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({productionAccess:false,results,checks:results.length,failures:results.filter(r=>!r.passed).length},null,2));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

