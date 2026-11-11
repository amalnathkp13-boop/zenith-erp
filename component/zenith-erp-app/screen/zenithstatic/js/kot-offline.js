/* Device drafts for KOT. The browser never records a payment in this queue. */
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
