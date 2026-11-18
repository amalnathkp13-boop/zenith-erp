const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../../component/zenith-erp-app/screen/zenithstatic/js/pos-terminal.js'), 'utf8');
const unicodeNames = ['குண்டு உளுந்து', 'తెలుగు బియ్యం', 'മലയാളം അരി', 'أرز بسمتي', 'भुना चना & rice'];
const data = {
    success:true, store:{name:'Disposable receipt store',headerText:'Header <literal>',footerText:'Footer & text',termsText:'Terms <literal>'}, bill:{number:'QA-RECEIPT',date:'01/01/2040',customer:'QA customer'},
    items:[{name:'QA pieces',qty:1,uom:'Nos',rate:10,total:10},{name:'QA weight',qty:1.25,uom:'kg',rate:8,total:10}],
    summary:{subtotal:20,discount:0,tax:2,roundOff:0,total:22,totalQty:2.25,itemCount:2},
    payments:[{method:'UPI',amount:22}], change:0, saving:0
};
for (const [name, end] of [['buildReceiptHtml','function iframePrint'],['buildHistReceipt','function histIframePrint']]) {
    const start = source.indexOf('function '+name+'(');
    const context = vm.createContext({window:{},data});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../../../component/zenith-erp-app/screen/zenithstatic/js/pos-receipt-layout.js'),'utf8'),context);
    const helper = source.indexOf('window._posReceiptTextData=');
    vm.runInContext(source.slice(helper,source.indexOf('\n};',helper)+3),context);
    vm.runInContext(source.slice(start,source.indexOf(end,start)),context);
    for (const width of ['58mm','80mm']) {
        const sample = {success:true,store:{receiptWidth:width},items:unicodeNames.map(name=>({name,qty:1,rate:10,total:10}))};
        context.sample = sample;
        const html = vm.runInContext(`${name}(sample,false,false)`,context);
        for (const script of ['Tamil','Telugu','Malayalam']) assert.ok(html.includes('Noto Sans '+script),name+' declares '+script+' font fallback');
        assert.match(html,/\.item-name\{[^}]*white-space:pre-wrap[^}]*word-spacing:/,name+' preserves readable gaps in product names');
        for (const productName of unicodeNames) assert.ok(html.includes(productName.replace('&','&amp;')),name+' preserves the saved spelling and spaces');
    }
    for (const tax of [true,false]) for (const design of ['normal','credit','revised','revised-credit']) {
        data.edited=design.includes('revised');data.isCredit=design.includes('credit');data.outstanding=data.isCredit?22:0;
        const html = vm.runInContext(`${name}(data,${tax},false)`,context);
        assert.ok(!/Total Qty:|Total Items:|Items: 2|Taxable \(after discount\)/.test(html),name+' omits receipt clutter');
        assert.ok(html.includes('Subtotal') && html.includes('1 Nos') && html.includes('1.25 kg'),name+' keeps subtotal and saved units');
        assert.ok(!html.includes('<td>UPI</td>'),name+' omits payment method rows');
        assert.ok([...html.matchAll(/(?:^|[;{\s"])color:\s*(#[0-9a-f]{3,6})/gi)].every(m=>m[1]==='#000'),name+' prints all receipt text in black');
        assert.ok(html.includes('Header &lt;literal&gt;')&&html.includes('Footer &amp; text')&&html.includes('Terms &lt;literal&gt;'),name+' escapes saved design text');
        if(data.edited)assert.ok(html.includes('EDITED'),name+' retains revised marker');
        if(data.isCredit)assert.ok(html.includes('Amount Due'),name+' retains credit amount due');
        assert.ok(html.includes('22.00'),name+' keeps the payable total');
        if (tax) assert.ok(/CGST|SGST|<td>Tax<\/td>/.test(html),name+' keeps GST information');
    }
}
const kitchen = vm.createContext({window:{},document:{addEventListener(){}}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../../component/zenith-erp-app/screen/zenithstatic/js/kitchen-print.js'),'utf8'),kitchen);
for (const receiptWidth of ['58mm','80mm']) {
    const store = {receiptWidth};
    const html = kitchen.window.KitchenPrint.kotHtml({store,items:unicodeNames.map(name=>({name,qty:1}))});
    const sales = kitchen.window.KitchenPrint.salesHtml({store,qty:1,subtotal:10,total:10,products:unicodeNames.map(name=>({name,qty:1,net:1}))});
    for (const output of [html,sales]) {
        assert.match(output,/\.item-name\{[^}]*white-space:pre-wrap[^}]*word-spacing:/);
        for (const productName of unicodeNames) assert.ok(output.includes(productName.replace('&','&amp;')));
    }
}
console.log('PASS thermal receipt: saved units, compact totals, black text, multilingual names, tax on/off and revised reprint');
