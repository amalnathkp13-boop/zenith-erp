/* KOT entry uses the POS catalogue, checkout services and kitchen print pipeline. */
(function () {
  'use strict';
  const root=document.getElementById('kb-wrap');
  if (!root || root.dataset.ready) return;
  root.dataset.ready='true';
  const $=id=>root.querySelector('#kb-'+id);
  const search=$('search'), suggestions=$('suggestions'), cart=new Map();
  const stats=$('stats'), summaryStack=stats.parentElement, checkout=root.querySelector('.kb-bottom');
  const modesMenu=root.querySelector('.kg-modes');
  const modeOptions=modesMenu.querySelectorAll('[data-kb-view]');
  const salesModeOptions=modesMenu.querySelectorAll('[data-kb-sales-mode]');
  const paymentButtons=Array.from(root.querySelectorAll('[data-kb-payment]'));
  const cartRows=$('cart'), editError=$('edit-error');
  const cfg=$('data').dataset;
  const tableLabels=JSON.parse($('table').dataset.labels||'{}');
  const deviceDrafts=cfg.kotModule==='kot'&&window.KotOfflineDrafts?.createStore(cfg.org,cfg.terminal,cfg.user);
  const device=deviceDrafts&&window.KotOffline?.createWorkspace(cfg.org,cfg.terminal,cfg.user);
  let workspace, catalogue, warming, syncing, localReceipt, offlineQuote, workspaceError, pendingSales=false;
  let localOrderId='', draftRevision=cfg.draftrevision||'';
  let claimingOrder, releaseOrder, lockRetry, catalogRead;
  const lockName='zenith-kot-cart:'+JSON.stringify([cfg.org,cfg.terminal,cfg.user,cfg.session]);
  const syncingHeld=new Set();
  const needsLocalOrder=()=>disconnected()||!!localOrderId;
  let transportDown=false, transportProbe, reconnectTimer;
  const disconnected=()=>cfg.kotModule==='kot'&&(!navigator.onLine||transportDown);
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
  let browsePage, pendingLookup, searchMessage='';
  let historyVersion=0, loadedHistoryVersion=$('history-rows').hasAttribute('data-kb-history-loaded')?0:-1, historyLoading=false;
  let grid=false, pickedMatch=false, categoryId='';
  let customer=JSON.parse(cfg.draftcustomer||'{}'), custVersion=0, custTimer, custAbort;
  let invalidEdit, pendingTender, sessionLost=false, completedKotId='', historyPrintRow=null;
  let historyTender, paymentAmount;
  let unconfirmedOrder=false;
  const signInMessage='Sign in again to continue billing.';
  const unconfirmedMessage='The last order submission could not be confirmed. Check Order History after reconnecting before saving it again.';
  if(cfg.draftmode && Array.from($('mode').options).some(o=>o.value===cfg.draftmode)) salesModeId=$('mode').value=cfg.draftmode;
  function paintSalesMode() {
    for(const option of salesModeOptions)option.setAttribute('aria-pressed',String(option.dataset.kbSalesMode===salesModeId));
  }
  paintSalesMode();
  if(cfg.draftwaiter) $('waiter').value=cfg.draftwaiter;
  $('table').value=cfg.drafttable||cfg.selectedTable||'';

  function postRequest(path,action,data,signal) {
    return fetch(path+'/'+action,{method:'POST',credentials:'same-origin',signal,
      body:new URLSearchParams({...data,sessionId:cfg.session,moquiSessionToken:token()})});
  }
  const transportError=error=>error.name==='TypeError'||error.name==='TimeoutError';
  function probeConnection() {
    if(!transportProbe)transportProbe=postRequest(base,'touchSession',{},AbortSignal.timeout?.(2500))
      .then(()=>true,()=>false).finally(()=>{transportProbe=null;});
    return transportProbe;
  }
  async function request(action,data,signal,path=base) {
    if(sessionLost)throw Error(signInMessage);
    const changesOrder=deviceDrafts&&(action==='checkoutKot'||action==='createKot'||(action==='saveDraft'&&!data.offlineDraftId));
    let response;
    try {
      response=await postRequest(path,action,data,signal??AbortSignal.timeout?.(15000));
    } catch (error) {
      if(changesOrder)unconfirmedOrder=true;
      if(catalogue&&transportError(error)&&!transportDown) {
        const down=!navigator.onLine||action==='touchSession'||!await probeConnection();
        if(down&&!transportDown&&root.isConnected) {
          transportDown=true;
          connectionChanged();
        }
      }
      if(changesOrder)throw Error(unconfirmedMessage);
      throw error;
    }
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
    // Moqui sends explicit validation rejections as HTTP 500 JSON.
    if(changesOrder&&result?.success!==false&&(response.status>=500||!result)) {
      unconfirmedOrder=true;
      throw Error(unconfirmedMessage);
    }
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
      if(!response.ok||!freshToken||fresh?.session!==cfg.session||fresh.user!==cfg.user||fresh.org!==cfg.org||fresh.terminal!==cfg.terminal||
          page.getElementById('kb-search')?.disabled!==search.disabled) {
        $('session-message').textContent='Sign in with the same account and shop, then try Resume billing again.';
        return;
      }
      $('token').value=freshToken;
      cfg.displayEnabled=fresh.displayEnabled;
      sessionLost=false;
      browsePage=null;
      $('session-notice').hidden=true;
      search.focus();lookup();quote();
      warmWorkspace();syncDeviceOrders();
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
  const orderData=()=>({orderType,taxOn,salesModeId,tableId:orderType==='Dine In'?$('table').value:'',waiterId:$('waiter').value,notes:$('instr').value,customerPartyId:customer.id||'',
    itemsJson:JSON.stringify(Array.from(cart.values(),it=>({productId:it.id,quantity:it.qty,
      ...(it.manualRate==null?{}:{manualPrice:'Y',unitPrice:it.manualRate})})))});
  function setType(value) {
    orderType=value;
    for(const button of root.querySelectorAll('[data-ot]')) {
      const active=button.dataset.ot===value;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',active);
    }
    $('list-type').textContent=orderType;
  }
  function paintTax() {
    const on=taxOn==='Y',b=$('tax-toggle');
    b.textContent=on?'Tax: ON':'Tax: OFF';b.classList.toggle('is-on',on);b.setAttribute('aria-checked',on);
  }
  function controls() {
    const online=!disconnected();
    const available=online||!!catalogue;
    const hasQuote=!busy&&!sessionLost&&!unconfirmedOrder&&available&&cart.size>0&&total!==null&&editError.hidden;
    const pendingPrice=Array.from(cart.values()).some(item=>item.pricePending);
    const canPay=hasQuote&&!pendingPrice;
    $('display-message').textContent=cfg.displayEnabled==='true'?'Kitchen Display enabled.':'Kitchen Display disabled. Use printed KOTs.';
    for(const button of paymentButtons) {
      button.disabled=busy||sessionLost||unconfirmedOrder||!available||!cart.size;
      button.setAttribute('aria-disabled',String(!canPay));
    }
    $('clear').disabled=busy||!cart.size;
    const closeSession=$('close-session');
    if(closeSession) {
      closeSession.disabled=busy||sessionLost||!online||pendingSales;
      closeSession.title=pendingSales?'Wait for pending KOT orders to sync before closing the session.':'';
    }
    if($('draft')) $('draft').disabled=!hasQuote;
    if($('bill')) $('bill').disabled=!canPay;
    if($('send')) {
      const displayDisabled=cfg.displayEnabled==='false';
      root.classList.toggle('kb-display-disabled',displayDisabled);
      $('send').style.display=displayDisabled?'none':'';
      $('send').disabled=busy||sessionLost||unconfirmedOrder||!available||!cart.size||displayDisabled||!editError.hidden||pendingPrice||
        (needsLocalOrder()&&!canPay);
      $('send').title=displayDisabled?'Kitchen Display is disabled for this shop. Use KOT printing.':'Press Shift by itself';
    }
  }
  function resetOrder() {
    unconfirmedOrder=false;
    cart.clear();
    $('table').value=cfg.selectedTable||'';
    browsePage=null;
    setEditError('');
    draftId='';draftRevision='';savedFingerprint='';customer={};
    if(localOrderId) {
      try { clearStoredOrder(); }
      catch { $('order-status').textContent='The browser could not clear its recovered order. Check History before resuming it.'; }
      localOrderId='';
    }
    $('badge').textContent='New KOT';$('instr').value='';
    renderCustomer();
    quote();
  }
  function updatePendingSales() {
    if(!device)return;
    try { pendingSales=device.queue().some(row=>row.sale.sessionId===cfg.session); }
    catch { pendingSales=true; }
  }
  function applyWorkspace(value) {
    if(value?.sessionId!==cfg.session||value.organizationPartyId!==cfg.org||value.terminalId!==cfg.terminal||
        value.userId!==cfg.user||value.version!==2)return;
    workspace=value;
    catalogue=KotOffline.indexWorkspace(value);
    root.dataset.offlineReady='true';
  }
  function warmWorkspace() {
    if(!device||search.disabled||warming||disconnected()||sessionLost)return;
    warming=request('exportOfflineWorkspace',{},AbortSignal.timeout?.(15000)).then(async ({workspace:value})=>{
      if(!root.isConnected)return;
      await device.saveCatalog(value);
      applyWorkspace(value);
      if(disconnected()){quote(false);lookup();}
    }).catch(error=>{
      workspaceError=error.message;
      if(disconnected())quote(false);
    }).finally(()=>{warming=null;});
  }
  function requireOfflineOwner() {
    if(releaseOrder)return;
    throw Error(navigator.locks?'This KOT session is open in another tab. Close it there to continue offline here.'
      :'Offline KOT billing requires a browser that can lock the session to one tab.');
  }
  function clearStoredOrder() {
    if(releaseOrder&&device.readOrder(cfg.session)?.localOrderId===localOrderId)device.removeOrder(cfg.session);
  }
  function rememberOrder() {
    if(!device||!needsLocalOrder()||!cart.size||unconfirmedOrder)return;
    requireOfflineOwner();
    const saved=device.readOrder(cfg.session);
    if(saved&&saved.localOrderId!==localOrderId)throw Error('Another unsent order is saved on this counter. Reload to recover it.');
    localOrderId||=crypto.randomUUID();
    device.saveOrder(cfg.session,{...orderData(),localOrderId,draftId,draftRevision,customer});
  }
  function recoverActiveOrder() {
    if(!releaseOrder||!catalogRead||draftId||cart.size)return false;
    const order=device.readOrder(cfg.session);
    if(!order?.localOrderId)return false;
    if(device.queue().some(row=>row.sale.offlineId===order.localOrderId))device.removeOrder(cfg.session);
    else {restoreOrder(order);return true;}
    return false;
  }
  function releaseOfflineOrder() {
    clearTimeout(lockRetry);
    releaseOrder?.();
    releaseOrder=null;
  }
  function claimOfflineOrder() {
    if(!navigator.locks||claimingOrder||releaseOrder||!root.isConnected)return;
    claimingOrder=true;
    navigator.locks.request(lockName,{ifAvailable:true},lock=>{
      if(!lock||!root.isConnected){
        if(root.isConnected&&disconnected())lockRetry=setTimeout(claimOfflineOrder,1000);
        return;
      }
      return new Promise(resolve=>{
        releaseOrder=resolve;
        try {
          if(!recoverActiveOrder()&&disconnected())quote(false);
          syncDeviceOrders();
        }catch(error){$('order-status').textContent=error.message;}
      });
    }).catch(error=>{$('order-status').textContent=error.message;}).finally(()=>{claimingOrder=false;});
  }
  function restoreOrder(order) {
    if(!Array.from($('mode').options).some(option=>option.value===order.salesModeId))
      throw Error('The saved sales mode is no longer offered on this counter.');
    setType(order.orderType);
    taxOn=order.taxOn;paintTax();
    $('table').value=order.tableId||'';
    $('waiter').value=order.waiterId||'';
    $('instr').value=order.notes||'';
    salesModeId=$('mode').value=order.salesModeId;
    paintSalesMode();
    draftId=order.draftId||'';
    draftRevision=order.draftRevision||'';
    localOrderId=order.localOrderId||crypto.randomUUID();
    savedFingerprint='';
    const cachedCustomer=workspace?.customers.find(person=>person.partyId===order.customerPartyId);
    customer=order.customer||(cachedCustomer?{id:cachedCustomer.partyId,name:cachedCustomer.name,phone:cachedCustomer.phone}
      :order.customerPartyId?{id:order.customerPartyId}:{});
    cart.clear();setEditError('');
    for(const line of JSON.parse(order.itemsJson)) {
      const product=catalogue?.products.get(line.productId), manualRate=line.manualPrice==='Y'?Number(line.unitPrice):undefined;
      cart.set(line.productId,{id:line.productId,name:product?.productName||line.productId,code:product?.barcode||line.productId,
        qty:Number(line.quantity),price:manualRate??Number(product?.prices?.[salesModeId]?.price||0),manualRate});
    }
    $('badge').textContent='Editing Held Order';
    renderCustomer();browsePage=null;quote();lookup();
  }
  async function syncDeviceOrders() {
    if(!device||!releaseOrder||syncing||disconnected()||sessionLost||!root.isConnected)return;
    syncing=true;
    const run=async()=>{
      let confirmed=false;
      try {
        const orders=device.queue().filter(row=>row.sale.sessionId===cfg.session);
        for(const row of orders) {
          if(disconnected()||sessionLost||!root.isConnected)break;
          const {sale}=row;
          try {
            const result=await request('syncOfflineSale',{saleJson:JSON.stringify(sale)},AbortSignal.timeout?.(20000));
            if(result.offlineId!==sale.offlineId||!result.kotId)throw Error('The server did not confirm this KOT order.');
            if(sale.operation==='send') {
              if(historyTender?.ticket?.sale.offlineId===sale.offlineId)historyTender.kotId=result.kotId;
              const payment=orders.find(order=>order.sale.sourceOfflineId===sale.offlineId)||
                device.queue().find(order=>order.sale.sourceOfflineId===sale.offlineId);
              if(payment) {
                payment.sale.kotId=result.kotId;
                device.enqueue(payment);
              }
            }
            const order=device.readOrder(cfg.session);
            if(order?.localOrderId===sale.offlineId)device.removeOrder(cfg.session);
            device.removeSale(sale.offlineId);
            confirmed=true;
          }catch(error) {
            device.enqueue({...row,error:error.message});
            if(disconnected()||sessionLost||['TypeError','TimeoutError','AbortError'].includes(error.name))break;
          }
        }
        if(!disconnected()&&!sessionLost&&!busy&&root.isConnected) {
          for(const draft of deviceDrafts.list()) {
            if(disconnected()||sessionLost||busy||!root.isConnected)break;
            if(draft.order.draftId||(draft.order.sessionId&&draft.order.sessionId!==cfg.session)||
                draft.order.localOrderId===localOrderId)continue;
            const id=draft.id, identity={offlineDraftId:id,offlineOrganizationId:cfg.org,offlineTerminalId:cfg.terminal,offlineUserId:cfg.user};
            syncingHeld.add(id);
            try {
              const saved=await request('saveDraft',{...draft.order,...identity,wantJson:'Y'},AbortSignal.timeout?.(12000));
              const receipt=await request('confirmOfflineDraft',identity,AbortSignal.timeout?.(12000));
              if(saved.offlineDraftId!==id||receipt.offlineDraftId!==id||!receipt.kotId||receipt.kotId!==saved.kotId)
                throw Error('The server did not confirm the held order.');
              deviceDrafts.remove(id);
              confirmed=true;
            } catch(error) {
              if(root.isConnected)$('order-status').textContent='Held order remains on this device. '+error.message;
              break;
            } finally {syncingHeld.delete(id);}
          }
        }
      } catch(error) {
        if(root.isConnected)$('order-status').textContent=error.message;
      } finally {
        if(root.isConnected) {
          updatePendingSales();controls();
          if(confirmed||history.open)refreshOpenHistory();
        }
      }
    };
    try {
      if(navigator.locks)await navigator.locks.request('zenith-kot-sync:'+JSON.stringify([cfg.org,cfg.terminal,cfg.user]),run);
      else await run();
    }finally{syncing=false;}
  }
  function renderCustomer() {
    const name=customer.name||'Walk-in Customer';
    $('customer-name').textContent=name;
    const headerName=$('header-customer-name');
    if(headerName)headerName.textContent=name;
    $('list-phone').textContent=customer.phone||'—';
  }
  function openCustomerDialog() {
    const dlg=$('customer-dialog');if(!dlg)return;
    $('customer-error').textContent='';$('customer-search').value='';
    $('customer-tax').checked=taxOn==='Y';
    $('customer-results').replaceChildren();dlg.showModal();
    searchCustomers('');$('customer-search').focus();
  }
  function offlineCustomers(term) {
    const query=KotOffline.normalize(term);
    return (workspace?.customers||[]).filter(c=>
      !query||KotOffline.normalize([c.name,c.phone,c.partyId].join(' ')).includes(query))
      .slice(0,30).map(c=>({...c,id:c.partyId}));
  }
  async function searchCustomers(term) {
    const version=++custVersion;
    custAbort?.abort();custAbort=new AbortController();
    $('customer-error').textContent='';
    try{
      const data=disconnected()?{customers:offlineCustomers(term)}:await request('searchKotCustomers',{term},custAbort.signal);
      if(version!==custVersion||!root.isConnected)return;
      renderCustomerResults(data.customers||[]);
    }catch(e){if(e.name!=='AbortError'&&version===custVersion)$('customer-error').textContent=e.message;}
  }
  function renderCustomerResults(list) {
    const box=$('customer-results');if(!box)return;
    if(!list.length){box.innerHTML='<p class="kb-search-message" role="status">No matching customers.</p>';return;}
    box.innerHTML=list.map(c=>'<button type="button" class="kb-suggestion" data-cust-id="'+esc(c.id)+'" data-cust-name="'+esc(c.name)+'" data-cust-phone="'+esc(c.phone||'')+'" data-cust-credit-days="'+esc(c.creditDays??'')+'"><span><strong>'+esc(c.name)+'</strong><small>'+esc(c.phone||c.id)+'</small></span></button>').join('');
  }
  function selectCustomer(el) {
    customer={id:el.dataset.custId,name:el.dataset.custName,phone:el.dataset.custPhone||''};
    if(grid){
      taxOn=$('customer-tax').checked?'Y':'N';
      paintTax();
    }
    $('customer-dialog')?.close();renderCustomer();quote();
    customer.creditDays=el.dataset.custCreditDays||'';
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
  function applyQuote(receipt) {
    for(const line of receipt.items){
      const item=cart.get(line.productId);
      if(item){item.price=Number(line.rate);item.amount=Number(line.total);item.tax=Number(line.tax??0);item.code=line.code;item.name=line.name;item.pricePending=line.pricePending===true;}
    }
    const pending=receipt.items.find(line=>line.pricePending);
    $('quote-error').textContent=pending?'Enter a price above ₹0 for '+pending.name+' before payment.':'';
    rows();total=Number(receipt.summary.total);controls();
    $('subtotal').textContent=money.format(receipt.summary.subtotal);
    $('grand').textContent=money.format(total);
    listTotals(receipt.summary);
    $('tax-rows').innerHTML=(receipt.summary.taxBreakdown||[]).map(t=>'<div class="kb-sum__row"><span>'+esc(t.name)+'</span><span>'+money.format(t.amount)+'</span></div>').join('');
    if(pendingTender&&pendingTender===document.activeElement)openPayment(pendingTender.dataset.kbPayment);
    pendingTender=null;
  }
  function quote(refreshRows=true) {
    clearTimeout(quoteTimer); const version=++quoteVersion;
    pendingTender=null;offlineQuote=null;
    for(const item of cart.values())item.tax=null;
    total=null;controls();if(refreshRows)rows();
    listTotals(cart.size?null:{});
    $('quote-error').textContent='';
    $('tax-rows').replaceChildren();
    $('grand').textContent=cart.size?(sessionLost?'Sign in to price':'Calculating…'):money.format(0);
    if(!cart.size){
      $('subtotal').textContent=money.format(0);
      if(localOrderId) {
        try { clearStoredOrder();localOrderId=''; }
        catch(error){$('quote-error').textContent=error.message;}
      }
      return;
    }
    $('subtotal').textContent='—';
    if(sessionLost)return;
    const showFailure=error=>{
      pendingTender=null;
      $('grand').textContent='Unavailable';
      $('quote-error').textContent=error.message;
    };
    if(needsLocalOrder()){
      try {
        rememberOrder();
        if(!catalogue)throw Error(workspaceError?'Offline catalogue unavailable. Reconnect to refresh it.':'Reconnect briefly to load this counter’s offline catalogue.');
        offlineQuote=KotOffline.quote(catalogue,cart.values(),salesModeId,taxOn==='Y',workspace.store);
        applyQuote(offlineQuote);
      }catch(error){showFailure(error);}
      return;
    }
    quoteTimer=setTimeout(async()=>{
      try {
        const {receipt}=await request('cartReceipt',orderData());
        if(version===quoteVersion&&root.isConnected)applyQuote(receipt);
      }catch(error){
        if(version===quoteVersion&&root.isConnected)showFailure(error);
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
    const toSearch=field==='qty' && (e.key==='ArrowDown'||e.key==='Enter');
    if(!toQty&&!toRate&&!toSearch)return;
    e.preventDefault();
    if(!commitEdit(input))return;
    if(toSearch)search.focus();
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
  function renderMatches(message=searchMessage) {
    searchMessage=message;
    const term=search.value.trim();
    const showResults=grid||!!term;
    suggestions.hidden=!showResults;
    search.setAttribute('aria-expanded',String(showResults));
    suggestions.classList.toggle('kb-results-grid',grid);
    suggestions.classList.toggle('is-searching',!!term);
    for(const button of root.querySelectorAll('[data-kb-category]')){
      button.setAttribute('aria-pressed',String(button.dataset.kbCategory===(term?'':categoryId)));
    }
    if(!showResults){suggestions.replaceChildren();return;}
    suggestions.innerHTML=(message?'<p class="kb-search-message" role="status">'+esc(message)+'</p>':'')+
      results.map((p,i)=>{
        const price=p.pricePending?'₹0 · Enter price':p.price==null?(p.reason||'No price for this mode'):(grid?cardMoney:money).format(p.price);
        return '<button type="button" class="kb-suggestion'+(i===selected&&(!grid||term||pickedMatch)?' is-active':'')+'" data-result="'+i+'"'+(search.disabled?' disabled':'')+'><span><strong>'+esc(p.name)+'</strong><small>'+esc(p.code)+(p.stock==null?'':' · Stock: '+esc(p.stock))+'</small></span><span'+(p.price==null||p.pricePending?' class="kg-unpriced" title="'+esc(price)+'"':'')+'>'+esc(price)+'</span></button>';
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
  function cancelLookup() {
    clearTimeout(searchTimer);
    searchVersion++;
    searchAbort?.abort();
    pendingLookup=null;
  }
  function resetMatches() {
    results=[];selected=0;pickedMatch=false;offset=0;hasMore=false;exactId=null;ambiguous=false;
  }
  async function lookup(append=false) {
    const value=search.value, searching=!!value.trim();
    const category=searching?'':categoryId;
    const offline=disconnected();
    const browseKey=JSON.stringify([salesModeId,category,offline]);
    const pageOffset=append?offset:0;
    const key=JSON.stringify([browseKey,value,pageOffset]);
    if(pendingLookup?.key===key)return pendingLookup.promise;
    cancelLookup();
    if(!append)resetMatches();
    if(!grid&&!searching){renderMatches('');return false;}
    if(!append&&!searching&&browsePage?.key===browseKey&&Date.now()-browsePage.loadedAt<30000){
      ({results,offset,hasMore}=browsePage);
      renderMatches(results.length?'':'No products available.');
      return true;
    }
    if(!append)renderMatches(searching?'Searching…':'Loading products…');
    const version=searchVersion;
    searchAbort=new AbortController();
    const cachedMatches=()=>{
      if(!catalogue)throw Error('Reconnect briefly to load this counter’s offline catalogue.');
      return KotOffline.lookup(catalogue,value,salesModeId,category,pageOffset);
    };
    const fetchMatches=offline?Promise.resolve().then(cachedMatches)
      :request('searchMenu',{term:value,salesModeId,offset:pageOffset,categoryId:category,stockSessionId:cfg.stockSession||''},searchAbort.signal)
        .catch(error=>{if(catalogue&&transportError(error))return cachedMatches();throw error;});
    const promise=fetchMatches
      .then(data=>{
        if(version!==searchVersion||!root.isConnected||search.value!==value)return false;
        if(append){
          const previousIds=new Set(results.map(product=>product.id));
          results=results.concat(data.products.filter(product=>!previousIds.has(product.id)));
        }else{
          results=data.products;
          exactId=data.exactId;ambiguous=data.ambiguous;
          if(exactId)selected=Math.max(0,results.findIndex(product=>product.id===exactId));
        }
        offset=pageOffset+40;hasMore=data.hasMore;
        if(!searching)browsePage={key:browseKey,loadedAt:Date.now(),results,offset,hasMore};
        const empty=searching?'No products match your search.':'No products available.';
        renderMatches(ambiguous?'Multiple products use this code. Choose a product from the results.':results.length?'':empty);
        return true;
      }).catch(error=>{
        if(version===searchVersion&&error.name!=='AbortError')renderMatches(error.message);
        return false;
      }).finally(()=>{if(version===searchVersion)pendingLookup=null;});
    pendingLookup={key,promise};
    return promise;
  }
  function clearSearch() {
    clearTimeout(searchTimer);
    $('match-status').textContent='';
    if(grid&&!search.value){
      selected=0;pickedMatch=false;suggestions.querySelector('.is-active')?.classList.remove('is-active');return;
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
    (grid?checkout:summaryStack).append(stats);
    if(!grid||search.value.trim())renderMatches();
    else lookup();
  }
  function updateHeader() {
    $('online').textContent=disconnected()?'Offline':'Online';
    $('online').classList.toggle('is-offline',disconnected());
    const now=new Date();
    $('clock').dateTime=now.toISOString();
    $('clock').textContent=now.toLocaleTimeString('en-IN');
  }
  let headerTimer=setInterval(()=>{
    if(!root.isConnected){
      clearInterval(headerTimer);releaseOfflineOrder();
      window.removeEventListener('pagehide',releaseOfflineOrder);
      window.removeEventListener('pageshow',claimOfflineOrder);
    } else updateHeader();
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
    if(byKeyboard||item.pricePending)focusEditor(editorFor(item.id,'rate'));
    else search.focus({preventScroll:grid});
  }
  search.addEventListener('input',e=>{
    cancelLookup();
    resetMatches();
    $('match-status').textContent='';
    renderMatches(search.value.trim()?'Searching…':'Loading products…');
    if(e.isComposing)return;
    if(!search.value.trim())lookup();
    else searchTimer=setTimeout(()=>lookup(),85);
  });
  search.addEventListener('compositionend',()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>lookup(),85);
  });
  search.addEventListener('keydown',async e=>{
    if(e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return;
    const cash=paymentButtons[0];
    if(e.key==='ArrowDown'&&!search.value.trim()&&cash&&!cash.disabled){
      e.preventDefault();
      if(!e.repeat)cash.focus();
      return;
    }
    if(moveMatch(e.key,false)){e.preventDefault();return;}
    if(e.repeat)return;
    if(e.key==='Escape'){clearSearch();return;}
    if(e.key===' '&&!search.value&&!$('bill')?.disabled&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.shiftKey){e.preventDefault();openPayment();return;}
    if(e.key!=='Enter'||(!search.value.trim()&&!(grid&&pickedMatch)))return;
    e.preventDefault();clearTimeout(searchTimer);
    const submitted=search.value;
    if(!results.length&&!(await lookup()))return;
    if(search.value!==submitted)return;
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

  function openPayment(method='Cash', order=null) {
    if(!$('bill')||busy||sessionLost||$('payment').open||(!order&&$('bill').disabled))return;
    $('payment-form').reset();
    historyTender=order;
    paymentAmount=order?.total??total;
    $('payment-total').textContent='Order total: '+money.format(paymentAmount);
    $('payment-method').value=method;
    $('payment').showModal();
    tenderFields(method);
  }
  function tenderFields(method) {
    const dialog=$('payment'), cashSlot=$('cash-slot'), panel=$('other-payment');
    $('payment-error').textContent='';
    $('payment-heading').hidden=$('payment-picker').hidden=Boolean(method);
    $('payment-continue').disabled=!method;
    dialog.classList.toggle('kb-cash-dialog',method==='Cash');
    dialog.dataset.tender=method;
    dialog.setAttribute('aria-labelledby',{
      Cash:'pos-cash-title',Card:'pos-digital-title',UPI:'pos-digital-title',
      Split:'pos-split-title',Credit:'pos-credit-title'
    }[method]||'kb-payment-title');
    cashSlot.replaceChildren();
    panel.replaceChildren();
    if(method==='Cash'){
      cashSlot.innerHTML=PosTillDialogs.cashMarkup(paymentAmount,true);
      const input=cashSlot.querySelector('.pos-cash-input');
      input.id='kb-cash';cashSlot.querySelector('label').htmlFor=input.id;
      input.addEventListener('input',()=>PosTillDialogs.updateCash(cashSlot,paymentAmount));
      input.focus();
    }else if(method==='Card'||method==='UPI'){
      panel.innerHTML=PosTillDialogs.digitalMarkup(method,paymentAmount);
      panel.querySelector('#posPayConfCancel').id='kb-payment-close';
      const confirm=panel.querySelector('#posPayConfOk');
      confirm.parentElement.insertAdjacentHTML('beforebegin',
        '<label>Reference number (optional)<input name="referenceNumber" type="text" maxlength="80"></label>');
      if(method==='Card')confirm.type='submit';
      confirm.focus();
    }else if(method==='Split'){
      panel.innerHTML=PosTillDialogs.splitMarkup(paymentAmount);
      panel.querySelector('.pos-split-cancel').id='kb-payment-close';
      for(const input of panel.querySelectorAll('input[type=number]')){
        input.step='0.01';
        input.inputMode='decimal';
      }
      for(const input of panel.querySelectorAll('input[type=text]'))input.maxLength=80;
      panel.querySelector('[name=cashAmount]').focus();
    }else if(method==='Credit'){
      panel.innerHTML=PosTillDialogs.creditMarkup();
      setupCreditTender(panel);
    }else{
      $('payment-method').focus();
    }
  }
  function showUpiReceiptChoices() {
    const panel=$('other-payment');
    const reference=panel.querySelector('[name=referenceNumber]');
    panel.innerHTML='<div class="kb-upi-save">'+PosTillDialogs.upiReceiptMarkup(paymentAmount)+'</div>';
    reference.type='hidden';
    panel.append(reference);
    $('payment').setAttribute('aria-labelledby','pos-upi-title');
    const choices=panel.querySelectorAll('button');
    for(const choice of choices)choice.type='submit';
    choices[0].focus();
  }
  function setupCreditTender(panel) {
    const field=id=>panel.querySelector('#credit-'+id);
    const name=field('name'), phone=field('phone'), add=field('add-customer'), upfront=field('upfront');
    const days=field('days'), results=field('cust-results'), confirm=field('confirm');
    const attached=historyTender?historyTender.customer:customer;
    const chosen=Object.assign(document.createElement('input'),{type:'hidden',name:'creditCustomerPartyId'});
    panel.append(chosen);
    Object.assign(name,{name:'customerName',required:true,maxLength:80,value:attached?.id?attached.name:''});
    Object.assign(phone,{name:'customerPhone',required:true,maxLength:20,value:attached?.id?attached.phone||'':''});
    Object.assign(upfront,{name:'upfrontAmount',required:true,max:String(paymentAmount)});
    field('upfront-method').name='upfrontMethod';
    days.name='creditDays';
    days.value=attached?.creditDays??'';
    field('terms-reason').name='termsReason';
    field('cancel').id='kb-payment-close';
    confirm.type='submit';
    name.readOnly=add.disabled=Boolean(attached?.id);
    phone.readOnly=Boolean(attached?.id&&phone.value);
    let searchTimer, searchAbort;
    const hideResults=()=>{
      clearTimeout(searchTimer);
      searchAbort?.abort();
      results.replaceChildren();
      results.style.display='none';
    };
    const update=()=>{
      const value=upfront.valueAsNumber, enteredDays=days.valueAsNumber;
      const {creditDate,creditZone}=$('payment-form').dataset;
      const date=new Date(creditDate+'T00:00:00Z');
      field('due-preview').textContent=upfront.validity.valid
        ? 'Balance after this payment: '+money.format(paymentAmount-value)
        : 'Enter an amount from ₹0 to the remaining bill balance.';
      if(days.validity.valid&&Number.isInteger(enteredDays)&&Number.isFinite(date.valueOf())){
        date.setUTCDate(date.getUTCDate()+enteredDays);
        field('date-preview').textContent='Due through '+date.toISOString().slice(0,10)+' ('+creditZone+').';
      }else field('date-preview').textContent='Choose the customer’s calendar-day term before completing.';
    };
    const pick=match=>{
      chosen.value=match.id;
      name.value=match.name;
      phone.value=match.phone||'';
      days.value=match.creditDays??'';
      hideResults();
      update();
      (phone.value?upfront:phone).focus();
    };
    const searchSaved=async term=>{
      const controller=new AbortController();
      searchAbort=controller;
      try{
        const {customers}=disconnected()?{customers:offlineCustomers(term)}:
          await request('searchKotCustomers',{term},controller.signal);
        if(controller.signal.aborted||!name.isConnected||!$('payment').open)return;
        for(const match of customers){
          const button=document.createElement('button');
          button.type='button';
          button.className='kb-credit-customer';
          button.textContent=match.name+(match.phone?' · '+match.phone:'');
          button.addEventListener('click',()=>pick(match));
          results.append(button);
        }
        if(!customers.length)results.textContent='No saved customer found. Use Add customer below.';
        results.style.display='block';
      }catch(error){
        if(!controller.signal.aborted&&name.isConnected&&$('payment').open)$('payment-error').textContent=error.message;
      }
    };
    name.addEventListener('input',()=>{
      chosen.value='';
      days.value='';
      hideResults();
      update();
      const term=name.value.trim();
      if(term)searchTimer=setTimeout(()=>searchSaved(term),180);
    });
    phone.addEventListener('input',()=>{
      if(chosen.value)days.value='';
      chosen.value='';
      update();
    });
    add.addEventListener('click',()=>{
      chosen.value='';
      days.value='';
      hideResults();
      update();
      (name.value.trim()?phone:name).focus();
    });
    upfront.addEventListener('input',update);
    days.addEventListener('input',update);
    update();
    (name.readOnly?(phone.readOnly?upfront:phone):name).focus();
  }
  async function openSessionClose() {
    if(!$('close-session')||busy||sessionLost||document.getElementById('posCloseSessionOverlay'))return;
    updatePendingSales();
    if(disconnected()||pendingSales)return;
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
  async function printChoice(kind,row=historyPrintRow) {
    const queued=row?.dataset.kbLocalSale?device?.queue().find(entry=>entry.sale.offlineId===row.dataset.kbLocalSale):row?null:localReceipt;
    const kotId=row?.dataset.kotId||completedKotId;
    if(busy||(!kotId&&!queued))return;
    const chooser=$('print-choice'), errorOutput=chooser.open?$('print-error'):$('history-error');
    errorOutput.textContent='';
    let printWindow, acknowledgement;
    try {
      // Open once per click. Chromium consumes the user gesture on the first popup.
      printWindow=KitchenPrint.open();
      busy=true;controls();
      for(const button of root.querySelectorAll('[data-kb-print]'))button.disabled=true;
      if(kind==='kot'||kind==='both') {
        const record=queued?.receipt||(await request('printRecord',{kotId,kind:'kot'})).record;
        await KitchenPrint.browserPrint(printWindow,KitchenPrint.kotHtml(record),
          kind==='both'?{nextLabel:'Print customer bill'}:{closeAfterPrint:true});
        if(kind==='kot')printWindow=null;
        if(!queued) {
          const recordPrint=request('ackKotPrint',{kotId},AbortSignal.timeout?.(8000));
          if(kind==='both')acknowledgement=recordPrint.then(()=>'',()=>' The kitchen print count could not be updated.');
          else await recordPrint;
        }
      }
      if(kind==='bill'||kind==='both') {
        const record=queued?.receipt||(await request('printRecord',{kotId,kind:row?.dataset.billed==='false'?'orderBill':'bill'})).record;
        await KitchenPrint.customer(printWindow,record,{closeAfterPrint:true});
        printWindow=null;
      }
      const warning=(await acknowledgement)||'';
      if(row) {
        const status=$('history-detail').open?$('history-detail-message'):$('history-print-status');
        status.textContent='Print request opened.'+warning;
      } else if(warning) $('order-status').textContent+=warning;
      if(chooser.open)chooser.close();
    } catch(error) {
      errorOutput.textContent=error.message;
    } finally {
      if(printWindow&&!printWindow.closed)printWindow.close();
      busy=false;controls();
      updatePrintOptions();
    }
  }
  async function holdOrder() {
    busy=true;controls();
    const status=$('order-status');
    try {
      if(needsLocalOrder()){
        requireOfflineOwner();
        if(cart.size>100)throw Error('Hold orders with up to 100 product lines.');
        deviceDrafts.save({...orderData(),sessionId:cfg.session,draftId,draftRevision,customer,localOrderId});
        resetOrder();refreshOpenHistory();
        status.textContent='Order held on this device.';
        syncDeviceOrders();
        return;
      }
      const saved=await request('saveDraft',{...orderData(),existingDraftId:draftId,wantJson:'Y'});
      resetOrder();
      refreshOpenHistory();
      status.textContent='Saved as Draft #'+saved.kotNumber+'.';
    } catch(error) {
      status.textContent=error.message;
    } finally {
      busy=false;controls();
    }
  }
  function enqueueOrder(operation, payment={}, savedOrder) {
    requireOfflineOwner();
    const {paymentMethod,referenceNumber}=payment;
    const source=savedOrder?.ticket.sale;
    const billTotal=source?.total??total;
    const mode=source?.mode??salesModeId;
    let payments=[], change=0;
    const chosen=source?{...source.customer}:{partyId:customer.id||null,name:customer.name||'',phone:customer.phone||''};
    if(operation==='checkout') {
      if(!(billTotal>0))throw Error('Reconnect to confirm an order with no amount due.');
      const rule=workspace?.rules?.find(rule=>rule.mode===mode);
      if(rule?.customer&&!chosen.partyId)throw Error('Select a customer for this sales mode.');
      if(billTotal<Number(rule?.minimum||0))throw Error('This sales mode requires a minimum order of '+money.format(rule.minimum)+'.');
      if(paymentMethod==='Credit') {
        chosen.name||=payment.customerName?.trim();
        chosen.phone||=payment.customerPhone?.trim();
        if(!chosen.name||!chosen.phone)throw Error('Choose a saved customer or enter the customer name and phone.');
        if(!/^\d{10,15}$/.test(chosen.phone.replace(/\D/g,'')))
          throw Error('Enter a valid customer phone number (10 to 15 digits).');
        const upfront=Number(payment.upfrontAmount||0);
        if(!Number.isFinite(upfront)||upfront<0||upfront>billTotal||
            (upfront>0&&!['Cash','Card','UPI'].includes(payment.upfrontMethod)))
          throw Error('Enter a valid upfront payment for this bill.');
        if(upfront>0)payments=[{method:payment.upfrontMethod,amount:upfront}];
      } else if(paymentMethod==='Split') {
        payments=['Cash','Card','UPI'].map(method=>({method,amount:Number(payment[method.toLowerCase()+'Amount']||0)}));
        if(payments.some(({amount})=>!Number.isFinite(amount)||amount<0)||payments.filter(({amount})=>amount>0).length<2||
            KotOffline.roundMoney(payments.reduce((sum,p)=>sum+p.amount,0))!==billTotal)
          throw Error('Enter at least two payments that add up to the bill total.');
        payments=payments.filter(({amount})=>amount>0);
      } else if(paymentMethod==='Cash') {
        payments=[{method:'Cash',amount:Number(payment.cashAmount)}];
        if(!Number.isFinite(payments[0].amount)||payments[0].amount<billTotal)throw Error('Cash received must cover the bill total.');
        change=KotOffline.roundMoney(payments[0].amount-billTotal);
      } else if(paymentMethod==='Card'||paymentMethod==='UPI') payments=[{method:paymentMethod,amount:billTotal}];
      else throw Error('Choose a payment method.');
    }
    const data=source||orderData(), quote=savedOrder?.ticket.receipt??offlineQuote, ts=new Date().toISOString();
    if(quote.items.some(item=>item.pricePending))throw Error('Enter a price above ₹0 for each unpriced product before continuing.');
    if(quote.items.length>100)throw Error('Offline orders can contain up to 100 product lines.');
    const {session,terminal,org,user}=cfg;
    const sale={version:2,operation,offlineId:source?crypto.randomUUID():localOrderId,sessionId:session,terminalId:terminal,
      organizationPartyId:org,userId:user,ts,facilityId:source?.facilityId??workspace.facilityId,
      orderType:data.orderType,tableId:data.tableId,waiterId:data.waiterId,notes:data.notes,
      taxOn:data.taxOn,total:quote.summary.total,taxAmount:quote.summary.tax,paymentMethod,payments,change,referenceNumber,
      ...(paymentMethod==='Split'?{cardRef:payment.cardRef,upiRef:payment.upiRef}:{}),
      ...(paymentMethod==='Credit'?{creditCustomerPartyId:payment.creditCustomerPartyId,
        creditDays:payment.creditDays||null,termsReason:payment.termsReason}:{}),
      customer:chosen,mode,
      items:source?.items??quote.items.map(line=>({productId:line.productId,qty:line.qty,price:line.rate,mode,
        discount:line.percent,manualPrice:line.manualPrice})),
      ...(source?{sourceOfflineId:source.offlineId,kotId:savedOrder.kotId}
        :draftId?{kotId:draftId,sourceRevision:draftRevision}:{})};
    const receipt={...quote,preview:operation==='send',
      store:{...quote.store,showLogo:'N',headerText:'OFFLINE · PENDING SYNC',
        showPaymentDetails:'N'},
      bill:{number:sale.offlineId,date:new Date(ts).toLocaleString('en-IN'),orderType:data.orderType,
        customer:chosen.name||'Walk-In Customer',customerPhone:chosen.phone,
        table:tableLabels[data.tableId]||''},
      items:source?quote.items:quote.items.map(item=>({...item,name:item.printName||item.name})),
      payments,change,isCredit:paymentMethod==='Credit',
      outstanding:paymentMethod==='Credit'?KotOffline.roundMoney(billTotal-(payments[0]?.amount||0)):0,
      notes:data.notes};
    const existing=device.queue().some(({sale:entry})=>entry.offlineId===sale.offlineId||
      (entry.operation==='checkout'&&((sale.sourceOfflineId&&entry.sourceOfflineId===sale.sourceOfflineId)||
        (sale.kotId&&entry.kotId===sale.kotId))));
    if(existing)throw Error('This order is already saved. Find it in History.');
    const row={sale,receipt};
    device.enqueue(row);
    pendingSales=true;
    return row;
  }
  async function pay(e) {
    e.preventDefault();

    const existingOrder=historyTender;
    if(!existingOrder&&unconfirmedOrder)return;
    const confirmedTotal=paymentAmount;
    if(busy||sessionLost||!$('payment-method').value||confirmedTotal===null||(!existingOrder&&total!==confirmedTotal))return;
    const form=e.currentTarget, method=$('payment-method').value, cash=method==='Cash';
    const submit=e.submitter||form.querySelector('[type=submit]');
    if(!submit)return;
    if(cash&&!PosTillDialogs.updateCash($('cash-slot'),confirmedTotal))return;
    if(method==='Credit'){
      const phone=form.elements.customerPhone;
      if(!/^\d{10,15}$/.test(phone.value.replace(/\D/g,''))){
        $('payment-error').textContent='Enter a valid customer phone number (10 to 15 digits).';
        phone.focus();
        return;
      }
    }
    const payment=Object.fromEntries(new FormData(form)), data=orderData(), fingerprint=JSON.stringify(data);
    const saveWithoutPrint=submit.id==='posPaySave';
    const actions=Array.from(form.querySelectorAll('button:enabled'));
    let bill;
    busy=true;controls();actions.forEach(button=>button.disabled=true);$('payment-error').textContent='';
    try{
      if(existingOrder?.ticket||(needsLocalOrder()&&!existingOrder)) {
        if(!existingOrder?.ticket&&!offlineQuote)throw Error('Recheck the offline order before taking payment.');
        const queued=enqueueOrder('checkout',payment,existingOrder);
        bill={billNumber:queued.sale.offlineId,changeAmount:queued.sale.change,local:queued};
      }else {
        if(!existingOrder&&(!draftId||fingerprint!==savedFingerprint)){
          const saved=await request('saveDraft',{...data,existingDraftId:draftId,wantJson:'Y'});
          draftId=saved.kotId;
          draftRevision=saved.sourceRevision||'';
          if(Number(saved.total)!==confirmedTotal){
            savedFingerprint='';
            $('payment').close();quote();
            $('order-status').textContent='The order total changed. Review it before taking payment.';return;
          }
          savedFingerprint=fingerprint;
        }
        bill=await request('checkoutKot',{...payment,kotId:existingOrder?.id||draftId,confirmedTotal});
      }
    }catch(error){
      $('payment-error').textContent=error.message;
    }finally{
      busy=false;controls();actions.forEach(button=>button.disabled=false);
      if(!bill&&$('payment').open&&!sessionLost&&!unconfirmedOrder){
        if(cash)PosTillDialogs.updateCash($('cash-slot'),confirmedTotal);
        if(!submit.disabled)submit.focus();
      }
    }
    if(!bill)return;
    completedKotId=bill.kotId||'';
    localReceipt=bill.local||null;
    refreshOpenHistory();
    browsePage=null;
    $('list-last-bill').textContent=bill.billNumber;
    const headerLastBill=$('header-last-bill'), headerTodayBills=$('header-today-bills');
    if(!bill.local&&headerLastBill&&headerLastBill.textContent!==bill.billNumber){
      headerLastBill.textContent=bill.billNumber;
      if(headerTodayBills)headerTodayBills.textContent=Number(headerTodayBills.textContent)+1;
    }
    $('list-last-amount').textContent=$('list-last-stat').textContent=money.format(confirmedTotal);
    $('payment').close();
    if(!existingOrder)resetOrder();
    const change=Number(bill.changeAmount)>0?' Change given: '+money.format(bill.changeAmount)+'.':'';
    const notice=bill.local?'Bill '+bill.billNumber+' is saved on this device and queued to sync.':'Bill '+bill.billNumber+' is saved.';
    $('order-status').textContent=bill.local?notice+change:'';
    $('print-summary').textContent=notice+change+' Choose a print option.';
    historyPrintRow=null;
    $('print-title').textContent='Payment complete';
    $('print-error').textContent='';
    if(saveWithoutPrint){
      $('order-status').textContent=notice+change;
      if(bill.local)syncDeviceOrders();
      return;
    }
    updatePrintOptions();
    $('print-choice').showModal();
    $('print-choice').querySelector('[data-kb-print="bill"]').focus();
    if(bill.local)syncDeviceOrders();
  }

  const history=$('history'), historyDetail=$('history-detail'), historyEdit=$('history-edit');
  let activeHistoryRow, editingBill, editSearchTimer, editSearchVersion=0, savingBill=false;
  const historyRows=()=>Array.from($('history-rows').children).filter(row=>!row.hidden);
  function selectHistoryRow(row, focus=false){
    activeHistoryRow?.classList.remove('is-current');
    activeHistoryRow=row;
    row?.classList.add('is-current');
    if(focus&&row){
      row.querySelector('[data-kb-history-detail]').focus({preventScroll:true});
      row.scrollIntoView({block:'nearest'});
    }
  }
  function filterHistory(focus=false){
    const host=$('history-rows');
    host.hidden=loadedHistoryVersion!==historyVersion&&!host.querySelector('[data-kb-device-row]');
    if(host.hidden){
      $('history-count').textContent='';
      return;
    }
    const term=$('history-search').value.trim().toLowerCase();
    const status=$('history-status').value, date=$('history-date').value;
    for(const order of $('history-rows').children){
      const matchesStatus=!status||(status==='billed'?order.dataset.billed==='true':order.dataset.kotGroup===status);
      const text=(order.textContent+' '+order.dataset.search).toLowerCase();
      order.hidden=(!order.hasAttribute('data-kb-device-row')&&loadedHistoryVersion!==historyVersion)||
        !matchesStatus||Boolean((date&&order.dataset.orderDate!==date)||(term&&!text.includes(term)));
    }
    const rows=historyRows(), billed=rows.filter(row=>row.dataset.billed==='true');
    const counts=[];
    if(billed.length)counts.push(billed.length+' bill'+(billed.length===1?'':'s'));
    if(rows.length>billed.length)counts.push((rows.length-billed.length)+' KOT'+(rows.length-billed.length===1?'':'s'));
    $('history-count').textContent=counts.length?counts.join(' · ')+' found':'No matching bills or KOTs.';
    selectHistoryRow(rows.includes(activeHistoryRow)?activeHistoryRow:rows[0],focus);
  }
  function renderLocalHistory() {
    if(!device)return;
    const host=$('history-rows');
    host.querySelectorAll('[data-kb-device-row]').forEach(row=>row.remove());
    try {
      const entries=device.queue().filter(row=>row.sale.sessionId===cfg.session);
      const paidTickets=new Set(entries.map(({sale})=>sale.sourceOfflineId).filter(Boolean));
      const records=entries.filter(({sale})=>!paidTickets.has(sale.offlineId)).map(({sale,receipt,error})=>({
        id:sale.offlineId,date:sale.ts,total:sale.total,name:receipt.bill.customer,items:receipt.items.length,
        group:sale.operation==='send'?'active':'billed',label:sale.operation==='send'?'Pending kitchen ticket':'Pending bill',
        note:error?'Needs review: '+error:'Pending sync',
      })).concat(deviceDrafts.list().map(draft=>({id:draft.id,date:draft.savedAt,
        items:draft.lines,group:'draft',name:draft.order.customer?.name,label:'Held order',note:'Saved on this device'})));
      for(const record of records.sort((a,b)=>a.date.localeCompare(b.date))) {
        const date=new Date(record.date), row=document.createElement('article'), held=record.group==='draft';
        row.className='kb-history-row';
        row.dataset.kbDeviceRow='';
        if(held)row.dataset.kbResumeLocal=record.id;
        else row.dataset.kbLocalSale=record.id;
        row.dataset.kotGroup=record.group;
        row.dataset.billed=String(record.group==='billed');
        row.dataset.hasBill=String(!held);
        row.dataset.orderDate=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);
        row.dataset.search=record.name||'Walk-In Customer';
        row.innerHTML='<button type="button" class="kb-history-number" data-kb-history-detail>'+esc(record.label)+'</button>'+
          '<strong class="kb-history-amount">'+(record.total==null?'—':money.format(record.total))+'</strong>'+
          '<span class="kb-history-meta">'+esc(date.toLocaleString())+'</span>'+
          '<span class="kb-history-meta kb-history-info">'+esc(row.dataset.search)+' · '+record.items+' items · '+esc(record.note)+'</span>'+
          (held?'':'<div class="kb-history-row-actions" role="group" aria-label="Print options">'+
            '<button type="button" class="kb-history-button" data-kb-history-print="bill">Bill Print</button>'+
            '<button type="button" class="kb-history-button" data-kb-history-print="kot">KOT Print</button>'+
            (record.group==='active'?'<button type="button" class="kb-history-button kb-history-primary" data-kb-bill-local>Bill Out</button>':'')+'</div>');
        host.prepend(row);
      }
    }catch(error){$('history-error').textContent=error.message;}
  }
  function refreshOpenHistory(){
    historyVersion++;
    if(history.open)showHistory();
  }
  async function showHistory(){
    const opened=!history.open;
    if(opened){
      history.showModal();
      selectHistoryRow(null);
      $('history-print-status').textContent='';
    }
    renderLocalHistory();
    filterHistory(opened);
    if(disconnected()){
      $('history-load-status').textContent='Offline. Showing orders available on this device.';
      $('history-load-status').hidden=false;
      $('history-retry').hidden=true;
      return;
    }
    if(historyLoading||loadedHistoryVersion===historyVersion)return;
    const version=historyVersion, status=$('history-load-status'), retry=$('history-retry');
    historyLoading=true;
    $('history-error').textContent='';
    retry.hidden=true;
    status.hidden=false;
    status.textContent='Loading bill history…';
    try{
      const response=await fetch('/apps'+billingPath+'?'+new URLSearchParams({sessionId:cfg.session,loadHistory:'Y'}),{cache:'no-store'});
      if(!response.ok||response.redirected)throw Error('History request failed');
      const page=new DOMParser().parseFromString(await response.text(),'text/html');
      const rows=page.querySelector('#kb-history-rows[data-kb-history-loaded]'), billing=page.getElementById('kb-data')?.dataset;
      if(!rows||billing?.session!==cfg.session||billing?.user!==cfg.user)throw Error('History response did not match this session');
      if(!root.isConnected||version!==historyVersion)return;
      const focused=document.activeElement;
      const focusRow=history.open&&(!history.contains(focused)||focused===history||focused===$('history-close')||
        focused===retry||$('history-rows').contains(focused));
      const previous=activeHistoryRow?.dataset.kotId;
      $('history-rows').replaceChildren(...rows.children);
      renderLocalHistory();
      activeHistoryRow=historyRows().find(row=>previous&&row.dataset.kotId===previous);
      loadedHistoryVersion=version;
      status.hidden=true;
      filterHistory(focusRow);
    }catch{
      if(root.isConnected&&version===historyVersion){
        status.textContent='Bill history could not be loaded. Please try again.';
        retry.hidden=false;
      }
    }finally{
      historyLoading=false;
      if(root.isConnected&&history.open&&version!==historyVersion)showHistory();
    }
  }
  function updatePrintOptions(){
    for(const button of $('print-choice')?.querySelectorAll('[data-kb-print]')||[]){
      button.disabled=busy||(historyPrintRow?.dataset.hasBill==='false'&&button.dataset.kbPrint!=='kot');
    }
  }
  function openReprint(row){
    if(!row||!$('print-choice'))return;
    historyPrintRow=row;
    $('print-title').textContent='Reprint';
    $('print-summary').textContent='Choose what to print for '+row.querySelector('[data-kb-history-detail]').textContent.trim()+'.';
    $('print-error').textContent='';
    updatePrintOptions();
    $('print-choice').showModal();
    $('print-choice').querySelector('[data-kb-print]:enabled')?.focus();
  }

  function billLine(item, canEdit){
    const name=esc(item.name), amount=value=>value==null?'—':money.format(value);
    const field=(type,value,min,step)=>canEdit
      ? '<input type="number" data-edit-'+type+' aria-label="'+type+' for '+name+'" value="'+esc(value)+'" min="'+min+'" step="'+step+'" required>'
      : type==='Rate'?amount(value):esc(value??'—');
    const row=document.createElement('tr');
    row.innerHTML='<th scope="row">'+name+'</th><td>'+field('Rate',item.rate,item.seq?0:0.01,0.01)+'</td><td>'+
      field('Quantity',item.qty,0.001,0.001)+'</td><td data-edit-tax>'+amount(item.tax)+'</td><td data-edit-total>'+amount(item.total)+'</td>'+
      (canEdit?'<td class="kb-history-editable"><input type="checkbox" data-edit-remove aria-label="Remove '+name+'"></td>':'');
    $('history-detail-lines').append(row);
    return row;
  }
  function previewBillAmounts(){
    const state=editingBill;
    if(!state?.canEdit)return;
    let total=0, changed=false, incomplete=false, newTax=false;
    for(const line of state.lines){
      const row=line.element, removed=row.querySelector('[data-edit-remove]').checked;
      const qty=row.querySelector('[data-edit-quantity]').valueAsNumber;
      const rate=row.querySelector('[data-edit-rate]').valueAsNumber;
      const edited=!line.seq||qty!==Number(line.qty)||rate!==Number(line.rate);
      let tax=Number(line.tax||0), amount=Number(line.total||0);
      if(removed){
        changed||=Boolean(line.seq);
        tax=amount=null;
      }else if(edited){
        changed=true;
        if(!Number.isFinite(qty)||!Number.isFinite(rate)||qty<=0||rate<0||(!line.seq&&rate===0)){
          incomplete=true;
          tax=amount=null;
        }else if(!line.seq){
          newTax||=state.hasTax;
          tax=state.hasTax?null:0;
          amount=qty*rate;
        }else{
          // Use the saved tax and discount basis, as the POS amendment does.
          const savedTaxable=Number(line.taxableAmount||0);
          const savedNet=Number(line.qty)*Number(line.rate)-Number(line.discountAmount||0);
          const net=qty*rate*(1-Number(line.discountPercent||0)/100);
          const taxable=savedNet>0?net*savedTaxable/savedNet:net;
          tax=savedTaxable?taxable*tax/savedTaxable:0;
          amount=taxable+tax;
        }
      }
      row.querySelector('[data-edit-tax]').textContent=tax==null?'—':money.format(tax);
      row.querySelector('[data-edit-total]').textContent=amount==null?'—':money.format(amount);
      total+=amount||0;
    }
    $('history-detail-total').textContent=changed
      ? 'Estimated total '+(incomplete?'—':money.format(Math.round(total)))
      : money.format(state.savedTotal);
    $('history-amount-note').hidden=!newTax;
  }
  async function openHistoryDetail(row){
    selectHistoryRow(row);
    const billed=row.dataset.billed==='true', held=row.dataset.kotGroup==='draft';
    const state={row,lines:[]};
    editingBill=state;
    historyEdit.reset();
    historyEdit.classList.remove('is-editable');
    $('history-edit-fields').hidden=true;
    $('history-detail-label').textContent=billed?'Bill Details':held?'Held Order':'Order Details';
    $('history-detail-number').textContent=row.querySelector('[data-kb-history-detail]').textContent.trim();
    $('history-detail-total').textContent=row.querySelector('.kb-history-amount').textContent;
    $('history-detail-lines').replaceChildren();
    $('history-amount-note').hidden=true;
    $('history-products').replaceChildren();
    $('history-edit-error').textContent='';
    $('history-detail-message').textContent='Loading items…';
    if($('history-save')){
      $('history-save').hidden=true;
      $('history-resume').hidden=$('history-discard').hidden=!held;
      $('history-detail-reprint').hidden=!!row.dataset.kbResumeLocal;
    }
    historyDetail.showModal();
    $('history-back').focus();
    try{
      const params={kotId:row.dataset.kotId};
      let data;
      if(row.dataset.kbLocalSale) {
        const receipt=device.queue().find(entry=>entry.sale.offlineId===row.dataset.kbLocalSale)?.receipt;
        if(!receipt)throw Error('This order has synced. Reopen History to see the saved bill.');
        data={total:receipt.summary.total,items:receipt.items};
      } else if(row.dataset.kbResumeLocal) {
        const draft=deviceDrafts.read(row.dataset.kbResumeLocal);
        if(!draft)throw Error('This held order is no longer on this device.');
        data={items:JSON.parse(draft.order.itemsJson).map(line=>{
          const product=catalogue?.products.get(line.productId), rate=line.unitPrice??product?.prices?.[draft.order.salesModeId]?.price;
          return {name:product?.productName||line.productId,qty:line.quantity,rate,total:rate==null?null:rate*line.quantity};
        })};
      } else data=billed?await request('historyBillDetails',params):(await request('printRecord',{...params,kind:'view'})).record;
      if(editingBill!==state||!historyDetail.open)return;
      state.transactionId=data.transactionId;
      state.salesModeId=data.salesModeId||salesModeId;
      state.savedTotal=data.total;
      state.hasTax=data.items?.some(item=>Number(item.tax)>0);
      const canEdit=Boolean(data.canEdit&&$('history-save'));
      state.canEdit=canEdit;
      if(canEdit)$('history-detail-label').textContent='Edit Bill';
      for(const item of data.items||[])state.lines.push({...item,element:billLine(item,canEdit)});
      historyEdit.classList.toggle('is-editable',canEdit);
      $('history-edit-fields').hidden=!canEdit;
      if($('history-save'))$('history-save').hidden=!canEdit;
      $('history-detail-message').textContent=canEdit?'Enter a reason to save a revision.':'';
    }catch(error){if(editingBill===state)$('history-detail-message').textContent=error.message;}
  }
  function billChanges(){
    const ops=[];
    for(const line of editingBill?.lines||[]){
      const row=line.element;
      if(row.querySelector('[data-edit-remove]').checked){
        if(line.seq)ops.push({type:'ITEM_REMOVED',seq:line.seq});
        continue;
      }
      const qty=Number(row.querySelector('[data-edit-quantity]').value);
      const rate=Number(row.querySelector('[data-edit-rate]').value);
      if(!line.seq){ops.push({type:'ITEM_ADDED',productId:line.productId,addQty:qty,newPrice:rate});continue;}
      if(qty!==Number(line.qty))ops.push({type:'QTY_CHANGE',seq:line.seq,newQty:qty});
      if(rate!==Number(line.rate))ops.push({type:'PRICE_CHANGE',seq:line.seq,newPrice:rate});
    }
    return ops;
  }
  function closeHistoryDetail(){
    if(savingBill)return;
    if(editingBill?.canEdit&&billChanges().length&&!confirm('Discard the unsaved bill changes?'))return;
    clearTimeout(editSearchTimer);
    editSearchVersion++;
    editingBill=null;
    historyDetail.close();
    if(!history.open)return;
    if(loadedHistoryVersion!==historyVersion)showHistory();
    else filterHistory(true);
  }
  async function saveHistoryBill(event){
    event.preventDefault();
    if(savingBill||!editingBill?.canEdit)return;
    const error=$('history-edit-error'), reason=$('history-edit-reason').value.trim(), ops=billChanges();
    error.textContent='';
    if(!ops.length||!reason){
      error.textContent=!ops.length?'No changes to save.':'Enter a reason for the change.';
      return;
    }
    const state=editingBill;
    savingBill=true;
    $('history-save').disabled=true;
    try{
      const {bill}=await request('ajaxCart',{action:'amendBill',editTxId:state.transactionId,editReason:reason,
        editOps:JSON.stringify(ops)},undefined,'/apps/zenith/pos/Terminal');
      $('history-detail-lines').replaceChildren();
      state.lines=bill.items.map(item=>{
        const line={...item,rate:item.price};
        return {...line,element:billLine(line,true)};
      });
      state.savedTotal=bill.payable;
      state.hasTax=state.lines.some(line=>Number(line.tax)>0);
      $('history-edit-reason').value='';
      previewBillAmounts();
      const adjustment=Number(bill.refundDue)>0?' Refund '+money.format(bill.refundDue)+'.':
        Number(bill.balanceDue)>0?' Collect '+money.format(bill.balanceDue)+'.':'';
      $('history-detail-message').textContent='Bill revision saved.'+adjustment;
      historyVersion++;
    }catch(failure){error.textContent=failure.message;}
    finally{savingBill=false;$('history-save').disabled=false;}
  }
  async function lookupBillProducts(term,version){
    const host=$('history-products'), state=editingBill;
    try{
      const data=await request('searchMenu',{term,salesModeId:state.salesModeId});
      if(version!==editSearchVersion||editingBill!==state||!historyDetail.open)return;
      host.replaceChildren();
      const matches=data.products||[];
      const exact=data.ambiguous?null:matches.find(product=>product.id===data.exactId);
      const results=exact?[exact,...matches.filter(product=>product!==exact)]:matches;
      for(const product of results){
        const rate=Number(product.price)>0?Number(product.price):null;
        const button=document.createElement('button');
        button.type='button';button.className='kb-history-match';
        if(product===exact)button.dataset.exact='true';
        const name=document.createElement('strong'), code=document.createElement('small'), price=document.createElement('span');
        name.textContent=product.name;
        code.textContent=product.code||product.id;
        price.textContent=rate==null?'Enter rate':money.format(rate);
        button.append(name,code,price);
        button.onclick=()=>{
          if(savingBill||editingBill!==state)return;
          const line={name:product.name,productId:product.id,qty:1,rate};
          const row=billLine(line,true);
          state.lines.push({...line,element:row});
          previewBillAmounts();
          $('history-add').value='';host.replaceChildren();
          (rate==null?row.querySelector('[data-edit-rate]'):$('history-add')).focus();
        };
        host.append(button);
      }
      if(!host.children.length)host.textContent='No matching products.';
    }catch(error){if(version===editSearchVersion&&editingBill===state)host.textContent=error.message;}
  }
  async function sendToKitchen() {
    if($('send').disabled)return;
    busy=true;controls();
    const status=$('order-status');
    status.textContent='Sending to kitchen…';
    try {
      if(needsLocalOrder()) {
        const queued=enqueueOrder('send');
        completedKotId='';localReceipt=queued;historyPrintRow=null;
        resetOrder();refreshOpenHistory();
        status.textContent='Kitchen ticket saved on this device and queued to sync.';
        $('print-title').textContent='Kitchen ticket saved';
        $('print-summary').textContent='Print the ticket while the order is pending sync.';
        $('print-error').textContent='';
        $('print-choice').showModal();
        return;
      }
      const ticket=await request('createKot',{...orderData(),loadedDraftId:draftId,wantJson:'Y'});
      resetOrder();
      refreshOpenHistory();
      status.textContent='KOT #'+ticket.kotNumber+' sent to the kitchen.';
    } catch(error) {
      status.textContent=error.message;
    } finally {
      busy=false;controls();
      updatePrintOptions();
      syncDeviceOrders();
    }
  }
  root.addEventListener('click',e=>{
    const button=e.target.closest('button');if(!button||button.disabled||busy)return;
    if(button.dataset.ot){setType(button.dataset.ot);quote();}
    else if(button.id==='kb-tax-toggle'){taxOn=taxOn==='Y'?'N':'Y';paintTax();quote();}
    else if(button.dataset.kbView)setGridView(button.dataset.kbView==='grid');
    else if(button.hasAttribute('data-kb-sales-mode')){
      $('mode').value=button.dataset.kbSalesMode;
      $('mode').dispatchEvent(new Event('change'));
      modesMenu.open=false;modesMenu.querySelector('summary').focus({preventScroll:true});
    }
    else if(button.hasAttribute('data-kb-category')){
      categoryId=button.dataset.kbCategory;
      search.value='';lookup();
    }
    else if(button.dataset.kbPayment)openPayment(button.dataset.kbPayment);
    else if(button.id==='kb-fullscreen')toggleFullscreen();
    else if(button.id==='kb-close-session')openSessionClose();
    else if(button.id==='kb-clear'&&confirm('Clear the unsent items from this order?')){
      resetOrder();
    }
    else if(button.id==='kb-history-open'||button.id==='kb-history-retry')showHistory();
    else if(button.hasAttribute('data-kb-bill-local')) {
      if(!releaseOrder){$('history-error').textContent='This KOT session is open in another tab.';return;}
      if(cart.size) {
        $('history-error').textContent='Hold the current order before billing this kitchen ticket.';
        return;
      }
      const row=button.closest('[data-kb-local-sale]');
      const entry=device.queue().find(item=>item.sale.offlineId===row.dataset.kbLocalSale);
      if(entry?.sale.operation!=='send'||entry.sale.sessionId!==cfg.session){showHistory();return;}
      history.close();
      openPayment('',{total:entry.sale.total,ticket:entry});
    }
    else if(button.dataset.kbBillOrder){
      if(sessionLost||disconnected())return;
      if(device?.queue().some(({sale})=>sale.operation==='checkout'&&sale.kotId===button.dataset.kbBillOrder)){
        $('history-error').textContent='Payment for this order is already pending sync on this device.';
        return;
      }
      $('history').close();
      openPayment('',{id:button.dataset.kbBillOrder,total:Number(button.dataset.kbBillTotal),
        customer:{id:button.dataset.kbBillCustomer,name:button.dataset.kbBillName,phone:button.dataset.kbBillPhone}});
    }
    else if(button.id==='kb-resume')resumeBilling();
    else if(button.id==='kb-bill')openPayment();
    else if(button.id==='kb-send')sendToKitchen();
    else if(button.id==='kb-draft'){
      if(deviceDrafts)holdOrder();
      else {
        busy=true;controls();
        post('saveDraft',{...orderData(),existingDraftId:draftId});
      }
    }
    else if(button.classList.contains('pos-cash-quick')){
      const slot=$('cash-slot');
      $('cash').value=button.dataset.amt;
      if(PosTillDialogs.updateCash(slot,paymentAmount)&&e.detail===0)slot.querySelector('.pos-cash-confirm').focus();
    }
    else if(button.id==='kb-payment-continue')tenderFields($('payment-method').value);
    else if(button.id==='posPayConfOk'&&$('payment-method').value==='UPI')showUpiReceiptChoices();
    else if(button.id==='kb-payment-close'||button.id==='kb-payment-picker-close'||button.classList.contains('pos-cash-cancel'))$('payment').close();
    else if(button.dataset.kbPrint)printChoice(button.dataset.kbPrint);
    else if(button.id==='kb-print-close')$('print-choice').close();
    else if(button.id==='kb-customer-open'||button.hasAttribute('data-kb-customer-change'))openCustomerDialog();
    else if(button.id==='kb-customer-walkin')walkInCustomer();
    else if(button.id==='kb-customer-close')$('customer-dialog')?.close();
    else if(button.dataset.custId)selectCustomer(button);
    else if(button.dataset.remove||button.dataset.qty){
      const id=button.closest('tr').dataset.product,it=cart.get(id);
      if(button.dataset.remove){cart.delete(id);if(invalidEdit?.id===id)setEditError('');}
      else{it.qty=Number((it.qty+Number(button.dataset.qty)).toFixed(6));it.amount=null;}
      quote();
    }
  });
  $('mode').addEventListener('change',()=>{
    if($('mode').value===salesModeId)return;
    if(cart.size&&!needsLocalOrder()&&!confirm('Update the cart? Existing items will be repriced for the selected sales mode.')){$('mode').value=salesModeId;paintSalesMode();return;}
    for(const item of cart.values())delete item.manualRate;
    salesModeId=$('mode').value;paintSalesMode();browsePage=null;quote();lookup();
  });
  $('waiter').addEventListener('change',quote);
  $('history-search').addEventListener('input',()=>filterHistory());
  $('history-status').addEventListener('change',()=>filterHistory());
  $('history-date').addEventListener('change',()=>filterHistory());
  $('history-close').addEventListener('click',()=>history.close());
  $('history-filter').addEventListener('click',()=>{
    const panel=$('history-filters');
    panel.hidden=!panel.hidden;
    $('history-filter').setAttribute('aria-expanded',String(!panel.hidden));
    if(!panel.hidden)$('history-status').focus();
  });
  $('history-rows').addEventListener('focusin',event=>{
    const row=event.target.closest('.kb-history-row');
    if(row)selectHistoryRow(row);
  });
  $('history-rows').addEventListener('click',event=>{
    const row=event.target.closest('.kb-history-row');
    if(!row)return;
    selectHistoryRow(row);
    if(event.target.closest('[data-kb-bill-order],[data-kb-bill-local]'))return;
    const print=event.target.closest('[data-kb-history-print]');
    if(print){if(!print.disabled)printChoice(print.dataset.kbHistoryPrint,row);}
    else openHistoryDetail(row);
  });
  history.addEventListener('keydown',event=>{
    if(event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
    const row=event.target.closest('.kb-history-row');
    if(event.key==='ArrowDown'&&event.target===$('history-search')&&activeHistoryRow){
      event.preventDefault();
      selectHistoryRow(activeHistoryRow,true);
    } else if(row&&['ArrowDown','ArrowUp'].includes(event.key)){
      event.preventDefault();
      const rows=historyRows(), index=rows.indexOf(row)+(event.key==='ArrowDown'?1:-1);
      selectHistoryRow(rows[Math.max(0,Math.min(rows.length-1,index))],true);
    } else if(row){
      const buttons=Array.from(row.querySelectorAll('[data-kb-history-print]:enabled'));
      if(!buttons.length)return;
      const index=buttons.indexOf(event.target);
      if(event.key===' '&&event.target.matches('[data-kb-history-detail]')){
        event.preventDefault();
        buttons[0].focus();
      }else if(index!==-1&&['ArrowLeft','ArrowRight'].includes(event.key)){
        event.preventDefault();
        const next=index+(event.key==='ArrowRight'?1:-1);
        buttons[(next+buttons.length)%buttons.length].focus();
      }
    }
  });
  for(const id of ['history-back','history-detail-close'])$(id).addEventListener('click',closeHistoryDetail);
  historyDetail.addEventListener('cancel',event=>{event.preventDefault();closeHistoryDetail();});
  $('history-detail-reprint')?.addEventListener('click',()=>openReprint(editingBill?.row));
  $('history-resume')?.addEventListener('click',()=>{
    const row=editingBill.row, id=row.dataset.kbResumeLocal;
    if(id) {
      if(cart.size){$('history-detail-message').textContent='Hold the current order before resuming this one.';return;}
      try {
        requireOfflineOwner();
        if(syncingHeld.has(id))throw Error('This held order is syncing. Reopen History in a moment.');
        const draft=deviceDrafts.read(id);
        if(!draft)throw Error('This held order has synced. Reopen History to resume it.');
        restoreOrder(draft.order);
        rememberOrder();
        deviceDrafts.remove(id);
        historyDetail.close();history.close();search.focus();
      }catch(error){$('history-detail-message').textContent=error.message;}
    } else if(disconnected()) $('history-detail-message').textContent='Reconnect to resume this server order.';
    else if(!cart.size||confirm('Replace the current unsent items with this held order?')){
      location.href=base+'/?sessionId='+encodeURIComponent(cfg.session)+'&loadDraft='+encodeURIComponent(row.dataset.kotId);
    }
  });
  $('history-discard')?.addEventListener('click',()=>{
    if(!confirm('Discard this held order?'))return;
    const row=editingBill.row, id=row.dataset.kbResumeLocal;
    if(!id){if(!disconnected())post('deleteDraft',{kotId:row.dataset.kotId});return;}
    try {
      requireOfflineOwner();
      if(syncingHeld.has(id))throw Error('This held order is syncing. Reopen History in a moment.');
      deviceDrafts.remove(id);closeHistoryDetail();
      refreshOpenHistory();
    }catch(error){$('history-detail-message').textContent=error.message;}
  });
  historyEdit.addEventListener('submit',saveHistoryBill);
  historyEdit.addEventListener('input',event=>{
    if(event.target.matches('[data-edit-quantity],[data-edit-rate]'))previewBillAmounts();
  });
  historyEdit.addEventListener('change',event=>{
    if(!event.target.matches('[data-edit-remove]'))return;
    for(const field of event.target.closest('tr').querySelectorAll('input[type=number]')){
      field.disabled=event.target.checked;
    }
    previewBillAmounts();
  });
  $('history-add').addEventListener('input',event=>{
    clearTimeout(editSearchTimer);
    const term=event.target.value.trim(), version=++editSearchVersion;
    $('history-products').textContent=term?'Searching…':'';
    if(term)editSearchTimer=setTimeout(()=>lookupBillProducts(term,version),150);
  });
  $('history-add').addEventListener('keydown',event=>{
    if(event.isComposing||!['Enter','ArrowDown'].includes(event.key))return;
    event.preventDefault();
    const matches=$('history-products').querySelectorAll('button');
    const exact=$('history-products').querySelector('[data-exact]');
    if(event.key==='Enter'&&(exact||matches.length===1))(exact||matches[0]).click();
    else matches[0]?.focus();
  });
  $('history-products').addEventListener('keydown',event=>{
    if(!['ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();
    if(event.key==='ArrowDown')event.target.nextElementSibling?.focus();
    else (event.target.previousElementSibling||$('history-add')).focus();
  });
  historyDetail.addEventListener('keydown',event=>{
    const reprint=$('history-detail-reprint');
    if(event.key===' '&&reprint&&event.target!==reprint&&!event.target.closest('input,textarea,select,[contenteditable]')){
      event.preventDefault();reprint.focus();
    }
  });
  $('customer-search')?.addEventListener('input',e=>{
    clearTimeout(custTimer);
    custVersion++;
    custAbort?.abort();
    $('customer-results').replaceChildren();
    const term=e.target.value.trim();
    custTimer=setTimeout(()=>searchCustomers(term),150);
  });
  $('payment-method')?.addEventListener('change',()=>{$('payment-continue').disabled=!$('payment-method').value;});
  $('payment-form')?.addEventListener('submit',pay);
  $('payment')?.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  function ignoreDialogKey(e) {
    return e.defaultPrevented||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey;
  }
  $('cash-slot')?.addEventListener('keydown',e=>{
    if(ignoreDialogKey(e))return;
    if(e.key==='Enter'&&e.repeat){e.preventDefault();return;}
    const slot=e.currentTarget, received=$('cash');
    const quick=Array.from(slot.querySelectorAll('.pos-cash-quick'));
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
      const index=quick.indexOf(e.target);
      if(index<0)return;
      e.preventDefault();
      quick[(index+(e.key==='ArrowRight'?1:-1)+quick.length)%quick.length].focus();
    }else if(e.key==='ArrowUp'||e.key==='ArrowDown'){
      const rows=[[received],Array.from(slot.querySelectorAll('.pos-cash-confirm:enabled')),
        quick,Array.from(slot.querySelectorAll('.pos-cash-cancel:enabled'))].filter(row=>row.length);
      const index=rows.findIndex(row=>row.includes(e.target));
      if(index<0)return;
      e.preventDefault();
      rows[index+(e.key==='ArrowDown'?1:-1)]?.[0].focus();
    }else if(e.key==='Enter'&&e.target===received&&!slot.querySelector('.pos-cash-confirm:enabled')&&!busy){
      e.preventDefault();quick[0].focus();
    }
  });
  $('payment')?.addEventListener('keydown',e=>{
    if(ignoreDialogKey(e)||e.target.closest('#kb-cash-slot'))return;
    const key=e.key, target=e.target;
    if(key==='Enter'&&e.repeat){e.preventDefault();return;}
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].includes(key))return;
    if(target===$('payment-method')&&key==='Enter'&&target.value){
      e.preventDefault();
      tenderFields(target.value);
      return;
    }
    const rows=new Map();
    for(const control of e.currentTarget.querySelectorAll('input:not([type=hidden]):enabled, select:enabled, button:enabled')){
      if(!control.getClientRects().length)continue;
      const row=control.closest('[data-pos-tender-row], .zk-history-actions')||control;
      if(!rows.has(row))rows.set(row,[]);
      rows.get(row).push(control);
    }
    const groups=Array.from(rows.values()), index=groups.findIndex(row=>row.includes(target));
    if(index<0)return;
    const row=groups[index], col=row.indexOf(target);
    if(key==='ArrowLeft'||key==='ArrowRight'){
      if(row.length<2||target.tagName==='SELECT'||(target.tagName==='INPUT'&&target.type!=='number'))return;
      e.preventDefault();
      row[(col+(key==='ArrowRight'?1:-1)+row.length)%row.length].focus();
    }else if(key==='Enter'){
      if(target.tagName==='BUTTON')return;
      e.preventDefault();
      (row[col+1]||groups[index+1]?.[0])?.focus();
    }else if(target.tagName!=='SELECT'){
      e.preventDefault();
      const next=groups[index+(key==='ArrowDown'?1:-1)];
      next?.[Math.min(col,next.length-1)].focus();
    }
  });
  $('print-choice')?.addEventListener('keydown',e=>{
    if(ignoreDialogKey(e))return;
    if(e.key==='Enter'&&e.repeat){e.preventDefault();return;}
    if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
    const buttons=Array.from(e.currentTarget.querySelectorAll('button:enabled'));
    const index=buttons.indexOf(e.target);
    if(index<0)return;
    e.preventDefault();
    buttons[(index+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length].focus();
  });
  let shiftAlone=false;
  const editable=e=>e.target?.closest?.('input,textarea,select,button,a,[contenteditable],dialog');
  function shortcut(e) {
    if(!root.isConnected){document.removeEventListener('keydown',shortcut);document.removeEventListener('keyup',shortcut);return;}
    if(document.documentElement.classList.contains('zk-billing-pending')||document.getElementById('posCloseSessionOverlay')){shiftAlone=false;return;}
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
      if(e.key==='F10'){e.preventDefault();showHistory();return;}
      if(e.key==='F7'&&!$('draft')?.disabled){e.preventDefault();$('draft')?.click();return;}
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
  updatePendingSales();updateHeader();setType(orderType);paintTax();renderCustomer();quote();
  function connectionChanged() {
    if(!root.isConnected)return;
    updateHeader();browsePage=null;quote(false);lookup();
    if(history.open)showHistory();
    if(!disconnected()){warmWorkspace();syncDeviceOrders();}
    else if(transportDown&&navigator.onLine&&!sessionLost) {
      clearTimeout(reconnectTimer);
      reconnectTimer=setTimeout(async()=>{
        if(!root.isConnected||!navigator.onLine||sessionLost)return;
        try {
          await request('touchSession',{},AbortSignal.timeout?.(7000));
          transportDown=false;
        }catch{}
        connectionChanged();
      },8000);
    }
  }
  if(device&&!search.disabled) {
    const onBrowserConnection=()=>{
      if(!root.isConnected){
        window.removeEventListener('online',onBrowserConnection);
        window.removeEventListener('offline',onBrowserConnection);
        return;
      }
      clearTimeout(reconnectTimer);
      if(navigator.onLine)transportDown=false;
      claimOfflineOrder();
      connectionChanged();
    };
    window.addEventListener('online',onBrowserConnection);
    window.addEventListener('offline',onBrowserConnection);
    window.addEventListener('pagehide',releaseOfflineOrder);
    window.addEventListener('pageshow',claimOfflineOrder);
    claimOfflineOrder();
    window.addEventListener('storage',function updateOtherTab(event){
      if(!root.isConnected){window.removeEventListener('storage',updateOtherTab);return;}
      if(event.key?.startsWith('zenith:kot:offline:')){
        updatePendingSales();controls();
        if(history.open)showHistory();
      }
    });
    $('instr').addEventListener('change',()=>{
      try { rememberOrder(); }
      catch(error){$('order-status').textContent=error.message;}
    });
    device.readCatalog().then(value=>{
      if(!root.isConnected)return;
      if(!catalogue)applyWorkspace(value);
      catalogRead=true;
      if(!recoverActiveOrder()&&disconnected())connectionChanged();
    }).catch(error=>{
      if(!root.isConnected)return;
      workspaceError=error.message;
      if(disconnected())quote(false);
    }).finally(()=>{
      if(root.isConnected){warmWorkspace();syncDeviceOrders();}
    });
  }
  if($('send')) {
    const keepSessionOpen=()=>{
      if(!root.isConnected) {
        clearInterval(heartbeat);
        window.removeEventListener('focus',keepSessionOpen);
        return;
      }
      if(device)claimOfflineOrder();
      if(sessionLost||disconnected())return;
      syncDeviceOrders();
      request('touchSession',{}).then(({displayEnabled})=>{
        if(typeof displayEnabled!=='boolean'||String(displayEnabled)===cfg.displayEnabled)return;
        cfg.displayEnabled=String(displayEnabled);
        controls();
      }).catch(()=>{});
    };
    const heartbeat=setInterval(keepSessionOpen,60000);
    window.addEventListener('focus',keepSessionOpen);
    keepSessionOpen();
  }
})();
