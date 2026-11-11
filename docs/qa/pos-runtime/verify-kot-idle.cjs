module.exports=async function({browser,base,check,q,sessionId}) {
 for(const shell of ['apps','qapps']) {
  const context=await browser.newContext();
  try {
   const auth='Basic '+Buffer.from('pos.qa:moqui').toString('base64');
   await context.request.get(base+'/apps/zenith/pos/Dashboard',{headers:{Authorization:auth}});
   const page=await context.newPage();
   await page.clock.install();
   await page.goto(base+'/'+shell+'/zenith/kot/KotBilling?sessionId='+sessionId);
   await page.locator('#kb-wrap').waitFor();
   await page.waitForFunction(()=>window.__zIdleLogout&&document.getElementById('kb-wrap')?.dataset.ready);
   await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));
   await page.keyboard.press('a');
   if(shell==='qapps') {
    await page.clock.fastForward('55:00');
    await page.keyboard.press('b');
    await page.clock.fastForward('05:00');
    check('KOT cashier input resets the original deadline',await page.locator('#kb-wrap').isVisible());
    await page.clock.fastForward('54:00');
   } else {
    await page.clock.fastForward('59:00');
   }
   check(shell+' KOT warns one minute before logout',await page.locator('#zIdleCountdown').textContent()==='60');
   await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'a'})));
   await page.clock.fastForward('00:59');
   check(shell+' KOT stays open just before the idle hour',await page.locator('#kb-wrap').isVisible()&&
    await page.locator('#zIdleCountdown').textContent()==='1');
   const login=page.waitForURL(url=>url.pathname==='/Login');
   await page.clock.runFor(1000);
   await login;
   check(shell+' KOT signs out at one hour without closing the drawer',q(
    `SELECT status_id FROM pos_session WHERE session_id='${sessionId}'`)[0]?.status_id==='PsOpen');
  } finally {
   await context.close();
  }
 }
};
