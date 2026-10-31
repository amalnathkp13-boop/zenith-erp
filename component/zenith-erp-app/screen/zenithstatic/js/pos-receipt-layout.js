/* Shared receipt presentation: preview, checkout and history use the same escaped HTML.
 * QZ uses its existing pixel/HTML driver path, never raw ESC/POS text or security bypasses. */
(function () {
    'use strict';
    function text(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
    function render(data, isTax, edited) {
        var d=data||{},s=d.store||{},b=d.bill||{},m=d.summary||{},o=d.options||{};
        var width=s.receiptWidth==='58mm'?58:80;
        function enabled(key) { return o[key]!==false; }
        function shown(key) { return s[key]!=='N'; }
        function number(value) { return Number(value||0).toFixed(2); }
        function align(key) { return ['left','center','right'].indexOf(o[key])>=0?o[key]:'center'; }
        function tone(section) { return o[section+'Tone']==='darkGrey'?'#333':o[section+'Tone']==='lightGrey'?(section==='amounts'||section==='information'||section==='tax'?'#333':'#707070'):'#000'; }
        function block(value,section,extra) { return value?'<div class="block" style="color:'+tone(section)+';'+(extra||'')+'">'+text(value)+'</div>':''; }
        function row(label,value,section,strong) { return '<tr style="color:'+tone(section)+'"><td>'+text(label)+'</td><td class="r'+(strong?' b':'')+'">'+text(value)+'</td></tr>'; }
        var h='<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title><style>'
            +'@page{size:'+width+'mm auto;margin:0}body{margin:0;padding:0;color:#000;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:'+(o.density==='light'?400:o.density==='dark'?700:600)+'}'
            +'.rcpt{width:'+width+'mm;max-width:100%;margin:auto;padding:3mm;box-sizing:border-box;overflow-wrap:anywhere}'
            +'.block{white-space:pre-line;text-align:center}.c{text-align:center}.r{text-align:right}.b{font-weight:700}.sep{border-bottom:1px dashed #000;margin:4px 0}.sep2{border-bottom:2px solid #000;margin:4px 0}'
            +'table{width:100%;border-collapse:collapse;table-layout:auto}th,td{padding:2px 1px;font-size:'+(width===58?10:11)+'px;vertical-align:top}th{border-bottom:1px solid #000}.tot td{font-size:'+(width===58?14:16)+'px;font-weight:700}.meta td:first-child{width:32%}.notice{border:1px dashed #000;padding:3px;text-align:center;font-weight:700}img{display:block;margin:2px auto;max-width:90%;max-height:60px}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><div class="rcpt" data-paper-width="'+width+'">';
        if(o.openingPreset&&o.openingPreset!=='none'&&o.openingMessage)h+=block(o.openingMessage,'greeting','text-align:'+align('greetingAlign')+';font-weight:'+(o.greetingBold===false?400:700)+';font-size:'+(o.greetingSize==='small'?10:o.greetingSize==='large'?18:14)+'px');
        if(s.showLogo==='Y'&&s.logoUrl&&/^(https:\/\/|\/(?!\/))/.test(s.logoUrl))h+='<img src="'+text(s.logoUrl)+'" alt="Company logo"/>';
        h+=block(s.name||'Store','company','font-size:16px;font-weight:'+(o.companyBold===false?400:700));
        h+=block(s.address,'company','font-size:11px')+block(s.phone?'Ph: '+s.phone:'','company','font-size:11px')+block(s.email,'company','font-size:11px');
        if(s.taxReg)h+=block('GSTIN: '+s.taxReg,'company','font-size:11px');
        h+=block(s.headerText,'header','text-align:'+align('headerAlign')+';font-weight:'+(o.headerBold?700:400));
        h+='<div class="sep"></div><div class="c b">'+(isTax?'POS TAX RECEIPT':'RECEIPT')+'</div>';
        if(edited||d.edited)h+='<div class="notice">EDITED / REVISED BILL</div>';
        var metadata='';
        if(enabled('showBillNumber')&&b.number)metadata+=row(o.billNumberLabel||'Bill No:',b.number,'information',true);
        if(enabled('showDate')&&b.date)metadata+=row('Date:',b.date,'information');
        if(shown('showCustomerInfo')&&enabled('showCustomerRow')){
            if(enabled('showCustomerName')&&b.customer)metadata+=row(o.customerLabel||'Customer:',b.customer,'information');
            if(enabled('showCustomerPhone')&&b.customerPhone)metadata+=row('Mobile:',b.customerPhone,'information');
        }
        if(enabled('showCashier')&&b.cashier)metadata+=row(o.cashierLabel||'Cashier:',b.cashier,'information');
        if(metadata)h+='<table class="meta">'+metadata+'</table>';
        h+='<div class="sep2"></div><table><thead><tr><th>#</th><th style="text-align:left">Item</th><th>Qty</th><th class="r">Rate</th><th class="r">Total</th></tr></thead><tbody>';
        (d.items||[]).forEach(function(it,i){
            h+='<tr><td style="color:'+tone('products')+'">'+(i+1)+'</td><td style="color:'+tone('products')+'">'+text(it.name)+(it.mode&&it.mode!=='Retail'?'<small> ['+text(it.mode)+']</small>':'')+'</td>'
                +'<td class="c" style="color:'+tone('products')+'">'+text(it.qty)+(it.uom?' '+text(it.uom):'')+'</td><td class="r" style="color:'+tone('amounts')+'">'+number(it.rate)+'</td><td class="r" style="color:'+tone('amounts')+'">'+number(it.total)+'</td></tr>';
            if(shown('showDiscount')&&Number(it.discount)>0)h+='<tr><td colspan="5" style="color:'+tone('tax')+'">Discount included: '+number(it.discount)+'</td></tr>';
            if(s.showItemTax==='Y'&&isTax&&Number(it.tax)>0)h+='<tr><td colspan="5" style="color:'+tone('tax')+'">Tax: '+number(it.tax)+'</td></tr>';
        });
        h+='</tbody></table><div class="sep"></div><table>'+row('Subtotal',number(m.subtotal),'amounts');
        if(shown('showDiscount')&&Number(m.discount)>0)h+=row('Discount included',number(m.discount),'tax');
        if(shown('showTaxBreakdown')&&isTax&&Number(m.tax)>0){
            if(m.taxBreakdown&&m.taxBreakdown.length)m.taxBreakdown.forEach(function(tax){h+=row(tax.name,number(tax.amount),'tax');});
            else h+=row('Tax',number(m.tax),'tax');
        }
        if(Number(m.roundOff))h+=row('Round Off',number(m.roundOff),'amounts');
        h+='</table><div class="sep2"></div><table class="tot">'+row(isTax?'GRAND TOTAL':'TOTAL',number(m.total),'amounts',true)+'</table>';
        if(s.showPaymentDetails==='Y'){
            var payments=(d.payments||[]).filter(function(p){return Number(p.amount)>0;});
            if(payments.length){h+='<div class="sep"></div><table>';payments.forEach(function(p){h+=row(p.method,number(p.amount),'payments');});h+='</table>';}
            if(Number(d.change)>0)h+='<table>'+row('Change',number(d.change),'payments')+'</table>';
        } else if(Number(d.change)>0&&s.showPaymentDetails!=='N')h+='<table>'+row('Change',number(d.change),'payments')+'</table>';
        if(d.isCredit)h+='<div class="sep"></div><div class="notice">'+(Number(d.outstanding)>0?'CREDIT / PAY LATER':'CREDIT / PAID IN FULL')+'</div><table>'+row('Amount Due',number(d.outstanding),'amounts',true)+'</table>';
        if(shown('showDiscount')&&Number(d.saving)>0)h+='<div class="sep"></div>'+block('You Saved: '+number(d.saving),'tax','font-weight:700');
        h+='<div class="sep"></div>'+block(s.footerText||'Thank You !!','footer','text-align:'+align('footerAlign')+';font-weight:'+(o.footerBold===false?400:700));
        h+=block(s.termsText,'footer','text-align:'+align('footerAlign')+';font-size:10px');
        h+='<div class="block" style="font-size:8px;color:'+tone('footer')+'">Powered by ZetaERP</div></div>';
        return h;
    }
    window.PosReceiptLayout={render:render};
})();
