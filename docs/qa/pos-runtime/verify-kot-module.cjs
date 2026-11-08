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
 try {
  for (const shell of ['apps','qapps']) {
   const sidebar = page.locator(shell==='apps'?'#z-sidebar a[data-match="/kot"]':'#zq-sidebar a[data-match="/kot"]');
   const strip = page.locator(shell==='apps'?'#z-subnav .zsub-grp.show':'#zq-subnav.show');
   const links = strip.locator('a:visible');
   await page.goto(base+'/'+shell+'/zenith/pos/Dashboard');
   await sidebar.click();
   await page.locator('#kd-wrap').waitFor();
   const activeSidebar = sidebar.and(page.locator('.on'));
   await activeSidebar.waitFor();
   check(shell+' opens KOT as its own sidebar module',await activeSidebar.isVisible(),{url:page.url()});
   check(shell+' shows exactly the six KOT sections in order',(await links.allTextContents()).map(x=>x.trim()).join('|')===tabs.map(x=>x[1]).join('|'));
   const shellSelector=shell==='apps'?'#z-sidebar':'#kitchen-page-frame';
   await page.evaluate(selector=>{window.qaKotShell=document.querySelector(selector);},shellSelector);
   for (const [seg,name,content] of tabs.slice(1)) {
    await strip.getByRole('link',{name,exact:true}).click();
    await page.locator(content).waitFor();
    check(shell+' opens '+name+' from KOT navigation',new URL(page.url()).pathname.endsWith('/kot/'+seg)&&await page.locator('#kitchen-tabs').count()===0);
    check(shell+' keeps its shell mounted on '+name,await page.evaluate(selector=>window.qaKotShell===document.querySelector(selector),shellSelector));
   }
   if(out) await page.screenshot({path:path.join(out,shell+'-standalone-kot.png')});
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
  check('KOT clerk can only select the administrator-assigned terminal',await clerkPage.locator('#kot-terminal-entry select[name=terminalId] option').count()===1&&await clerkPage.locator('#kot-terminal-entry select[name=terminalId]').inputValue()===terminalId);
  await clerkPage.getByRole('button',{name:'Open / Resume Session'}).click();
  await clerkPage.locator('#kb-wrap').waitFor();
  check('KOT-only clerk sees only their allowed tab and no POS sidebar',await clerkPage.locator('#z-sidebar a[data-mod=pos]:visible').count()===0&&
   (await clerkPage.locator('#z-subnav .zsub-grp.show a:visible').allTextContents()).join('|').trim()==='KOT Billing');
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
  const draftResponse=await post(kit,'kot/KotBilling/saveDraft',{sessionId,itemsJson:JSON.stringify([{productId:'POS_QA_A_P18',quantity:1}]),orderType:'Take Away',taxOn:'N',salesModeId:'RETAIL',wantJson:'Y'});
  const draft=await draftResponse.json();
  const paid=await post(kit,'kot/KotBilling/checkoutKot',{sessionId,kotId:draft.kotId,paymentMethod:'Cash',cashAmount:'100'});
  check('KOT-only clerk can complete a bill on the assigned terminal',draft.success&&(await paid.json()).success===true);
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
