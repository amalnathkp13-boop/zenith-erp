/* KOT entry uses the POS catalogue, checkout services and kitchen print pipeline. */
(function () {
  'use strict';
  const root=document.getElementById('kb-wrap');
  if (!root || root.dataset.ready) return;
  root.dataset.ready='true';
  const $=id=>root.querySelector('#kb-'+id);
  const search=$('search'), suggestions=$('suggestions'), cart=new Map();
  const cfg=$('data').dataset;
  const shell=location.pathname.startsWith('/qapps/')?'/qapps':'/apps';
  const billingPath='/zenith'+(cfg.kotModule==='kot'?'/kot':'/pos/Kitchen')+'/KotBilling';
  const base=shell+billingPath;
  const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'});
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token=()=>window.moqui?.webrootVue?.moquiSessionToken||$('token').value;
  let orderType=cfg.drafttype||'Dine In', taxOn=cfg.drafttax||'Y', draftId=cfg.draftid||'';
  let salesModeId=$('mode').value, quoteVersion=0, quoteTimer, total=null, busy=false, savedFingerprint='';
  let searchVersion=0, searchTimer, searchAbort, results=[], selected=0, exactId, ambiguous=false, hasMore=false, offset=0;
  let historyDirty=false, grid=false, pickedMatch=false;
  let customer=JSON.parse(cfg.draftCustomer||'{}'), lastAmount=Number(cfg.lastAmount)||0;
  const modeOptions=Array.from($('mode').options,o=>[o.value,o.text]);
  if(cfg.draftmode && Array.from($('mode').options).some(o=>o.value===cfg.draftmode)) salesModeId=$('mode').value=cfg.draftmode;
  if(cfg.draftwaiter) $('waiter').value=cfg.draftwaiter;
  $('table').value=cfg.drafttable||cfg.selectedTable||'';

  async function request(action,data,signal) {
    const response=await fetch(base+'/'+action,{method:'POST',credentials:'same-origin',signal,
      body:new URLSearchParams({...data,sessionId:cfg.session,moquiSessionToken:token()})});
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result?.success) throw Error(result?.error||'The request could not be completed. Check your connection and try again.');
    return result;
  }
  function post(action,data) {
    const form=document.createElement('form');
    form.method='POST';form.action=base+'/'+action;
    for(const [name,value] of Object.entries({...data,sessionId:cfg.session,moquiSessionToken:token()})) {
      const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);
    }
    root.append(form);form.submit();
  }
  const orderData=()=>({orderType,taxOn,salesModeId,tableId:$('table').value,waiterId:$('waiter').value,notes:$('instr').value,customerPartyId:customer.id||'',
    itemsJson:JSON.stringify(Array.from(cart.values(),it=>({productId:it.id,quantity:it.qty,salesModeId:it.mode||salesModeId,
      ...(it.manual==null?{}:{manualPrice:'Y',unitPrice:it.manual})})))});
  function paintDetails() {
    for(const el of root.querySelectorAll('[data-kb-customer-name]')) el.textContent=customer.name||'Walk-in Customer';
    $('customer-phone').textContent=customer.phone||'—';
    $('last-bill').textContent=customer.lastBill||'—';
    $('customer-last').textContent=customer.lastAmount==null?'—':money.format(customer.lastAmount);
    $('last-amount').textContent=lastAmount?money.format(lastAmount):'0';
    $('detail-type').textContent=orderType;
    $('detail-waiter').textContent=$('waiter').value?$('waiter').selectedOptions[0].text:'—';
    $('detail-mode').textContent=$('mode').selectedOptions[0]?.text||'Standard';
  }
  function paintTotals(summary) {
    for(const key of ['subtotal','tax','grand']) {
      const value=summary?.[key==='grand'?'total':key];
      $('list-'+key).textContent=value==null?'—':money.format(value);
    }
    $('stat-qty').textContent=Array.from(cart.values()).reduce((qty,it)=>qty+it.qty,0);
    $('stat-tax').textContent=summary?.tax??'—';
    $('stat-discount').textContent=summary?.discount??'—';
  }
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
    for(const id of ['draft','bill']) if($(id)) $(id).disabled=busy||!cart.size||total===null;
    for(const button of root.querySelectorAll('[data-kb-payment],[data-kb-hold]')) button.disabled=busy||!cart.size||total===null;
    if($('send')) {
      const displayDisabled=cfg.displayEnabled==='false';
      $('send').disabled=busy||!cart.size||total===null||displayDisabled;
      $('send').title=displayDisabled?'Kitchen Display is disabled for this shop. Use KOT printing.':'Press Shift by itself';
    }
  }
  function resetOrder() {
    cart.clear();
    draftId='';savedFingerprint='';customer={};
    $('badge').textContent='New KOT';$('instr').value='';
    quote();
  }
  function rows() {
    const number=(value,digits)=>Number.isFinite(value)?value.toFixed(digits):'—';
    $('cart').innerHTML=Array.from(cart.values(),(it,i)=>'<tr data-product="'+esc(it.id)+'"><td>'+(i+1)+'</td><td><strong>'+esc(it.name)+'</strong>'+(grid?'<small>'+esc(it.code)+'</small>':'')+'</td>'
      +(grid?'':'<td><select class="kb-line-mode" data-kb-line-mode aria-label="Sales mode for '+esc(it.name)+'"'+(search.disabled?' disabled':'')+'>'
        +modeOptions.map(([value,name])=>'<option value="'+esc(value)+'"'+(value===(it.mode||salesModeId)?' selected':'')+'>'+esc(name)+'</option>').join('')
        +'</select></td><td><input class="kb-price-input" type="number" data-kb-rate min="0" max="10000000" step="0.01" inputmode="decimal" required aria-label="Rate for '+esc(it.name)+'" value="'+esc(it.manual??it.price??'')+'"'+(cfg.canOverride==='true'?'':' readonly')+'></td>')
      +'<td><span class="kb-ostep"><button type="button" data-qty="-1" aria-label="Decrease quantity" '+(it.qty<=1?'disabled':'')+'>−</button><span>'+it.qty+'</span><button type="button" data-qty="1" aria-label="Increase quantity">+</button></span></td>'
      +(grid?'<td class="r">'+money.format(it.price)+'</td>':'<td>'+number(it.tax,3)+'</td>')
      +'<td class="r kb-oamt">'+(grid?money.format(it.amount??it.qty*it.price):number(it.amount==null?null:it.amount+(it.tax||0),2))+'</td>'
      +'<td class="r"><button type="button" class="kb-orm" data-remove="true" aria-label="Remove '+esc(it.name)+'">'+(grid?'×':'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>')+'</button></td></tr>').join('');
    $('cartempty').hidden=cart.size>0;
    $('item-count').textContent=cart.size;
    $('list-count').textContent=$('summary-count').textContent=cart.size;
  }
  function quote() {
    clearTimeout(quoteTimer); const version=++quoteVersion;
    total=null;controls();rows();paintDetails();
    $('quote-error').textContent='';
    $('tax-rows').replaceChildren();
    $('grand').textContent=cart.size?'Calculating…':money.format(0);
    paintTotals(cart.size?null:{subtotal:0,tax:0,total:0,discount:0});
    if(!cart.size){$('subtotal').textContent=money.format(0);return;}
    quoteTimer=setTimeout(async()=>{
      try{
        const {receipt}=await request('cartReceipt',orderData());
        if(version!==quoteVersion||!root.isConnected)return;
        for(const line of receipt.items){
          const it=cart.get(line.productId);
          if(it){it.price=Number(line.rate);it.amount=Number(line.total);it.tax=Number(line.tax);it.code=line.code;it.name=line.name;}
        }
        rows();total=Number(receipt.summary.total);controls();
        $('subtotal').textContent=money.format(receipt.summary.subtotal);
        $('grand').textContent=money.format(total);
        paintTotals(receipt.summary);
        $('tax-rows').innerHTML=(receipt.summary.taxBreakdown||[]).map(t=>'<div class="kb-sum__row"><span>'+esc(t.name)+'</span><span>'+money.format(t.amount)+'</span></div>').join('');
      }catch(e){if(version===quoteVersion&&root.isConnected)$('quote-error').textContent=e.message;}
    },100);
  }
  function renderMatches(message) {
    const term=search.value.trim();
    const showResults=grid||!!term;
    suggestions.hidden=!showResults;
    search.setAttribute('aria-expanded',String(showResults));
    suggestions.classList.toggle('kb-results-grid',grid);
    if(!showResults){suggestions.replaceChildren();return;}
    suggestions.innerHTML=(message?'<p class="kb-search-message" role="status">'+esc(message)+'</p>':'')+
      results.map((p,i)=>'<button type="button" class="kb-suggestion'+(i===selected?' is-active':'')+'" data-result="'+i+'"'+(search.disabled?' disabled':'')+'><span><strong>'+esc(p.name)+'</strong><small>'+esc(p.code)+(p.stock==null?'':' · Stock: '+esc(p.stock))+'</small></span><span>'+esc(p.price==null?(p.reason||'No price for this mode'):money.format(p.price))+'</span></button>').join('')
      +(hasMore?'<button type="button" class="kb-control" id="kb-more">More matches</button>':'');
  }
  async function lookup(append=false) {
    const value=search.value, version=++searchVersion;
    searchAbort?.abort(); searchAbort=new AbortController();
    if(!append){results=[];selected=0;pickedMatch=false;offset=0;hasMore=false;exactId=null;ambiguous=false;}
    if(!grid&&!value.trim()){renderMatches();return false;}
    if(!append)renderMatches(value.trim()?'Searching…':'Loading products…');
    try{
      const data=await request('searchMenu',{term:value,salesModeId,offset,stockSessionId:cfg.stockSession||''},searchAbort.signal);
      if(version!==searchVersion||!root.isConnected)return false;
      results=append?results.concat(data.products.filter(p=>!results.some(x=>x.id===p.id))):data.products;
      offset+=40;hasMore=data.hasMore;exactId=data.exactId;ambiguous=data.ambiguous;
      if(!append&&exactId)selected=Math.max(0,results.findIndex(p=>p.id===exactId));
      const noResults=value.trim()?'No products match your search.':'No products available.';
      renderMatches(ambiguous?'Multiple products use this code. Choose a product from the results.':results.length?'':noResults);
      return true;
    }catch(e){if(version===searchVersion&&e.name!=='AbortError')renderMatches(e.message);return false;}
  }
  function clearSearch() {
    clearTimeout(searchTimer);
    if(grid&&!search.value){
      selected=0;pickedMatch=false;renderMatches();return;
    }
    search.value='';
    lookup();
  }
  function setGridView() {
    grid=!grid;
    const panel=$('product-grid'),button=$('view-grid');
    $('view-label').textContent=grid?'List View':'Grid View';
    root.classList.toggle('kb-grid-view',grid);
    search.placeholder=grid?'Search product by name, code or barcode...':'Scan barcode, or type product name or code...   ( press / )';
    rows();
    button.setAttribute('aria-expanded',String(grid));
    panel.hidden=!grid;
    (grid?panel:search.parentElement).append(suggestions);
    if(search.value.trim())renderMatches();
    else {
      clearTimeout(searchTimer);
      lookup();
    }
  }
  function fullscreenElement() {
    return document.fullscreenElement||document.webkitFullscreenElement;
  }
  function syncFullscreen() {
    const active=fullscreenElement()===root;
    $('fullscreen-label').textContent=active?'Exit fullscreen':'Fullscreen';
    $('fullscreen').setAttribute('aria-pressed',String(active));
  }
  async function toggleFullscreen() {
    const status=$('fullscreen-status');
    status.textContent='';
    const active=fullscreenElement()===root;
    const target=active?document:root;
    const method=active?(document.exitFullscreen||document.webkitExitFullscreen):
      (root.requestFullscreen||root.webkitRequestFullscreen);
    if(!method){
      status.textContent='Fullscreen is unavailable in this browser.';
      return;
    }
    try {
      await method.call(target);
      syncFullscreen();
    } catch {
      status.textContent='Fullscreen could not be changed.';
    }
  }
  root.addEventListener('fullscreenchange',syncFullscreen);
  root.addEventListener('webkitfullscreenchange',syncFullscreen);
  function choose(index) {
    const item=results[index];if(!item||busy||search.disabled)return;
    if(item.price==null){renderMatches(item.reason||'No price for this sales mode.');return;}
    if(cart.has(item.id)){const row=cart.get(item.id);row.qty++;row.amount=null;}
    else cart.set(item.id,{...item,qty:1});
    clearSearch();quote();search.focus({preventScroll:grid});
  }
  search.addEventListener('input',()=>{
    clearTimeout(searchTimer);++searchVersion;searchAbort?.abort();results=[];selected=0;pickedMatch=false;exactId=null;ambiguous=false;hasMore=false;
    renderMatches(search.value.trim()?'Searching…':'Loading products…');
    if(grid||search.value.trim())searchTimer=setTimeout(()=>lookup(),85);
  });
  search.addEventListener('keydown',async e=>{
    if(e.isComposing||e.repeat)return;
    if(e.key==='Escape'){clearSearch();return;}
    if(e.key===' '&&!search.value&&!$('bill')?.disabled&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.shiftKey){e.preventDefault();openPayment();return;}
    if((e.key==='ArrowUp'||e.key==='ArrowDown')&&results.length){
      e.preventDefault();selected=(selected+(e.key==='ArrowDown'?1:results.length-1))%results.length;pickedMatch=true;renderMatches();
      suggestions.querySelector('.is-active')?.scrollIntoView({block:'nearest'});return;
    }
    if(e.key!=='Enter'||(!search.value.trim()&&!(grid&&pickedMatch)))return;
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

  function openPayment(method='Cash') {
    if(!$('bill')||$('bill').disabled||$('payment').open)return;
    $('payment-total').textContent='Order total: '+money.format(total);
    if($('payment-method')){$('payment-method').value=method;tenderFields();}
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
    if(method==='Credit') {
      $('payment-form').elements.customerName.value=customer.name||'';
      $('payment-form').elements.customerPhone.value=customer.phone||'';
    }
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
      lastAmount=total;$('payment').close();resetOrder();
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
        const response=await fetch('/apps'+billingPath+'?sessionId='+encodeURIComponent(cfg.session));
        if(!response.ok)throw Error('History could not be refreshed.');
        const page=new DOMParser().parseFromString(await response.text(),'text/html');
        const rows=page.getElementById('kb-history-rows');
        if(!rows)throw Error('History could not be refreshed. Reload the page.');
        $('history-rows').replaceChildren(...rows.children);historyDirty=false;
      }catch(e){$('order-status').textContent=e.message;}
    }
    filterHistory();
  }
  async function sendToKitchen() {
    if($('send').disabled)return;
    busy=true;controls();
    const status=$('order-status');
    status.textContent='Sending to kitchen…';
    try {
      const ticket=await request('createKot',{...orderData(),loadedDraftId:draftId,wantJson:'Y'});
      resetOrder();
      historyDirty=true;
      status.textContent='KOT #'+ticket.kotNumber+' sent to the kitchen.';
    } catch(error) {
      status.textContent=error.message;
    } finally {
      busy=false;controls();
    }
  }
  root.addEventListener('click',e=>{
    const button=e.target.closest('button');if(!button||button.disabled||busy)return;
    if(button.hasAttribute('data-kb-customer-open')) {
      $('customer-results').replaceChildren();$('customer-search').value='';$('customer-dialog').showModal();
    }else if(button.hasAttribute('data-kb-walk-in')) {
      customer={};$('customer-dialog').close();quote();
    }else if(button.dataset.kbCustomer) {
      button.disabled=true;
      request('findKotCustomer',{customerPartyId:button.dataset.kbCustomer}).then(result=>{
        if(!$('customer-dialog').open)return;
        customer=result.customer;$('customer-dialog').close();quote();
      }).catch(error=>{$('customer-results').textContent=error.message;});
    }else if(button.dataset.kbMode) {
      $('mode').value=button.dataset.kbMode;$('mode').dispatchEvent(new Event('change'));button.closest('details').open=false;
    }else if(button.dataset.ot){setType(button.dataset.ot);quote();}
    else if(button.id==='kb-tax-toggle'){taxOn=taxOn==='Y'?'N':'Y';paintTax();quote();}
    else if(button.id==='kb-view-grid')setGridView();
    else if(button.id==='kb-fullscreen')toggleFullscreen();
    else if(button.id==='kb-clear'&&confirm('Clear the unsent items from this order?')){cart.clear();quote();}
    else if(button.id==='kb-history-open')showHistory();
    else if(button.id==='kb-bill')openPayment();
    else if(button.dataset.kbPayment)openPayment(button.dataset.kbPayment);
    else if(button.id==='kb-send')sendToKitchen();
    else if(button.id==='kb-draft'||button.hasAttribute('data-kb-hold')){
      busy=true;controls();
      post('saveDraft',{...orderData(),existingDraftId:draftId});
    }
    else if(button.id==='kb-payment-close')$('payment').close();
    else if(button.dataset.kotResume){
      if(!cart.size||confirm('Replace the current unsent items with this held order?'))location.href=base+'/?sessionId='+encodeURIComponent(cfg.session)+'&loadDraft='+encodeURIComponent(button.dataset.kotResume);
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
    if($('mode').value===salesModeId)return;
    if(cart.size&&!confirm('Update the cart? Existing items will be repriced for the selected sales mode.')){$('mode').value=salesModeId;return;}
    salesModeId=$('mode').value;
    for(const item of cart.values()){item.mode='';item.manual=null;item.amount=null;}
    quote();lookup();
  });
  $('cart').addEventListener('change',e=>{
    const input=e.target, item=cart.get(input.closest('tr')?.dataset.product);
    if(!item||busy)return;
    if(input.hasAttribute('data-kb-line-mode')){item.mode=input.value;item.manual=null;item.amount=null;quote();}
    if(input.hasAttribute('data-kb-rate')){
      if(!input.reportValidity()){total=null;controls();return;}
      item.manual=String(Number(input.value));item.amount=null;quote();
    }
  });
  $('customer-search-form')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const button=e.currentTarget.querySelector('button'), output=$('customer-results');
    button.disabled=true;output.textContent='Searching…';
    try{
      const {customers}=await request('findKotCustomer',{term:$('customer-search').value});
      output.innerHTML=customers.map(c=>'<button class="kb-control" type="button" data-kb-customer="'+esc(c.id)+'">'+esc(c.name)+'</button>').join('')||'No customers found.';
    }catch(error){output.textContent=error.message;}
    finally{button.disabled=false;}
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
    if(e.key==='/'){e.preventDefault();search.focus();}
    if(e.key==='F7'&&!$('draft')?.disabled){e.preventDefault();$('draft')?.click();}
    if(e.key===' '&&!e.shiftKey&&!$('bill')?.disabled){e.preventDefault();$('bill')?.click();}
  }
  document.addEventListener('keydown',shortcut);document.addEventListener('keyup',shortcut);
  const snapshot=JSON.parse(cfg.draftreceipt||'[]');
  for(const item of JSON.parse(cfg.draftload||'[]')){
    const saved=snapshot.find(row=>row.productId===item.productId);
    cart.set(item.productId,{id:item.productId,name:item.productName,code:saved?.code||item.productId,price:Number(saved?.rate)||0,qty:Number(item.quantity),
      mode:saved?.salesModeId||'',manual:saved?.manualPrice==='Y'?saved.rate:null});
  }
  if(draftId){$('badge').textContent='Editing Held Order';$('instr').value=cfg.draftinstr||'';}
  setType(orderType);paintTax();quote();
  const localDate=new Intl.DateTimeFormat('en-GB'), localTime=new Intl.DateTimeFormat('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
  function clock(){
    const now=new Date(), online=navigator.onLine;
    $('date').textContent=localDate.format(now).replaceAll('/','-');
    $('time').textContent=localTime.format(now).toUpperCase();
    $('online').textContent=online?'Online':'Offline';$('online').classList.toggle('is-offline',!online);
  }
  clock();
  const ticker=setInterval(()=>root.isConnected?clock():clearInterval(ticker),1000);
  if($('send')) {
    const keepSessionOpen=()=>{
      if(!root.isConnected)clearInterval(heartbeat);
      else request('touchSession',{}).catch(()=>{});
    };
    const heartbeat=setInterval(keepSessionOpen,60000);
    keepSessionOpen();
  }
})();
