const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../../component/zenith-erp-app/screen/zenithstatic/js/pos-receipt-layout.js'),'utf8'),context);
const base={store:{name:'QA company',headerText:'<QA header>',footerText:'QA footer',termsText:'Terms & conditions'},
 bill:{number:'REAL-SAVED-42',date:'31/10/2026',customer:'Saved customer',cashier:'Saved cashier'},
 items:[{name:'Tea cup',qty:2,uom:'Nos',rate:10,total:20,tax:1}],summary:{subtotal:20,tax:1,total:21},payments:[{method:'Cash',amount:21}]};
const render=(options={},store={})=>context.window.PosReceiptLayout.render({...base,options,store:{...base.store,...store}},true,false);
const original=JSON.stringify(base);
for(const width of ['58mm','80mm']){
 const html=render({}, {receiptWidth:width});assert.ok(html.includes('@page{size:'+width+' auto'));assert.ok(html.includes('2 Nos'));assert.ok(html.includes('&lt;QA header&gt;'));
}
for(const [key,text] of [['showBillNumber','REAL-SAVED-42'],['showDate','31/10/2026'],['showCustomerRow','Saved customer'],['showCashier','Saved cashier']])assert.ok(!render({[key]:false}).includes(text),key);
for(const preset of ['Ayya Thunai','Praise the Lord','Mashallah','Bismillah','custom']){
 const html=render({openingPreset:preset,openingMessage:'வணக்கம் '+preset,greetingAlign:'right',greetingBold:false,greetingSize:'large'});
 assert.ok(html.indexOf('வணக்கம்')<html.indexOf('QA company'));assert.ok(html.includes('text-align:right;font-weight:400;font-size:18px'));
}
assert.ok(!render({openingPreset:'none',openingMessage:'Hidden greeting'}).includes('Hidden greeting'));
for(const section of ['greeting','company','header','information','products','amounts','tax','payments','footer']){
 const html=render({[section+'Tone']:'lightGrey',openingPreset:'custom',openingMessage:'QA',showPaymentDetails:true},{showPaymentDetails:'Y'});
 assert.ok(html.includes(['information','amounts','tax'].includes(section)?'#333':'#707070'),section+' tone');
}
assert.ok(render({billNumberLabel:'Receipt No:',customerLabel:'Buyer:',cashierLabel:'Served by:'}).includes('Receipt No:'));
assert.ok(!render({}, {showCustomerInfo:'N'}).includes('Saved customer'));
assert.ok(!render({}, {showTaxBreakdown:'N'}).includes('>Tax<'));
assert.ok(render({}, {showItemTax:'Y'}).includes('Tax: 1.00'));
assert.ok(render({}, {showPaymentDetails:'Y'}).includes('>Cash<'));
assert.ok(!render({}, {showLogo:'Y',logoUrl:'javascript:alert(1)'}).includes('<img'));
assert.equal(JSON.stringify(base),original,'presentation never mutates bill or prices');
const pdf=fs.readFileSync(path.join(__dirname,'../../../component/zenith-erp-pos/screen/zenith/pos/Pos/ReceiptPdf.xml'),'utf8');
assert.ok(pdf.includes('<#if ((txn.totalTaxAmount!0)) gt 0>TAX INVOICE'), 'hiding a tax breakdown must not rename a tax invoice');
const runtimeChecks=fs.readFileSync(path.join(__dirname,'verify-runtime.cjs'),'utf8');
assert.ok(!runtimeChecks.includes('\u00e2\u201a\u00b9'), 'currency assertions must retain their original UTF-8 rupee symbol');
console.log('PASS receipt options: widths, greetings, Unicode preview, labels, visibility, tones, flags, escaping and immutable bill data');
