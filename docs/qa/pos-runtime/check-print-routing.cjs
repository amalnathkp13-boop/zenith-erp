// Exercise the production receipt router with a virtual clock and printer; no device jobs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../../component/zenith-erp-app/screen/zenithstatic/js/pos-terminal.js'), 'utf8');
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function harness({missing = false, fullscreen = false} = {}) {
    let now = 0, active = false, serial = 0;
    const timers = new Map(), connections = [], jobs = [], browser = [], offers = [];
    const context = vm.createContext({
        Promise, console: {log() {}, warn() {}, error() {}},
        window: {}, document: {fullscreenElement: fullscreen ? {} : null},
        localStorage: {getItem: () => 'Disposable QA printer'}, showToast() {}, showBanner() {},
        setTimeout(fn, delay) { const id = ++serial; timers.set(id, {at: now + delay, fn}); return id; },
        clearTimeout(id) { timers.delete(id); },
        qz: missing ? undefined : {
            websocket: {isActive: () => active, connect() {
                return new Promise((resolve, reject) => connections.push({resolve() {active = true; resolve();}, reject}));
            }},
            configs: {create: (printer, options) => ({printer, options})},
            print: (config, data) => { jobs.push({config, data}); return Promise.resolve(); }
        }
    });
    const start = source.indexOf('/* === QZ Tray');
    vm.runInContext(source.slice(start, source.indexOf('function buildReceiptHtml', start)), context);
    const render = source.indexOf('function printReceipt(', start);
    vm.runInContext(source.slice(render, source.indexOf('function approvedPaymentFetch', render)), context);
    context.buildReceiptHtml = () => '<html><body>Disposable receipt';
    context.iframePrint = (...args) => browser.push(args);
    context.offerBrowserPrint = (...args) => offers.push(args);
    return {context, connections, jobs, browser, offers,
        async advance(ms) {
            const end = now + ms;
            while (true) {
                const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                now = next[1].at; timers.delete(next[0]); next[1].fn(); await tick();
            }
            now = end; await tick();
        },
        async receipt(tax = 'N', edited = false) { context.window._posPrintReceipt('QA-TX', 'QA-BILL', tax, edited, {success: true}); await tick(); },
        disconnect() { active = false; },
        socketOpen() { active = true; }
    };
}
const cases = [
    ['QZ pixel printing uses the saved 58mm paper width', async () => {
        const h=harness(),printing=h.context.qzPrint('<div data-paper-width="58">QA receipt</div>','QA');
        await tick();h.connections[0].resolve();await printing;
        assert.equal(h.jobs[0].config.options.size.width,58);assert.equal(h.jobs[0].data[0].options.pageWidth,58);
    }],
    ['opening billing never requests QZ permission', async () => { const h=harness(); await h.advance(5000); assert.equal(h.connections.length,0); }],
    ['overlapping first receipts share one printer-selection request', async () => {
        const h = harness(); h.context.qzConnect().catch(() => {}); await tick(); h.connections[0].resolve(); await tick();
        let lookups = 0;
        h.context.qz.printers = {find: () => {lookups++; return new Promise(() => {});}};
        h.context.qzShowSetup(); h.context.qzShowSetup(); await tick();
        assert.equal(lookups, 1, 'one setup must not replace an earlier receipt\'s pending setup');
    }],
    ['an open WebSocket still waits for QZ permission to finish', async () => {
        const h = harness(); h.context.qzConnect().catch(() => {}); await tick(); h.socketOpen(); await h.receipt();
        assert.equal(h.jobs.length, 0, 'an open socket alone does not finish the permission handshake');
        h.connections[0].resolve(); await tick(); assert.equal(h.jobs.length, 1);
    }],
    ['slow QZ permission shares the pending connection and preserves fullscreen', async () => {
        const h = harness({fullscreen: true}); h.context.qzConnect().catch(() => {}); await tick(); await h.receipt('Y');
        assert.equal(h.connections.length, 1, 'one shared connection, including checkout during probe');
        await h.advance(9000);
        assert.equal(h.browser.length, 0, 'permission wait must not start browser preview');
        h.connections[0].resolve(); await tick();
        assert.equal(h.jobs.length, 1); assert.equal(h.offers.length, 0);
        assert.ok(h.context.document.fullscreenElement);
    }],
    ['late connection after timeout recovers on the next receipt without duplicate printing', async () => {
        const h = harness({fullscreen: true}); h.context.qzConnect().catch(() => {}); await tick(); await h.receipt(); await h.advance(31000);
        assert.equal(h.jobs.length, 0); assert.equal(h.browser.length, 0);
        assert.equal(h.offers.length, 1, 'offer explicit fallback rather than force fullscreen exit');
        h.connections[0].resolve(); await tick();
        assert.equal(h.jobs.length, 0, 'timed-out receipt must not also print when permission arrives');
        await h.receipt('Y', true); assert.equal(h.jobs.length, 1); assert.equal(h.connections.length, 1);
    }],
    ['a failed connection does not permanently disable QZ', async () => {
        const h = harness(); h.context.qzConnect().catch(() => {}); await tick(); h.connections[0].reject(Error('service stopped')); await tick();
        await h.receipt(); assert.equal(h.connections.length, 2);
        h.connections[1].resolve(); await tick(); assert.equal(h.jobs.length, 1); assert.equal(h.browser.length, 0);
    }],
    ['a disconnected service reconnects for the next tax-off or revised receipt', async () => {
        const h = harness(); h.context.qzConnect().catch(() => {}); await tick(); h.connections[0].resolve(); await tick();
        await h.receipt('Y'); h.disconnect(); await h.receipt('N', true);
        assert.equal(h.connections.length, 2); h.connections[1].resolve(); await tick(); assert.equal(h.jobs.length, 2);
    }],
    ['missing QZ keeps normal browser printing available', async () => {
        const h = harness({missing: true}); await h.receipt(); assert.equal(h.browser.length, 1); assert.equal(h.jobs.length, 0);
    }],
    ['missing QZ in fullscreen requires an explicit browser-print choice', async () => {
        const h = harness({missing: true, fullscreen: true}); await h.receipt();
        assert.equal(h.browser.length, 0); assert.equal(h.offers.length, 1); assert.equal(h.jobs.length, 0);
    }],
    ['QZ print rejection never silently opens browser preview in fullscreen', async () => {
        const h = harness({fullscreen: true}); h.context.qzConnect().catch(() => {}); await tick(); h.connections[0].resolve(); await tick();
        h.context.qz.print = () => Promise.reject(Error('printer unavailable'));
        await h.receipt(); assert.equal(h.browser.length, 0); assert.equal(h.offers.length, 1);
    }],
    ['cancelling printer selection never prints through another route', async () => {
        const h = harness(); h.context.qzConnect().catch(() => {}); await tick(); h.connections[0].resolve(); await tick();
        h.context.qzPrint = () => Promise.reject('cancelled');
        await h.receipt(); assert.equal(h.browser.length, 0); assert.equal(h.offers.length, 0); assert.equal(h.jobs.length, 0);
    }]
];
(async () => {
    let failed = 0;
    for (const [name, run] of cases) {
        try { await run(); console.log('PASS ' + name); }
        catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
    }
    if (failed) process.exitCode = 1;
})();
