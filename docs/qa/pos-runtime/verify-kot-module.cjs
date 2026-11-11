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
 const tools = [
  ['PosTransactions', 'Transactions'],
  ['PosSessions', 'Sessions'],
  ['PosTerminals', 'Terminals'],
  ['Wastage', 'Wastage'],
  ['ProductPricing', 'Product Prices'],
  ['DiscountSettings', 'Discount'],
  ['SalesMode', 'Sales Mode'],
  ['ProductImport', 'Import'],
  ['ReceiptConfig', 'Receipts'],
  ['PrinterConfig', 'Printers'],
  ['BillNumberRegister', 'Bill Register'],
  ['OfflineMode', 'Offline Mode']
 ];
 const page = await a.c.newPage();
 const clerk = await browser.newContext({ viewport:{ width:1366, height:768 } });
 const post = (actor, route, values) => actor.c.request.post(base+'/apps/zenith/'+route,{
  maxRedirects:0,form:{ moquiSessionToken:actor.t,...values }
 });
 const completedOrders = page.locator('.kd-stat').filter({hasText:'Completed Orders'}).locator('.kd-stat__value');
 const money = value => Number(value.replace(/[₹, ]/g,''));
 const posTotal = async () => {
  await page.goto(base+'/apps/zenith/pos/Dashboard');
  const card = page.locator('.pos-dash-metric').filter({has:page.getByText('Total Sales',{exact:true})});
  return money(await card.locator('strong').innerText());
 };
 const homeTotal = async (shell='apps', date='') => {
  await page.goto(base+'/'+shell+'/zenith/Dashboard'+(date?'?dashDate='+date:''));
  const card = page.locator('.zsc').filter({has:page.getByText('Total Sales',{exact:true})});
  const config = JSON.parse(await page.locator('#homeDashboard').getAttribute('data-config'));
  return {amount:money(await card.locator('.zsc-num').innerText()), chart:config.weekly.total, hourly:config.hourly.total};
 };
 try {
  for (const shell of ['apps','qapps']) {
   const sidebar = page.locator(shell==='apps'?'#z-sidebar a[data-match="/kot"]':'#zq-sidebar a[data-match="/kot"]');
   const strip = page.locator(shell==='apps'?'#z-subnav .zsub-grp.show':'#zq-subnav.show');
   const links = strip.locator('a:visible');
   await page.goto(base+'/'+shell+'/zenith/pos/Dashboard');
   await strip.locator('a[data-match="/pos/Dashboard"]').waitFor();
   await sidebar.click();
   await page.locator('#kd-wrap').waitFor();
   const activeSidebar = sidebar.and(page.locator('.on'));
   await activeSidebar.waitFor();
   check(shell+' opens KOT as its own sidebar module',await activeSidebar.isVisible(),{url:page.url()});
   const kotLinks = await links.evaluateAll(anchors=>anchors.map(a=>a.getAttribute('data-match')));
   check(shell+' lists only KOT tools in the KOT tabs',
    kotLinks.join('|')===tabs.concat(tools).map(([seg])=>'/kot/'+seg).join('|'),{kotLinks});
   const shellSelector=shell==='apps'?'#z-sidebar':'#kitchen-page-frame';
   await page.evaluate(selector=>{window.qaKotShell=document.querySelector(selector);},shellSelector);
   for (const [seg,name,content] of tabs.slice(1)) {
    await strip.getByRole('link',{name,exact:true}).click();
    await page.locator(content).waitFor();
    check(shell+' opens '+name+' from KOT navigation',new URL(page.url()).pathname.endsWith('/kot/'+seg)&&await page.locator('#kitchen-tabs').count()===0);
    check(shell+' keeps its shell mounted on '+name,await page.evaluate(selector=>window.qaKotShell===document.querySelector(selector),shellSelector));
   }
   if(out) await page.screenshot({path:path.join(out,shell+'-standalone-kot.png')});
   for (const [seg,name] of tools) {
    const response=await page.goto(base+'/'+shell+'/zenith/kot/'+seg);
    const active=strip.locator('a.on[data-match="/kot/'+seg+'"]');
    await active.waitFor();
    check(shell+' opens the KOT '+name+' screen',response.ok()&&
     new URL(page.url()).pathname.includes('/kot/'+seg),{url:page.url(),status:response.status()});
   }
   await strip.getByRole('link',{name:'KOT Billing',exact:true}).click();
   await page.locator('#kot-terminal-entry').waitFor();
   await page.locator((shell==='apps'?'#z-sidebar':'#zq-sidebar')+' a[data-match="/pos"]').click();
   await page.waitForURL('**/'+shell+'/zenith/pos/Dashboard');
   await strip.locator('a[data-match="/pos/Dashboard"]').waitFor();
   check(shell+' can leave the KOT terminal gateway using the sidebar',await page.locator('#zk-route-status').count()===0);
  }
  const preference = JSON.stringify({version:1,order:['/kot/KotBilling','/pos/Reports'],hidden:['/pos/SalesMode']});
  const saved = await post(a,'saveSubnavConfiguration',{module:'kot',payload:preference});
  check('KOT preferences can still read legacy POS tab paths',saved.ok()&&JSON.parse((await saved.json()).preference).order[1]==='/pos/Reports');
  await page.goto(base+'/apps/zenith/kot/KotDashboard');
  const migratedTab=page.locator('#z-subnav .zsub-grp.show [data-match="/kot/SalesMode"]');
  await migratedTab.locator('xpath=self::*[@hidden]').waitFor({state:'attached'});
  check('KOT preserves the visibility of tabs saved under their previous POS paths',await migratedTab.isHidden());
  await post(a,'saveSubnavConfiguration',{module:'kot',payload:JSON.stringify({version:1,order:[],hidden:[]})});
  await page.goto(base+'/apps/zenith/kot/KotDashboard');
  const reportingDate = await page.locator('.kd-datepill input').inputValue();
  const dayStart = new Date(reportingDate+'T00:00:00+05:30').getTime();
  const sqlTime = epoch => new Date(epoch).toISOString().slice(0,19).replace('T',' ');
  const completedKotIds = () => q(`SELECT DISTINCT t.transaction_id FROM pos_transaction t
   JOIN kitchen_order_ticket k ON k.transaction_id=t.transaction_id AND k.organization_party_id=t.organization_party_id
   WHERE t.organization_party_id='POS_QA_A' AND t.status_id='PtCompleted'
     AND t.entry_date>=TIMESTAMP '${sqlTime(dayStart)}' AND t.entry_date<TIMESTAMP '${sqlTime(dayStart+86400000)}'`)
   .map(row=>row.transaction_id);
  const beforeIds = completedKotIds();
  const posBefore = await posTotal();
  const homeBefore = await homeTotal();
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
  for(const route of ['pos/Terminal','pos/Reports','kot/KotHistory','pos/Kitchen/KotHistory',
   ...tools.map(([seg])=>'kot/'+seg),'kot/EditSession','kot/EditTransaction','kot/ReceiptPdf','kot/PosSessionsPdf']){
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
  const settled=await paid.json();
  check('KOT-only clerk can complete a bill on the assigned terminal',draft.success&&settled.success===true);
  const transactionId=q("SELECT transaction_id FROM kitchen_order_ticket WHERE kot_id='"+draft.kotId+"'")[0]?.transaction_id;
  check('the paid KOT has a linked transaction and bill number',!!transactionId&&!!settled.billNumber);
  const billDetails=await post(kit,'kot/KotBilling/historyBillDetails',{sessionId,kotId:draft.kotId});
  const historyBill=await billDetails.json().catch(()=>null);
  check('KOT-only clerk can view the issued bill without POS amendment access',
   billDetails.ok()&&historyBill?.success===true&&historyBill.transactionId===transactionId&&
   historyBill.number===settled.billNumber&&historyBill.canEdit===false,
   {status:billDetails.status(),historyBill});
  for (const route of ['PosTransactions','EditTransaction?transactionId='+transactionId,'BillNumberRegister/printDoc']) {
   const report=await a.c.request.get(base+'/apps/zenith/kot/'+route);
   check('owner can find the issued KOT bill in '+route.split('?')[0],report.ok()&&
    (await report.text()).includes(settled.billNumber),{status:report.status()});
  }
  const receipt=await a.c.request.get(base+'/fop/apps/zenith/kot/ReceiptPdf?transactionId='+transactionId);
  check('owner can generate the linked KOT receipt PDF',receipt.ok()&&
   (await receipt.body()).subarray(0,4).toString()==='%PDF');
  await page.goto(base+'/apps/zenith/kot/KotDashboard?dashDate='+encodeURIComponent(reportingDate));
  const afterText = await completedOrders.innerText();
  const dashboardDate = await page.locator('.kd-datepill input').inputValue();
  const shop = await page.locator('#z-shopdata').getAttribute('data-active');
  const afterIds = completedKotIds();
  check('standalone KOT dashboard counts the newly completed KOT sale once',
   !shop&&dashboardDate===reportingDate&&Number(afterText)===afterIds.length&&
   afterIds.length===beforeIds.length+1&&afterIds.includes(transactionId)&&!beforeIds.includes(transactionId)&&
   beforeIds.every(id=>afterIds.includes(id)),{
   beforeIds,afterIds,afterText,transactionId,reportingDate,dashboardDate,shop
  });
  check('POS dashboard includes the KOT bill once',await posTotal()===posBefore+100);
  await page.goto(base+'/apps/zenith/pos/PosTransactions');
  const posRow = page.getByRole('row').filter({has:page.getByText(settled.billNumber,{exact:true})});
  check('POS Transactions displays the KOT bill once and identifies its source',
   await posRow.count()===1&&await posRow.getByText('KOT',{exact:true}).count()===1);
  await page.goto(base+'/apps/zenith/pos/Reports/BillWise?searchText='+encodeURIComponent(settled.billNumber));
  check('POS Bill Wise report includes the completed KOT bill once',
   await page.getByRole('row').filter({has:page.getByText(settled.billNumber,{exact:true})}).count()===1);
  for (const shell of ['apps','qapps']) {
   const homeAfter=await homeTotal(shell);
   check(shell+' Home Dashboard adds the KOT bill exactly once to sales and charts',
    homeAfter.amount===homeBefore.amount+100&&homeAfter.chart===homeAfter.amount&&homeAfter.hourly===homeAfter.amount,
    {homeBefore,homeAfter});
  }
  const fixture = mode => post(a,'pos/PosQaAcceptance/kotSalesReportFixture',{mode,sessionId});
  const historicalDate='2040-02-01';
  try {
   const seeded=await fixture('seed');
   check('disposable KOT reporting records are seeded',seeded.ok()&&(await seeded.json()).success);
   const historical=await homeTotal('apps',historicalDate);
   const nextDay=await homeTotal('qapps','2040-02-02');
   check('Home sales counts KOT before sync and finalization, deduplicates the finalized mirror, and excludes the cancelled mirror',
    historical.amount===133&&historical.chart===133&&nextDay.amount===0&&nextDay.chart===0,
    {historical,nextDay});
   await page.goto(base+'/apps/zenith/kot/KotDashboard?dashDate='+historicalDate);
   check('KOT Dashboard excludes ordinary POS and counts a sale with two kitchen tickets once',
    Number(await completedOrders.innerText())===4);
  } finally {
   const cleaned=await fixture('clean');
   check('disposable KOT reporting records are removed',cleaned.ok()&&(await cleaned.json()).success&&
    q("SELECT transaction_id FROM pos_transaction WHERE transaction_id IN ('POS_QA_KOT_REPORT_UNSYNCED','POS_QA_KOT_REPORT_SYNCED','POS_QA_KOT_REPORT_DRAFT','POS_QA_KOT_REPORT_CANCELLED','POS_QA_KOT_REPORT_POS')").length===0);
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
  await require('./verify-kot-offline-drafts.cjs')({foreign,base,check,q,out});
 } finally { await clerk.close(); await page.close(); }
};
