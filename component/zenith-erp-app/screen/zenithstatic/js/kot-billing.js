/* KOT entry uses the POS catalogue, checkout services and kitchen print pipeline. */
(function () {
  'use strict';
  const root=document.getElementById('kb-wrap');
  if (!root || root.dataset.ready) return;
  root.dataset.ready='true';
  const $=id=>root.querySelector('#kb-'+id);
  const search=$('search'), suggestions=$('suggestions'), cart=new Map();
  const shell=location.pathname.startsWith('/qapps/')?'/qapps':'/apps';
  const base=shell+'/zenith/pos/Kitchen/KotBilling';
  const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'});
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token=()=>window.moqui?.webrootVue?.moquiSessionToken||$('token').value;
  const cfg=$('data').dataset;
  let orderType=cfg.drafttype||'Dine In', taxOn=cfg.drafttax||'Y', draftId=cfg.draftid||'';
  let salesModeId=$('mode').value, quoteVersion=0, quoteTimer, total=null, busy=false, savedFingerprint='';
  let searchVersion=0, searchTimer, searchAbort, results=[], selected=0, exactId, ambiguous=false, hasMore=false, offset=0;
  let historyDirty=false, grid=false, pickedMatch=false;
  if(cfg.draftmode && Array.from($('mode').options).some(o=>o.value===cfg.draftmode)) salesModeId=$('mode').value=cfg.draftmode;
  if(cfg.draftwaiter) $('waiter').value=cfg.draftwaiter;
  $('table').value=cfg.drafttable||cfg.selectedTable||'';

  async function request(action,data,signal) {
    const response=await fetch(base+'/'+action,{method:'POST',credentials:'same-origin',signal,
      body:new URLSearchParams({...data,moquiSessionToken:token()})});
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result?.success) throw Error(result?.error||'The request could not be completed. Check your connection and try again.');
    return result;
  }
  function post(action,data) {
    const form=document.createElement('form');
    form.method='POST';form.action=base+'/'+action;
    for(const [name,value] of Object.entries({...data,moquiSessionToken:token()})) {
      const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);
    }
    root.append(form);form.submit();
  }
  const orderData=()=>({orderType,taxOn,salesModeId,tableId:$('table').value,waiterId:$('waiter').value,notes:$('instr').value,
    itemsJson:JSON.stringify(Array.from(cart.values(),it=>({productId:it.id,quantity:it.qty})))});
  function setType(value) {
    orderType=value;
    for(const button of root.querySelectorAll('[data-ot]')) {
      const active=button.dataset.ot===value;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',active);
    }
    $('table-field').hidden=value==='Take Away'||$('table').options.length===1;
    if(value==='Take Away') $('table').value='';
  }
  function paintTax() {
    const on=taxOn==='Y',b=$('tax-toggle');
    b.textContent=on?'Tax: ON':'Tax: OFF';b.classList.toggle('is-on',on);b.setAttribute('aria-checked',on);
  }
  function controls() {
    $('clear').disabled=busy||!cart.size;
    for(const id of ['draft','send','bill']) if($(id)) $(id).disabled=busy||!cart.size||total===null;
  }
  function rows() {
    $('cart').innerHTML=Array.from(cart.values(),(it,i)=>'<tr data-product="'+esc(it.id)+'"><td>'+(i+1)+'</td><td><strong>'+esc(it.name)+'</strong><small>'+esc(it.code)+'</small></td>'
      +'<td><span class="kb-ostep"><button type="button" data-qty="-1" aria-label="Decrease quantity" '+(it.qty<=1?'disabled':'')+'>−</button><span>'+it.qty+'</span><button type="button" data-qty="1" aria-label="Increase quantity">+</button></span></td>'
      +'<td class="r">'+money.format(it.price)+'</td><td class="r kb-oamt">'+money.format(it.amount??it.qty*it.price)+'</td>'
      +'<td class="r"><button type="button" class="kb-orm" data-remove="true" aria-label="Remove '+esc(it.name)+'">×</button></td></tr>').join('');
    $('cartempty').hidden=cart.size>0;
    $('item-count').textContent=cart.size;
  }
  function quote() {
    clearTimeout(quoteTimer); const version=++quoteVersion;
    total=null;controls();rows();
    $('quote-error').textContent='';
    $('tax-rows').replaceChildren();
    $('grand').textContent=cart.size?'Calculating…':money.format(0);
    if(!cart.size){$('subtotal').textContent=money.format(0);return;}
    quoteTimer=setTimeout(async()=>{
      try{
        const {receipt}=await request('cartReceipt',orderData());
        if(version!==quoteVersion||!root.isConnected)return;
        for(const line of receipt.items){
          const it=cart.get(line.productId);
          if(it){it.price=Number(line.rate);it.amount=Number(line.total);it.code=line.code;it.name=line.name;}
        }
        rows();total=Number(receipt.summary.total);controls();
        $('subtotal').textContent=money.format(receipt.summary.subtotal);
        $('grand').textContent=money.format(total);
        $('tax-rows').innerHTML=(receipt.summary.taxBreakdown||[]).map(t=>'<div class="kb-sum__row"><span>'+esc(t.name)+'</span><span>'+money.format(t.amount)+'</span></div>').join('');
      }catch(e){if(version===quoteVersion&&root.isConnected)$('quote-error').textContent=e.message;}
    },100);
  }
  function renderMatches(message) {
    const term=search.value.trim();
    suggestions.hidden=!term;
    search.setAttribute('aria-expanded',String(!!term));
    suggestions.classList.toggle('kb-results-grid',grid&&results.length>0);
    if(!term){suggestions.replaceChildren();return;}
    suggestions.innerHTML=(message?'<p class="kb-search-message" role="status">'+esc(message)+'</p>':'')+
      results.map((p,i)=>'<button type="button" class="kb-suggestion'+(i===selected?' is-active':'')+'" data-result="'+i+'"><span><strong>'+esc(p.name)+'</strong><small>'+esc(p.code)+(p.stock==null?'':' · Stock: '+esc(p.stock))+'</small></span><span>'+esc(p.price==null?(p.reason||'No price for this mode'):money.format(p.price))+'</span></button>').join('')
      +(hasMore?'<button type="button" class="kb-control" id="kb-more">More matches</button>':'');
  }
  async function lookup(append=false) {
    const value=search.value, version=++searchVersion;
    searchAbort?.abort(); searchAbort=new AbortController();
    if(!append){results=[];selected=0;pickedMatch=false;offset=0;hasMore=false;exactId=null;ambiguous=false;}
    if(!value.trim()){renderMatches();return false;}
    if(!append)renderMatches('Searching…');
    try{
      const data=await request('searchMenu',{term:value,salesModeId,offset,stockSessionId:cfg.stockSession||''},searchAbort.signal);
      if(version!==searchVersion||!root.isConnected)return false;
      results=append?results.concat(data.products.filter(p=>!results.some(x=>x.id===p.id))):data.products;
      offset+=40;hasMore=data.hasMore;exactId=data.exactId;ambiguous=data.ambiguous;
      if(!append&&exactId)selected=Math.max(0,results.findIndex(p=>p.id===exactId));
      renderMatches(ambiguous?'Multiple products use this code. Choose a product from the results.':results.length?'':'No products match your search.');
      return true;
    }catch(e){if(version===searchVersion&&e.name!=='AbortError')renderMatches(e.message);return false;}
  }
  function clearSearch() {
    clearTimeout(searchTimer);++searchVersion;searchAbort?.abort();results=[];selected=0;pickedMatch=false;exactId=null;ambiguous=false;hasMore=false;search.value='';renderMatches();
  }
  function choose(index) {
    const item=results[index];if(!item||busy)return;
    if(item.price==null){renderMatches(item.reason||'No price for this sales mode.');return;}
    if(cart.has(item.id)){const row=cart.get(item.id);row.qty++;row.amount=null;}
    else cart.set(item.id,{...item,qty:1});
    clearSearch();quote();search.focus();
  }
  search.addEventListener('input',()=>{
    clearTimeout(searchTimer);++searchVersion;searchAbort?.abort();results=[];selected=0;pickedMatch=false;exactId=null;ambiguous=false;hasMore=false;
    renderMatches('Searching…');if(search.value.trim())searchTimer=setTimeout(()=>lookup(),85);
  });
  search.addEventListener('keydown',async e=>{
    if(e.isComposing||e.repeat)return;
    if(e.key==='Escape'){clearSearch();return;}
    if(e.key===' '&&!search.value&&!$('bill')?.disabled&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.shiftKey){e.preventDefault();openPayment();return;}
    if((e.key==='ArrowUp'||e.key==='ArrowDown')&&results.length){
      e.preventDefault();selected=(selected+(e.key==='ArrowDown'?1:results.length-1))%results.length;pickedMatch=true;renderMatches();
      suggestions.querySelector('.is-active')?.scrollIntoView({block:'nearest'});return;
    }
    if(e.key!=='Enter'||!search.value.trim())return;
    e.preventDefault();clearTimeout(searchTimer);
    if(!results.length&&!(await lookup()))return;
    if(ambiguous&&!pickedMatch){renderMatches('Choose a match with the mouse or arrow keys before adding.');return;}
    if(!pickedMatch&&!exactId&&/^\d{8,}$/.test(search.value.trim())){renderMatches('Barcode not found. Check the code or choose a matching product.');return;}
    if(results.length)choose(selected);
  });
  suggestions.addEventListener('click',e=>{
    if(e.target.closest('#kb-more')){lookup(true);return;}
    const match=e.target.closest('[data-result]');if(match)choose(Number(match.dataset.result));
  });

  function openPayment() {
    if(!$('bill')||$('bill').disabled||$('payment').open)return;
    $('payment-total').textContent='Order total: '+money.format(total);
    if($('payment-method')){$('payment-method').value='Cash';tenderFields();}
    if($('payment-error'))$('payment-error').textContent='';
    $('payment').showModal();
  }
  function tenderFields() {
    const method=$('payment-method').value;
    for(const label of $('payment').querySelectorAll('[data-kb-tender]')){
      const shown=label.dataset.kbTender.split(' ').includes(method);label.hidden=!shown;
      label.querySelector('input').disabled=!shown;
    }
    $('cash').value=method==='Cash'?total.toFixed(2):'';
  }
  async function printBill(kotId,isTakeAway,w,kitchenWindow) {
    let error;
    if(isTakeAway){
      try{
        if(!kitchenWindow)throw Error('Allow a second print window for the kitchen ticket.');
        const {record}=await request('printRecord',{kotId,kind:'kot'});
        await KitchenPrint.browserPrint(kitchenWindow,KitchenPrint.kotHtml(record));
        await request('ackKotPrint',{kotId});
      }catch(e){error=e;}
    }
    const {record}=await request('printRecord',{kotId,kind:'bill'});
    await KitchenPrint.customer(w,record);
    if(error)throw error;
  }
  async function pay(e) {
    e.preventDefault();if(busy||total===null)return;
    let w,kitchenWindow,finalized=false;
    const form=e.currentTarget, submit=form.querySelector('[type=submit]');
    const payment=Object.fromEntries(new FormData(form)), data=orderData(), fingerprint=JSON.stringify(data);
    const isTakeAway=orderType==='Take Away';
    try{
      // A blocked popup never prevents a sale from saving; history remains the print fallback.
      try{w=KitchenPrint.open();}catch(_){}
      if(w&&isTakeAway){try{kitchenWindow=KitchenPrint.open();}catch(_){}}
      busy=true;controls();submit.disabled=true;$('payment-close').disabled=true;$('payment-error').textContent='';
      if(!draftId||fingerprint!==savedFingerprint){
        const saved=await request('saveDraft',{...data,existingDraftId:draftId,wantJson:'Y'});
        draftId=saved.kotId;savedFingerprint=fingerprint;
        if(Number(saved.total)!==total)throw Error('The order total changed. Close checkout and review the total before confirming again.');
      }
      const bill=await request('checkoutKot',{...payment,kotId:draftId});
      finalized=true;historyDirty=true;
      $('payment').close();cart.clear();draftId='';savedFingerprint='';$('badge').textContent='New KOT';$('instr').value='';quote();
      $('order-status').textContent='Saved bill '+bill.billNumber+'.';
      const status=$('order-status');
      if(w)await printBill(bill.kotId,isTakeAway,w,kitchenWindow);
      else status.textContent+=' Allow pop-ups and reprint from History.';
    }catch(error){
      if(finalized)$('order-status').textContent+=' Printing needs attention. Reprint from History. '+error.message;
      else $('payment-error').textContent=error.message;
    }finally{
      if(w&&!w.closed)w.close();if(kitchenWindow&&!kitchenWindow.closed)kitchenWindow.close();
      busy=false;controls();submit.disabled=false;$('payment-close').disabled=false;
    }
  }
  function filterHistory(){
    const term=$('history-search').value.trim().toLowerCase(),status=$('history-status').value,date=$('history-date').value;let visible=0;
    for(const order of $('history-rows').children){
      order.hidden=Boolean((date&&order.dataset.orderDate!==date)||(status&&order.dataset.kotGroup!==status)||(term&&!order.textContent.toLowerCase().includes(term)));
      if(!order.hidden)visible++;
    }
    $('history-empty').hidden=visible!==0;
  }
  async function showHistory(){
    $('history').showModal();
    if(historyDirty){
      try{
        const response=await fetch('/apps/zenith/pos/Kitchen/KotBilling');
        if(!response.ok)throw Error('History could not be refreshed.');
        const page=new DOMParser().parseFromString(await response.text(),'text/html');
        const rows=page.getElementById('kb-history-rows');
        if(!rows)throw Error('History could not be refreshed. Reload the page.');
        $('history-rows').replaceChildren(...rows.children);historyDirty=false;
      }catch(e){$('order-status').textContent=e.message;}
    }
    filterHistory();
  }
  function sendOrHold(send) {
    if(busy||!cart.size||total===null)return;
    busy=true;controls();
    post(send?'createKot':'saveDraft',{...orderData(),loadedDraftId:draftId,existingDraftId:draftId});
  }
  root.addEventListener('click',e=>{
    const button=e.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.ot){setType(button.dataset.ot);quote();}
    else if(button.id==='kb-tax-toggle'){taxOn=taxOn==='Y'?'N':'Y';paintTax();quote();}
    else if(button.id==='kb-view-grid'){grid=!grid;button.setAttribute('aria-pressed',grid);renderMatches();}
    else if(button.id==='kb-clear'&&confirm('Clear the unsent items from this order?')){cart.clear();quote();}
    else if(button.id==='kb-history-open')showHistory();
    else if(button.id==='kb-bill')openPayment();
    else if(button.id==='kb-draft'||button.id==='kb-send')sendOrHold(button.id==='kb-send');
    else if(button.id==='kb-payment-close')$('payment').close();
    else if(button.dataset.kotResume){
      if(!cart.size||confirm('Replace the current unsent items with this held order?'))location.href=base+'/?loadDraft='+encodeURIComponent(button.dataset.kotResume);
    }else if(button.dataset.kotDiscard){
      if(confirm('Discard this held order?'))post('deleteDraft',{kotId:button.dataset.kotDiscard});
    }else if(button.dataset.remove||button.dataset.qty){
      const id=button.closest('tr').dataset.product,it=cart.get(id);
      if(button.dataset.remove)cart.delete(id);
      else{it.qty=Math.max(1,it.qty+Number(button.dataset.qty));it.amount=null;}
      quote();
    }
  });
  $('mode').addEventListener('change',()=>{
    if(cart.size&&!confirm('Update the cart? Existing items will be repriced for the selected sales mode.')){$('mode').value=salesModeId;return;}
    salesModeId=$('mode').value;quote();lookup();
  });
  $('table').addEventListener('change',quote);
  $('waiter').addEventListener('change',quote);
  $('history-search').addEventListener('input',filterHistory);
  $('history-status').addEventListener('change',filterHistory);
  $('history-date').addEventListener('change',filterHistory);
  $('payment-method')?.addEventListener('change',tenderFields);
  $('payment-form')?.addEventListener('submit',pay);
  $('payment')?.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  let shiftAlone=false;
  const editable=e=>e.target?.closest?.('input,textarea,select,button,a,[contenteditable],dialog');
  function shortcut(e) {
    if(!root.isConnected){document.removeEventListener('keydown',shortcut);document.removeEventListener('keyup',shortcut);return;}
    if(e.type==='keyup'){
      if(e.key==='Shift'&&shiftAlone&&!editable(e)&&!root.querySelector('dialog[open]'))$('send')?.click();
      if(e.key==='Shift')shiftAlone=false;
      return;
    }
    if(e.key!=='Shift')shiftAlone=false;
    if(e.repeat||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||editable(e)||root.querySelector('dialog[open]'))return;
    if(e.key==='Shift')shiftAlone=true;
    if(e.key==='F7'&&!$('draft')?.disabled){e.preventDefault();$('draft')?.click();}
    if(e.key===' '&&!e.shiftKey&&!$('bill')?.disabled){e.preventDefault();$('bill')?.click();}
  }
  document.addEventListener('keydown',shortcut);document.addEventListener('keyup',shortcut);
  const snapshot=JSON.parse(cfg.draftreceipt||'[]');
  for(const item of JSON.parse(cfg.draftload||'[]')){
    const saved=snapshot.find(row=>row.productId===item.productId);
    cart.set(item.productId,{id:item.productId,name:item.productName,code:saved?.code||item.productId,price:Number(saved?.rate)||0,qty:Number(item.quantity)});
  }
  if(draftId){$('badge').textContent='Editing Held Order';$('instr').value=cfg.draftinstr||'';}
  setType(orderType);paintTax();quote();
})();
