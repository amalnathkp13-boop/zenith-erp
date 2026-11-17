// Run in the disposable POS runtime with both shops under POS_QA_A and All Shops selected.
module.exports = async function ({a, base, check, invoke, post}) {
 const page = await a.c.newPage();
 const sessions = [];
 const suffix = Date.now().toString(36);
 async function count(index, layout = 'normal') {
  await page.goto(`${base}/apps/zenith/pos/Terminal?sessionId=${sessions[index].sessionId}`, {waitUntil:'domcontentloaded'});
  await page.locator('#pos-today-bills').waitFor();
  await page.evaluate(layout => window.posSetLayout(layout), layout);
  return Number(await page.locator('#pos-today-bills').innerText());
 }
 async function cart(index) {
  const tx = await invoke('cart', {sessionId:sessions[index].sessionId});
  await invoke('add', {transactionId:tx.transactionId,productId:'POS_QA_A_P18',quantity:'1',unitPrice:'10',taxOn:'N'});
  return tx;
 }
 async function complete(tx) {
  await invoke('pay', {transactionId:tx.transactionId,paymentMethod:'Card',amount:'10'});
  await invoke('complete', {transactionId:tx.transactionId});
 }
 try {
  for (let i = 0; i < 3; i++) {
   const terminalId = `POS_QA_COUNT_${suffix}_${i}`;
   await post('PosTerminals','createTerminal', {terminalId,terminalName:`Bill count QA ${i}`,facilityId:i < 2 ? 'POS_QA_A_FAC' : 'POS_QA_A_FAC2',organizationPartyId:'POS_QA_A',stateCode:'33',countryGeoId:'IND',isActive:'Y'});
   sessions.push(await invoke('open', {terminalId,openingCash:'0'}));
   // Keep each synthetic shift open when the next counter is opened.
   await complete(await cart(i));
  }
  const beforeA = await count(0), beforeB = await count(2);
  const first = await cart(0);
  check('An unfinished cart does not increase Today', await count(0) === beforeA);
  await complete(first);
  for (const layout of ['normal','advanced']) {
   check(`${layout}: own shop completed bill increases Today`, await count(0,layout) === beforeA + 1);
   check(`${layout}: another counter in the same shop shares Today`, await count(1,layout) === beforeA + 1);
   check(`${layout}: another shop does not include that bill`, await count(2,layout) === beforeB);
  }
  await complete(await cart(1));
  check('Today includes sales from a second counter in the same shop', await count(0) === beforeA + 2);
  await complete(await cart(2));
  for (const layout of ['normal','advanced']) {
   check(`${layout}: shop B sale leaves shop A unchanged`, await count(0,layout) === beforeA + 2);
   check(`${layout}: shop B counts its own sale`, await count(2,layout) === beforeB + 1);
  }
 } finally {
  await page.close();
  for (const session of sessions) await invoke('close', {sessionId:session.sessionId,closingCash:'0'});
 }
};
