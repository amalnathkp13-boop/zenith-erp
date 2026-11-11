(() => {
  'use strict';

  const filters = ['catalogCategoryId', 'mrpMin', 'mrpMax', 'catalogTaxCode', 'gstRates'];
  const clearedFilters = Object.fromEntries(filters.map(field => [field, '']));
  const initialized = new WeakSet();

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = value;
    return node;
  }

  function icon(name) {
    const node = element('span', 'material-icons', name);
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function mount(root) {
    initialized.add(root);
    const amountFormat = new Intl.NumberFormat(root.dataset.currency === '₹' ? 'en-IN' : undefined,
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const form = root.querySelector('#CatalogSearchForm');
    const search = root.querySelector('#catalogSearch');
    const list = root.querySelector('#catalog-suggestions');
    const panel = root.querySelector('#catalogFilters');
    const body = root.querySelector('tbody');
    const exportLink = root.querySelector('.catalog-export');
    const feedback = root.querySelector('[data-catalog-feedback]');
    const status = root.querySelector('#catalogStatus');
    const retry = root.querySelector('[data-catalog-retry]');
    const filterError = root.querySelector('[data-filter-error]');
    const pageSize = root.querySelector('.catalog-page-size select');
    const pager = root.querySelector('.catalog-pagination');
    const count = root.querySelector('[data-catalog-count]');
    const badge = root.querySelector('[data-filter-count]');
    const closeFilters = root.querySelector('[data-close-filters]');
    const clearFilters = root.querySelector('[data-clear-filters]');
    let requested = new URL(exportLink.href).searchParams;
    requested.delete('renderMode');
    requested.delete('lastStandalone');
    let controller;
    let timer;
    let suggestions = [];
    let selection = -1;
    let suggest = false;

    closeFilters.hidden = false;
    // The shared QVT renderer can generate /apps URLs even when the browser is on /qapps.
    root.querySelectorAll('a[href]').forEach(link => { link.href = url(link.href, []); });

    function url(base, params) {
      const target = new URL(base, location.href);
      if (location.pathname.startsWith('/qapps/') && target.pathname.startsWith('/apps/')) {
        target.pathname = '/q' + target.pathname.slice(1);
      }
      for (const [key, value] of params) target.searchParams.set(key, value);
      return target.href;
    }

    function pageUrl(params) {
      return url(root.dataset.catalogUrl, params);
    }

    function copyWith(params, values) {
      const copy = new URLSearchParams(params);
      for (const [key, value] of Object.entries(values)) {
        if (value == null || value === '') copy.delete(key);
        else copy.set(key, value);
      }
      return copy;
    }

    function setStatus(message, canRetry = false) {
      status.textContent = message;
      feedback.hidden = !message;
      retry.hidden = !canRetry;
    }

    function setFilterError(message) {
      filterError.textContent = message;
      filterError.hidden = !message;
    }

    function hideSuggestions() {
      selection = -1;
      list.hidden = true;
      list.replaceChildren();
      search.setAttribute('aria-expanded', 'false');
      search.removeAttribute('aria-activedescendant');
    }

    function renderSuggestions(products) {
      hideSuggestions();
      suggestions = products;
      if (!suggest || document.activeElement !== search || !suggestions.length) return;
      suggestions.forEach((product, index) => {
        const option = element('li', 'catalog-suggestion');
        option.id = 'catalog-option-' + index;
        option.dataset.catalogOption = index;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.append(element('strong', '', product.productName), element('span', '', product.pseudoId || product.productId));
        list.append(option);
      });
      list.hidden = false;
      search.setAttribute('aria-expanded', 'true');
    }

    function selectSuggestion(product) {
      search.value = product.productName || product.pseudoId || product.productId;
      suggest = false;
      hideSuggestions();
      refresh(copyWith(requested, {
        catalogSearch: search.value,
        catalogMode: 'product',
        catalogProductId: product.productId,
        pageIndex: 0
      }));
    }

    function renderRows(rows) {
      const rendered = rows.map(product => {
        const row = element('tr');
        const name = element('span', '', product.productName || '—');
        name.title = product.productName || '';
        const titleCell = element('td', 'catalog-item-name');
        titleCell.append(name);
        const view = element('a', 'catalog-view');
        view.href = url(root.dataset.viewUrl, new URLSearchParams({ productId: product.productId }));
        view.setAttribute('aria-label', 'View ' + (product.productName || product.productId));
        view.append(icon('visibility'), ' View');
        const actions = element('td', 'catalog-view-cell');
        actions.append(view);
        row.append(
          element('td', 'catalog-item-code', product.pseudoId || product.productId),
          titleCell,
          element('td', '', product.gstRate == null ? '—' : product.gstRate + '%'),
          element('td', '', product.uqcEnumId || '—'),
          element('td', 'catalog-amount', product.mrpAmount == null ? '—' : amountFormat.format(product.mrpAmount)),
          element('td', '', product.catalogTaxCode || '—'),
          actions
        );
        return row;
      });
      if (!rendered.length) {
        const row = element('tr');
        const cell = element('td', 'catalog-empty', 'No matching products.');
        cell.colSpan = 7;
        row.append(cell);
        rendered.push(row);
      }
      body.replaceChildren(...rendered);
    }

    function renderNavigation(result) {
      const index = result.pageIndex;
      const size = result.pageSize;
      const total = result.total;
      const last = Math.max(0, Math.ceil(total / size) - 1);
      const start = Math.max(0, Math.min(index - 2, last - 4));
      const focused = pager.contains(document.activeElement);
      const page = (number, label, content) => {
        const enabled = number >= 0 && number <= last;
        const link = element(enabled ? 'a' : 'button', 'catalog-page', content);
        link.setAttribute('aria-label', label);
        if (enabled) {
          link.href = pageUrl(copyWith(requested, { pageIndex: number }));
          link.dataset.catalogPage = number;
          if (number === index) {
            link.classList.add('is-current');
            link.setAttribute('aria-current', 'page');
          }
        } else {
          link.type = 'button';
          link.disabled = true;
        }
        return link;
      };
      const links = [page(index - 1, 'Previous page', '«')];
      for (let number = start; number <= Math.min(last, start + 4); number++) {
        links.push(page(number, 'Page ' + (number + 1), number + 1));
      }
      links.push(page(index + 1, 'Next page', '»'));
      pager.replaceChildren(...links);
      if (focused) pager.querySelector('[aria-current]')?.focus({ preventScroll: true });
      count.textContent = total ? 'Showing ' + (index * size + 1) + '–' + Math.min(total, (index + 1) * size) + ' of ' + total : '0 products';
      pageSize.value = size;

      const sort = (requested.get('orderByField') || '').split(',')[0];
      root.querySelectorAll('[data-catalog-sort]').forEach(link => {
        const field = link.dataset.catalogSort;
        const direction = sort === field ? 'ascending' : sort === '-' + field ? 'descending' : 'none';
        link.closest('th').setAttribute('aria-sort', direction);
        link.querySelector('.material-icons').textContent =
          direction === 'ascending' ? 'arrow_upward' : direction === 'descending' ? 'arrow_downward' : 'unfold_more';
        link.href = pageUrl(copyWith(requested, { orderByField: sort === field ? '-' + field : field, pageIndex: 0 }));
      });
      form.elements.namedItem('orderByField').value = sort;
      form.elements.namedItem('catalogMode').value = requested.get('catalogMode') || 'live';
      form.elements.namedItem('catalogProductId').value = requested.get('catalogProductId') || '';
      const filterCount = ['catalogCategoryId', 'catalogTaxCode', 'gstRates'].filter(field => requested.has(field)).length +
        Number(requested.has('mrpMin') || requested.has('mrpMax'));
      badge.textContent = filterCount;
      badge.hidden = !filterCount;
      clearFilters.href = pageUrl(copyWith(requested, { ...clearedFilters, pageIndex: 0 }));
      exportLink.href = pageUrl(copyWith(requested, { renderMode: 'csv', lastStandalone: 'true' }));
    }

    function refresh(params, delay = 0) {
      requested = params;
      clearTimeout(timer);
      controller?.abort();
      const request = new AbortController();
      controller = request;
      exportLink.setAttribute('aria-disabled', 'true');
      body.setAttribute('aria-busy', 'true');
      setStatus('Loading products…');

      async function load() {
        try {
          const response = await fetch(url(root.dataset.queryUrl, params), {
            signal: request.signal,
            headers: { Accept: 'application/json' }
          });
          const result = await response.json();
          if (request.signal.aborted || !root.isConnected) return;
          if (!response.ok || !Array.isArray(result.rows) || !result.params) throw new Error();
          if (result.error) {
            setStatus(result.error);
            return;
          }
          requested = copyWith(new URLSearchParams(), result.params);
          renderRows(result.rows);
          renderNavigation(result);
          renderSuggestions(result.suggestions || []);
          setStatus(result.barcodeMiss ? 'No product found for this barcode.' : '');
          history.replaceState(history.state, '', pageUrl(requested));
          exportLink.removeAttribute('aria-disabled');
        } catch {
          if (!request.signal.aborted && root.isConnected) setStatus('Could not refresh products. Try again.', true);
        } finally {
          if (!request.signal.aborted) body.removeAttribute('aria-busy');
        }
      }

      if (delay) timer = setTimeout(load, delay);
      else load();
    }

    function submitSearch(mode, delay = 0) {
      suggest = mode === 'live' && !!search.value.trim();
      hideSuggestions();
      refresh(copyWith(requested, { catalogSearch: search.value.trim(), catalogMode: mode, catalogProductId: '', pageIndex: 0 }), delay);
    }

    search.addEventListener('input', () => submitSearch('live', 180));
    search.addEventListener('blur', () => {
      suggest = false;
      hideSuggestions();
    });
    search.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        suggest = false;
        hideSuggestions();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (selection >= 0 && !list.hidden) selectSuggestion(suggestions[selection]);
        else submitSearch('scan');
      } else if (!list.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const last = suggestions.length - 1;
        selection = event.key === 'ArrowDown' ? (selection === last ? 0 : selection + 1) : (selection <= 0 ? last : selection - 1);
        Array.from(list.children).forEach((option, index) => option.setAttribute('aria-selected', index === selection ? 'true' : 'false'));
        search.setAttribute('aria-activedescendant', list.children[selection].id);
        list.children[selection].scrollIntoView({ block: 'nearest' });
      }
    });
    list.addEventListener('pointerdown', event => event.preventDefault());
    list.addEventListener('click', event => {
      const option = event.target.closest('[data-catalog-option]');
      if (option) selectSuggestion(suggestions[Number(option.dataset.catalogOption)]);
    });

    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!event.submitter?.hasAttribute('data-apply-filters')) {
        submitSearch('live');
        return;
      }
      const values = new FormData(form);
      const min = values.get('mrpMin');
      const max = values.get('mrpMax');
      if (min !== '' && max !== '' && Number(min) > Number(max)) {
        setFilterError('Minimum MRP must be less than or equal to maximum MRP.');
        return;
      }
      setFilterError('');
      panel.open = false;
      panel.querySelector('summary').focus();
      const applied = Object.fromEntries(filters.map(field => [field, values.getAll(field).join(',').trim()]));
      refresh(copyWith(requested, { ...applied, pageIndex: 0 }));
    });
    form.addEventListener('invalid', event => {
      if (['mrpMin', 'mrpMax'].includes(event.target.name)) {
        panel.open = true;
        setFilterError('Enter a non-negative MRP with up to two decimal places.');
      }
    }, true);

    function closePanel() {
      panel.open = false;
      panel.querySelector('summary').focus();
    }

    closeFilters.addEventListener('click', closePanel);
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && panel.open) {
        event.preventDefault();
        closePanel();
      }
    });
    clearFilters.addEventListener('click', event => {
      event.preventDefault();
      filters.forEach(field => {
        form.querySelectorAll('[name="' + field + '"]').forEach(input => {
          if (input.type === 'checkbox') input.checked = false;
          else input.value = '';
        });
      });
      setFilterError('');
      closePanel();
      refresh(copyWith(requested, { ...clearedFilters, pageIndex: 0 }));
    });
    pageSize.addEventListener('change', () => refresh(copyWith(requested, { pageSize: pageSize.value, pageIndex: 0 })));
    retry.addEventListener('click', () => refresh(requested));
    exportLink.addEventListener('click', event => {
      if (exportLink.hasAttribute('aria-disabled')) event.preventDefault();
    });
    root.addEventListener('click', event => {
      const link = event.target.closest('a[data-catalog-sort],a[data-catalog-page]');
      if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (link.dataset.catalogSort) {
        const field = link.dataset.catalogSort;
        const sort = (requested.get('orderByField') || '').split(',')[0];
        refresh(copyWith(requested, { orderByField: sort === field ? '-' + field : field, pageIndex: 0 }));
      } else {
        refresh(copyWith(requested, { pageIndex: link.dataset.catalogPage }));
      }
    });
    if (search.value.trim() !== (requested.get('catalogSearch') || '')) submitSearch('live');
  }

  let pending = false;
  function scan() {
    pending = false;
    const catalog = document.getElementById('productCatalog');
    if (!catalog) return;
    const createIcon = catalog.querySelector('.catalog-create .q-icon');
    if (createIcon && createIcon.textContent !== 'add') createIcon.textContent = 'add';
    const root = catalog.querySelector('[data-product-catalog]');
    if (root && !initialized.has(root)) mount(root);
  }
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(scan);
  }

  schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
