// Uses native popup blocking. Only the physical print dialog is simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

const scripts = path.resolve(__dirname, '../../../component/zenith-erp-app/screen/zenithstatic/js');
const kitchenPrint = fs.readFileSync(path.join(scripts, 'kitchen-print.js'), 'utf8');
const billing = fs.readFileSync(path.join(scripts, 'kot-billing.js'), 'utf8');
const printChoice = billing.match(/  async function printChoice\([\s\S]*?(?=\r?\n  let billingNotice;)/)[0];
const fixture = `
<button id="print">Print both</button>
<dialog id="kb-print-choice">
  <span id="kb-print-error"></span>
  <div id="kb-print-recovery" hidden><button id="kb-print-browser">Print using browser</button></div>
</dialog>
<p id="kb-order-status"></p>
<script src="/kitchen-print.js"></script>
<script>
  const root = document.body, $ = id => document.getElementById('kb-' + id);
  let historyPrintRow, completedKotId, browserPrintRetry, busy = false;
  function controls() {}
  function clearPrintFeedback() { browserPrintRetry = null; $('print-error').textContent = ''; }
  function showBillingNotice() {}
  function savedPrinter() { return 'Synthetic printer'; }
  function disconnected() { return false; }
  window.qzAttempts = 0;
  if (location.search === '?qz-down') {
    window.PosQzPrint = {
      async connect() { window.qzAttempts++; throw Error('Synthetic QZ connection failure'); },
      printHtml() { throw Error('A job must not reach an unavailable QZ connection'); }
    };
  }
  function updatePrintOptions() {}
  const receipt = { success: true, items: [{ name: 'Kitchen item', qty: 2 }] };
  const localReceipt = location.search === '?ack-error' ? null : { receipt };
  if (!localReceipt) completedKotId = 'synthetic-kot';
  async function request(action) {
    if (action === 'ackKotPrint') throw Error('Synthetic acknowledgment failure');
    return { record: receipt };
  }
  window.isBusy = () => busy;
  window.PosReceiptLayout = { render: () => '<!doctype html><body><p>Customer bill</p>' };
  window.prints = [];
  window.opens = 0;
  const nativeOpen = window.open.bind(window);
  window.open = (...args) => {
    window.opens++;
    const popup = nativeOpen(...args);
    if (popup) popup.print = () => {
      const text = popup.document.body.textContent;
      const kitchen = text.includes('Kitchen item');
      window.prints.push(kitchen ? 'kitchen' : 'customer');
      if (kitchen && ['?manual', '?closed'].includes(location.search)) return;
      // An asynchronous print implementation still needs its original DOM until afterprint.
      setTimeout(() => {
        if (!popup.closed && popup.document.body.textContent === text) {
          window.prints.push(kitchen ? 'kitchen retained' : 'customer retained');
          popup.dispatchEvent(new popup.Event('afterprint'));
        }
      }, 150);
    };
    return popup;
  };
  ${printChoice}
  document.getElementById('print').onclick = () => {
    $('print-choice').showModal();
    printChoice(location.search === '?kot' ? 'kot' : location.search === '?bill' ? 'bill' : 'both');
  };
</script>`;

const server = http.createServer((request, response) => {
  const script = request.url === '/kitchen-print.js';
  response.setHeader('Content-Type', script ? 'application/javascript' : 'text/html');
  response.end(script ? kitchenPrint : fixture);
});

(async () => {
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const url = 'http://127.0.0.1:' + server.address().port;
    const useWebKit = process.env.KOT_QA_PRINT_BROWSER === 'webkit';
    const browserType = useWebKit ? webkit : chromium;
    const launch = useWebKit ? {} : {
      executablePath: process.env.POS_QA_CHROME,
      ignoreDefaultArgs: ['--disable-popup-blocking']
    };
    browser = await browserType.launch(launch);
    for (const scenario of ['automatic', 'manual', 'closed', 'ack-error', 'kot', 'bill', 'qz-down']) {
      const page = await browser.newPage();
      try {
        await page.goto(url + '?' + scenario);
        const opened = Promise.race([
          page.waitForEvent('popup'),
          page.waitForEvent('pageerror').then(error => { throw error; })
        ]);
        const [popup] = await Promise.all([opened, page.locator('#print').click()]);
        await page.waitForFunction(() => window.prints.length || document.getElementById('kb-print-error').textContent);
        const error = await page.locator('#kb-print-error').textContent();
        assert.equal(error, '', 'Print both must work with browser popup blocking');
        assert.equal(await page.evaluate(() => window.opens), 1);
        if (scenario === 'qz-down') assert.equal(await page.evaluate(() => window.qzAttempts), 1, 'Try QZ before falling back to the browser');
        if (scenario === 'kot' || scenario === 'bill') {
          const documentName = scenario === 'kot' ? 'kitchen' : 'customer';
          await page.waitForFunction(name => window.prints.includes(name + ' retained'), documentName);
          assert.deepEqual(await page.evaluate(() => window.prints), [documentName, documentName + ' retained']);
          continue;
        }
        if (scenario === 'closed') {
          await popup.close();
          await page.waitForFunction(() => !window.isBusy());
          assert.match(await page.locator('#kb-print-error').textContent(), /closed before the customer bill opened/);
          assert.deepEqual(await page.evaluate(() => window.prints), ['kitchen']);
          continue;
        }
        if (scenario === 'manual') {
          assert.deepEqual(await page.evaluate(() => window.prints), ['kitchen']);
          await popup.getByRole('button', { name: 'Print customer bill' }).click();
        }
        await page.waitForFunction(() => window.prints.includes('customer retained'));
        assert.deepEqual(await page.evaluate(() => window.prints),
          scenario === 'manual' ? ['kitchen', 'customer', 'customer retained'] :
            ['kitchen', 'kitchen retained', 'customer', 'customer retained']);
        await page.waitForFunction(() => !window.isBusy());
        const status = await page.locator('#kb-order-status').textContent();
        if (scenario === 'ack-error') {
          assert.match(status, /kitchen print count could not be updated/i);
        } else {
          assert.equal(status, '', 'Printing must keep the cart clear of confirmation messages');
        }
      } finally {
        await page.close();
      }
    }
    console.log(`PASS ${browserType.name()} ${browser.version()} KOT and customer print from one popup with independent documents.`);
  } finally {
    try {
      await browser?.close();
    } finally {
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
