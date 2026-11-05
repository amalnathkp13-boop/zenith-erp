const path=require('node:path');
const {randomUUID}=require('node:crypto');
module.exports=async({a,browser,base,check,invoke,post,q,out})=>{
 const shop='POS_QA_A_FAC', otherShop='POS_QA_A_KPI_FAC', terminalId='POS_QA_A_KPI_TERM';
 const page=await a.c.newPage();
 const staff=await browser.newContext();
 const route=(actor,suffix,form)=>actor.c.request.post(base+'/apps/zenith/'+suffix,{
  maxRedirects:0,form:{moquiSessionToken:actor.t,...form}
 });
 const select=(actor,id)=>route(actor,'setActiveShop',{facilityId:id,returnUrl:'/apps/zenith/Dashboard'});
 const view=async actorPage=>{
  const data=actorPage.locator('#z-shopdata');
  return {active:await data.getAttribute('data-active'),restricted:await data.getAttribute('data-restricted'),
   options:await data.locator('i').evaluateAll(items=>items.map(item=>item.dataset.id))};
 };
 const kpis=async()=>{
  await page.goto(base+'/apps/zenith/Dashboard?dashPeriod=today');
  const amount=async label=>Number((await page.locator('.zsc-footer').filter({hasText:label}).locator('strong').innerText()).replace(/[₹,]/g,''));
  check('Owner overview retains four cards and two KPI footer rows',await page.locator('.zsc').count()===4&&await page.locator('.zsc-footer').count()===2);
  return {sales:await amount('Total invoices'),digital:await amount('Online payment')};
 };
 try{
  await select(a,'');
  const combinedBaseline=await kpis();
  await select(a,shop);
  const baseline=await kpis();
  const seed=await post('PosQaAcceptance','seedShopDashboard',{});
  check('Disposable shop and accounting records seeded',seed.ok()&&(await seed.json()).success);
  await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable KPI counter',facilityId:otherShop,organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
  const session=await invoke('open',{terminalId,openingCash:'0'});
  const sale=await invoke('cart',{sessionId:session.sessionId});
  await invoke('add',{transactionId:sale.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
  await invoke('pay',{transactionId:sale.transactionId,paymentMethod:'Cash',amount:'23'});
  await invoke('pay',{transactionId:sale.transactionId,paymentMethod:'UPI',amount:'77'});
  await invoke('complete',{transactionId:sale.transactionId});
  const refund=await invoke('returnCreate',{sessionId:session.sessionId,originalTransactionId:sale.transactionId,refundMethod:'Card',
   items:JSON.stringify([{productId:'POS_QA_A_P18',quantity:'0.2',unitPrice:'100'}])});
  await invoke('returnComplete',{returnId:refund.returnId});
  await select(a,shop);
  const first=await kpis();
  check('First shop counts the finalized invoice and net posted bank payment only',
   first.sales===baseline.sales+1&&first.digital===baseline.digital+31,{baseline,first});
  await select(a,otherShop);
  const second=await kpis();
  check('Second shop counts one POS invoice and only the digital tender less its refund',second.sales===1&&second.digital===57,second);
  await select(a,'');
  const combined=await kpis();
  check('Combined owner view adds both test shops without double counting',
   combined.sales===combinedBaseline.sales+(first.sales-baseline.sales)+second.sales&&
   combined.digital===combinedBaseline.digital+(first.digital-baseline.digital)+second.digital,
   {combinedBaseline,baseline,first,second,combined});
  if(out) await page.locator('.zsc-row').screenshot({path:path.join(out,'owner-dashboard-kpis.png')});
  await page.setViewportSize({width:390,height:780});
  check('Both KPI footers fit the dashboard on mobile',await page.locator('.zsc-footer').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().right<=innerWidth)));
  if(out) await page.locator('.zsc-row').screenshot({path:path.join(out,'owner-dashboard-kpis-mobile.png')});
  await page.setViewportSize({width:1366,height:768});
  await page.goto(base+'/apps/zenith/Settings/RoleEditor');
  const catalogue=JSON.parse(await page.locator('#z-role-editor').getAttribute('data-catalogue'));
  const pos=catalogue.find(module=>module.id==='pos').screens.map(screen=>screen.id);
  check('Role catalogue lists POS tabs and hides internal pages',pos.includes('/pos/Dashboard')&&pos.includes('/pos/Terminal')&&
   ['/pos/WeighingScales','/pos/ReceiptPdf','/pos/QrPayments','/pos/PosLock','/pos/OwnerDashboard'].every(id=>!pos.includes(id)),pos);
  const username='scope.qa.'+randomUUID()+'@example.com',password='Qa9!'+randomUUID();
  await route(a,'Settings/Users/createUser',{username,userFullName:'Disposable Shop Staff',newPassword:password,newPasswordVerify:password});
  const userId=q("SELECT user_id FROM user_account WHERE username='"+username+"'")[0]?.user_id;
  check('Shop staff account created for the test',!!userId);
  await page.goto(base+'/qapps/zenith/Settings/Users');
  const staffRow=page.locator('tr,.tr').filter({hasText:username});
  await staffRow.getByRole('button',{name:'Manage roles'}).click();
  const form=page.locator('.z-manage-roles:visible');
  await form.getByText('Assigned shops',{exact:true}).waitFor();
  await form.getByLabel('Store Manager',{exact:true}).check();
  await form.locator('input[name=selectedShopIds][value="'+shop+'"]').check();
  check('Manage roles uses independent role and shop controls',await form.locator('fieldset').count()===2&&
   await form.locator('fieldset').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+2)));
  await form.getByRole('button',{name:'Save access'}).click();
  const policy=()=>q("SELECT shop_ids_json FROM organization_user_shop_access WHERE organization_party_id='POS_QA_A' AND user_id='"+userId+"'")[0]?.shop_ids_json;
  await page.waitForLoadState('networkidle');
  check('Manage roles persists the selected shop',policy()==='["'+shop+'"]',policy());
  await route(a,'Settings/Users/saveRoles',{userId,selectedRoles:'ZENITH_STORE_MGR',saveShopAccess:'Y',selectedShopIds:'POS_QA_B_FAC'});
  check('An owner cannot assign another organization’s shop',policy()==='["'+shop+'"]');
  const auth={Authorization:'Basic '+Buffer.from(username+':'+password).toString('base64')};
  await staff.request.get(base+'/apps/zenith/pos/Dashboard',{headers:auth});
  const staffPage=await staff.newPage();
  await staffPage.goto(base+'/apps/zenith/pos/Dashboard');
  const token=await staffPage.locator('#z-shopdata').getAttribute('data-token');
  const actor={c:staff,t:token};
  const allowed=await view(staffPage);
  check('Single-shop login only sees its assigned shop',allowed.restricted==='true'&&allowed.active===shop&&allowed.options.join()===shop,allowed);
  await select(actor,otherShop);
  await select(actor,'');
  await staffPage.goto(base+'/apps/zenith/pos/Dashboard?dashLoc='+otherShop);
  const blocked=await view(staffPage);
  check('Forged same-tenant shop and All Shops requests keep the assigned shop',blocked.active===shop&&blocked.options.join()===shop,blocked);
  const loc=await staffPage.locator('.pos-dash-chart-controls input[name=dashLoc]').inputValue();
  check('Direct POS dashboard replaces an out-of-scope location with the assigned shop',loc===shop,{loc});
  const promote=new URLSearchParams({moquiSessionToken:a.t,userId,saveShopAccess:'Y'});
  ['ZENITH_STORE_MGR','ZENITH_MULTI_SHOP_MANAGER'].forEach(role=>promote.append('selectedRoles',role));
  [shop,otherShop].forEach(id=>promote.append('selectedShopIds',id));
  await a.c.request.post(base+'/apps/zenith/Settings/Users/saveRoles',{data:promote.toString(),
   headers:{'Content-Type':'application/x-www-form-urlencoded'},maxRedirects:0});
  const manager=await browser.newContext();
  try{
   await manager.request.get(base+'/apps/zenith/pos/Dashboard',{headers:auth});
   const managerPage=await manager.newPage();
   await managerPage.goto(base+'/apps/zenith/pos/Dashboard');
   const scope=await view(managerPage);
   check('Multiple Shop Manager receives exactly the assigned shops',scope.restricted==='true'&&scope.options.length===2&&scope.options.includes(otherShop),scope);
   const m={c:manager,t:await managerPage.locator('#z-shopdata').getAttribute('data-token')};
   await select(m,otherShop);
   await managerPage.goto(base+'/apps/zenith/pos/Dashboard');
   check('Multiple Shop Manager can switch within their assigned shops',(await view(managerPage)).active===otherShop);
   await managerPage.locator('#z-ownerview').click();
   check('Multiple Shop Manager has no All Shops option',await managerPage.locator('#z-shopmenu').getByText('All Shops (combined)').count()===0);
  }finally{await manager.close();}
  await invoke('close',{sessionId:session.sessionId,closingCash:'23'});
 }finally{await select(a,'');await staff.close();await page.close();}
};
