const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { join } = require('node:path');

async function verifyKotCreditBills({ a, foreign, base, check, q, out, kotId, retailId }) {
  const page = await foreign.c.newPage();
  const posPath = '/apps/zenith/pos/CreditBills';
  const kotPath = '/apps/zenith/kot/CreditBills';
  const row = id => page.locator('.credit-history-btn[data-tx="' + id + '"]');
  const settle = page.locator('.credit-settle-btn[data-tx="' + kotId + '"]');
  const post = (actor, path, fields) => actor.c.request.post(base + path,{
    maxRedirects:0, form:{moquiSessionToken:actor.t,...fields}
  });
  const denied = async (actor, path, fields) => {
    const response = await post(actor,path,fields);
    return response.status() === 403 || (await response.json().catch(() => null))?.success === false;
  };
  const payments = id => q("SELECT payment_method,amount FROM pos_payment WHERE transaction_id='" + id + "' ORDER BY payment_method");
  const repay = async (method, amount) => {
    await settle.click();
    await page.locator('#settle-single [data-m="' + method + '"]').click();
    await page.locator('#settle-amt').fill(String(amount));
    const completed = page.waitForResponse(response => new URL(response.url()).pathname === kotPath+'/settleCredit');
    await page.locator('#settle-confirm').click();
    const response = await completed;
    await page.locator('#settle-confirm').waitFor({state:'detached'});
    return response.json();
  };
  try {
    await page.goto(base + posPath);
    await row(retailId).waitFor();
    check('POS Credit Bills lists its own credit and excludes the synced KOT credit',await row(kotId).count() === 0);
    const response = await page.goto(base + kotPath);
    assert.ok(response.ok(),'KOT has a dedicated Credit Bills screen');
    await row(kotId).waitFor();
    check('KOT Credit Bills lists the synced KOT credit and excludes ordinary POS credit',
      await row(retailId).count() === 0 && await settle.isVisible());
    if (out) await page.screenshot({path:join(out,'kot-credit-list.png')});

    const blocked = await Promise.all([
      denied(foreign,posPath+'/history',{transactionId:kotId}),
      denied(foreign,kotPath+'/history',{transactionId:retailId}),
      denied(a,kotPath+'/history',{transactionId:kotId}),
      denied(foreign,posPath+'/settleCredit',{settleTxId:kotId,settleMethod:'UPI',settleAmount:'1'}),
      denied(foreign,'/apps/zenith/pos/Terminal/ajaxCart',{action:'settleCredit',settleTxId:kotId,settleMethod:'UPI',settleAmount:'1'}),
      denied(foreign,kotPath+'/settleCredit',{settleTxId:retailId,settleMethod:'UPI',settleAmount:'1'}),
      denied(a,kotPath+'/settleCredit',{settleTxId:kotId,settleMethod:'UPI',settleAmount:'1'})
    ]);
    check('Credit detail and repayment enforce the module and organization boundary',
      blocked.every(Boolean) && payments(kotId).length === 1 && payments(retailId).length === 0,blocked);

    const partial = await repay('UPI',40);
    check('KOT can record a partial repayment against its offline credit bill',
      partial.success === true && Number(partial.outstanding) === 40 && !partial.fullyPaid,partial);
    const partialNotice = page.getByText('Payment recorded',{exact:false});
    await partialNotice.waitFor();
    const final = await repay('Card',40);
    await page.getByText('Bill fully settled',{exact:false}).waitFor();
    check('The latest repayment confirmation replaces the previous notification',
      await partialNotice.count() === 0);
    check('KOT keeps the upfront payment and both repayments when settling the remaining balance',
      final.success === true && final.fullyPaid === true && Number(final.outstanding) === 0 &&
      JSON.stringify(payments(kotId).map(p => [p.payment_method,Number(p.amount)])) === JSON.stringify([['Card',40],['Cash',10],['UPI',40]]) &&
      payments(retailId).length === 0,final);
    await row(kotId).click();
    const dialog = page.locator('#pos-credit-history');
    await dialog.getByText('Balance after payment',{exact:true}).waitFor();
    check('KOT repayment history shows the upfront payment and both repayments',await dialog.locator('tbody tr').count() === 3);
    if (out) await page.screenshot({path:join(out,'kot-credit-settlement.png')});
  } finally {
    await page.close();
  }
}

