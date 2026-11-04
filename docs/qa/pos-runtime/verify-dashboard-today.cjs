module.exports = async ({ a, base, check }) => {
 const page = await a.c.newPage();
 const today = new Intl.DateTimeFormat('en-CA', {
  timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
 }).format(new Date());
 const dashboards = [
  'Dashboard','Contacts/ContactsDashboard','sales/SalesDashboard','Inventory/InventoryDashboard',
  'Accounting/AcctgDashboard','Hr/HrDashboard','tax/TaxDashboard','pos/OwnerDashboard','pos/Dashboard'
 ];
 const range = async () => Promise.all(['dashDate','dashDateTo'].map(name =>
  page.locator('input[type=date][name='+name+']').first().inputValue()));
 try {
  for (const shell of ['apps','qapps']) {
   const root = base+'/'+shell+'/zenith/';
   for (const dashboard of dashboards) {
    await page.goto(root+dashboard,{waitUntil:'domcontentloaded'});
    const [from,to] = await range();
    check(shell+' '+dashboard+' opens on the current local day',from===today&&to===today,{from,to,today});
    if (dashboard==='Dashboard') check(shell+' Home defaults to the Today Hourly chart',
     await page.locator('.ba-seg-btn[data-t=hourly]').getAttribute('aria-pressed')==='true');
    if (dashboard==='pos/OwnerDashboard') check(shell+' Owner Overview defaults to the Today chart',
     await page.locator('.biz-tab.on').getAttribute('data-t')==='today');
    await page.goto(root+dashboard+'?dateMode=custom&dashDate=2024-09-04&dashDateTo=2024-09-06',{waitUntil:'domcontentloaded'});
    const [selectedFrom,selectedTo] = await range();
    check(shell+' '+dashboard+' preserves an explicit date range',
     selectedFrom==='2024-09-04'&&selectedTo==='2024-09-06',{selectedFrom,selectedTo});
   }
   for (const dashboard of ['sales/SalesDashboard','Inventory/InventoryDashboard','Hr/HrDashboard']) {
    await page.goto(root+dashboard+'?dateMode=all',{waitUntil:'domcontentloaded'});
    const [from,to] = await range();
    check(shell+' '+dashboard+' preserves All time',!from&&!to,{from,to});
   }
   for (const [params,label] of [['','Today'],['?period=all','All time']]) {
    await page.goto(root+'Crm/Dashboard'+params,{waitUntil:'domcontentloaded'});
    const selection = await page.locator('.zcrm-period-active').first().textContent();
    check(shell+' CRM selects '+label,selection.trim()===label,{selection});
   }
   await page.goto(root+'pos/Kitchen/KotDashboard',{waitUntil:'domcontentloaded'});
   const kotDate=await page.locator('#kd-wrap input[type=date]').inputValue();
   check(shell+' KOT still opens on the current local day',kotDate===today,{kotDate,today});
  }
 } finally { await page.close(); }
};
