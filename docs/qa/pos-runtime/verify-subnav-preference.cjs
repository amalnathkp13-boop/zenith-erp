const dashboardPath='/apps/zenith/pos/Dashboard';
const readPath='/apps/zenith/getSubnavConfiguration?module=pos';
const savePath='/apps/zenith/saveSubnavConfiguration';

module.exports=async function ({browser,base,check}) {
 const c=await browser.newContext({serviceWorkers:'allow',viewport:{width:1366,height:768}});
 const p=await c.newPage();
 const defaultSettings={version:1,order:[],hidden:[]};
 let original, otherOriginal;
 const trigger=p.getByRole('button',{name:'Customize POS navigation'});
 const list=p.locator('#z-subnav .zsub-grp.show');
 const settings=p.getByRole('dialog',{name:'Customize POS Navigation'});
 const toggle=settings.getByRole('switch',{name:'Show Transactions in top navigation'});
 const transaction=list.locator('[data-match="/pos/PosTransactions"]');
 const tabIds=()=>list.locator('.zsub-tab').evaluateAll(tabs=>tabs.map(tab=>tab.dataset.match));
 const signIn=async user=>{
  await p.goto('about:blank');
  await c.clearCookies();
  const response=await c.request.get(base+dashboardPath,{headers:{Authorization:'Basic '+Buffer.from(user+':moqui').toString('base64')}});
  const token=(await response.text()).match(/id="z-shopdata"[^>]*data-token="([^"]+)"/)?.[1];
  if(!response.ok()||!token) throw new Error('Could not authenticate synthetic user '+user);
  return token;
 };
 const show=async path=>{
  await p.goto(base+path);
  await trigger.click();
  await settings.waitFor();
 };
 const write=async (value,token)=>{
  const response=await c.request.post(base+savePath,{form:{module:'pos',payload:JSON.stringify(value),moquiSessionToken:token}});
  if(!response.ok()||!(await response.json()).saved) throw new Error('Could not set synthetic navigation preferences');
 };
 try {
  await signIn('pos.qa');
  const initial=await (await c.request.get(base+readPath)).json();
  original=JSON.parse(initial.preference||JSON.stringify(defaultSettings));
  const otherToken=await signIn('pos.b.qa');
  const otherInitial=await (await c.request.get(base+readPath)).json();
  otherOriginal=JSON.parse(otherInitial.preference||JSON.stringify(defaultSettings));
  await write({version:1,order:[],hidden:['/pos/DailySummary']},otherToken);
  await write(defaultSettings,await signIn('pos.qa'));
  await p.goto(base+dashboardPath);
  await p.evaluate(async()=>{
   await navigator.serviceWorker.register('/apps/zenith/pos/sw.js');
   await navigator.serviceWorker.ready;
  });
  await p.waitForFunction(()=>navigator.serviceWorker.controller);
  await show(dashboardPath);
  const defaultTabs=await tabIds();
  check('POS navigation starts with the synthetic user’s default preferences',await toggle.getAttribute('aria-checked')==='true');
  await toggle.click();
  await settings.getByRole('button',{name:'Move Billing Terminal up'}).click();
  await settings.getByRole('button',{name:'Save changes'}).click();
  await settings.waitFor({state:'hidden'});
  const directRead=await c.request.get(base+readPath);
  const persisted=JSON.parse((await directRead.json()).preference);
  check('POS navigation customization is written to the server',persisted.hidden.includes('/pos/PosTransactions')&&persisted.order[0]==='/pos/Terminal');
  check('Authenticated navigation preference responses instruct HTTP caches not to store them',
   directRead.headers()['cache-control']?.includes('no-store'));

  await show('/apps/zenith/pos/PosSessions');
  check('Controlled POS navigation retains the saved visibility and order after changing screens',
   await toggle.getAttribute('aria-checked')==='false'&&await transaction.getAttribute('hidden')!==null&&(await tabIds())[0]==='/pos/Terminal');
  await p.goto(base+'/apps/zenith/Dashboard');
  await show(dashboardPath);
  check('The POS navigation settings survive leaving the module and returning',
   await toggle.getAttribute('aria-checked')==='false'&&(await tabIds())[0]==='/pos/Terminal');
  await signIn('pos.qa');
  await show(dashboardPath);
  check('The same user retains their POS navigation settings after a fresh sign-in',
   await toggle.getAttribute('aria-checked')==='false'&&(await tabIds())[0]==='/pos/Terminal');

  await signIn('pos.b.qa');
  await show(dashboardPath);
  check('Another signed-in user receives their own POS navigation preferences in the same browser',
   await toggle.getAttribute('aria-checked')==='true'&&JSON.stringify(await tabIds())===JSON.stringify(defaultTabs)&&
   await settings.getByRole('switch',{name:'Show Daily Summary in top navigation'}).getAttribute('aria-checked')==='false');
 } finally {
  try {
   if(otherOriginal){
    await write(otherOriginal,await signIn('pos.b.qa'));
   }
   if(original) await write(original,await signIn('pos.qa'));
  } finally { await c.close(); }
 }
};