module.exports = async ({ a, foreign, base, check, q, out }) => {
  const context = foreign.c;
  const page = await context.newPage();
  const billing = base + '/apps/zenith/kot/KotBilling';
  const terminalId = 'POS_QA_B_TERM1';
  const org = 'POS_QA_B';
  const product = 'POS_QA_B_P18';
  const note = 'KOT Offline QA ' + randomUUID();
  const matchingOrders = () => q(
    "SELECT kot_id,kot_number,status_id,transaction_id FROM kitchen_order_ticket WHERE organization_party_id='" + org + "'" +
    " AND terminal_id='" + terminalId + "' AND notes LIKE '%" + note + "%' ORDER BY kot_id"
  );
  const syncRoute = '**/kot/KotBilling/syncOfflineSale';
  const saveDraftRoute = '**/kot/KotBilling/saveDraft';
  const search = page.locator('#kb-search');
  const cart = page.locator('#kb-cart');
  const history = page.getByRole('dialog', { name:'Bill History' });
  const orderStatus = page.locator('#kb-order-status');
  const waitTotal = amount => page.locator('#kb-grand').getByText(amount, { exact:true }).waitFor();
  let sessionId;
  let user;

  async function enterCounter() {
    await page.locator('#kot-terminal-entry select[name=terminalId]').selectOption(terminalId);
    await page.getByRole('button', { name:'Open / Resume Session' }).click();
    await page.locator('#kb-wrap[data-ready=true]').waitFor();
    sessionId = new URL(page.url()).searchParams.get('sessionId');
    user = await page.locator('#kb-data').getAttribute('data-user');
  }

  async function chooseMode(mode) {
    await page.locator('.kg-modes summary').click();
    await page.locator('[data-kb-sales-mode="' + mode + '"]').click();
  }

  async function switchOffline(offline) {
    await context.setOffline(offline);
    await page.locator('#kb-online.is-offline').waitFor({state:offline ? 'visible' : 'hidden'});
  }

  async function addItem(query, sku, method = 'click') {
    await search.fill(query);
    const result = page.locator('#kb-suggestions [data-result]').filter({hasText:sku});
    await result.waitFor();
    if (method === 'enter') await search.press('Enter');
    else await result.click();
    await cart.locator('tr[data-product="' + sku + '"]').waitFor();
  }

  async function offlineDashboard() {
    const dashboard = await context.newPage();
    await dashboard.goto(base + '/apps/zenith/kot/OfflineMode');
    const queue = dashboard.locator('[data-kot-device-queue][data-terminal="' + terminalId + '"]');
    await queue.waitFor();
    return { dashboard, queue };
  }

  try {
    await page.goto(billing);
    await enterCounter();
    await page.locator('#kb-wrap[data-offline-ready=true]').waitFor();
    const initialToday = Number(await page.locator('#kb-header-today-bills').textContent());
    check('KOT has a prepared offline workspace and uses the ordinary billing buttons',
      await page.locator('#kb-offline-open,#kb-offline').count() === 0 &&
      await page.locator('#kb-draft').isVisible() && await page.locator('#kb-history-open').isVisible());

    const readResponses = [];
    for (let burst = 0; burst < 3; burst++) {
      readResponses.push(...await Promise.all([
        ...Array.from({length:4}, async () => {
          const response = await context.request.get(base + '/apps/zenith/kot/OfflineMode');
          return {kind:'dashboard', status:response.status(), correct:(await response.text()).includes('id="kot-offline-title"')};
        }),
        ...Array.from({length:4}, async () => {
          const response = await context.request.post(billing + '/exportOfflineWorkspace', {
            form:{moquiSessionToken:foreign.t,sessionId},maxRedirects:0
          });
          const body = await response.json().catch(() => null);
          return {kind:'workspace', status:response.status(), correct:body?.workspace?.organizationPartyId===org};
        })
      ]));
    }
    check('Concurrent KOT dashboard and catalog requests all resolve the same cached shop list',
      readResponses.every(response => response.status === 200 && response.correct), {readResponses});

    await page.locator('[data-ot="Take Away"]').click();
    if (await page.locator('#kb-tax-toggle').getAttribute('aria-checked') === 'true') {
      await page.locator('#kb-tax-toggle').click();
    }
    const browserRequests = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/zenith/')) browserRequests.push(request.url());
    });
    await switchOffline(true);
    await addItem(product, product, 'enter');
    const rate = cart.locator('[data-kb-edit="rate"]');
    const quantity = cart.locator('[data-kb-edit="qty"]');
    await rate.fill('120');
    await rate.press('Enter');
    await quantity.fill('1.25');
    await quantity.press('ArrowDown');
    await waitTotal('₹150.00');
    await page.locator('#kb-tax-toggle').click();
    await waitTotal('₹177.00');
    await page.locator('#kb-instr').fill(note + ' hold and checkout');
    await page.locator('#kb-instr').blur();
    check('Disconnected KOT accepts keyboard product lookup, rate, fractional quantity and tax changes',
      await search.inputValue() === '' && await page.locator('[data-kb-payment="Cash"]').isEnabled() &&
      !browserRequests.some(url => /\/(?:searchMenu|cartReceipt)$/.test(url)));

    await page.keyboard.press('F7');
    await cart.locator('tr[data-product]').waitFor({state:'hidden'});
    check('Normal F7 Hold clears the cart and keeps the disconnected order on this device', matchingOrders().length === 0);
    await page.locator('.kg-modes summary').click();
    await page.locator('[data-kb-view=grid]').click();
    await page.locator('#kb-held-open').click();
    const heldBills = page.getByRole('dialog',{name:'Hold Bills'});
    await heldBills.locator('[data-kb-resume-local]').getByRole('button',{name:'Resume'}).click();
    await waitTotal('₹177.00');
    check('Hold Bills restores the offline order in its original List View',
      await page.locator('#kb-wrap:not(.kg-grid)').isVisible());
    await page.keyboard.press('F7');
    await cart.locator('tr[data-product]').waitFor({state:'hidden'});
    await page.locator('#kb-history-open').click();
    await history.locator('#kb-history-filter').click();
    await history.locator('#kb-history-status').selectOption('draft');
    const localResume = history.locator('article[data-kb-resume-local] [data-kb-history-detail]');
    await localResume.waitFor();
    await localResume.click();
    await page.locator('#kb-history-resume').click();
    await waitTotal('₹177.00');
    check('Normal History resumes the local Hold with tax, note, item rate and quantity intact',
      await page.locator('#kb-instr').inputValue() === note + ' hold and checkout' &&
      Number(await rate.inputValue()) === 120 && Number(await quantity.inputValue()) === 1.25);

    await page.evaluate(() => {
      window.kotOfflinePrints = [];
      window.kotOfflinePrintWindows = 0;
      window.open = () => {
        window.kotOfflinePrintWindows++;
        let html = '';
        const dom = document.implementation.createHTMLDocument();
        const printDocument = {
          head:dom.head, body:dom.body, createElement:tag => dom.createElement(tag),
          open() { html = ''; },
          write(markup) { html += markup; },
          close() {}
        };
        return Object.assign(new EventTarget(),{
          document:printDocument,
          closed:false,
          focus() {},
          print() {
            window.kotOfflinePrints.push(html);
            this.dispatchEvent(new Event('afterprint'));
          },
          close() { this.closed = true; }
        });
      };
    });
    await search.focus();
    await page.keyboard.press('Space');
    const cash = page.locator('#kb-payment input[name=cashAmount]:visible');
    await cash.fill('200');
    await page.locator('#kb-payment .pos-cash-confirm').click();
    await page.locator('#kb-print-choice').waitFor();
    check('Normal disconnected Cash checkout queues the sale without requiring a server receipt',
      matchingOrders().length === 0 && await page.locator('#kb-print-summary').getByText(/23\.00/).isVisible() &&
      await page.locator('#kb-close-session').isDisabled() && await page.locator('#kb-printer-options').isHidden());
    if (out) await page.screenshot({path:join(out,'kot-offline-disconnected-checkout.png')});
    await page.locator('[data-kb-print="both"]').click();
    await page.waitForFunction(() => window.kotOfflinePrints.length === 2);
    const prints = await page.evaluate(() => window.kotOfflinePrints);
    check('Print both dispatches the actual kitchen ticket and customer receipt while disconnected',
      prints[0].includes('Disposable POS B P18') && prints[0].includes('class="q">1.25</td>') &&
      prints[1].includes('Disposable POS B P18') && prints[1].includes('177.00') &&
      !browserRequests.some(url => /\/(?:printRecord|checkoutKot|syncOfflineSale)$/.test(url)));
    check('Offline Print both opens one window for both documents',await page.evaluate(() => window.kotOfflinePrintWindows) === 1);

    let sale;
    let committed = false;
    let syncFailure;
    let acknowledgeReplay = false;
    const dropAcknowledgement = async route => {
      const acknowledge = acknowledgeReplay;
      const data = new URLSearchParams(route.request().postData());
      sale = JSON.parse(data.get('saleJson'));
      try {
        const response = await route.fetch();
        if (acknowledge) {
          await route.fulfill({response});
          return;
        }
        const result = await response.json().catch(() => null);
        committed ||= response.ok() && result?.success === true;
        if (!committed) syncFailure = result || {status:response.status()};
      } catch (error) { syncFailure = {message:error.message}; }
      await route.abort().catch(() => {});
    };
    await page.route(syncRoute, dropAcknowledgement);
    const lostResponse = page.waitForEvent('requestfailed', request => request.url().endsWith('/syncOfflineSale'));
    await switchOffline(false);
    await lostResponse;
    const firstSave = matchingOrders();
    check('A lost reconnect response leaves exactly one persisted paid KOT order',
      committed && firstSave.length === 1 && !!firstSave[0].transaction_id, {firstSave,syncFailure});
    const payment = q("SELECT t.transaction_number,t.payable_amount,t.change_amount,p.amount,p.payment_method FROM pos_transaction t" +
      " JOIN pos_payment p ON p.transaction_id=t.transaction_id WHERE t.transaction_id='" + firstSave[0].transaction_id + "'");
    check('Reconciliation records one ₹177 sale with ₹200 received and ₹23 change',
      payment.length === 1 && Number(payment[0].payable_amount) === 177 &&
      Number(payment[0].change_amount) === 23 && Number(payment[0].amount) === 200 && payment[0].payment_method === 'Cash', {payment});

    const { dashboard, queue } = await offlineDashboard();
    await queue.getByText(sale.offlineId,{exact:false}).waitFor();
    check('KOT Offline Mode can still see the pending device entry after acknowledgement loss', await queue.isVisible());
    await dashboard.close();
    check('A bill remains pending on the billing screen until its server acknowledgement',
      (await page.locator('#kb-list-last-bill').textContent()).trim() === 'Pending sync' &&
      /queued to sync/.test(await orderStatus.textContent()));
    const replayResponse = page.waitForResponse(response => response.url().endsWith('/syncOfflineSale') && response.ok());
    acknowledgeReplay = true;
    await page.evaluate(() => {
      window.kotReconnectDocument = true;
      window.dispatchEvent(new Event('online'));
    });
    const replay = await (await replayResponse).json();
    await page.unroute(syncRoute, dropAcknowledgement);
    assert.equal(replay.success,true);
    const officialNumber = payment[0].transaction_number;
    await page.waitForFunction(({ number, count }) =>
      document.querySelector('#kb-header-today-bills').textContent.trim() === String(count) &&
      document.querySelector('#kb-header-last-bill').textContent.trim() === number,
      {number:officialNumber,count:initialToday+1});
    const printSummary = await page.locator('#kb-print-summary').textContent();
    check('Acknowledgement updates the bill number and clears the queued message without reloading',
      await page.evaluate(() => window.kotReconnectDocument) &&
      (await page.locator('#kb-list-last-bill').textContent()).trim() === officialNumber &&
      await orderStatus.isHidden() &&
      printSummary.includes('Bill '+officialNumber+' is saved.') &&
      printSummary.includes('Change given: ₹23.00.') &&
      !printSummary.includes('queued to sync'));
    if (out) await page.screenshot({path:join(out,'kot-offline-reconnected-billing.png')});
    check('Same-tab reconnect replays the sale without a duplicate KOT ticket, transaction or tender',
      JSON.stringify(matchingOrders()) === JSON.stringify(firstSave) &&
      q("SELECT transaction_id FROM pos_payment WHERE transaction_id='" + firstSave[0].transaction_id + "'").length === 1);

    const ack = await offlineDashboard();
    await ack.queue.getByText('No KOT orders pending sync on this counter.').waitFor();
    check('KOT clears its local queue after verified server acknowledgement', await ack.queue.isVisible());
    if (out) await ack.dashboard.screenshot({path:join(out,'kot-offline-synced.png')});
    await ack.dashboard.close();

    await page.route('**/apps/qzSign?*',route=>route.fulfill({body:'U1lOVEhFVElD',contentType:'text/plain'}));
    await page.evaluate(() => {
      localStorage.setItem('posPrinter','Disposable QZ printer');
      window.kotQzJobs = [];
      let active = false;
      window.qz = {
        security:{
          setSignatureAlgorithm:value => { window.kotQzAlgorithm = value; },
          setCertificatePromise:() => {},
          setSignaturePromise:handler => { window.kotQzSigner = handler; }
        },
        websocket:{isActive:() => active,connect:async () => { active = true; }},
        printers:{
          find:async () => ['Disposable QZ printer','Second disposable printer'],
          getDefault:async () => 'Disposable QZ printer'
        },
        configs:{create:(printer,options) => ({printer,options})},
        print:async (config,data) => {
          const signature=await new Promise(window.kotQzSigner('synthetic print request'));
          if(window.kotQzRejectBill&&!data[0].data.includes('<title>KOT</title>'))throw Error('Disposable printer is unavailable');
          if(window.kotQzWait)await new Promise(resolve=>{window.kotQzRelease=resolve;});
          window.kotQzJobs.push({config,data,signature});
        }
      };
    });
    const existingBrowserJobs = await page.evaluate(() => window.kotOfflinePrints.length);
    await page.locator('#kb-history-open').click();
    await history.locator('#kb-history-status').selectOption('');
    const syncedRow = history.locator('[data-kot-id="' + firstSave[0].kot_id + '"]');
    await syncedRow.locator('[data-kb-history-print=bill]').click();
    await page.waitForFunction(previous => window.kotQzJobs.length || window.kotOfflinePrints.length > previous,existingBrowserJobs);
    const qzPrint = await page.evaluate(() => ({
      jobs:window.kotQzJobs,algorithm:window.kotQzAlgorithm,signed:typeof window.kotQzSigner==='function',
      browser:window.kotOfflinePrints.length
    }));
    check('KOT Billing reprints the confirmed receipt through the saved QZ printer without a browser dialog',
      qzPrint.jobs.length === 1 && qzPrint.jobs[0].config.printer === 'Disposable QZ printer' &&
      qzPrint.jobs[0].data[0].data.includes(officialNumber) && qzPrint.jobs[0].signature === 'U1lOVEhFVElD' &&
      qzPrint.algorithm === 'SHA1' && qzPrint.signed &&
      qzPrint.browser === existingBrowserJobs);
    const printBanner=page.locator('.kb-print-banner');
    await printBanner.waitFor();
    check('QZ print confirmation shows the bill number after the print job is accepted',
      (await printBanner.textContent()).includes('BILL-'+officialNumber+' sent to printer'));
    await page.evaluate(() => {
      localStorage.removeItem('posPrinter');
      document.querySelector('.kb-print-banner')?.remove();
      window.kotQzWait=true;
    });
    await syncedRow.locator('[data-kb-history-print=bill]').click();
    await page.waitForFunction(() => typeof window.kotQzRelease==='function');
    check('A queued QZ job waits for acceptance without opening browser print or showing success',
      await printBanner.count()===0 &&
      await page.evaluate(previous => window.kotOfflinePrints.length===previous,existingBrowserJobs));
    await page.evaluate(() => { window.kotQzWait=false; window.kotQzRelease(); });
    await page.waitForFunction(() => window.kotQzJobs.length===2);
    check('A second print uses QZ and its system default printer when no printer is saved',
      await page.evaluate(previous => window.kotQzJobs[1].config.printer==='Disposable QZ printer' &&
        window.kotOfflinePrints.length===previous,existingBrowserJobs));
    await page.evaluate(() => localStorage.setItem('posPrinter','Disposable QZ printer'));
    await syncedRow.locator('[data-kb-history-detail]').click();
    await page.locator('#kb-history-detail').getByRole('button',{name:'Print bill',exact:true}).waitFor();
    await page.evaluate(() => { window.kotQzRejectBill=true; });
    await page.locator('#kb-history-detail-reprint').click();
    await page.locator('#kb-print-error').getByText(/Disposable printer is unavailable/).waitFor();
    check('When editor reprint fails in QZ, it offers an explicit browser fallback',
      await page.locator('#kb-print-choice').isVisible()&&
      await page.locator('#kb-print-browser').isVisible()&&
      await page.evaluate(previous => window.kotQzJobs.length===2&&window.kotOfflinePrints.length===previous,existingBrowserJobs));
    await page.locator('[data-kb-print=bill]').focus();
    for (const [selector, label] of [['[data-kb-print=kot]', 'KOT Print'], ['[data-kb-print=both]', 'Print both'], ['#kb-print-close', 'Done']]) {
      await page.keyboard.press('ArrowRight');
      check('The print chooser moves focus to '+label, await page.locator(selector).evaluate(el => el === document.activeElement));
    }
    await page.locator('#kb-printer-setup').click();
    await page.locator('#kb-printer-list').selectOption('Second disposable printer');
    check('KOT can change the saved QZ printer without opening a print dialog',
      await page.evaluate(() => localStorage.getItem('kotPrinter')==='Second disposable printer' &&
        localStorage.getItem('posPrinter')==='Disposable QZ printer' && window.kotQzJobs.length===2));
    await page.locator('[data-kb-print=both]').click();
    await page.locator('#kb-print-error').getByText(/Kitchen ticket sent/).waitFor();
    check('A failed customer job after a successful QZ kitchen job keeps browser fallback explicit',
      await page.locator('[data-kb-print=both]').isDisabled() &&
      await page.evaluate(previous => window.kotQzJobs.length===3 &&
        window.kotQzJobs[2].config.printer==='Second disposable printer' &&
        window.kotQzJobs[2].data[0].data.includes('<title>KOT</title>') &&
        window.kotOfflinePrints.length===previous,existingBrowserJobs));
    await page.locator('#kb-print-browser').click();
    await page.locator('#kb-print-choice').waitFor({state:'hidden'});
    check('Browser fallback prints only the remaining customer bill without charging again',
      await page.evaluate(({previous,number}) => window.kotOfflinePrints.length===previous+1 &&
        window.kotOfflinePrints.at(-1).includes(number) && window.kotQzJobs.length===3,
        {previous:existingBrowserJobs,number:officialNumber}) &&
      (await printBanner.textContent()).includes('browser print requested') &&
      JSON.stringify(matchingOrders())===JSON.stringify(firstSave));
    await page.locator('#kb-history-detail-close').click();
    await page.locator('#kb-history-close').click();
    await page.evaluate(() => {
      localStorage.removeItem('kotPrinter');
      localStorage.removeItem('posPrinter');
      delete window.qz;
    });

    const direct = (actor, route, payload) => actor.c.request.post(base + '/apps/zenith/' + route, {
      form: {moquiSessionToken:actor.t, sessionId, saleJson:JSON.stringify(payload)}, maxRedirects:0
    });
    const bad = await direct(a,'kot/KotBilling/syncOfflineSale',sale);
    const pos = await direct(foreign,'pos/Kitchen/KotBilling/syncOfflineSale',sale);
    check('The same offline sale is unavailable to a different organization and the legacy POS Kitchen route',
      (await bad.json().catch(() => null))?.success !== true && (await pos.json().catch(() => null))?.success !== true &&
      JSON.stringify(matchingOrders()) === JSON.stringify(firstSave), {foreignStatus:bad.status(),posStatus:pos.status()});
    const invokePos = async (op, params) => {
      const response = await context.request.post(base + '/apps/zenith/pos/PosQaAcceptance/invoke', {
        form:{moquiSessionToken:foreign.t,op,...params},maxRedirects:0
      });
      const result = await response.json();
      assert.deepEqual(result.errors,[],op);
      return result.result;
    };
    const completedKotOrders = async () => {
      const dashboard = await context.newPage();
      try {
        const response = await dashboard.goto(base + '/apps/zenith/kot/KotDashboard');
        assert.ok(response.ok(),'KOT Dashboard loads');
        return Number(await dashboard.locator('.kd-stat').filter({hasText:'Completed Orders'}).locator('.kd-stat__value').innerText());
      } finally {
        await dashboard.close();
      }
    };
    const beforeRetail = await completedKotOrders();
    const { transactionId } = await invokePos('cart',{sessionId,reuseOpenCart:'false'});
    await invokePos('add',{transactionId,productId:product,quantity:'1',taxOn:'N'});
    await invokePos('kot',{posTransactionId:transactionId,items:JSON.stringify([{productId:product,quantity:1}])});
    await invokePos('pay',{transactionId,paymentMethod:'Cash',amount:'100'});
    await invokePos('complete',{transactionId});
    const legacyTickets = q("SELECT kot_id,order_receipt_json FROM kitchen_order_ticket WHERE transaction_id='" + transactionId + "'");
    assert.ok(legacyTickets.length === 1 && legacyTickets[0].order_receipt_json === null,'Retail fixture has a legacy kitchen ticket');
    const retailNumber = q("SELECT transaction_number FROM pos_transaction WHERE transaction_id='" + transactionId + "'")[0].transaction_number;
    const [kotTransactions, posTransactions, posHistory] = await Promise.all([
      context.request.get(base + '/apps/zenith/kot/PosTransactions'),
      context.request.get(base + '/apps/zenith/pos/PosTransactions'),
      context.request.post(base + '/apps/zenith/pos/Terminal/ajaxCart', {
        form:{moquiSessionToken:foreign.t,sessionId,action:'billHistory'},maxRedirects:0
      })
    ]);
    const [kotList,posList,historyList] = await Promise.all([kotTransactions,posTransactions,posHistory].map(response => response.text()));
    const afterRetail = await completedKotOrders();
    const inKot = kotList.includes(retailNumber);
    const inPos = posList.includes(retailNumber);
    const inPosHistory = historyList.includes(retailNumber);
    check('A POS bill with a legacy kitchen ticket remains a POS sale and leaves the KOT dashboard unchanged',
      posTransactions.ok() && posHistory.ok() && kotTransactions.ok() && inPos && inPosHistory && !inKot && afterRetail === beforeRetail,
      {retailNumber,inPos,inPosHistory,inKot,beforeRetail,afterRetail});
    const number = payment[0].transaction_number;
    check('The synced offline bill is in KOT Transactions and the consolidated POS report, with retail Bill History kept separate',
      kotTransactions.ok() && kotList.includes(number) && posTransactions.ok() && posList.includes(number) &&
      posHistory.ok() && !historyList.includes(number),
      {kotStatus:kotTransactions.status(),posStatus:posTransactions.status(),historyStatus:posHistory.status(),number});
    await page.reload();
    check('Reloaded KOT header counts only the confirmed KOT bill and ignores the newer POS bill',
      Number(await page.locator('#kb-header-today-bills').textContent()) === initialToday+1 &&
      (await page.locator('#kb-header-last-bill').textContent()).trim() === number);

    await page.locator('#kb-wrap[data-offline-ready=true]').waitFor();
    await page.locator('.kg-modes summary').click();
    await page.locator('[data-kb-view=grid]').click();
    await switchOffline(true);
    await page.locator('[data-ot="Take Away"]').click();
    if (await page.locator('#kb-tax-toggle').getAttribute('aria-checked') === 'true') {
      await page.locator('#kb-tax-toggle').click();
    }
    await chooseMode('WHOLESALE');
    await addItem('disposable   pos b p5', 'POS_QA_B_P5');
    await waitTotal('₹90.00');
    await page.locator('#kb-instr').fill(note + ' split');
    await page.locator('[data-kb-payment=Split]').click();
    await cash.fill('40');
    await page.locator('#kb-payment [name=upiAmount]').fill('49');
    const confirmOther = page.locator('#kb-other-payment button[type=submit]:visible');
    const confirmUpi = async () => {
      await page.locator('#posPayConfOk').click();
      await page.locator('#kb-print-choice').waitFor();
    };
    await confirmOther.click();
    await page.locator('#kb-payment-error').getByText(/add up to the bill total/i).waitFor();
    await page.locator('#kb-payment [name=upiAmount]').fill('50');
    await page.locator('#kb-payment [name=upiRef]').fill('KOT-QA-SPLIT-UPI');
    await confirmOther.click();
    await page.locator('#kb-print-close').click();
    check('Grid View finds multiword searches offline, uses Wholesale price, and validates split before checkout',
      matchingOrders().length === 1 && await page.locator('#kb-order-status').getByText(/queued to sync/).isVisible());

    const scope = {org,terminalId,user};
    const deviceCount = ({org,terminalId,user}) => window.KotOffline.createWorkspace(org,terminalId,user).queue().length;
    await addItem('disposable pos b p18',product);
    await page.locator('#kb-instr').fill(note + ' credit');
    await page.locator('[data-kb-payment=Credit]').click();
    await page.locator('#kb-payment [name=customerName]').fill('Unregistered QA Customer');
    await page.locator('#kb-payment [name=customerPhone]').fill('123');
    await confirmOther.click();
    await page.locator('#kb-payment-error').getByText(/valid customer phone number/i).waitFor();
    check('An invalid offline credit phone leaves the queued Split and current credit cart unchanged',
      await page.evaluate(deviceCount,scope) === 1 && !await page.locator('#kb-print-choice').isVisible());
    await page.locator('#kb-payment-close').click();
    await page.locator('#kb-customer-open').click();
    await page.locator('#kb-customer-search').fill('Synthetic POS B SAME');
    await page.locator('[data-cust-id="POS_QA_B_CUST_SAME"]').click();
    await page.locator('[data-kb-payment=Credit]').click();
    const creditPhone = page.locator('#kb-payment [name=customerPhone]');
    if (await creditPhone.isEditable()) await creditPhone.fill('9000000020');
    await page.locator('#credit-upfront').fill('10');
    await page.locator('#credit-days').fill('14');
    await page.locator('#credit-terms-reason').fill('Disposable KOT checkout test');
    await confirmOther.click();
    await page.locator('#kb-print-close').click();
    check('A named-customer credit checkout is queued independently of the Split bill',
      await page.evaluate(deviceCount,scope) === 2 && matchingOrders().length === 1);
    await switchOffline(false);
    await page.waitForFunction(scope => window.KotOffline.createWorkspace(scope.org,scope.terminalId,scope.user).queue().length === 0,scope);
    const synchronized = matchingOrders();
    const split = q("SELECT payment_method,amount,reference_number FROM pos_payment WHERE transaction_id='" + synchronized[1]?.transaction_id + "' ORDER BY payment_method");
    const credit = q("SELECT customer_party_id,payable_amount,paid_amount,credit_days FROM pos_transaction WHERE transaction_id='" + synchronized[2]?.transaction_id + "'");
    check('Reconnect preserves the Split reference and the selected customer, upfront payment, and term on Credit',
      synchronized.length === 3 && split.length === 2 && split[0].payment_method === 'Cash' && Number(split[0].amount) === 40 &&
      split[1].payment_method === 'UPI' && Number(split[1].amount) === 50 && split[1].reference_number === 'KOT-QA-SPLIT-UPI' &&
      credit.length === 1 && credit[0].customer_party_id === 'POS_QA_B_CUST_SAME' &&
      Number(credit[0].payable_amount) === 90 && Number(credit[0].paid_amount) === 10 && Number(credit[0].credit_days) === 14,
      {split,credit});

    const { transactionId:retailCreditId } = await invokePos('cart',{sessionId,reuseOpenCart:'false'});
    await invokePos('add',{transactionId:retailCreditId,productId:product,quantity:'1',taxOn:'N'});
    await invokePos('credit',{transactionId:retailCreditId,customerName:'Disposable POS B retail credit',customerPhone:'9000000052'});
    await verifyKotCreditBills({a,foreign,base,check,q,out,kotId:synchronized[2].transaction_id,retailId:retailCreditId});

    const tableNumber = 'OFFLINE-' + randomUUID().slice(0,8);
    const tableResponse = await context.request.post(base + '/apps/zenith/kot/Tables/createTable', {
      form:{moquiSessionToken:foreign.t,facilityId:'POS_QA_B_FAC',tableNumber,seatingCapacity:'2'},maxRedirects:0
    });
    const table = q("SELECT table_id FROM restaurant_table WHERE facility_id='POS_QA_B_FAC' AND table_number='" + tableNumber + "'");
    assert.ok(tableResponse.status()<400 && table.length===1,'Synthetic dine-in table exists');
    const tableId = table[0].table_id;
    await page.goto(base + '/apps/zenith/kot/Tables');
    await page.locator('.tm-card[data-table-id="' + tableId + '"]').click();
    await page.locator('[data-billing-table="' + tableId + '"]').click();
    await enterCounter();
    await page.locator('#kb-wrap[data-offline-ready=true]').waitFor();
    await page.locator('.kg-modes summary').click();
    await page.locator('[data-kb-view=grid]').click();
    await switchOffline(true);
    assert.equal(await page.locator('#kb-table').inputValue(),tableId,'Table selected in the Tables workflow carries through to offline billing');
    await addItem(product,product);
    await page.locator('#kb-instr').fill(note + ' dine-in');
    await page.locator('#kb-instr').blur();
    await page.keyboard.press('Shift');
    await page.locator('#kb-print-close').click();
    const queuedSales = ({org,terminalId,user}) => window.KotOffline.createWorkspace(org,terminalId,user).queue().map(entry => entry.sale);
    const sent = (await page.evaluate(queuedSales,scope)).find(sale => sale.operation === 'send');
    assert.ok(sent,'The dine-in ticket was queued before checkout');
    const openSentPayment = async method => {
      await page.locator('#kb-history-open').click();
      await history.locator('[data-kb-bill-local]').click();
      await page.locator('#kb-payment').waitFor();
      const methodPicker = page.locator('#kb-payment-method');
      if (await methodPicker.isVisible()) {
        await methodPicker.selectOption(method);
        await page.locator('#kb-payment-continue').click();
      } else assert.equal(await methodPicker.inputValue(),method);
    };
    await openSentPayment('Cash');
    const sentTotal = await page.locator('#kb-payment-total').textContent();
    await page.locator('#kb-payment .pos-cash-cancel').click();
    const sentRow = cart.locator('tr[data-product="' + product + '"]');
    const editableSent = await sentRow.locator('[data-kb-edit]').evaluateAll(inputs => inputs.some(input => !input.disabled && !input.readOnly));
    if (editableSent) {
      const rate = sentRow.locator('[data-kb-edit=rate]');
      await rate.fill('81');
      await rate.press('Enter');
    }
    check('Cancelling offline payment never makes a sent kitchen ticket editable or queues a payment',
      !editableSent && JSON.stringify(await page.evaluate(queuedSales,scope)) === JSON.stringify([sent]),
      {editableSent,cartRows:await cart.locator('tr[data-product]').count()});

    await addItem('disposable pos b p5','POS_QA_B_P5');
    const newRow = cart.locator('tr[data-product="POS_QA_B_P5"]');
    const newQuantity = newRow.locator('[data-kb-edit=qty]');
    await newQuantity.fill('2');
    await newQuantity.press('ArrowDown');
    check('A new offline cart can be edited after cancellation while the sent ticket stays unchanged',
      Number(await newQuantity.inputValue()) === 2 && JSON.stringify(await page.evaluate(queuedSales,scope)) === JSON.stringify([sent]));
    await page.locator('#kb-history-open').click();
    await history.locator('[data-kb-bill-local]').click();
    await history.locator('#kb-history-error').filter({hasText:'Hold the current order'}).waitFor();
    check('An unsent offline cart remains intact when opening a different sent ticket',
      Number(await newQuantity.inputValue()) === 2 && !await page.locator('#kb-payment').isVisible() &&
      JSON.stringify(await page.evaluate(queuedSales,scope)) === JSON.stringify([sent]));
    await page.locator('#kb-history-close').click();
    await page.locator('#kb-clear').click();

    await openSentPayment('UPI');
    assert.equal(await page.locator('#kb-payment-total').textContent(),sentTotal,'Reopening uses the original sent ticket total');
    await confirmUpi();
    await page.locator('#kb-print-close').click();
    check('A disconnected dine-in kitchen ticket can be billed from ordinary History',
      await page.evaluate(deviceCount,scope) === 2 && matchingOrders().length === 3);
    await switchOffline(false);
    await page.waitForFunction(scope => window.KotOffline.createWorkspace(scope.org,scope.terminalId,scope.user).queue().length === 0,scope);
    const dineIn = matchingOrders()[3];
    const tickets = q("SELECT operation,kot_id,transaction_id FROM kot_offline_sale_sync WHERE kot_id='" + dineIn?.kot_id + "' ORDER BY operation");
    const dineInPayments = q("SELECT payment_method,amount FROM pos_payment WHERE transaction_id='" + dineIn?.transaction_id + "'");
    check('The queued kitchen ticket and its later UPI payment reconcile to a single table order',
      matchingOrders().length === 4 && !!dineIn.transaction_id && tickets.length === 2 &&
      tickets[0].operation === 'checkout' && tickets[0].transaction_id === dineIn.transaction_id &&
      tickets[1].operation === 'send' && !tickets[1].transaction_id &&
      dineInPayments.length === 1 && dineInPayments[0].payment_method === 'UPI' && Number(dineInPayments[0].amount) === Number(sent.total),
      {dineIn,tickets,dineInPayments});

    await switchOffline(true);
    await page.locator('[data-ot="Take Away"]').click();
    await addItem(product,product);
    const cardNote = (note + ' card ').padEnd(500,'x');
    await page.locator('#kb-instr').fill(cardNote);
    await page.locator('[data-kb-payment=Card]').click();
    await page.locator('#kb-payment [name=referenceNumber]').fill('KOT-QA-CARD');
    await confirmOther.click();
    await page.locator('#kb-print-close').click();
    await switchOffline(false);
    await page.waitForFunction(scope => window.KotOffline.createWorkspace(scope.org,scope.terminalId,scope.user).queue().length === 0,scope);
    const cardOrder = matchingOrders()[4];
    const card = q("SELECT payment_method,reference_number FROM pos_payment WHERE transaction_id='" + cardOrder?.transaction_id + "'");
    const savedCardNote = q("SELECT notes FROM kitchen_order_ticket WHERE kot_id='" + cardOrder?.kot_id + "'")[0]?.notes;
    check('Direct Card checkout syncs once with its cashier-entered reference and full 500-character note',
      matchingOrders().length === 5 && card.length === 1 && card[0].payment_method === 'Card' &&
      card[0].reference_number === 'KOT-QA-CARD' && savedCardNote === '[Take Away] ' + cardNote, {card,noteLength:savedCardNote?.length});

    await switchOffline(true);
    await addItem(product,product);
    const reconnectNote = note + ' reconnect during sent payment';
    await page.locator('#kb-instr').fill(reconnectNote);
    await page.locator('#kb-instr').blur();
    await page.keyboard.press('Shift');
    await page.locator('#kb-print-close').click();
    const pendingTicket = (await page.evaluate(queuedSales,scope)).find(sale => sale.operation === 'send');
    assert.ok(pendingTicket,'The ticket is queued before reconnecting');
    await openSentPayment('UPI');
    const pendingTotal = await page.locator('#kb-payment-total').textContent();
    await switchOffline(false);
    await page.waitForFunction(scope => window.KotOffline.createWorkspace(scope.org,scope.terminalId,scope.user).queue().length === 0,scope);
    const ticketRow = () => q("SELECT kot_id,transaction_id FROM kitchen_order_ticket WHERE organization_party_id='" + org + "' AND notes='[Take Away] " + reconnectNote + "'");
    const [savedTicket] = ticketRow();
    assert.ok(savedTicket && !savedTicket.transaction_id,'The server has acknowledged the ticket while the tender dialog stays open');
    assert.equal(await page.locator('#kb-payment-total').textContent(),pendingTotal);
    await confirmUpi();
    await page.locator('#kb-payment').waitFor({state:'hidden'});
    await page.locator('#kb-print-close').click();
    await page.waitForFunction(scope => window.KotOffline.createWorkspace(scope.org,scope.terminalId,scope.user).queue().length === 0,scope);
    const linkedTicket = ticketRow();
    const linkedPayments = q("SELECT payment_method,amount FROM pos_payment WHERE transaction_id='" + linkedTicket[0]?.transaction_id + "'");
    check('Reconnecting while the sent-ticket payment dialog is open settles the original server ticket once',
      linkedTicket.length === 1 && linkedTicket[0].kot_id === savedTicket.kot_id && linkedPayments.length === 1 &&
      linkedPayments[0].payment_method === 'UPI' && Number(linkedPayments[0].amount) === Number(pendingTicket.total),
      {linkedTicket,linkedPayments});

    await chooseMode('RETAIL');

    const legacy = {
      itemsJson:JSON.stringify([{productId:product,quantity:1}]), orderType:'Take Away',
      salesModeId:'RETAIL',taxOn:'N',notes:note + ' legacy draft'
    };
    const legacyId = await page.evaluate(({org,terminalId,user,legacy}) => {
      return window.KotOfflineDrafts.createStore(org,terminalId,user).save(legacy).id;
    }, {org,terminalId,user,legacy});
    const legacyResponse = page.waitForResponse(response => response.url().endsWith('/confirmOfflineDraft') && response.ok());
    await page.reload();
    assert.equal((await (await legacyResponse).json()).success,true);
    await page.waitForFunction(({org,terminalId,user,legacyId}) => !window.KotOfflineDrafts.createStore(org,terminalId,user).read(legacyId),
      {org,terminalId,user,legacyId});
    check('A legacy device draft still syncs automatically to one unpaid KOT hold',
      matchingOrders().filter(order => order.status_id === 'KotDraft' && !order.transaction_id).length === 1);

    const catalogRoute = '**/kot/KotBilling/searchMenu';
    const healthRoute = '**/kot/KotBilling/touchSession';
    const blockRequest = route => route.abort('failed');
    const clearCart = () => page.locator('#kb-clear').click();
    await page.route(catalogRoute,blockRequest);
    const isolatedSearch = page.waitForRequest(request => request.url().endsWith('/searchMenu'));
    const healthy = page.waitForResponse(response => response.url().endsWith('/touchSession') && response.ok());
    await addItem('disposable pos b p5','POS_QA_B_P5');
    await isolatedSearch;
    await healthy;
    check('An isolated KOT search failure falls back to cached products without taking billing offline',
      await page.locator('#kb-online.is-offline').isHidden());
    await clearCart();

    await page.route(healthRoute,blockRequest);
    await addItem('disposable pos b p18',product);
    await page.locator('#kb-online.is-offline').waitFor();
    check('Cached search continues during an ERP connection failure with the network adapter still online',
      await page.evaluate(() => navigator.onLine) && await page.locator('#kb-online.is-offline').isVisible());
    await page.unroute(catalogRoute,blockRequest);
    await page.unroute(healthRoute,blockRequest);
    await page.locator('#kb-online.is-offline').waitFor({state:'hidden'});
    await clearCart();

    await page.locator('[data-ot="Take Away"]').click();
    await addItem(product, product);
    await page.locator('#kb-instr').fill(note + ' online hold');
    const dropHoldResponse = async route => {
      await route.fetch();
      await route.abort();
    };
    await page.route(saveDraftRoute, dropHoldResponse);
    await page.locator('#kb-draft').click();
    await orderStatus.getByText(/could not be confirmed|could not be completed/i).waitFor();
    await switchOffline(true);
    check('A committed online Hold with a lost response cannot be resubmitted from the offline cart',
      await page.locator('#kb-draft').isDisabled() && await page.locator('[data-kb-payment="Cash"]').isDisabled() &&
      matchingOrders().filter(order => order.status_id === 'KotDraft').length === 2);
  } finally {
    await context.setOffline(false);
    await page.close();
  }
};
