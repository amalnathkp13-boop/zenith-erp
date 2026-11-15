// Existing kitchen checks enter through the real terminal gateway before order entry.
module.exports=async({a,base})=>{
 const page=await a.c.newPage();
 try {
  await page.goto(base+'/apps/zenith/pos/Kitchen/KotBilling');
  if(await page.locator('#kot-terminal-entry').isVisible()) {
   await page.locator('#kot-terminal-entry select[name=terminalId]').selectOption({index:0});
   await page.getByRole('button',{name:'Open / Resume Session'}).click();
  }
  await page.locator('#kb-wrap[data-ready=true]').waitFor();
  return page.locator('#kb-data').getAttribute('data-session');
 } finally {await page.close();}
};
