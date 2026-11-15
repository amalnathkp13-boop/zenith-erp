/* Kitchen and customer receipt templates and browser printing. */
(function () {
  'use strict';
  if(window.KitchenPrint)return;
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function kotHtml(record){
    const store=record.store||{}, options=record.options||{};
    const width=store.receiptWidth==='58mm'?58:80;
    // These printers offset printing right; use a small LEFT pad so item names fill the left
    // gap (the hardware offset is the real left margin) and a larger RIGHT pad so qty never clips.
    const kpadL=2;
    const kpadR=width===58?8:9;
    const tone=section=>({darkGrey:'#333',lightGrey:'#707070'}[options[section+'Tone']]||'#000');
    const align=section=>['left','center','right'].includes(options[section+'Align'])?options[section+'Align']:'center';
    const block=(value,section,style='')=>value?'<div class="block" style="color:'+tone(section)+';text-align:'+align(section)+';'+style+'">'+esc(value)+'</div>':'';
    const numberLabel=options.billNumberLabel&&options.billNumberLabel!=='Bill No:'?options.billNumberLabel:'KOT No:';
    const weight=options.density==='dark'?700:(options.density==='standard'?600:400);
    let header='';
    if(options.openingPreset&&options.openingPreset!=='none')
      header+=block(options.openingMessage,'greeting','font-weight:'+(options.greetingBold===false?400:700)+';font-size:'+({small:10,large:18}[options.greetingSize]||14)+'px');
    if(store.showLogo==='Y'&&store.logoUrl&&/^(https:\/\/|\/(?!\/))/.test(store.logoUrl))
      header+='<img src="'+esc(store.logoUrl)+'" alt="Company logo"/>';
    header+=block(store.name,'company','font-weight:'+(options.companyBold===false?400:700));
    header+=block(store.headerText,'header','font-weight:'+(options.headerBold?700:400));
    if(record.store&&options.showBillNumber!==false&&record.number)header+=block(numberLabel+' '+record.number,'information');
    if(record.store&&options.showDate!==false)header+=block(record.date,'information');
    return '<!doctype html><html data-paper-width="'+width+'"><head><meta charset="utf-8"><title>KOT</title><style>@page{size:'+width+'mm auto;margin:0}'+
      'body{font:13px monospace;color:#000;width:'+width+'mm;padding:3mm '+kpadR+'mm 3mm '+kpadL+'mm;margin:0;box-sizing:border-box;font-weight:'+weight+'}'+
      '.block{white-space:pre-line;overflow-wrap:anywhere}img{display:block;margin:2px auto;max-width:90%;max-height:60px}'+
      'table{width:100%;border-collapse:collapse;color:'+tone('products')+'}td{border-bottom:1px dashed #000;padding:4px 0;overflow-wrap:anywhere}.q{text-align:right}'+
      '</style></head><body>'+header+'<table><tbody>'+
      (record.items||[]).map(it=>'<tr><td>'+esc(it.name)+'</td><td class="q">'+esc(it.qty)+'</td></tr>').join('')+
      '</tbody></table>'+block(store.footerText,'footer','font-weight:'+(options.footerBold===false?400:700))+'</body></html>';
  }
  function salesHtml(report){
    const store=report.store||{}, options=report.options||{};
    const width=store.receiptWidth==='58mm'?58:80;
    // Same thermal margins as the receipt (#249): flush left + larger right pad so the Sales
    // column stays inside the ~72mm printable window on the right-offset printer. See #182/#189.
    const padR=width===58?8:9;
    const money=new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
    const qty=new Intl.NumberFormat('en-IN',{maximumFractionDigits:6});
    const tone=key=>({darkGrey:'#333',lightGrey:'#707070'}[options[key+'Tone']]||'#000');
    const block=(value,key)=>value?'<div class="block" style="color:'+tone(key)+';text-align:'+
      (['left','right','center'].includes(options[key+'Align'])?options[key+'Align']:'center')+
      ';font-weight:'+(options[key+'Bold']===false?400:700)+'">'+esc(value)+'</div>':'';
    const row=(label,quantity,value)=>'<tr><td>'+esc(label)+'</td><td class="num">'+(quantity==null?'':qty.format(quantity))+
      '</td><td class="num">'+money.format(value)+'</td></tr>';
    const logo=store.showLogo==='Y'&&/^(https:\/\/|\/(?!\/))/.test(store.logoUrl||'')
      ? '<img src="'+esc(store.logoUrl)+'" alt="Company logo">' : '';
    let adjustments=row('Products subtotal',report.qty,report.subtotal)+row('Additional fees',null,report.additionalFee||0)+
      row('Discounts (included)',null,report.discount||0)+row('Tax',null,report.tax||0)+row('Round off',null,report.roundOff||0);
    if(Number(report.adjustment))adjustments+=row('Other bill adjustments',null,report.adjustment);
    return '<!doctype html><html data-paper-width="'+width+'"><head><meta charset="utf-8"><title>Daily sales summary</title>'+
      '<style>@page{size:'+width+'mm auto;margin:0}*{box-sizing:border-box}body{margin:0;padding:1mm '+padR+'mm 5mm 0;width:'+width+
      'mm;color:#000;background:#fff;font:'+({dark:700,standard:600,light:400}[options.density]||600)+' 11px Arial,sans-serif}'+
      '.block{white-space:pre-line;overflow-wrap:anywhere;text-align:center}h1{font-size:13px;text-align:center;margin:5px 0}'+
      'img{display:block;margin:auto;max-width:90%;max-height:45px}table{width:100%;border-collapse:collapse}th,td{padding:3px 1px;vertical-align:top}'+
      'td:first-child,th:first-child{text-align:left;overflow-wrap:anywhere}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}'+
      'thead,.total{border-block:1px solid #000}.adjustments{border-top:1px dashed #000}tr{break-inside:avoid}'+
      '</style></head><body>'+block(options.openingPreset!=='none'?options.openingMessage:'','greeting')+logo+block(store.name,'company')+block(store.headerText,'header')+'<h1>DAILY SALES SUMMARY</h1>'+
      block(report.date+' · '+report.terminal,'information')+'<div class="block">'+ (report.operatorOnly?'Cashier sales at this counter · ':'')+
      'Completed bills: '+esc(report.billCount)+(report.returnCount?' · Returns: '+esc(report.returnCount):'')+'</div>'+
      '<table><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Sales (₹)</th></tr></thead>'+
      '<tbody style="color:'+tone('products')+'">'+(report.products||[]).map(item=>row(item.name,item.qty,item.net)).join('')+'</tbody>'+
      '<tbody class="adjustments" style="color:'+tone('amounts')+'">'+adjustments+'</tbody><tfoot class="total">'+
      row('GRAND TOTAL',null,report.total)+'</tfoot></table>'+block(store.footerText,'footer')+'</body></html>';
  }
  function open(){const w=window.open('','_blank','width=430,height=650');if(!w)throw Error('Allow pop-ups for this site, then retry printing.');return w;}
  function printBeforeNextDocument(w,label){
    // Keep the first document intact for browsers that return before the print dialog closes.
    const button=w.document.createElement('button');
    const style=w.document.createElement('style');
    button.id='kitchen-print-continue';button.type='button';button.textContent=label;
    style.textContent='@media print{#kitchen-print-continue{display:none!important}}';
    w.document.head.appendChild(style);
    w.document.body.prepend(button);
    return new Promise((resolve,reject)=>{
      const finish=(error)=>{
        clearInterval(checkClosed);
        if(!w.closed){w.removeEventListener('afterprint',advance);button.remove();}
        if(error)reject(error);else resolve();
      };
      const advance=()=>finish();
      const checkClosed=setInterval(()=>{
        if(w.closed)finish(Error('The print window was closed before the customer bill opened.'));
      },250);
      w.addEventListener('afterprint',advance,{once:true});
      button.addEventListener('click',advance,{once:true});
      try{w.print();}catch(error){finish(error);}
    });
  }
  async function browserPrint(w,html,{nextLabel,closeAfterPrint=false}={}){
    if(!w||w.closed)throw Error('The print window was closed. Retry when ready.');
    w.document.open();w.document.write(html);w.document.close();
    if(w.document.fonts)await w.document.fonts.ready;
    await Promise.all(Array.from(w.document.images||[]).map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=img.onerror=resolve;setTimeout(resolve,5000);})));
    if(w.closed)throw Error('The print window was closed.');
    w.focus();
    if(nextLabel)return printBeforeNextDocument(w,nextLabel);
    if(closeAfterPrint){
      w.addEventListener('afterprint',()=>setTimeout(()=>{if(!w.closed)w.close();},0),{once:true});
    }
    w.print(); // Request accepted by the browser; physical output/cancellation is not observable.
  }
  function customerHtml(data){
    if(!data||!data.success||!window.PosReceiptLayout)throw Error('The saved customer receipt could not be loaded.');
    return PosReceiptLayout.render(data,Number(data.summary?.tax)>0,!!data.edited)+'</body></html>';
  }
  async function customer(w,data,options){await browserPrint(w,customerHtml(data),options);}
  window.KitchenPrint={open,kotHtml,browserPrint,customer,customerHtml,salesHtml};
  var busy=false;
  function screen(){return location.pathname.replace(/\/$/,'').replace(/\.(qvt|html)$/,'');}
  function token(){return window.moqui?.webrootVue?.moquiSessionToken||document.querySelector('#kb-token,[name="moquiSessionToken"]')?.value||'';}
  async function request(action,params){
    const response=await fetch(screen()+'/'+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,moquiSessionToken:token()})});
    let data;try{data=await response.json();}catch(_){throw Error('The session may have expired. Sign in and retry.');}
    if(!response.ok||!data.success)throw Error(data.error||'The request could not be completed. Check your access and retry.');return data;
  }
  function selection(kind){
    const selected=Array.from(document.querySelectorAll('[data-kitchen-select]:checked')).filter(e=>e.getClientRects().length);
    const eligible=selected.filter(e=>e.dataset.kitchenBillEligible==='true');
    document.querySelectorAll('[data-kitchen-selected-count]').forEach(e=>e.textContent=selected.length+' selected');
    document.querySelectorAll('[data-kitchen-bulk]').forEach(e=>e.disabled=busy||!(e.dataset.kitchenBulk==='bill'?eligible.length:selected.length));
    return (kind==='bill'?eligible:selected).map(e=>e.dataset.kitchenSelect);
  }
  function status(message){
    const host=document.querySelector('#kb-history[open]')||document.querySelector('#kb-wrap')||document.querySelector('#kitchen-page-frame');
    if(!host)return;
    let el=document.getElementById('zk-print-status');
    if(!el){el=document.createElement('p');el.id='zk-print-status';el.setAttribute('role','status');}
    if(el.parentElement!==host)host.prepend(el);
    el.textContent=message;
  }
  async function run(kind,ids,button,skipped=0){
    if(busy||!ids.length)return;
    const origin=screen();let w,accepted=0,errors=[];
    try{
      busy=true;if(button)button.disabled=true;selection();
      if(kind!=='view')w=open();
      for(const [index,id] of ids.entries()){
        if(screen()!==origin)break;
        if(ids.length>1)status('Preparing '+(index+1)+' of '+ids.length+' '+(kind==='bill'?'bills':'KOTs')+'…');
        try{
          const data=await request('printRecord',{kind:kind,kotId:id});
          if(screen()!==origin)break;
          if(kind==='view'){
            document.querySelector('.zk-history-view')?.remove();
            const dialog=document.createElement('dialog');dialog.className='zk-history-view';
            dialog.innerHTML='<h2>KOT #'+esc(data.record.number)+'</h2><p>'+esc(data.record.date)+' · Table '+esc(data.record.table)+'</p><ul>'+(data.record.items||[]).map(it=>'<li>'+esc(it.name)+' × '+esc(it.qty)+(it.instructions?' — '+esc(it.instructions):'')+'</li>').join('')+'</ul><p>'+esc(data.record.notes)+'</p><button type="button">Close</button>';
            dialog.querySelector('button').onclick=()=>dialog.close();document.body.appendChild(dialog);dialog.showModal();
          }else if(kind==='kot'){
            await browserPrint(w,kotHtml(data.record));accepted++;
            const ack=await request('ackKotPrint',{kotId:id});
            document.querySelectorAll('[data-kitchen-print-count]').forEach(el=>{if(el.dataset.kitchenPrintCount===id)el.textContent=String(ack.printCount);});
          }else{await customer(w,data.record);accepted++;}
        }catch(e){errors.push('KOT '+id+': '+e.message);}
      }
      if(screen()===origin)status((accepted?accepted+' print request(s) opened. ':'')+(skipped?skipped+' selected KOT(s) have no finalized customer bill. ':'')+errors.join(' '));
    }catch(e){if(screen()===origin)status(e.message);}
    finally{busy=false;if(w&&!w.closed)w.close();if(button&&button.isConnected)button.disabled=false;selection();}
  }
  document.addEventListener('click',function(e){
    const button=e.target.closest('[data-kitchen-print],[data-kitchen-bulk]');if(!button||button.disabled)return;
    e.preventDefault();const kind=button.dataset.kitchenPrint||button.dataset.kitchenBulk;
    const selected=button.dataset.kotId?[button.dataset.kotId]:selection();
    const ids=button.dataset.kotId?selected:selection(kind);
    run(kind,ids,button,selected.length-ids.length);
  });
  document.addEventListener('change',function(e){
    if(e.target.matches('[data-kitchen-select-all]'))document.querySelectorAll('[data-kitchen-select]').forEach(x=>{if(x.getClientRects().length)x.checked=e.target.checked;});
    if(e.target.matches('[data-kitchen-select],[data-kitchen-select-all]'))selection();
  });
})();
