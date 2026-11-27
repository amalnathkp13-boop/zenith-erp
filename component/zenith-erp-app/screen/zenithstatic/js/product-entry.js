/* Enhance only native product-entry forms; the existing transition still saves the line. */
(function () {
    'use strict';
    if (window.zenithProductEntryReady) return;
    window.zenithProductEntryReady = true;
    function setup(entry) {
        if (entry.dataset.ready) return;
        const source = entry.querySelector('.zpe-source');
        const host = entry.querySelector('.zpe-picker');
        if (!source || !host) return;
        entry.dataset.ready = 'true';
        const field = name => entry.querySelector('[name="' + name + '"]');
        const selectedName = entry.querySelector('[data-selected-name]');
        const status = entry.querySelector('.zpe-price-status');
        const form = entry.closest('form');
        const options = Array.from(source.options).filter(option => option.value);
        const search = document.createElement('input');
        search.type = 'search'; search.placeholder = 'Search name or code'; search.setAttribute('aria-label','Find a product');
        const grid = document.createElement('div'); grid.className = 'zpe-grid'; grid.setAttribute('role','group'); grid.setAttribute('aria-label','Choose a product');
        const result = document.createElement('p'); result.className = 'zpe-result'; result.setAttribute('role','status');
        const more = document.createElement('button'); more.type = 'button'; more.className = 'zpe-more'; more.textContent = 'More products';
        host.append(search,grid,result,more);
        source.classList.add('zpe-source-ready');
        let limit = 24, version = 0, timer;
        function setValues(values) {
            entry.dispatchEvent(new CustomEvent('zpe-values',{detail:values}));
            // Bootstrap widgets use DOM values; Quasar also receives the model patch above.
            for (const [key,value] of Object.entries(values)) {
                const input = field(key);
                if (input) input.value = value == null ? '' : value;
            }
        }
        function render() {
            const term = search.value.trim().toLocaleLowerCase();
            const matches = options.filter(option => (option.textContent + ' ' + (option.dataset.name||'') + ' ' + option.value).toLocaleLowerCase().includes(term));
            grid.replaceChildren();
            for (const option of matches.slice(0,limit)) {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'zpe-product';
                button.dataset.productId = option.value; button.setAttribute('aria-pressed',String(source.value === option.value));
                const title = option.dataset.name || option.textContent;
                for (const [tag,text,cls] of [['span',title.slice(0,1).toUpperCase(),'zpe-product-icon'],['strong',title,''],['small',option.dataset.code||'','']]) {
                    const element = document.createElement(tag); element.textContent = text; element.className = cls; if(cls)element.setAttribute('aria-hidden','true'); button.append(element);
                }
                if(option.dataset.mrp && entry.dataset.currency === 'INR') {
                    const price = document.createElement('span'); price.textContent = 'MRP ' + new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Number(option.dataset.mrp)); button.append(price);
                }
                button.addEventListener('click',()=>{
                    source.value = option.value; source.dispatchEvent(new Event('change',{bubbles:true}));
                    const values = {};
                    for(const key of ['description','itemDescription','partName']) if(field(key))values[key] = title;
                    for(const key of ['hsnSacCode','productTaxCode']) if(field(key))values[key] = option.dataset.taxCode||'';
                    if(field('quantity')&&!field('quantity').value)values.quantity='1';
                    setValues(values);
                    source.dispatchEvent(new Event('input',{bubbles:true}));
                    if(selectedName)selectedName.textContent = title;
                    grid.querySelectorAll('[data-product-id]').forEach(tile=>tile.setAttribute('aria-pressed',String(tile===button)));
                    lookup(true);
                });
                grid.append(button);
            }
            more.hidden = matches.length <= limit;
            result.textContent = matches.length ? '' : 'No products found.';
        }
        async function lookup(reset) {
            if(entry.dataset.salesPrice !== 'true')return;
            const current = ++version;
            const priceKey = field('amount')?'amount':'unitAmount';
            const quantity = field('quantity')?.value || '1';
            if(!source.value||!field(priceKey)||!(Number(quantity)>0))return;
            const values = {[priceKey]:''};setValues(values);
            status.textContent = 'Checking price…';
            const submit = entry.querySelector('[type=submit]');if(submit)submit.disabled=true;
            try {
                const url = new URL(entry.dataset.priceUrl,location.origin); url.search='';
                const params = new URLSearchParams({productId:source.value,quantity});
                if(entry.dataset.orderId)params.set('orderId',entry.dataset.orderId);else params.set('invoiceId',entry.dataset.invoiceId);
                const response = await fetch(url+'?'+params,{cache:'no-store'});if(!response.ok)throw Error('Price lookup');
                const price = await response.json();if(current!==version||!entry.isConnected)return;
                if(!price.description || price.currency!==entry.dataset.currency)throw Error('Price unavailable');
                const patch = {[priceKey]:price.unitAmount??''};
                if(reset&&field('taxPercentage')&&price.taxRate!=null)patch.taxPercentage=String(price.taxRate);
                setValues(patch);
                status.textContent = price.unitAmount==null?'Enter a unit price for this item.':'Unit price '+new Intl.NumberFormat('en-IN',{style:'currency',currency:price.currency,maximumFractionDigits:6}).format(Number(price.unitAmount));
            } catch(error) {
                if(current===version)status.textContent='Price unavailable. Enter the unit price or select the product again.';
            } finally {if(current===version&&submit)submit.disabled=false;}
        }
        source.addEventListener('invalid',event=>{event.preventDefault();search.focus();result.textContent='Choose a product before adding the item.';});
        search.addEventListener('input',()=>{limit=24;render();});
        more.addEventListener('click',()=>{limit+=24;render();});
        entry.addEventListener('input',event=>{
            if(event.target.name==='quantity' && entry.dataset.salesPrice==='true') {
                version++;clearTimeout(timer);timer=setTimeout(()=>lookup(false),180);
            }
        });
        entry.querySelector('[data-custom-item]')?.addEventListener('click',()=>{
            version++;clearTimeout(timer);source.value='';source.dispatchEvent(new Event('change',{bubbles:true}));
            const patch={};for(const key of ['description','itemDescription','partName','amount','unitAmount','hsnSacCode','productTaxCode'])if(field(key))patch[key]='';setValues(patch);
            if(selectedName)selectedName.textContent='Custom item';if(status)status.textContent='Enter the description and unit price.';
            const extra=entry.querySelector('details');if(extra)extra.open=true;
            const submit=entry.querySelector('[type=submit]');if(submit)submit.disabled=false;
            (field('description')||field('itemDescription'))?.focus();render();
        });
        render();
    }
    function scan(){document.querySelectorAll('.zpe-form').forEach(setup);}
    new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
})();
