const { randomUUID } = require('node:crypto');
const path = require('node:path');

module.exports = async ({ browser, a, foreign, base, check, q, out }) => {
 const tabs = [
  ['KotDashboard', 'KOT Dashboard', '#kd-wrap'],
  ['KitchenDisplay', 'Kitchen Display', '.zk-display'],
  ['KotBilling', 'KOT Billing', '#kot-terminal-entry'],
  ['Tables', 'Tables', '#tm-wrap'],
  ['KotHistory', 'KOT History', '#zk-history-toolbar'],
  ['WaiterManagement', 'Waiters', '#wf-search']
 ];
 const page = await a.c.newPage();
 const clerk = await browser.newContext({ viewport:{ width:1366, height:768 } });
 const post = (actor, route, values) => actor.c.request.post(base+'/apps/zenith/'+route,{
  maxRedirects:0,form:{ moquiSessionToken:actor.t,...values }
 });
 const completedOrders = page.locator('.kd-stat').filter({hasText:'Completed Orders'}).locator('.kd-stat__value');
 const kitchenTickets = page.locator('[data-kot-ticket-count]');
 const sales = page.locator('.kd-stat').filter({hasText:'Total Sales'}).locator('.kd-stat__value');
 const dashboardRoutes = ['kot/KotDashboard','pos/Kitchen/KotDashboard'];
 async function snapshotDashboard(route) {
  await page.goto(base+'/apps/zenith/'+route);
  return {
   completed:Number(await completedOrders.innerText()),
   tickets:Number(await kitchenTickets.innerText()),
   sales:await sales.innerText()
  };
 }
 try {
  for (const shell of ['apps','qapps']) {
   const sidebar = page.locator(shell==='apps'?'#z-sidebar a[data-match="/kot"]':'#zq-sidebar a[data-match="/kot"]');
   const strip = page.locator(shell==='apps'?'#z-subnav .zsub-grp.show':'#zq-subnav.show');
   const links = strip.locator('a:visible');
   await page.goto(base+'/'+shell+'/zenith/pos/Dashboard');
   await strip.locator('a[data-match="/pos/Dashboard"]').waitFor();
   const posLinks = await links.evaluateAll(anchors=>anchors.map(a=>a.getAttribute('data-match')));
   check(shell+' retains retail shortcuts in POS',
    ['/pos/Terminal','/pos/Barcodes','/pos/BarcodeLabels'].every(link=>posLinks.includes(link)),{posLinks});
   await sidebar.click();
   await page.locator('#kd-wrap').waitFor();
   const activeSidebar = sidebar.and(page.locator('.on'));
   await activeSidebar.waitFor();
   check(shell+' opens KOT as its own sidebar module',await activeSidebar.isVisible(),{url:page.url()});
   const kotLinks = await links.evaluateAll(anchors=>anchors.map(a=>[a.getAttribute('data-match'),new URL(a.href).pathname]));
   check(shell+' KOT navigation contains only the six kitchen tabs in order',
    JSON.stringify(kotLinks)===JSON.stringify(tabs.map(([seg])=>['/kot/'+seg,'/'+shell+'/zenith/kot/'+seg])),{kotLinks});
   const shellSelector=shell==='apps'?'#z-sidebar':'#zq-sidebar';
   await page.evaluate(selector=>{window.qaKotShell=document.querySelector(selector);},shellSelector);
   for (const [seg,name,content] of tabs.slice(1)) {
    await strip.getByRole('link',{name,exact:true}).click();
    await page.locator(content).waitFor();
    const activeTab = strip.locator('a.on[data-match="/kot/'+seg+'"]');
    await activeTab.waitFor();
    check(shell+' opens '+name+' inside the KOT workspace',
     new URL(page.url()).pathname==='/'+shell+'/zenith/kot/'+seg&&
     await activeSidebar.isVisible()&&await activeTab.isVisible()&&
     await page.locator('#kitchen-tabs').count()===0,{url:page.url()});
    check(shell+' keeps its shell mounted on '+name,await page.evaluate(selector=>window.qaKotShell===document.querySelector(selector),shellSelector));
   }
   if(out) await page.screenshot({path:path.join(out,shell+'-standalone-kot.png')});
   await strip.getByRole('link',{name:'KOT Billing',exact:true}).click();
   await page.locator('#kot-terminal-entry').waitFor();
   await strip.getByRole('link',{name:'KOT Dashboard',exact:true}).click();
   await page.locator('#kd-wrap').waitFor();
   check(shell+' leaves the KOT terminal gateway for KOT Dashboard',await page.locator('#zk-route-status').count()===0&&await activeSidebar.isVisible());
   await strip.getByRole('link',{name:'KOT Billing',exact:true}).click();
   await page.locator('#kot-terminal-entry').waitFor();
   await page.locator((shell==='apps'?'#z-sidebar':'#zq-sidebar')+' a[data-match="/pos"]').click();
   await page.waitForURL('**/'+shell+'/zenith/pos/Dashboard');
   await strip.locator('a[data-match="/pos/Dashboard"]').waitFor();
   check(shell+' can leave the KOT terminal gateway using the sidebar',await page.locator('#zk-route-status').count()===0);
   const tableHistory = base+'/'+shell+'/zenith/kot/Tables/goTransactions';
   const historyRedirect = await a.c.request.get(tableHistory,{maxRedirects:0});
   check(shell+' table history action stays in KOT',historyRedirect.status()===302&&
    new URL(historyRedirect.headers().location,tableHistory).pathname==='/'+shell+'/zenith/kot/KotHistory',
    {status:historyRedirect.status(),location:historyRedirect.headers().location});
  }
  const preference = JSON.stringify({version:1,order:['/kot/KotBilling'],hidden:['/kot/WaiterManagement']});
  const saved = await post(a,'saveSubnavConfiguration',{module:'kot',payload:preference});
  const crossModule = await post(a,'saveSubnavConfiguration',{module:'kot',payload:JSON.stringify({version:1,order:['/pos/Reports'],hidden:[]})});
  check('KOT preferences accept kitchen sections and reject retail sections',
   saved.ok()&&(await saved.json()).preference===preference&&
   crossModule.status()===400&&(await crossModule.json()).saved===false);
  await post(a,'saveSubnavConfiguration',{module:'kot',payload:JSON.stringify({version:1,order:[],hidden:[]})});
  const before = new Map();
  for (const route of dashboardRoutes) before.set(route,await snapshotDashboard(route));
  const retailSession = await require('./kot-test-session.cjs')({a,base});
  async function invoke(op, params) {
   const response = await post(a,'pos/PosQaAcceptance/invoke',{op,...params});
   const body = await response.json();
   check('retail control sale '+op,response.ok()&&!body.errors?.length,{status:response.status(),errors:body.errors});
   return body.result;
  }
  const { transactionId } = await invoke('cart',{sessionId:retailSession,reuseOpenCart:'N'});
  await invoke('add',{transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
  const [retail] = q("SELECT payable_amount FROM pos_transaction WHERE transaction_id='"+transactionId+"'");
  await invoke('pay',{transactionId,paymentMethod:'Cash',amount:String(retail.payable_amount)});
  await invoke('complete',{transactionId});
  check('control bill is completed and has no kitchen ticket',
   q("SELECT status_id FROM pos_transaction WHERE transaction_id='"+transactionId+"'")[0]?.status_id==='PtCompleted'&&
   q("SELECT kot_id FROM kitchen_order_ticket WHERE transaction_id='"+transactionId+"'").length===0);
  for (const route of dashboardRoutes) {
   const afterRetail = await snapshotDashboard(route);
   check(route+' ignores a completed retail bill',JSON.stringify(afterRetail)===JSON.stringify(before.get(route)),{before:before.get(route),afterRetail});
   const history = page.getByRole('link',{name:'View KOT History'});
   check(route+' points to sibling KOT History',
    new URL(await history.getAttribute('href'),page.url()).pathname.endsWith('/'+route.replace('KotDashboard','KotHistory')));
  }
  await page.goto(base+'/apps/zenith/pos/Kitchen');
  await page.locator('.zk-display').waitFor();
  check('old Kitchen bookmark still opens the shared Kitchen Display',
   await page.locator('.zk-display').isVisible(),
   {url:page.url()});
  const role=await post(a,'Settings/RoleEditor/saveRole',{
   roleName:'Synthetic KOT Clerk '+randomUUID().slice(0,8),selectionsJson:JSON.stringify({kot:['/kot/KotBilling']})
  });
  const id=new URL(role.headers().location||base,base).searchParams.get('userGroupId');
  check('role editor accepts only the selected KOT section',role.status()===302&&!!id,{status:role.status()});
  const username='kot.qa.'+randomUUID()+'@example.com', password='Qa9!'+randomUUID();
  await post(a,'Settings/Users/createUser',{username,userFullName:'Synthetic KOT Clerk',newPassword:password,newPasswordVerify:password});
  const userId=q("SELECT user_id FROM user_account WHERE username='"+username+"'")[0]?.user_id;
  check('disposable KOT clerk account is created',!!userId);
  const assigned=await post(a,'Settings/Users/assignRole',{userId,userGroupId:id});
  check('saved KOT role is assigned to the disposable clerk',assigned.status()===302&&
   q("SELECT user_group_id FROM user_group_member WHERE user_id='"+userId+"' AND user_group_id='"+id+"'").length===1,
   {status:assigned.status()});
  const terminalId='KOT_CLERK_'+randomUUID().slice(0,8);
  await post(a,'pos/PosTerminals/createTerminal',{terminalId,terminalName:'Assigned KOT clerk terminal',facilityId:'POS_QA_A_FAC',stateCode:'33',isActive:'Y'});
  await post(a,'pos/PosQaAcceptance/invoke',{op:'assignTerminal',userId,terminalId});
  const authorized = await clerk.request.get(base+'/apps/zenith/kot',{headers:{Authorization:'Basic '+Buffer.from(username+':'+password).toString('base64')}});
  check('KOT-only sidebar landing opens the clerk’s allowed terminal gateway',authorized.ok()&&(await authorized.text()).includes('id="kot-terminal-entry"'),{url:authorized.url(),status:authorized.status()});
  const clerkPage=await clerk.newPage();
  await clerkPage.goto(base+'/apps/zenith/kot/KotBilling');
  const clerkTabs=clerkPage.locator('#z-subnav .zsub-grp.show a:visible');
  await clerkTabs.first().waitFor();
  check('KOT-only clerk sees only their allowed tab and no POS sidebar at terminal selection',
   await clerkPage.locator('#z-sidebar a[data-mod=pos]:visible').count()===0&&
   (await clerkTabs.allTextContents()).map(text=>text.trim()).join('|')==='KOT Billing');
  check('KOT clerk can only select the administrator-assigned terminal',await clerkPage.locator('#kot-terminal-entry select[name=terminalId] option').count()===1&&await clerkPage.locator('#kot-terminal-entry select[name=terminalId]').inputValue()===terminalId);
  await clerkPage.getByRole('button',{name:'Open / Resume Session'}).click();
  await clerkPage.locator('#kb-wrap').waitFor();
  await clerkPage.locator('#z-subnav').waitFor({state:'hidden'});
  check('KOT-only clerk has a full-screen billing workspace without module navigation',
   await clerkPage.locator('#z-subnav:visible,#z-sidebar:visible').count()===0);
  for(const route of ['pos/Terminal','pos/Reports','kot/KotHistory','pos/Kitchen/KotHistory']){
   const denied=await clerk.request.get(base+'/apps/zenith/'+route,{maxRedirects:0});
   check('KOT-only grant does not allow '+route,[302,303,403].includes(denied.status()),{status:denied.status()});
  }
  const token=await clerkPage.locator('#kb-token').inputValue();
  const kit={c:clerk,t:token||await clerkPage.locator('#z-shopdata').getAttribute('data-token')};
  const sessionId=new URL(clerkPage.url()).searchParams.get('sessionId');
  const note='KOT role QA '+randomUUID();
  const ownTicket=await post(kit,'kot/KotBilling/createKot',{
   sessionId,itemsJson:JSON.stringify([{productId:'POS_QA_A_P18',quantity:1}]),orderType:'Take Away',notes:note
  });
  const ownId=q("SELECT kot_id FROM kitchen_order_ticket WHERE organization_party_id='POS_QA_A' AND notes LIKE '%"+note+"%'")[0]?.kot_id;
  check('KOT-only clerk can save an order in their organization',ownTicket.status()<400&&!!ownId,{status:ownTicket.status()});
  const ownPrint=await post(kit,'kot/KotBilling/printRecord',{kotId:ownId,kind:'kot'});
  check('KOT-only clerk can fetch their own kitchen ticket for printing',ownPrint.ok()&&(await ownPrint.json()).success===true);
  const ack=await post(kit,'kot/KotBilling/ackKotPrint',{kotId:ownId});
  check('KOT-only clerk can record a successful print',ack.ok()&&(await ack.json()).success===true);
  for (const route of dashboardRoutes) {
   const afterTicket = await snapshotDashboard(route);
   const initial = before.get(route);
   check(route+' counts an unpaid kitchen ticket as activity only',
    afterTicket.tickets===initial.tickets+1&&afterTicket.completed===initial.completed&&afterTicket.sales===initial.sales,
    {initial,afterTicket});
  }
  const draftResponse=await post(kit,'kot/KotBilling/saveDraft',{sessionId,itemsJson:JSON.stringify([{productId:'POS_QA_A_P18',quantity:1}]),orderType:'Take Away',taxOn:'N',salesModeId:'RETAIL',wantJson:'Y'});
  const draft=await draftResponse.json();
  const paid=await post(kit,'kot/KotBilling/checkoutKot',{sessionId,kotId:draft.kotId,paymentMethod:'Cash',cashAmount:'100'});
  check('KOT-only clerk can complete a bill on the assigned terminal',draft.success&&(await paid.json()).success===true);
  for (const route of dashboardRoutes) {
   const afterPayment = await snapshotDashboard(route);
   const initial = before.get(route);
   check(route+' counts the newly completed KOT bill once',
    afterPayment.completed===initial.completed+1&&afterPayment.tickets===initial.tickets+2&&afterPayment.sales!==initial.sales,
    {initial,afterPayment});
  }
  const unchanged=q("SELECT setting_value FROM company_settings WHERE organization_party_id='POS_QA_A' AND setting_key='KITCHEN_DISPLAY_POS_QA_A_FAC'");
  await post(kit,'kot/KitchenDisplay/saveDisplayPolicy',{facilityId:'POS_QA_A_FAC',enabled:'N'});
  check('KOT clerk cannot change the administrator kitchen policy',JSON.stringify(q("SELECT setting_value FROM company_settings WHERE organization_party_id='POS_QA_A' AND setting_key='KITCHEN_DISPLAY_POS_QA_A_FAC'"))===JSON.stringify(unchanged));
  const foreignSession=await require('./kot-test-session.cjs')({a:foreign,base});
  const foreignTicket=await post(foreign,'kot/KotBilling/createKot',{
   sessionId:foreignSession,itemsJson:JSON.stringify([{productId:'POS_QA_B_P18',quantity:1}]),orderType:'Take Away',notes:note
  });
  const foreignId=q("SELECT kot_id FROM kitchen_order_ticket WHERE organization_party_id='POS_QA_B' AND notes LIKE '%"+note+"%'")[0]?.kot_id;
  check('canonical KOT creates a ticket in the selected organization',foreignTicket.status()<400&&!!foreignId,{status:foreignTicket.status()});
  const response=await post(kit,'kot/KotBilling/printRecord',{kotId:foreignId,kind:'kot'});
  const foreignBody=await response.json().catch(()=>({}));
  check('a KOT-only clerk cannot retrieve another organization’s ticket',response.status()===403||foreignBody.success===false,{status:response.status(),success:foreignBody.success});
 } finally { await clerk.close(); await page.close(); }
};
