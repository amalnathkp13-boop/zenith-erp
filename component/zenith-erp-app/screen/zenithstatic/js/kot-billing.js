/* KOT Billing — kitchen order-entry cart engine.
 * Loaded via <img onload> from KotBilling.xml so it runs on both /apps and /qapps.
 * External .js file => no Vue-template constraints (bare < is fine here).
 * Drafts are persisted SERVER-SIDE (KotDraft); Active/Completed tabs show server-loaded lists. */
(function () {
  if (window.__kbRoot === document.getElementById('kb-wrap')) return;
  window.__kbRoot = document.getElementById('kb-wrap');
  var root = window.__kbRoot, quoteVersion = 0, quoteTimer, printBusy = false, quoteTotal = 0;
  var taxOn = 'Y', matches = [], activeMatch = 0, combinedBusy = false;

  var cart = {};            // id -> {id, name, price, qty}
  var orderType = 'Dine In';
  var loadedDraftId = '';   // set when a saved draft was resumed into the cart
  var orders = {};          // kotId -> {num, table, time, items:[{name,qty}]}  (for per-order print)

  function $(id) { return document.getElementById(id); }
  function qsa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function base() {
    var prefix = location.pathname.indexOf('/qapps/') === 0 ? '/qapps' : '/apps';
    return prefix + '/zenith/pos/Kitchen/KotBilling';
  }
  function cssId(id) { return (window.CSS && CSS.escape) ? CSS.escape(id) : id; }
  function tok() {
    try { if (window.moqui && window.moqui.webrootVue && window.moqui.webrootVue.moquiSessionToken) return window.moqui.webrootVue.moquiSessionToken; } catch (e) {}
    var h = $('kb-token'); return h ? h.value : '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function inr(n) {
    n = Math.round((Number(n) || 0) * 100) / 100;
    var neg = n < 0; n = Math.abs(n);
    var s = n.toFixed(2), ip = s.split('.')[0], fp = s.split('.')[1], res;
    if (ip.length <= 3) { res = ip; }
    else {
      var last3 = ip.slice(-3), rest = ip.slice(0, -3), out = '';
      while (rest.length > 2) { out = ',' + rest.slice(-2) + out; rest = rest.slice(0, -2); }
      res = rest + out + ',' + last3;
    }
    return (neg ? '-' : '') + '₹' + res + '.' + fp;
  }

  var TRASH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';

  function menuPrice(id) {
    var c = document.querySelector('.kb-card[data-id="' + cssId(id) + '"]');
    return c ? (Number(c.getAttribute('data-price')) || 0) : 0;
  }

  function render(skipQuote) {
    var tbody = $('kb-cart'), rows = '', sub = 0, n = 0;
    for (var id in cart) {
      if (!cart.hasOwnProperty(id)) continue;
      var it = cart[id], amt = it.price * it.qty; sub += amt; n++;
      rows += '<tr data-cart-id="' + esc(id) + '">' +
        '<td class="kb-oname"><span class="kb-row-number">' + n + '</span><span>' + esc(it.name) + '</span></td>' +
        '<td><input class="kb-price-input" type="number" min="0" step="0.01" value="' + esc(it.price) + '" aria-label="Price for ' + esc(it.name) + '" data-kb-price="' + esc(id) + '"></td>' +
        '<td><span class="kb-ostep">' +
          '<button type="button" onclick="kbDec(\'' + id + '\')" aria-label="Decrease ' + esc(it.name) + '"' + (it.qty <= 1 ? ' disabled' : '') + '>−</button>' +
          '<input class="kb-qty-input" type="number" min="0.001" step="any" value="' + esc(it.qty) + '" aria-label="Quantity for ' + esc(it.name) + '" data-kb-qty="' + esc(id) + '">' +
          '<button type="button" onclick="kbInc(\'' + id + '\')" aria-label="Increase ' + esc(it.name) + '">+</button>' +
        '</span></td>' +
        '<td class="r kb-oamt">' + inr(amt) + '</td>' +
        '<td class="r"><button type="button" class="kb-orm" aria-label="Remove ' + esc(it.name) + '" onclick="kbRemove(\'' + id + '\')">' + TRASH + '</button></td>' +
      '</tr>';
    }
    if (tbody) tbody.innerHTML = rows;
    root.classList.toggle('has-cart', n > 0);
    var empty = $('kb-cartempty'); if (empty) empty.style.display = n ? 'none' : 'block';

    if ($('kb-subtotal')) $('kb-subtotal').textContent = inr(sub);
    if (!skipQuote) {
      quoteTotal=0;
      if ($('kb-grand')) $('kb-grand').textContent = n ? 'Calculating…' : inr(0);
      if ($('kb-tax-rows')) $('kb-tax-rows').replaceChildren();
      if ($('kb-print-bill')) $('kb-print-bill').disabled = true;
      if ($('kb-print-both')) $('kb-print-both').disabled = true;
      clearTimeout(quoteTimer);var version=++quoteVersion;
      if(n)quoteTimer=setTimeout(function(){getQuote().then(function(data){if(version!==quoteVersion||!root.isConnected)return;showQuote(data);}).catch(function(e){if(version===quoteVersion&&root.isConnected)$('kb-quote-error').textContent=e.message;});},150);
      else if($('kb-quote-error'))$('kb-quote-error').textContent='';
    }

    var send = $('kb-send'); if (send) send.classList.toggle('is-disabled', n === 0);
    var clr = $('kb-clear'); if (clr) clr.disabled = (n === 0);

    qsa('.kb-card').forEach(function (c) {
      var id = c.getAttribute('data-id'), it = cart[id];
      c.classList.toggle('in-cart', !!it);
      var q = c.querySelector('[data-q="' + cssId(id) + '"]');
      if (q) q.textContent = it ? it.qty : 0;
    });
  }

  function cardData(id) {
    var c = document.querySelector('.kb-card[data-id="' + cssId(id) + '"]');
    if (!c) return null;
    return { id: id, name: c.getAttribute('data-name'), price: Number(c.getAttribute('data-price')) || 0 };
  }

  window.kbAdd = function (id) {
    if (cart[id]) { cart[id].qty++; }
    else { var d = cardData(id); if (!d) return; cart[id] = { id: id, name: d.name, price: d.price, qty: 1 }; }
    render();
    if ($('kb-search')) $('kb-search').focus();
  };
  window.kbInc = function (id) { if (cart[id]) { cart[id].qty++; render(); } };
  window.kbDec = function (id) { if (cart[id]) { cart[id].qty--; if (cart[id].qty <= 0) delete cart[id]; render(); } };
  window.kbRemove = function (id) { delete cart[id]; render(); };
  window.kbClear = function () { cart = {}; render(); };
  function updateCartField(target) {
    var id = target.getAttribute('data-kb-price') || target.getAttribute('data-kb-qty'), it = cart[id];
    if (!it) return;
    var value = Number(target.value);
    if (!Number.isFinite(value) || value < (target.hasAttribute('data-kb-qty') ? 0.001 : 0)) return;
    if (target.hasAttribute('data-kb-qty')) it.qty = value;
    else { it.price = value; it.manualPrice = value !== menuPrice(id); }
    var tr = target.closest('tr'); if (tr) tr.querySelector('.kb-oamt').textContent = inr(it.price * it.qty);
    var sub = Object.keys(cart).reduce(function (total, key) { return total + cart[key].price * cart[key].qty; }, 0);
    $('kb-subtotal').textContent = inr(sub);
    renderQuote();
  }
  function renderQuote() {
    quoteTotal = 0; ++quoteVersion; clearTimeout(quoteTimer);
    $('kb-grand').textContent = 'Calculating…';
    $('kb-print-bill').disabled = true; $('kb-print-both').disabled = true;
    var version = quoteVersion;
    quoteTimer = setTimeout(function () { getQuote().then(function (data) {
      if (version === quoteVersion && root.isConnected) showQuote(data);
    }).catch(function (e) { if (version === quoteVersion && root.isConnected) $('kb-quote-error').textContent = e.message; }); }, 150);
  }
  root.addEventListener('input', function (event) { if (event.target.matches('[data-kb-price],[data-kb-qty]')) updateCartField(event.target); });
  root.addEventListener('change', function (event) {
    if (!event.target.matches('[data-kb-price],[data-kb-qty]')) return;
    var value = Number(event.target.value); if (!Number.isFinite(value) || value < (event.target.hasAttribute('data-kb-qty') ? 0.001 : 0)) render();
  });

  // ---- menu filters ----
  function applyFilter() {
    var cat = (window.__kbCat || ''), term = (window.__kbTerm || '').toLowerCase(),
        avail = $('kb-avail') && !$('kb-avail').classList.contains('off'), shown = 0;
    qsa('.kb-card').forEach(function (c) {
      var okCat = (!cat || c.getAttribute('data-cat') === cat);
      var okTerm = (!term || [c.getAttribute('data-name'), c.getAttribute('data-code'), c.getAttribute('data-barcode')].some(function (v) { return (v || '').toLowerCase().indexOf(term) !== -1; }));
      var okAvail = (!avail || (Number(c.getAttribute('data-price')) || 0) > 0);
      var ok = okCat && okTerm && okAvail;
      c.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    qsa('.kb-product-row').forEach(function (row) {
      var okCat = !cat || row.getAttribute('data-cat') === cat;
      var okTerm = !term || [row.getAttribute('data-name'), row.getAttribute('data-code'), row.getAttribute('data-barcode')].some(function (v) { return (v || '').toLowerCase().indexOf(term) !== -1; });
      var okAvail = !avail || Number(row.getAttribute('data-price')) > 0;
      row.style.display = okCat && okTerm && okAvail ? '' : 'none';
    });
    var nr = $('kb-noresult'); if (nr) nr.style.display = shown ? 'none' : 'block';
  }
  window.kbCat = function (cat, el) { window.__kbCat = cat; qsa('.kb-cat').forEach(function (x) { x.classList.toggle('is-active', x === el); }); applyFilter(); };
  window.kbSearch = function (v) {
    window.__kbTerm = v.trim(); root.classList.toggle('has-search', !!v.trim()); applyFilter();
    matches = v.trim() ? qsa('.kb-card').filter(function (card) { return card.style.display !== 'none'; }).slice(0, 8) : [];
    activeMatch = 0;
    var box = $('kb-suggestions');
    box.hidden = !matches.length;
    box.innerHTML = matches.map(function (card, index) {
      return '<button type="button" role="option" class="kb-suggestion' + (index === 0 ? ' is-active' : '') + '" data-match="' + index + '" aria-selected="' + (index === 0) + '"><b>' + esc(card.getAttribute('data-name')) + '</b><span>' + esc(card.getAttribute('data-code')) + ' · ' + inr(card.getAttribute('data-price')) + '</span></button>';
    }).join('');
  };
  function chooseMatch(index) {
    if (!matches[index]) return;
    kbAdd(matches[index].getAttribute('data-id'));
    $('kb-search').value = ''; kbSearch(''); $('kb-search').focus();
  }
  root.addEventListener('click', function (event) { var option = event.target.closest('[data-match]'); if (option) chooseMatch(Number(option.getAttribute('data-match'))); });
  window.kbSearchKey = function (event) {
    if (event.key === 'Escape') { $('kb-search').value = ''; kbSearch(''); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!matches.length) return; event.preventDefault();
      activeMatch = (activeMatch + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
      qsa('.kb-suggestion').forEach(function (option, index) { option.classList.toggle('is-active', index === activeMatch); option.setAttribute('aria-selected', index === activeMatch); });
    } else if (event.key === 'Enter' && matches.length) { event.preventDefault(); chooseMatch(activeMatch); }
  };
  window.kbView = function (view) {
    root.classList.toggle('view-grid', view === 'grid');
    ['list', 'grid'].forEach(function (v) { var b = $('kb-view-' + v); b.classList.toggle('is-active', v === view); b.setAttribute('aria-pressed', v === view); });
  };
  window.kbTaxToggle = function () {
    taxOn = taxOn === 'Y' ? 'N' : 'Y'; var b = $('kb-tax-toggle');
    b.classList.toggle('is-on', taxOn === 'Y'); b.setAttribute('aria-pressed', taxOn === 'Y'); b.textContent = 'Tax: ' + (taxOn === 'Y' ? 'ON' : 'OFF');
    if (Object.keys(cart).length) renderQuote();
  };
  if(window.__kbAvailabilityHandler)document.removeEventListener('click',window.__kbAvailabilityHandler);
  window.__kbAvailabilityHandler=function (e) { if (e.target && e.target.id === 'kb-avail') setTimeout(applyFilter, 0); };
  document.addEventListener('click',window.__kbAvailabilityHandler);

  // ---- order type ----
  function setOrderType(ot) {
    orderType = ot;
    qsa('.kb-otbtn').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-ot') === ot); });
    if ($('kb-table')) $('kb-table').closest('.kb-toolbar-table').style.display = ot === 'Take Away' ? 'none' : '';
    if (ot === 'Take Away' && $('kb-table')) $('kb-table').value = '';
    if ($('kb-print-both')) $('kb-print-both').hidden = ot !== 'Take Away';
    if (Object.keys(cart).length) renderQuote();
  }
  window.kbOrderType = function (ot) { setOrderType(ot); };
  window.kbOrderTypeSel = function (v) { setOrderType(v); };

  // ---- tabs: switch between the New Order entry view and the Active/Completed lists ----
  window.kbTab = function (tab, el) {
    qsa('.kb-tab').forEach(function (b) { b.classList.toggle('is-active', b === el); });
    var w = $('kb-wrap'); if (!w) return;
    w.classList.remove('view-active', 'view-completed');
    if (tab === 'active') w.classList.add('view-active');
    else if (tab === 'completed') w.classList.add('view-completed');
  };

  window.kbGo = function (path) { location.href = base() + '/' + path; };

  // ---- server-side transitions (POST with session token) ----
  function post(path, params) {
    var f = document.createElement('form');
    f.method = 'POST'; f.action = base() + '/' + path; f.style.display = 'none';
    function add(n, v) { var i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = (v == null ? '' : v); f.appendChild(i); }
    for (var k in params) { if (params.hasOwnProperty(k)) add(k, params[k]); }
    add('moquiSessionToken', tok());
    document.body.appendChild(f); f.submit();
  }
  function cartItems() {
    var items = [];
    for (var id in cart) { if (!cart.hasOwnProperty(id)) continue; var it = cart[id]; items.push({ productId: it.id, productName: it.name, quantity: it.qty, unitPrice: it.price, manualPrice: it.manualPrice ? 'Y' : 'N' }); }
    return items;
  }

  window.kbSend = function () {
    var items = cartItems(); if (!items.length) return;
    var btn = $('kb-send'); if (btn) { btn.classList.add('is-disabled'); btn.textContent = 'Sending...'; }
    post('createKot', { itemsJson: JSON.stringify(items), tableId: ($('kb-table') || {}).value || '',
      orderType: orderType, taxOn: taxOn, notes: ($('kb-instr') || {}).value || '', loadedDraftId: loadedDraftId });
  };
  window.kbSaveDraft = function () {
    var items = cartItems(); if (!items.length) { alert('Add items before saving a draft.'); return; }
    var btn = $('kb-draft'); if (btn) { btn.innerHTML = 'Saving...'; }
    post('saveDraft', { itemsJson: JSON.stringify(items), tableId: ($('kb-table') || {}).value || '',
      orderType: orderType, taxOn: taxOn, notes: ($('kb-instr') || {}).value || '', existingDraftId: loadedDraftId });
  };
  window.kbLoadDraft = function (id) { location.href = base() + '/?loadDraft=' + encodeURIComponent(id); };
  window.kbDiscardDraft = function (id) { if (!confirm('Discard this draft?')) return; post('deleteDraft', { kotId: id }); };

  // ---- printing ----
  async function getQuote(){
    var body=new URLSearchParams({moquiSessionToken:tok(),itemsJson:JSON.stringify(cartItems()),tableId:($('kb-table')||{}).value||'',orderType:orderType,taxOn:taxOn,notes:($('kb-instr')||{}).value||''});
    var response=await fetch(base()+'/cartReceipt',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
    var data;try{data=await response.json();}catch(e){throw Error('Could not calculate this order. Refresh or retry.');}
    if(!response.ok||!data.success||!data.receipt)throw Error(data.error||'Could not calculate this order.');return data.receipt;
  }
  function showQuote(data){
    quoteTotal=Number(data.summary.total);
    $('kb-subtotal').textContent=inr(data.summary.subtotal);$('kb-grand').textContent=inr(data.summary.total);
    $('kb-tax-rows').innerHTML=(data.summary.taxBreakdown||[]).map(function(t){return '<div class="kb-sum__row"><span>'+esc(t.name)+'</span><span>'+inr(t.amount)+'</span></div>';}).join('');
    $('kb-quote-error').textContent='';$('kb-print-bill').disabled=printBusy||Number(data.summary.total)<=0;
    $('kb-print-both').disabled=printBusy||combinedBusy||orderType!=='Take Away'||Number(data.summary.total)<=0;
  }
  window.kbPrintBill=async function(){
    if(printBusy)return;
    if(!cartItems().length){alert('Add items before printing a customer bill.');return;}
    var w,version=quoteVersion;
    try{
      printBusy=true;$('kb-print-bill').disabled=true;w=KitchenPrint.open();
      var receipt=await getQuote();if(!root.isConnected){w.close();return;}
      if(version!==quoteVersion)throw Error('The order changed while preparing its receipt. Retry Print Bill.');
      if(Number(receipt.summary.total)<=0)throw Error('Add items with a positive total before printing a customer bill.');
      showQuote(receipt);await KitchenPrint.customer(w,receipt);
    }catch(e){if(w&&!w.closed)w.close();if(root.isConnected)$('kb-quote-error').textContent=e.message;}
    finally{printBusy=false;if(root.isConnected)$('kb-print-bill').disabled=!cartItems().length||quoteTotal<=0;}
  };
  function openPrint(html) {
    var w = window.open('', '_blank', 'width=340,height=560');
    if (!w) { alert('Allow pop-ups to print the KOT.'); return; }
    w.document.write(html); w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 250);
  }
  function slip(title, meta, items, notes) {
    return KitchenPrint.kotHtml({number:title.replace(/^KOT #/,''),table:meta,date:'',items:items,notes:notes});
  }
  window.kbPrint = function () {
    var items = cartItems(); if (!items.length) { alert('Add items before printing.'); return; }
    var pit = items.map(function (it) { return { name: it.productName, qty: it.quantity }; });
    openPrint(slip('KITCHEN ORDER TICKET', 'Type: ' + orderType + '   Table: ' + (($('kb-table') || {}).value || '-') + '\n' + new Date().toLocaleString(), pit, ($('kb-instr') || {}).value || ''));
  };
  window.kbPrintBoth = async function () {
    if (combinedBusy || printBusy || orderType !== 'Take Away' || !cartItems().length) return;
    var billWindow = KitchenPrint.open();
    var kotWindow = window.open('', '_blank', 'width=340,height=560');
    if (!billWindow || !kotWindow) {
      if (billWindow) billWindow.close(); if (kotWindow) kotWindow.close();
      $('kb-quote-error').textContent = 'Allow print windows, then retry KOT + Bill.'; return;
    }
    var version = quoteVersion;
    combinedBusy = true; $('kb-print-both').disabled = true;
    try {
      var receipt = await getQuote();
      if (version !== quoteVersion) throw Error('The order changed while preparing print jobs. Retry.');
      if (Number(receipt.summary.total) <= 0) throw Error('Add items with a positive total before printing.');
      var items = cartItems().map(function (it) { return { name: it.productName, qty: it.quantity }; });
      kotWindow.document.write(slip('KITCHEN ORDER TICKET', 'Type: Take Away   ' + new Date().toLocaleString(), items, ($('kb-instr') || {}).value || ''));
      kotWindow.document.close(); kotWindow.focus(); setTimeout(function () { kotWindow.print(); }, 250);
      await KitchenPrint.customer(billWindow, receipt);
    } catch (error) {
      if (billWindow && !billWindow.closed) billWindow.close();
      if (kotWindow && !kotWindow.closed) kotWindow.close();
      $('kb-quote-error').textContent = error.message;
    } finally {
      combinedBusy = false; $('kb-print-both').disabled = orderType !== 'Take Away' || quoteTotal <= 0;
    }
  };
  window.kbPrintKot = function (id) {
    var o = orders[id]; if (!o) { alert('Order not found.'); return; }
    var w = window.open('', '_blank', 'width=340,height=560');
    if (!w) { alert('Allow pop-ups to print the KOT.'); return; }
    var body = new URLSearchParams(); body.append('kotId', id); body.append('moquiSessionToken', tok());
    fetch(base() + '/reprintKot', { method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:body.toString() })
      .then(function (r) { if (!r.ok) throw Error('Reprint failed'); return r.json(); })
      .then(function (result) {
        if (!result.success) throw Error('Reprint denied');
        w.document.write(slip('KOT #' + o.num, 'Table: ' + o.table + '   ' + o.time, o.items, ''));
        w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 250);
      }).catch(function () { w.close(); alert('Could not reprint this KOT. Refresh and try again.'); });
  };

  // ---- init: read embedded server data, prime a resumed draft ----
  (function init() {
    var el = $('kb-data');
    if (el) {
      try { orders = JSON.parse(el.getAttribute('data-orders') || '{}'); } catch (e) { orders = {}; }
      loadedDraftId = el.getAttribute('data-draftid') || '';
      var selected=el.getAttribute('data-selected-table');if(selected&&$('kb-table'))$('kb-table').value=selected;
      var dl = [];
      try { dl = JSON.parse(el.getAttribute('data-draftload') || '[]'); } catch (e) { dl = []; }
      if (dl.length) {
        var receiptLines = [];
        try { receiptLines = JSON.parse(el.getAttribute('data-draftreceipt') || '[]'); } catch (e) {}
        dl.forEach(function (it) {
          var saved = receiptLines.find(function (line) { return line.productId === it.productId; });
          var defaultPrice = menuPrice(it.productId), price = saved ? Number(saved.rate) : defaultPrice;
          cart[it.productId] = { id: it.productId, name: it.productName, price: price, qty: Number(it.quantity) || 1, manualPrice: price !== defaultPrice };
        });
        var b = $('kb-badge'); if (b && loadedDraftId) b.textContent = 'Editing Draft';
        var dt = el.getAttribute('data-drafttable'); if (dt && $('kb-table')) $('kb-table').value = dt;
        var dty = el.getAttribute('data-drafttype'); if (dty) setOrderType(dty);
        var di = el.getAttribute('data-draftinstr'); if (di && $('kb-instr')) $('kb-instr').value = di;
        if (el.getAttribute('data-drafttax') === 'N') kbTaxToggle();
      }
    }
    setOrderType(orderType);
    if (window.__kbKeyHandler) document.removeEventListener('keydown', window.__kbKeyHandler);
    window.__kbKeyHandler = function (event) {
      if (!root.isConnected || event.repeat || event.altKey || event.metaKey) return;
      var target = event.target;
      if (target && target.closest('input,textarea,select,[contenteditable="true"],dialog,[role="dialog"]')) return;
      if (event.key === ' ' && !event.ctrlKey && !root.classList.contains('view-active') && !root.classList.contains('view-completed') && !printBusy && quoteTotal > 0) {
        event.preventDefault(); kbPrintBill();
      } else if (event.key === 'Enter' && event.ctrlKey && !root.classList.contains('view-active') && !root.classList.contains('view-completed') && Object.keys(cart).length) {
        event.preventDefault(); kbSend();
      }
    };
    document.addEventListener('keydown', window.__kbKeyHandler);
    render();
  })();
})();
