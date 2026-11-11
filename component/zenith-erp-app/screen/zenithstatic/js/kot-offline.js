/* KOT-only device drafts, catalog and pending orders. */
(function () {
  'use strict';
  if (!window.KotOfflineDrafts) {
    const draftIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
    function createStore(organizationId, terminalId, userId) {
      if (!organizationId || !terminalId || !userId) throw Error('Open a KOT counter to access its device drafts.');
      const prefix = 'zenith:kot:draft:' + JSON.stringify([organizationId, terminalId, userId]) + ':';
      function key(id) {
        if (!draftIdPattern.test(id)) throw Error('Invalid device draft.');
        return prefix + id;
      }
      function read(id) {
        try {
          const draft = JSON.parse(localStorage.getItem(key(id)));
          return draft?.id === id && draft.savedAt && draft.order?.itemsJson ? draft : null;
        } catch (error) {
          if (error instanceof SyntaxError) return null;
          throw error;
        }
      }
      function list() {
        return Object.keys(localStorage).filter(name => name.startsWith(prefix))
          .map(name => name.slice(prefix.length)).filter(id => draftIdPattern.test(id))
          .map(read).filter(Boolean).sort((first, second) => first.savedAt.localeCompare(second.savedAt));
      }
      function save(order) {
        const id = crypto.randomUUID();
        const draft = {id, savedAt:new Date().toISOString(), lines:JSON.parse(order.itemsJson).length, order};
        localStorage.setItem(key(id), JSON.stringify(draft));
        return draft;
      }
      return {read, list, save, remove:id => localStorage.removeItem(key(id))};
    }
    function describe(draft) {
      const type = draft.order.orderType === 'Take Away' ? 'Take Away' : 'Dine In';
      return type + ' · ' + draft.lines + (draft.lines === 1 ? ' item line' : ' item lines') +
        ' · ' + new Date(draft.savedAt).toLocaleString();
    }
    window.KotOfflineDrafts = {createStore, describe};
  }

  const roundMoney = amount => Math.round((amount + Number.EPSILON * Math.max(1, Math.abs(amount))) * 100) / 100;
  const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
  const exactCode = value => normalize(value).replace(/[-\s]/g, '');
  function createWorkspace(organizationId, terminalId, userId) {
    if (!organizationId || !terminalId || !userId) throw Error('Open a KOT counter to access its offline workspace.');
    const identity = [organizationId, terminalId, userId];
    const scope = JSON.stringify(identity);
    const prefix = 'zenith:kot:offline:' + scope + ':';
    function read(key) {
      try { return JSON.parse(localStorage.getItem(prefix + key)); }
      catch (error) { if (error instanceof SyntaxError) return null; throw error; }
    }
    function write(key, value) { localStorage.setItem(prefix + key, JSON.stringify(value)); }
    function remove(key) { localStorage.removeItem(prefix + key); }
    function queue() {
      return Object.keys(localStorage).filter(key => key.startsWith(prefix + 'queue:'))
        .map(key => read(key.slice(prefix.length)))
        .filter(row => row?.sale?.offlineId)
        .sort((first, second) => first.sale.ts.localeCompare(second.sale.ts));
    }
    let database;
    function catalog(mode, action) {
      database ||= new Promise((resolve, reject) => {
        const open = indexedDB.open('zenith-kot-offline', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('workspaces');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(Error('Offline storage is busy.'));
      });
      return database.then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('workspaces', mode);
        const request = action(tx.objectStore('workspaces'));
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(tx.error || Error('Offline storage failed.'));
      }));
    }
    return {
      readCatalog: () => catalog('readonly', store => store.get(scope)),
      saveCatalog: value => catalog('readwrite', store => store.put(value, scope)),
      readOrder: session => read('order:' + session),
      saveOrder: (session, order) => write('order:' + session, order),
      removeOrder: session => remove('order:' + session),
      queue,
      enqueue: row => write('queue:' + row.sale.offlineId, row),
      removeSale: id => remove('queue:' + id),
    };
  }
  function indexWorkspace(workspace) {
    const sorted = [...workspace.products].sort((first, second) =>
      (first.productName || first.productId).localeCompare(second.productName || second.productId, 'en-IN'));
    const products = new Map(sorted.map(product => {
      const name = product.productName || product.productId;
      const codes = [product.productId, product.barcode, ...(product.aliases || [])].filter(Boolean);
      return [product.productId, {...product, productName: name,
        codes: codes.map(exactCode), names: [name, ...codes].map(normalize)}];
    }));
    return {products, modes: new Map(workspace.modes.map(mode => [mode.id, mode]))};
  }
  function lookup(index, value, mode, category, offset) {
    // Preserve a trailing word separator so "PP " starts with the PP sizes, as in POS.
    const term = value.trim() ? value.normalize('NFKC').toLowerCase().trimStart().replace(/\s+/g, ' ') : '';
    const code = exactCode(value);
    const exact = [], prefix = [], remainder = [];
    for (const product of index.products.values()) {
      if (category && !(product.categoryIds || []).includes(category)) continue;
      if (code && product.codes.includes(code)) exact.push(product);
      else if (term && product.names[0].startsWith(term)) prefix.push(product);
      else if (!term || product.names.some(name => name.includes(term))) remainder.push(product);
    }
    const matches = exact.concat(prefix, remainder);
    return {
      products: matches.slice(offset, offset + 40).map(product => ({
        id: product.productId,
        name: product.productName,
        code: product.barcode,
        price: product.prices?.[mode]?.blocked ? null : product.prices?.[mode]?.price ?? null,
      })),
      exactId: exact.length === 1 ? exact[0].productId : null,
      ambiguous: exact.length > 1,
      hasMore: matches.length > offset + 40,
    };
  }
  function quote(index, cart, modeId, taxOn, store) {
    const mode = index.modes.get(modeId);
    if (!mode) throw Error('Choose a sales mode available on this counter.');
    let subtotal = 0, tax = 0, totalQty = 0;
    const items = Array.from(cart, item => {
      const product = index.products.get(item.id), priceInfo = product?.prices?.[modeId];
      if (!priceInfo || priceInfo.blocked || priceInfo.price == null) throw Error(item.name + ' has no offline price for this sales mode.');
      const rate = Number(item.manualRate ?? priceInfo.price);
      if (!(rate > 0)) throw Error(item.name + ' needs a positive price. Approve free items online.');
      if (taxOn && !Array.isArray(product.taxRates)) throw Error('GST is unavailable offline for ' + item.name + '. Reconnect to verify its tax.');
      const gross = rate * item.qty, discount = roundMoney(gross * Number(priceInfo.disc || 0) / 100);
      const net = gross - discount, rates = taxOn ? product.taxRates.map(Number) : [];
      const rateTotal = rates.reduce((sum, value) => sum + value, 0);
      const inclusive = rateTotal > 0 && mode.inclusive;
      const taxable = inclusive ? roundMoney(net * 100 / (100 + rateTotal)) : net;
      const lineTax = inclusive ? roundMoney(roundMoney(net) - taxable)
        : roundMoney(rates.reduce((sum, value) => sum + roundMoney(taxable * value / 100), 0));
      subtotal += taxable;
      tax += lineTax;
      totalQty += item.qty;
      return {productId: item.id, name: product.productName, printName: product.printName, code: product.barcode,
        qty: item.qty, rate, total: taxable, tax: lineTax, discount, percent: Number(priceInfo.disc || 0),
        manualPrice: item.manualRate != null ? 'Y' : 'N', uom: product.uom};
    });
    const grand = subtotal + tax, total = Math.round(grand + Number.EPSILON * Math.max(1, grand));
    return {success: true, store, items, summary: {subtotal: roundMoney(subtotal), tax: roundMoney(tax),
      roundOff: roundMoney(total - grand), total, totalQty, itemCount: items.length}};
  }
  function describeQueue(row) {
    const {sale} = row, date = new Date(sale.ts).toLocaleString();
    return (sale.operation === 'send' ? 'Kitchen ticket' : 'Bill') + ' ' + sale.offlineId + ' · ' + date +
      (row.error ? ' · ' + row.error : ' · Pending sync');
  }
  window.KotOffline = {createWorkspace, indexWorkspace, lookup, quote, normalize, roundMoney, describeQueue};

  for (const list of document.querySelectorAll('[data-kot-device-queue]')) {
    const {organization, terminal, user} = list.dataset;
    const render = () => {
      try {
        const rows = createWorkspace(organization, terminal, user).queue().map(describeQueue);
        list.replaceChildren(...(rows.length ? rows : ['No KOT orders pending sync on this counter.']).map(message => {
          const row = document.createElement('li');
          row.textContent = message;
          return row;
        }));
      } catch {
        list.textContent = 'This browser could not read its pending KOT orders.';
      }
    };
    render();
    window.addEventListener('storage', render);
  }

  for (const list of document.querySelectorAll('[data-kot-device-drafts]')) {
    const {organization, terminal, user} = list.dataset;
    try {
      const drafts = window.KotOfflineDrafts.createStore(organization, terminal, user).list();
      const rows = drafts.map(draft => {
        const row = document.createElement('li');
        row.textContent = window.KotOfflineDrafts.describe(draft);
        return row;
      });
      if (!rows.length) {
        const empty = document.createElement('li');
        empty.textContent = 'No drafts saved on this device for this counter.';
        rows.push(empty);
      }
      list.replaceChildren(...rows);
    } catch {
      const error = document.createElement('li');
      error.textContent = 'This browser could not read its saved drafts.';
      list.replaceChildren(error);
    }
  }
})();
