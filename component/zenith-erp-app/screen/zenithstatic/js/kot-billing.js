/* KOT entry uses the POS catalogue, checkout services and kitchen print pipeline. */
(function () {
  'use strict';
  const root=document.getElementById('kb-wrap');
  if (!root || root.dataset.ready) return;
  root.dataset.ready='true';
  const $=id=>root.querySelector('#kb-'+id);
  const search=$('search'), suggestions=$('suggestions'), cart=new Map();
  const modesMenu=root.querySelector('.kg-modes');
  const modeOptions=modesMenu.querySelectorAll('[data-kb-view]');
  const paymentButtons=Array.from(root.querySelectorAll('[data-kb-payment]'));
  const cartRows=$('cart'), editError=$('edit-error');
  const cfg=$('data').dataset;
  const shell=location.pathname.startsWith('/qapps/')?'/qapps':'/apps';
  const billingPath='/zenith'+(cfg.kotModule==='kot'?'/kot':'/pos/Kitchen')+'/KotBilling';
  const base=shell+billingPath;
  const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'});
  const cardMoney=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:0});
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token=()=>$('token').value||window.moqui?.webrootVue?.moquiSessionToken;
  let orderType=cfg.drafttype||'Dine In', taxOn=cfg.drafttax||'Y', draftId=cfg.draftid||'';
  let salesModeId=$('mode').value, quoteVersion=0, quoteTimer, total=null, busy=false, savedFingerprint='';
  let searchVersion=0, searchTimer, searchAbort, results=[], selected=0, exactId, ambiguous=false, hasMore=false, offset=0;
  let historyDirty=false, grid=false, pickedMatch=false, categoryId='';
  let customer={}, custVersion=0, custTimer, custAbort;
  let invalidEdit, pendingTender, sessionLost=false, completedKotId='';
  const signInMessage='Sign in again to continue billing.';
  if(cfg.draftmode && Array.from($('mode').options).some(o=>o.value===cfg.draftmode)) salesModeId=$('mode').value=cfg.draftmode;
  if(cfg.draftwaiter) $('waiter').value=cfg.draftwaiter;
  $('table').value=cfg.drafttable||cfg.selectedTable||'';

  async function request(action,data,signal) {
    if(sessionLost)throw Error(signInMessage);
    const response=await fetch(base+'/'+action,{method:'POST',credentials:'same-origin',signal,
      body:new URLSearchParams({...data,sessionId:cfg.session,moquiSessionToken:token()})});
    if(response.status===401||/\/Login\/?$/i.test(new URL(response.url,location.href).pathname)) {
      if(root.isConnected&&!sessionLost) {
        sessionLost=true;
        $('session-message').textContent='Your sign-in ended. The unsent order is still here.';
        $('session-notice').hidden=false;
        quote(false);
      }
      throw Error(signInMessage);
    }
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result?.success) throw Error(result?.error||'The request could not be completed. Check your connection and try again.');
    return result;
  }
  async function resumeBilling() {
    const button=$('resume');
    button.disabled=true;
    try {
      const response=await fetch('/apps'+billingPath+'?sessionId='+encodeURIComponent(cfg.session),{cache:'no-store'});
      const page=new DOMParser().parseFromString(await response.text(),'text/html');
      const fresh=page.getElementById('kb-data')?.dataset, freshToken=page.getElementById('kb-token')?.value;
      if(!response.ok||!freshToken||fresh?.session!==cfg.session||fresh.user!==cfg.user||
          page.getElementById('kb-search')?.disabled!==search.disabled) {
        $('session-message').textContent='Sign in with the same account and shop, then try Resume billing again.';
        return;
      }
      $('token').value=freshToken;
      cfg.displayEnabled=fresh.displayEnabled;
      $('display-message').hidden=fresh.displayEnabled==='true';
      sessionLost=false;
      $('session-notice').hidden=true;
      search.focus();lookup();quote();
    } catch {
      $('session-message').textContent='Billing could not reconnect. Check your connection and try again.';
    } finally {
      button.disabled=false;
    }
  }
  function post(action,data) {
    if(sessionLost)return;
    const form=document.createElement('form');
    form.method='POST';form.action=base+'/'+action;
    for(const [name,value] of Object.entries({...data,sessionId:cfg.session,moquiSessionToken:token()})) {
      const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);
    }
    root.append(form);form.submit();
  }
  const orderData=()=>({orderType,taxOn,salesModeId,tableId:$('table').value,waiterId:$('waiter').value,notes:$('instr').value,customerPartyId:customer.id||'',
    itemsJson:JSON.stringify(Array.from(cart.values(),it=>({productId:it.id,quantity:it.qty,
      ...(it.manualRate==null?{}:{manualPrice:'Y',unitPrice:it.manualRate})})))});
  function setType(value) {
    orderType=value;
    for(const button of root.querySelectorAll('[data-ot]')) {
      const active=button.dataset.ot===value;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',active);
    }
    $('table-field').hidden=value==='Take Away'||$('table').options.length===1;
    if(value==='Take Away') $('table').value='';
    $('list-type').textContent=orderType;
  }
  function paintTax() {
    const on=taxOn==='Y',b=$('tax-toggle');
    b.textContent=on?'Tax: ON':'Tax: OFF';b.classList.toggle('is-on',on);b.setAttribute('aria-checked',on);
  }
  function controls() {
    const canPay=!busy&&!sessionLost&&cart.size>0&&total!==null&&editError.hidden;
    for(const button of paymentButtons) {
      button.disabled=busy||sessionLost||!cart.size;
      button.setAttribute('aria-disabled',String(!canPay));
    }
    $('clear').disabled=busy||!cart.size;
    if($('close-session')) $('close-session').disabled=busy||sessionLost;
    for(const id of ['draft','bill']) if($(id)) $(id).disabled=!canPay;
    if($('send')) {
      const displayDisabled=cfg.displayEnabled==='false';
      root.classList.toggle('kb-display-disabled',displayDisabled);
      $('send').style.display=displayDisabled?'none':'';
      $('send').disabled=busy||sessionLost||!cart.size||displayDisabled||!editError.hidden;
      $('send').title=displayDisabled?'Kitchen Display is disabled for this shop. Use KOT printing.':'Press Shift by itself';
    }
  }
  function resetOrder() {
    cart.clear();
    setEditError('');
    draftId='';savedFingerprint='';customer={};
    $('badge').textContent='New KOT';$('instr').value='';
    renderCustomer();
    quote();
  }
  function renderCustomer() {
    const label=$('customer-name');
    const name=customer.name||'Walk-in Customer';
    if(label)label.textContent=name;
    $('list-customer').textContent=name;
    $('list-phone').textContent=customer.phone||'—';
    $('customer-open')?.classList.toggle('is-active',!!customer.id);
  }
  function openCustomerDialog() {
    const dlg=$('customer-dialog');if(!dlg)return;
    $('customer-error').textContent='';$('customer-search').value='';
    renderCustomerResults([]);dlg.showModal();
    searchCustomers('');$('customer-search').focus();
  }
  async function searchCustomers(term) {
    const version=++custVersion;
    custAbort?.abort();custAbort=new AbortController();
    $('customer-error').textContent='';
    try{
      const data=await request('searchKotCustomers',{term},custAbort.signal);
      if(version!==custVersion||!root.isConnected)return;
      renderCustomerResults(data.customers||[]);
    }catch(e){if(e.name!=='AbortError'&&version===custVersion)$('customer-error').textContent=e.message;}
  }
  function renderCustomerResults(list) {
    const box=$('customer-results');if(!box)return;
    if(!list.length){box.innerHTML='<p class="kb-search-message" role="status">No matching customers. Billing stays as Walk-in.</p>';return;}
    box.innerHTML=list.map(c=>'<button type="button" class="kb-suggestion" data-cust-id="'+esc(c.id)+'" data-cust-name="'+esc(c.name)+'" data-cust-phone="'+esc(c.phone||'')+'"><span><strong>'+esc(c.name)+'</strong><small>'+esc(c.phone||c.id)+'</small></span></button>').join('');
  }
  function selectCustomer(el) {
    customer={id:el.dataset.custId,name:el.dataset.custName,phone:el.dataset.custPhone||''};
    $('customer-dialog')?.close();renderCustomer();quote();
  }
  function walkInCustomer() {
    customer={};$('customer-dialog')?.close();renderCustomer();quote();
  }
  function editorFor(id, field) {
    return cartRows.querySelector('tr[data-product="'+CSS.escape(id)+'"] [data-kb-edit="'+field+'"]');
  }
  function focusEditor(input) {
    if(!input || input.readOnly)return;
    input.focus();
    input.select();
  }
  function rows() {
    // A quote can finish while a cashier is typing. Keep the uncommitted text and selection.
    const active=document.activeElement;
    const editing=active?.dataset.kbEdit && cartRows.contains(active);
    const cursor=editing && {id:active.closest('tr').dataset.product,field:active.dataset.kbEdit,
      value:active.value,changed:active.value!==active.defaultValue,start:active.selectionStart,end:active.selectionEnd};
    const readOnly=search.disabled?' readonly':'';
    const modeName=$('mode').selectedOptions[0]?.textContent||'—';
    $('list-mode').textContent=modeName;
    $('list-waiter').textContent=$('waiter').value?$('waiter').selectedOptions[0]?.textContent:'—';
    cartRows.innerHTML=Array.from(cart.values(),(it,i)=>'<tr data-product="'+esc(it.id)+'"><td>'+(i+1)+'</td><td><strong>'+esc(it.name)+'</strong><small>'+esc(it.code)+'</small></td>'
      +'<td class="kg-normal"><span class="kl-line-mode">'+esc(modeName)+'</span></td>'
      +'<td><input type="text" inputmode="decimal" class="kl-line-rate" data-kb-edit="rate" aria-label="Rate for '+esc(it.name)+'" value="'+esc(it.price)+'"'+readOnly+'></td>'
      +'<td><span class="kb-ostep"><button type="button" data-qty="-1" aria-label="Decrease quantity" '+(it.qty<=1||search.disabled?'disabled':'')+'>−</button><input type="text" inputmode="decimal" data-kb-edit="qty" aria-label="Quantity for '+esc(it.name)+'" value="'+esc(it.qty)+'"'+readOnly+'><button type="button" data-qty="1" aria-label="Increase quantity" '+(search.disabled?'disabled':'')+'>+</button></span></td>'
      +'<td class="kg-normal">'+(it.tax==null?'—':money.format(it.tax))+'</td>'
      +'<td class="r kb-oamt">'+money.format(it.amount??it.qty*it.price)+'</td>'
      +'<td class="r"><button type="button" class="kb-orm" data-remove="true" aria-label="Remove '+esc(it.name)+'"><span class="kg-only">×</span><svg class="kg-normal" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18m-2 0-1 15H6L5 6m4 0V3h6v3m-5 4v7m4-7v7"/></svg></button></td></tr>').join('');
    const next=cursor && editorFor(cursor.id,cursor.field);
    const invalid=invalidEdit && editorFor(invalidEdit.id,invalidEdit.field);
    if(invalid) {
      invalid.value=invalidEdit.value;
      invalid.setAttribute('aria-invalid','true');
    }
    if(next) {
      if(cursor.changed)next.value=cursor.value;
      next.focus({preventScroll:true});
      if(!cursor.changed && cursor.start===0 && cursor.end===cursor.value.length)next.select();
      else next.setSelectionRange(cursor.start,cursor.end);
    }
    $('cartempty').hidden=cart.size>0;
    $('item-count').textContent=cart.size;
    $('grid-count').textContent=cart.size;
    $('list-count').textContent=cart.size;
    $('list-item-count').textContent=cart.size+' '+(cart.size===1?'item':'items');
    $('list-qty').textContent=Array.from(cart.values()).reduce((qty,item)=>qty+item.qty,0);
  }
  function listTotals(summary) {
    const display=value=>summary?money.format(value??0):'—';
    $('list-subtotal').textContent=display(summary?.subtotal);
    $('list-tax').textContent=display(summary?.tax);
    $('list-grand').textContent=display(summary?.total);
    $('list-tax-stat').textContent=display(summary?.tax);
  }
  function quote(refreshRows=true) {
    clearTimeout(quoteTimer); const version=++quoteVersion;
    pendingTender=null;
    for(const item of cart.values())item.tax=null;
    total=null;controls();if(refreshRows)rows();
    listTotals(cart.size?null:{});
    $('quote-error').textContent='';
    $('tax-rows').replaceChildren();
    $('grand').textContent=cart.size?(sessionLost?'Sign in to price':'Calculating…'):money.format(0);
    if(!cart.size){$('subtotal').textContent=money.format(0);return;}
    $('subtotal').textContent='—';
    if(sessionLost)return;
    quoteTimer=setTimeout(async()=>{
      try{
        const {receipt}=await request('cartReceipt',orderData());
        if(version!==quoteVersion||!root.isConnected)return;
        for(const line of receipt.items){
          const it=cart.get(line.productId);
          if(it){it.price=Number(line.rate);it.amount=Number(line.total);it.tax=Number(line.tax??0);it.code=line.code;it.name=line.name;}
        }
        rows();total=Number(receipt.summary.total);controls();
        $('subtotal').textContent=money.format(receipt.summary.subtotal);
        $('grand').textContent=money.format(total);
        listTotals(receipt.summary);
        $('tax-rows').innerHTML=(receipt.summary.taxBreakdown||[]).map(t=>'<div class="kb-sum__row"><span>'+esc(t.name)+'</span><span>'+money.format(t.amount)+'</span></div>').join('');
        if(pendingTender && pendingTender===document.activeElement)openPayment(pendingTender.dataset.kbPayment);
        pendingTender=null;
      }catch(e){
        if(version!==quoteVersion||!root.isConnected)return;
        pendingTender=null;
        $('grand').textContent='Unavailable';
        $('quote-error').textContent=e.message;
      }
    },100);
  }
  function setEditError(message, input) {
    invalidEdit=input && {id:input.closest('tr').dataset.product,field:input.dataset.kbEdit,value:input.value};
    cartRows.querySelector('[aria-invalid="true"]')?.removeAttribute('aria-invalid');
    if(input)input.setAttribute('aria-invalid','true');
    editError.textContent=message;
    editError.hidden=!message;
  }
  function commitEdit(input) {
    if(input.readOnly||busy)return false;
    if(input.value===input.defaultValue) {
      if(input.hasAttribute('aria-invalid')){setEditError('');controls();}
      return true;
    }
    const item=cart.get(input.closest('tr').dataset.product);
    const rate=input.dataset.kbEdit==='rate';
    const raw=input.value.trim(), value=Number(raw);
    const decimal=rate?/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/:/^(?:\d+(?:\.\d{0,6})?|\.\d{1,6})$/;
    if(!decimal.test(raw)||value>(rate?10000000:1000000)||(!rate&&value<=0)) {
      setEditError(rate?'Enter a rate from 0 to 10,000,000 with up to two decimal places.':'Enter a positive quantity up to 1,000,000 with up to six decimal places.',input);
      controls();
      return false;
    }
    if(input.hasAttribute('aria-invalid'))setEditError('');
    input.defaultValue=input.value=String(value);
    if(rate){item.manualRate=value;item.price=value;}
    else item.qty=value;
    item.amount=null;
    quote(false);
    return true;
  }
  cartRows.addEventListener('change',e=>{
    if(e.target.dataset.kbEdit)commitEdit(e.target);
  });
  cartRows.addEventListener('keydown',e=>{
    const input=e.target, field=input.dataset.kbEdit;
    if(!field||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return;
    const id=input.closest('tr').dataset.product;
    if(e.key==='Escape' && (input.value!==input.defaultValue || input.hasAttribute('aria-invalid'))) {
      e.preventDefault();
      input.value=input.defaultValue;
      if(input.hasAttribute('aria-invalid'))setEditError('');
      controls();input.select();
      return;
    }
    const toQty=field==='rate' && (e.key==='ArrowRight'||e.key==='Enter');
    const toRate=field==='qty' && e.key==='ArrowLeft';
    const toPayment=e.key==='ArrowDown'||(field==='qty'&&e.key==='Enter');
    if(!toQty&&!toRate&&!toPayment)return;
    e.preventDefault();
    if(!commitEdit(input))return;
    if(toPayment)paymentButtons[0]?.focus();
    else focusEditor(editorFor(id,toQty?'qty':'rate'));
  });
  for(const [index,button] of paymentButtons.entries()) {
    button.addEventListener('blur',()=>{if(pendingTender===button)pendingTender=null;});
    button.addEventListener('keydown',e=>{
      if(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return;
      if(e.key==='Enter'&&total===null&&!busy&&!invalidEdit&&!$('quote-error').textContent) {
        // A fast cashier may pick the tender while the latest quote is still in flight.
        e.preventDefault();
        pendingTender=button;
      } else if(e.key==='ArrowRight'||e.key==='ArrowLeft') {
        e.preventDefault();
        const step=e.key==='ArrowRight'?1:-1;
        paymentButtons[(index+step+paymentButtons.length)%paymentButtons.length].focus();
      }
    });
  }
  function renderMatches(message) {
    const term=search.value.trim();
    const showResults=grid||!!term;
    suggestions.hidden=!showResults;
    search.setAttribute('aria-expanded',String(showResults));
    suggestions.classList.toggle('kb-results-grid',grid);
    if(!showResults){suggestions.replaceChildren();return;}
    suggestions.innerHTML=(message?'<p class="kb-search-message" role="status">'+esc(message)+'</p>':'')+
      results.map((p,i)=>{
        const price=p.price==null?(p.reason||'No price for this mode'):(grid?cardMoney:money).format(p.price);
        return '<button type="button" class="kb-suggestion'+(i===selected&&(!grid||term||pickedMatch)?' is-active':'')+'" data-result="'+i+'"'+(search.disabled?' disabled':'')+'><span><strong>'+esc(p.name)+'</strong><small>'+esc(p.code)+(p.stock==null?'':' · Stock: '+esc(p.stock))+'</small></span><span'+(p.price==null?' class="kg-unpriced" title="'+esc(price)+'"':'')+'>'+esc(price)+'</span></button>';
      }).join('')
      +(hasMore?'<button type="button" class="kb-control" id="kb-more">More matches</button>':'');
  }
  function moveMatch(key, fromCard) {
    if(!results.length||!/^Arrow(Left|Right|Up|Down)$/.test(key))return false;
    const horizontal=key==='ArrowLeft'||key==='ArrowRight';
    if(horizontal&&!grid)return false;
    const step=key==='ArrowLeft'||key==='ArrowUp'?-1:1;
    if(!grid)selected=(selected+step+results.length)%results.length;
    else if(fromCard||pickedMatch||search.value.trim()) {
      const columns=getComputedStyle(suggestions).gridTemplateColumns.split(' ').length;
      const rowStart=selected-selected%columns;
      if(horizontal||results.length<=columns) {
        selected=Math.max(rowStart,Math.min(rowStart+columns-1,results.length-1,selected+step));
      } else if(step<0 ? rowStart>0 : rowStart+columns<results.length) {
        selected=Math.min(results.length-1,selected+step*columns);
      }
    }
    pickedMatch=true;
    suggestions.querySelector('.is-active')?.classList.remove('is-active');
    const active=suggestions.querySelector('[data-result="'+selected+'"]');
    active?.classList.add('is-active');
    if(fromCard)active?.focus({preventScroll:true});
    active?.scrollIntoView({block:'nearest',inline:'nearest'});
    $('match-status').textContent=results[selected].name;
    return true;
  }
  async function lookup(append=false) {
    const value=search.value, version=++searchVersion;
    searchAbort?.abort(); searchAbort=new AbortController();
    if(!append){results=[];selected=0;pickedMatch=false;offset=0;hasMore=false;exactId=null;ambiguous=false;}
    if(!grid&&!value.trim()){renderMatches();return false;}
    if(!append)renderMatches(value.trim()?'Searching…':'Loading products…');
    try{
      const data=await request('searchMenu',{term:value,salesModeId,offset,categoryId:grid?categoryId:'',stockSessionId:cfg.stockSession||''},searchAbort.signal);
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
    $('match-status').textContent='';
    if(grid&&!search.value){
      selected=0;pickedMatch=false;renderMatches();return;
    }
    search.value='';
    lookup();
  }
  function setGridView(next) {
    modesMenu.open=false;
    modesMenu.querySelector('summary').focus({preventScroll:true});
    if(grid===next)return;
    grid=next;
    const panel=$('product-grid');
    root.classList.toggle('kg-grid',grid);
    panel.hidden=!grid;
    for(const option of modeOptions)option.setAttribute('aria-pressed',String((option.dataset.kbView==='grid')===grid));
    (grid?panel:search.parentElement).append(suggestions);
    if(search.value.trim())renderMatches();
    else {
      clearTimeout(searchTimer);
      lookup();
    }
  }
  function updateHeader() {
    $('online').textContent=navigator.onLine?'Online':'Offline';
    $('online').classList.toggle('is-offline',!navigator.onLine);
    const now=new Date();
    $('clock').dateTime=now.toISOString();
    $('clock').textContent=now.toLocaleTimeString('en-IN');
  }
  let headerTimer=setInterval(()=>{
    if(!root.isConnected)clearInterval(headerTimer);
    else updateHeader();
  },1000);
  document.addEventListener('click',function dismissModes(e){
    if(!root.isConnected){document.removeEventListener('click',dismissModes);return;}
    if(!modesMenu.contains(e.target))modesMenu.open=false;
  });
  function fullscreenElement() {
    return document.fullscreenElement||document.webkitFullscreenElement;
  }
  function syncFullscreen() {
    const active=fullscreenElement()===root;
    const label=active?'Exit fullscreen':'Enter fullscreen';
    $('fullscreen-label').textContent=label;
    $('fullscreen').title=label;
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
  function choose(index, byKeyboard=false) {
    const item=results[index];if(!item||busy||search.disabled)return;
    if(item.price==null){renderMatches(item.reason||'No price for this sales mode.');return;}
    if(cart.has(item.id)){const row=cart.get(item.id);row.qty++;row.amount=null;}
    else cart.set(item.id,{...item,qty:1});
    clearSearch();quote();
    if(byKeyboard)focusEditor(editorFor(item.id,'rate'));
    else search.focus({preventScroll:grid});
  }
  search.addEventListener('input',()=>{
    clearTimeout(searchTimer);++searchVersion;searchAbort?.abort();results=[];selected=0;pickedMatch=false;exactId=null;ambiguous=false;hasMore=false;
    $('match-status').textContent='';
    renderMatches(search.value.trim()?'Searching…':'Loading products…');
    if(grid||search.value.trim())searchTimer=setTimeout(()=>lookup(),85);
  });
  search.addEventListener('keydown',async e=>{
    if(e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return;
    if(moveMatch(e.key,false)){e.preventDefault();return;}
    if(e.repeat)return;
    if(e.key==='Escape'){clearSearch();return;}
    if(e.key===' '&&!search.value&&!$('bill')?.disabled&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.shiftKey){e.preventDefault();openPayment();return;}
    if(e.key!=='Enter'||(!search.value.trim()&&!(grid&&pickedMatch)))return;
    e.preventDefault();clearTimeout(searchTimer);
    if(!results.length&&!(await lookup()))return;
    if(ambiguous&&!pickedMatch){renderMatches('Choose a match with the mouse or arrow keys before adding.');return;}
    if(!pickedMatch&&!exactId&&/^\d{8,}$/.test(search.value.trim())){renderMatches('Barcode not found. Check the code or choose a matching product.');return;}
    if(results.length)choose(selected,true);
  });
  suggestions.addEventListener('keydown',e=>{
    const match=e.target.closest('[data-result]');
    if(!grid||!match||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return;
    if(e.key==='Enter'&&e.repeat){e.preventDefault();return;}
    selected=Number(match.dataset.result);
    if(moveMatch(e.key,true))e.preventDefault();
  });
  suggestions.addEventListener('click',e=>{
    if(e.target.closest('#kb-more')){lookup(true);return;}
    const match=e.target.closest('[data-result]');if(match)choose(Number(match.dataset.result),e.detail===0);
  });

  function openPayment(method='Cash') {
    if(!$('bill')||$('bill').disabled||$('payment').open)return;
    $('payment-total').textContent='Order total: '+money.format(total);
    if($('payment-method')){$('payment-method').value=method;tenderFields();}
    if($('payment-error'))$('payment-error').textContent='';
    $('payment').showModal();
    $('cash')?.focus();
  }
  function tenderFields() {
    const method=$('payment-method').value, cash=method==='Cash', slot=$('cash-slot'), dialog=$('payment');
    dialog.classList.toggle('kb-cash-dialog',cash);
    dialog.setAttribute('aria-labelledby',cash?'pos-cash-title':'kb-payment-title');
    $('payment-heading').hidden=$('other-payment').hidden=cash;
    $('other-payment').querySelector('[type=submit]').disabled=cash;
    for(const label of dialog.querySelectorAll('[data-kb-tender]')){
      const shown=label.dataset.kbTender.split(' ').includes(method);label.hidden=!shown;
      label.querySelector('input').disabled=!shown;
    }
    slot.innerHTML=cash?PosTillDialogs.cashMarkup(total,true):'';
    if(cash){
      const input=slot.querySelector('.pos-cash-input');
      input.id='kb-cash';slot.querySelector('label').htmlFor=input.id;
      input.addEventListener('input',()=>PosTillDialogs.updateCash(slot,total));
    }
  }
  async function openSessionClose() {
    if(!$('close-session')||busy||sessionLost||document.getElementById('posCloseSessionOverlay'))return;
    busy=true;controls();
    try {
      const {summary}=await request('sessionDrawer',{});
      PosTillDialogs.openClose({sessionId:cfg.session,summary,
        warning:cart.size && (!draftId||savedFingerprint!==JSON.stringify(orderData())) ? 'Unsent items will be discarded when this session closes. Cancel to hold the order first.' : '',
        close:closingCash=>request('sessionDrawer',{drawerAction:'close',closingCash}),
        onClosed:()=>location.assign(base)});
    } catch(error){ $('order-status').textContent=error.message; }
    finally{busy=false;controls();}
  }
  async function printChoice(kind) {
    if(busy||!completedKotId)return;
    let billWindow,kotWindow;
    try {
      // Open windows from the click itself so the browser does not block them after fetching.
      if(kind==='bill'||kind==='both')billWindow=KitchenPrint.open();
      if(kind==='kot'||kind==='both')kotWindow=KitchenPrint.open();
      busy=true;controls();
      for(const button of root.querySelectorAll('[data-kb-print]'))button.disabled=true;
      $('print-error').textContent='';
      if(kotWindow) {
        const {record}=await request('printRecord',{kotId:completedKotId,kind:'kot'});
        await KitchenPrint.browserPrint(kotWindow,KitchenPrint.kotHtml(record));
        await request('ackKotPrint',{kotId:completedKotId});
      }
      if(billWindow) {
        const {record}=await request('printRecord',{kotId:completedKotId,kind:'bill'});
        await KitchenPrint.customer(billWindow,record);
      }
      $('order-status').textContent+=' Print request opened. The completed bill is also in History.';
      $('print-choice').close();
    } catch(error) {
      $('print-error').textContent=error.message+' You can retry here or print from History.';
    } finally {
      if(billWindow&&!billWindow.closed)billWindow.close();
      if(kotWindow&&!kotWindow.closed)kotWindow.close();
      busy=false;controls();
      for(const button of root.querySelectorAll('[data-kb-print]'))button.disabled=false;
    }
  }
  async function pay(e) {
    e.preventDefault();
    if(busy||sessionLost||total===null)return;
    const confirmedTotal=total;
    const form=e.currentTarget, cash=$('payment-method').value==='Cash';
    const submit=cash?$('cash-slot').querySelector('[type=submit]'):$('other-payment').querySelector('[type=submit]');
    const cancel=cash?$('cash-slot').querySelector('.pos-cash-cancel'):$('payment-close');
    if(cash&&!PosTillDialogs.updateCash($('cash-slot'),confirmedTotal))return;
    const payment=Object.fromEntries(new FormData(form)), data=orderData(), fingerprint=JSON.stringify(data);
    let bill;
    busy=true;controls();submit.disabled=true;cancel.disabled=true;$('payment-error').textContent='';
    try{
      if(!draftId||fingerprint!==savedFingerprint){
        const saved=await request('saveDraft',{...data,existingDraftId:draftId,wantJson:'Y'});
        draftId=saved.kotId;
        if(Number(saved.total)!==confirmedTotal){
          savedFingerprint='';
          $('payment').close();quote();
          $('order-status').textContent='The order total changed. Review it before taking payment.';return;
        }
        savedFingerprint=fingerprint;
      }
      bill=await request('checkoutKot',{...payment,kotId:draftId});
    }catch(error){
      $('payment-error').textContent=error.message;
    }finally{
      busy=false;controls();cancel.disabled=false;
      if(!bill&&$('payment').open&&!sessionLost){
        if(cash)PosTillDialogs.updateCash($('cash-slot'),confirmedTotal);
        else submit.disabled=false;
      }
    }
    if(!bill)return;
    completedKotId=bill.kotId;historyDirty=true;
    $('list-last-bill').textContent=bill.billNumber;
    $('list-last-amount').textContent=$('list-last-stat').textContent=money.format(confirmedTotal);
    $('payment').close();resetOrder();
    const change=Number(bill.changeAmount)>0?' Change given: '+money.format(bill.changeAmount)+'.':'';
    $('order-status').textContent='Saved bill '+bill.billNumber+'.'+change;
    $('print-summary').textContent='Bill '+bill.billNumber+' is saved.'+change+' Choose a print option.';
    $('print-error').textContent='';
    $('print-choice').showModal();
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
    if(button.dataset.ot){setType(button.dataset.ot);quote();}
    else if(button.id==='kb-tax-toggle'){taxOn=taxOn==='Y'?'N':'Y';paintTax();quote();}
    else if(button.dataset.kbView)setGridView(button.dataset.kbView==='grid');
    else if(button.hasAttribute('data-kb-category')){
      categoryId=button.dataset.kbCategory;
      for(const category of button.parentElement.children) category.setAttribute('aria-pressed',String(category===button));
      clearTimeout(searchTimer);search.value='';lookup();
    }
    else if(button.dataset.kbPayment)openPayment(button.dataset.kbPayment);
    else if(button.id==='kb-fullscreen')toggleFullscreen();
    else if(button.id==='kb-close-session')openSessionClose();
    else if(button.id==='kb-clear'&&confirm('Clear the unsent items from this order?')){cart.clear();setEditError('');quote();}
    else if(button.id==='kb-history-open')showHistory();
    else if(button.id==='kb-resume')resumeBilling();
    else if(button.id==='kb-bill')openPayment();
    else if(button.id==='kb-send')sendToKitchen();
    else if(button.id==='kb-draft'){
      busy=true;controls();
      post('saveDraft',{...orderData(),existingDraftId:draftId});
    }
    else if(button.classList.contains('pos-cash-quick')){
      $('cash').value=button.dataset.amt;PosTillDialogs.updateCash($('cash-slot'),total);
    }
    else if(button.id==='kb-payment-close'||button.classList.contains('pos-cash-cancel'))$('payment').close();
    else if(button.dataset.kbPrint)printChoice(button.dataset.kbPrint);
    else if(button.id==='kb-print-close')$('print-choice').close();
    else if(button.id==='kb-customer-open'||button.hasAttribute('data-kb-customer-change'))openCustomerDialog();
    else if(button.id==='kb-customer-walkin')walkInCustomer();
    else if(button.id==='kb-customer-close')$('customer-dialog')?.close();
    else if(button.dataset.custId)selectCustomer(button);
    else if(button.dataset.kotResume){
      if(!cart.size||confirm('Replace the current unsent items with this held order?'))location.href=base+'/?sessionId='+encodeURIComponent(cfg.session)+'&loadDraft='+encodeURIComponent(button.dataset.kotResume);
    }else if(button.dataset.kotDiscard){
      if(confirm('Discard this held order?'))post('deleteDraft',{kotId:button.dataset.kotDiscard});
    }else if(button.dataset.remove||button.dataset.qty){
      const id=button.closest('tr').dataset.product,it=cart.get(id);
      if(button.dataset.remove){cart.delete(id);if(invalidEdit?.id===id)setEditError('');}
      else{it.qty=Math.max(1,it.qty+Number(button.dataset.qty));it.amount=null;}
      quote();
    }
  });
  $('mode').addEventListener('change',()=>{
    if(cart.size&&!confirm('Update the cart? Existing items will be repriced for the selected sales mode.')){$('mode').value=salesModeId;return;}
    for(const item of cart.values())delete item.manualRate;
    salesModeId=$('mode').value;quote();lookup();
  });
  $('table').addEventListener('change',quote);
  $('waiter').addEventListener('change',quote);
  $('history-search').addEventListener('input',filterHistory);
  $('history-status').addEventListener('change',filterHistory);
  $('history-date').addEventListener('change',filterHistory);
  $('customer-search')?.addEventListener('input',e=>{clearTimeout(custTimer);const v=e.target.value.trim();custTimer=setTimeout(()=>searchCustomers(v),150);});
  $('payment-method')?.addEventListener('change',tenderFields);
  $('payment-form')?.addEventListener('submit',pay);
  $('payment')?.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  let shiftAlone=false;
  const editable=e=>e.target?.closest?.('input,textarea,select,button,a,[contenteditable],dialog');
  function shortcut(e) {
    if(!root.isConnected){document.removeEventListener('keydown',shortcut);document.removeEventListener('keyup',shortcut);return;}
    if(document.getElementById('posCloseSessionOverlay')){shiftAlone=false;return;}
    if(e.type==='keyup'){
      if(e.key==='Shift'&&shiftAlone&&!editable(e)&&!root.querySelector('dialog[open]'))$('send')?.click();
      if(e.key==='Shift')shiftAlone=false;
      return;
    }
    if(e.key!=='Shift')shiftAlone=false;
    if(e.key==='Escape'&&modesMenu.open){
      modesMenu.open=false;modesMenu.querySelector('summary').focus();return;
    }
    if(!e.repeat&&!e.isComposing&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey&&!root.querySelector('dialog[open]')){
      if(e.key.toLowerCase()==='c'&&$('close-session')&&!e.target?.closest?.('input,textarea,select,[contenteditable]')){e.preventDefault();openSessionClose();return;}
      if(grid&&e.key==='F10'){e.preventDefault();showHistory();return;}
      if(grid&&paymentButtons.length&&/^F[2-6]$/.test(e.key)){
        e.preventDefault();paymentButtons[Number(e.key.slice(1))-2].click();return;
      }
      if(e.key==='/'&&!e.defaultPrevented&&!search.disabled) {
        const editor=e.target?.dataset.kbEdit;
        if(editor || !e.target?.closest?.('input,textarea,select,[contenteditable]')) {
          e.preventDefault();
          if(!editor||commitEdit(e.target))search.focus();
          return;
        }
      }
    }
    if(e.repeat||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||editable(e)||root.querySelector('dialog[open]'))return;
    if(e.key==='Shift')shiftAlone=true;
    if(e.key==='F7'&&!$('draft')?.disabled){e.preventDefault();$('draft')?.click();}
    if(e.key===' '&&!e.shiftKey&&!$('bill')?.disabled){e.preventDefault();$('bill')?.click();}
  }
  document.addEventListener('keydown',shortcut);document.addEventListener('keyup',shortcut);
  const snapshot=JSON.parse(cfg.draftreceipt||'[]');
  for(const item of JSON.parse(cfg.draftload||'[]')){
    const saved=snapshot.find(row=>row.productId===item.productId);
    cart.set(item.productId,{id:item.productId,name:item.productName,code:saved?.code||item.productId,price:Number(saved?.rate)||0,qty:Number(item.quantity),
      manualRate:saved?.manualPrice==='Y'?Number(saved.rate):undefined});
  }
  if(draftId){$('badge').textContent='Editing Held Order';$('instr').value=cfg.draftinstr||'';}
  updateHeader();setType(orderType);paintTax();renderCustomer();quote();
  if($('send')) {
    const keepSessionOpen=()=>{
      if(!root.isConnected) {
        clearInterval(heartbeat);
        window.removeEventListener('focus',keepSessionOpen);
        return;
      }
      if(sessionLost)return;
      request('touchSession',{}).then(({displayEnabled})=>{
        if(typeof displayEnabled!=='boolean'||String(displayEnabled)===cfg.displayEnabled)return;
        cfg.displayEnabled=String(displayEnabled);
        $('display-message').hidden=displayEnabled;
        controls();
      }).catch(()=>{});
    };
    const heartbeat=setInterval(keepSessionOpen,60000);
    window.addEventListener('focus',keepSessionOpen);
    keepSessionOpen();
  }
})();
