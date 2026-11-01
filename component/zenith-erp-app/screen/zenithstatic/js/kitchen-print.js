/* Kitchen and customer receipts share presentation, never transaction side effects.
 * KOT uses its existing browser printer selection; customer bills use the configured
 * browser print workflow. Kitchen and bill printers are selected independently. */
(function () {
  'use strict';
  if(window.KitchenPrint)return;
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function kotHtml(record){
    return '<!doctype html><html><head><meta charset="utf-8"><title>KOT</title><style>@page{size:80mm auto;margin:0}body{font:13px monospace;color:#000;width:74mm;padding:3mm;margin:0}h3{text-align:center}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px dashed #000;padding:4px 0}.q{text-align:right}small{display:block;white-space:pre-wrap}p{white-space:pre-wrap}</style></head><body><h3>KOT #'+esc(record.number)+'</h3><p>Table: '+esc(record.table)+'\n'+esc(record.date)+(record.waiter?'\nWaiter: '+esc(record.waiter):'')+'</p><table><thead><tr><th>Item</th><th class="q">Qty</th></tr></thead><tbody>'+
      (record.items||[]).map(it=>'<tr><td>'+esc(it.name)+(it.instructions?'<small>'+esc(it.instructions)+'</small>':'')+'</td><td class="q">'+esc(it.qty)+'</td></tr>').join('')+'</tbody></table>'+(record.notes?'<p>Notes: '+esc(record.notes)+'</p>':'')+'</body></html>';
  }
  function open(){const w=window.open('','_blank','width=430,height=650');if(!w)throw Error('Allow pop-ups for this site, then retry printing.');return w;}
  async function browserPrint(w,html){
    if(!w||w.closed)throw Error('The print window was closed. Retry when ready.');
    w.document.open();w.document.write(html);w.document.close();
    if(w.document.fonts)await w.document.fonts.ready;
    await Promise.all(Array.from(w.document.images||[]).map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=img.onerror=resolve;setTimeout(resolve,5000);})));
    if(w.closed)throw Error('The print window was closed.');
    w.focus();w.print(); // Request accepted by the browser; physical output/cancellation is not observable.
  }
  async function customer(w,data){
    if(!data||!data.success||!window.PosReceiptLayout)throw Error('The saved customer receipt could not be loaded.');
    const html=PosReceiptLayout.render(data,Number(data.summary?.tax)>0,!!data.edited)+'</body></html>';
    await browserPrint(w,html);
  }
  window.KitchenPrint={open:open,kotHtml:kotHtml,browserPrint:browserPrint,customer:customer};
  var busy=false;
  function screen(){return location.pathname.replace(/\/$/,'').replace(/\.(qvt|html)$/,'');}
  function token(){return window.moqui?.webrootVue?.moquiSessionToken||document.querySelector('#kb-token,[name="moquiSessionToken"]')?.value||'';}
  async function request(action,params){
    const response=await fetch(screen()+'/'+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,moquiSessionToken:token()})});
    let data;try{data=await response.json();}catch(_){throw Error('The session may have expired. Sign in and retry.');}
    if(!response.ok||!data.success)throw Error(data.error||'The request could not be completed. Check your access and retry.');return data;
  }
  function selection(){
    const selected=Array.from(document.querySelectorAll('[data-kitchen-select]:checked'));
    document.querySelectorAll('[data-kitchen-selected-count]').forEach(e=>e.textContent=selected.length+' selected');
    document.querySelectorAll('[data-kitchen-bulk]').forEach(e=>e.disabled=busy||!selected.length);
    return selected.map(e=>e.dataset.kitchenSelect);
  }
  function status(message){let el=document.getElementById('zk-print-status');if(!el){el=document.createElement('p');el.id='zk-print-status';el.setAttribute('role','status');(document.querySelector('#kb-wrap')||document.querySelector('#kitchen-page-frame')).prepend(el);}el.textContent=message;}
  async function run(kind,ids,button){
    if(busy||!ids.length)return;
    const origin=screen();let w,accepted=0,errors=[];
    try{
      busy=true;if(button)button.disabled=true;selection();
      if(kind!=='view')w=open();
      for(const id of ids){
        if(screen()!==origin)break;
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
      if(screen()===origin)status((accepted?accepted+' print request(s) opened. ':'')+errors.join(' '));
    }catch(e){if(screen()===origin)status(e.message);}
    finally{busy=false;if(w&&!w.closed)w.close();if(button&&button.isConnected)button.disabled=false;selection();}
  }
  document.addEventListener('click',function(e){
    const button=e.target.closest('[data-kitchen-print],[data-kitchen-bulk]');if(!button||button.disabled)return;
    e.preventDefault();run(button.dataset.kitchenPrint||button.dataset.kitchenBulk,button.dataset.kotId?[button.dataset.kotId]:selection(),button);
  });
  document.addEventListener('change',function(e){
    if(e.target.matches('[data-kitchen-select-all]'))document.querySelectorAll('[data-kitchen-select]').forEach(x=>x.checked=e.target.checked);
    if(e.target.matches('[data-kitchen-select],[data-kitchen-select-all]'))selection();
  });
})();
