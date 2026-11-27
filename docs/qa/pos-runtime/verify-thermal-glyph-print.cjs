const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const scripts = path.resolve(__dirname, '../../../component/zenith-erp-app/screen/zenithstatic/js');
const tamil = '\u0b95\u0bc1\u0ba3\u0bcd\u0b9f\u0bc1 \u0b89\u0bb3\u0bc1\u0ba8\u0bcd\u0ba4\u0bc1';
const names = [tamil, 'తెలుగు బియ్యం', 'മലയാളം അരി', 'English control & rice'];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.POS_QA_CHROME });
  try {
    const page = await browser.newPage();
    await page.evaluate(() => {
      window.printJobs = [];
      window.qz = {
        websocket: { isActive: () => true },
        configs: { create: (printer, options) => ({ printer, options }) },
        async print(config, documents) { window.printJobs.push({ config, documents }); }
      };
    });
    for (const script of ['pos-qz-print.js', 'pos-receipt-layout.js', 'kitchen-print.js']) {
      await page.addScriptTag({ path: path.join(scripts, script) });
    }

    for (const width of [58, 80]) {
      for (const receipt of ['POS', 'KOT']) {
        const actual = await page.evaluate(async ({ names, width, receipt }) => {
          const store = { name: 'Thermal QA', receiptWidth: width + 'mm' };
          const items = names.map(name => ({ name, qty: 1, uom: 'Nos', rate: 140, total: 140 }));
          const html = receipt === 'POS'
            ? window.PosReceiptLayout.render({
              store, items, bill: { number: 'QA-ONLY' }, summary: { subtotal: 560, total: 560 }
            }, false, false)
            : window.KitchenPrint.kotHtml({ store, items, number: 'QA-ONLY' });
          await window.PosQzPrint.printHtml('Synthetic printer', html);
          const { config, documents } = window.printJobs.pop();
          const [payload] = documents;
          const doc = new DOMParser().parseFromString(payload.data, 'text/html');
          const rows = await Promise.all(Array.from(doc.querySelectorAll('.item-name'), async cell => {
            const names = Array.from(cell.childNodes).map(node =>
              node.nodeType === Node.TEXT_NODE ? node.textContent : node.getAttribute('alt'));
            const pngs = await Promise.all(Array.from(cell.querySelectorAll('img'), async sprite => {
              const image = new Image();
              image.src = sprite.getAttribute('src');
              if (!image.src.startsWith('data:image/png;base64,')) return false;
              await image.decode();
              const canvas = document.createElement('canvas');
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(image, 0, 0);
              const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
              for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i + 3] > 0 && pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180) return true;
              }
              return false;
            }));
            return { names, pngs };
          }));
          return {
            rows, printer: config.printer, configuredWidth: config.options.size.width,
            configuredHeight: config.options.size.height, pageHeight: payload.options.pageHeight,
            pageWidth: payload.options.pageWidth, paperWidth: doc.querySelector('[data-paper-width]')?.dataset.paperWidth,
            format: [payload.type, payload.format, payload.flavor]
          };
        }, { names, width, receipt });

        const label = receipt + ' ' + width + 'mm';
        assert.equal(actual.printer, 'Synthetic printer', label);
        assert.deepEqual([actual.configuredWidth, actual.pageWidth, actual.paperWidth], [width, width, String(width)], label);
        assert.ok(actual.configuredHeight > 0, label + ' sets a positive paper length');
        assert.equal(actual.pageHeight, actual.configuredHeight, label + ' uses the same page length for HTML');
        assert.deepEqual(actual.format, ['pixel', 'html', 'plain'], label);
        assert.deepEqual(actual.rows, names.map((name, index) => index < 3
          ? { names: name.split(/( )/), pngs: [true, true] }
          : { names: [name], pngs: [] }), label + ' preserves shaped Indic words and their original spacing');
      }
    }
    const lengths = await page.evaluate(async () => {
      const store = { name: 'Thermal QA', receiptWidth: '80mm' };
      const printLength = async (count, edited = false) => {
        const items = Array.from({ length: count }, (_, index) => ({
          name: 'Long synthetic product name ' + (index + 1), qty: 0.5,
          uom: 'Nos', rate: 100, total: 50
        }));
        const html = window.PosReceiptLayout.render({
          store, items, bill: { number: 'QA-ONLY' },
          summary: { subtotal: count * 50, total: count * 50 }
        }, false, edited);
        await window.PosQzPrint.printHtml('Synthetic printer', html);
        const job = window.printJobs.pop();
        const printed = new DOMParser().parseFromString(job.documents[0].data, 'text/html');
        return {
          height: job.config.options.size.height,
          pageHeight: job.documents[0].options.pageHeight,
          hasLastItem: printed.querySelector('.items tbody tr:last-child .item-name')?.textContent ===
            'Long synthetic product name ' + count,
          hasTotal: printed.querySelector('.tot tr')?.textContent.includes((count * 50).toFixed(2)),
          hasFooter: printed.querySelector('.rcpt')?.textContent.includes('Thank You !!'),
          hasRevisionNotice: printed.querySelector('.notice')?.textContent.includes('EDITED / REVISED BILL') === true
        };
      };
      return [await printLength(4), await printLength(50), await printLength(50, true)];
    });
    assert.ok(lengths[1].height > lengths[0].height, '50-item receipt receives a longer paper size');
    assert.equal(lengths[1].pageHeight, lengths[1].height, 'long HTML render height matches its paper size');
    assert.ok(lengths[1].hasLastItem && lengths[1].hasTotal && lengths[1].hasFooter,
      'long receipt sent to QZ includes its final item, total and footer');
    assert.ok(lengths[2].hasRevisionNotice && lengths[2].hasLastItem &&
      lengths[2].hasTotal && lengths[2].hasFooter, 'revised long receipt includes its totals and notice');
    assert.ok(lengths[2].height > lengths[1].height,
      'revised receipt gets additional paper length for its edit notice');
    console.log('PASS QZ POS and KOT thermal receipts at 58mm and 80mm preserve Indic glyphs and size long bills through the total and footer.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
