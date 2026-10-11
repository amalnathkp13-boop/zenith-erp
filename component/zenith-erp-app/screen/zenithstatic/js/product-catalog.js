/* Catalog-only enhancement. Native filters/export/navigation remain the fallback. */
(function () {
  'use strict';
  var movedLinks=[];
  function el(tag, cls, text) { var n=document.createElement(tag); n.className=cls||''; if(text!=null)n.textContent=text; return n; }
  function icon(name) { var n=el('span','material-icons',name); n.setAttribute('aria-hidden','true'); return n; }
  function button(label, glyph, action) { var b=el('button','catalog-button'); b.type='button'; b.title=label; b.setAttribute('aria-label',label); if(glyph)b.appendChild(icon(glyph)); b.addEventListener('click',action); return b; }
  function rowActions(root){
    root.querySelectorAll('#FindProductList_table .tbody > .tr, #FindProductList_table > tbody > tr:not(.form-list-nav-row)').forEach(function(row){var link=row.querySelector('.prod-code');if(!link||row.querySelector('.catalog-row-actions'))return;var cell=el(row.tagName==='TR'?'td':'div','td catalog-row-actions'),details=el('details','catalog-row-menu'),summary=el('summary','');summary.setAttribute('aria-label','Actions for '+link.textContent.trim());summary.appendChild(icon('more_vert'));var open=el('a','catalog-open','Open product');open.href=link.href;details.appendChild(summary);details.appendChild(open);cell.appendChild(details);row.appendChild(cell);});
    var heading=root.querySelector('#FindProductList_table .thead > .tr, #FindProductList_table > thead > tr:not(.form-list-nav-row):last-child');if(heading&&!heading.querySelector('.catalog-row-actions')){var th=el(heading.tagName==='TR'?'th':'div','th catalog-row-actions');th.setAttribute('aria-label','Product actions');heading.appendChild(th);}
  }
  function init(root) {
    var side=document.querySelector('#zq-sidebar .zqs-scroll,#z-sidebar .zs-scroll');
    if(side&&!movedLinks.length){Array.from(side.querySelectorAll('a')).filter(function(a){return /\/zenith\/(pricing|barcode|tax|expenses)(\/|$)/i.test(new URL(a.href,location.href).pathname);}).forEach(function(a){movedLinks.push({node:a,parent:a.parentNode,next:a.nextSibling});side.appendChild(a);});}
    var input=root.querySelector('input[name="catalogSearch"]');
    if(input){input.placeholder='Search by item code, product name, barcode...'; input.setAttribute('aria-label','Search products by item code, name or barcode');}
    root.querySelectorAll('.prod-code').forEach(function(a){a.title=a.textContent.trim();});
    var add=root.querySelector('.zc-page-head__actions .q-icon'); if(add&&add.textContent!=='add')add.textContent='add';
    var bootAdd=root.querySelector('#CreateProductDialog-button .fa');if(bootAdd&&!bootAdd.classList.contains('fa-plus'))bootAdd.className='fa fa-plus';
    var card=root.querySelector('.catalog-list'), native=card&&card.querySelector('.form-list-nav-row');
    if(!native)return;
    // Read the count control alone: adjacent numbered buttons concatenate into "12 / 2" on page two.
    var countPattern=/(\d+)\s*-\s*(\d+)\s*(?:\/|of)\s*(\d+)/i;
    var counter=Array.from(native.querySelectorAll('.q-pagination button,ul.pagination a,ul.pagination span')).find(function(n){return countPattern.test(n.textContent);});
    var text=counter?counter.textContent.replace(/,/g,''):'', count=text.match(countPattern), page=text.match(/(?:Page\s*)?(\d+)\s*(?:\/|of)\s*(\d+)/i);
    if(!count||!page){if(native.querySelector('.q-pagination,ul.pagination'))return;var visible=Array.from(card.querySelectorAll('.tbody > .tr,table > tbody > tr')).filter(function(row){return !!row.querySelector('.td:nth-child(2),td:nth-child(2)');}).length;count=['',visible?'1':'0',String(visible),String(visible)];page=['','1','1'];}
    var signature=count.slice(1).join(':')+':'+page.slice(1).join(':');
    if(card.__catalogSignature===signature){rowActions(root);return;}
    var previous=card.querySelector('.catalog-toolbar');if(previous)previous.remove();card.__catalogSignature=signature;
    var current=Math.max(1,+page[1]), pages=Math.max(1,+page[2]);
    if(+count[3]===0){count[1]='0';count[2]='0';}
    var tools=el('div','catalog-toolbar'), left=el('div','catalog-tools'), right=el('nav','catalog-pagination'); right.setAttribute('aria-label','Product catalog pages');
    var find=Array.from(native.querySelectorAll('button,a')).find(function(n){return /Find Options/.test(n.textContent);});
    if(find){var findButton=button('Find Options','search',function(){find.click();});findButton.appendChild(el('span','','Find Options'));left.appendChild(findButton);}
    var csv=native.querySelector('a[href*="renderMode=csv"]');
    if(csv){var download=el('a','catalog-button');download.href=csv.href;download.appendChild(icon('file_download'));download.appendChild(el('span','','CSV'));left.appendChild(download);}
    var info=el('span','catalog-page-info','Page '+current+' of '+pages+' ('+count[1]+'-'+count[2]+' of '+count[3]+')');right.appendChild(info);
    var arrows={};
    var qp=native.querySelector('.q-pagination');
    if(qp){['skip_previous','fast_rewind','fast_forward','skip_next'].forEach(function(name){arrows[name]=Array.from(qp.querySelectorAll('button')).find(function(b){return b.textContent.indexOf(name)>=0;});});}
    else {var items=native.querySelectorAll('ul.pagination > li'); if(items.length>=5){arrows.skip_previous=items[0].querySelector('a');arrows.fast_rewind=items[1].querySelector('a');arrows.fast_forward=items[items.length-2].querySelector('a');arrows.skip_next=items[items.length-1].querySelector('a');}}
    function arrow(label,glyph,key){var source=arrows[key],b=button(label,glyph,function(){source.click();});b.classList.add('catalog-page-button');b.disabled=!source||source.disabled||source.classList.contains('disabled');right.appendChild(b);}
    arrow('First page','first_page','skip_previous');arrow('Previous page','keyboard_double_arrow_left','fast_rewind');
    var start=Math.max(1,Math.min(current-2,pages-4));
    for(var p=start;p<=Math.min(pages,start+4);p++){
      var a=el('a','catalog-page-button',String(p));var url=new URL(location.href);url.searchParams.set('pageIndex',String(p-1));a.href=url.href;a.setAttribute('aria-label','Page '+p);
      if(p===current){a.classList.add('current');a.setAttribute('aria-current','page');}right.appendChild(a);
    }
    arrow('Next page','keyboard_double_arrow_right','fast_forward');arrow('Last page','last_page','skip_next');
    var refresh=button('Refresh products','refresh',function(){location.reload();});refresh.classList.add('catalog-refresh');right.appendChild(refresh);
    tools.appendChild(left);tools.appendChild(right);card.insertBefore(tools,card.firstChild);
    var table=card.querySelector('#FindProductList_table'); if(table&&!table.parentNode.classList.contains('catalog-table-scroll')){var scroll=el('div','catalog-table-scroll');scroll.setAttribute('tabindex','0');scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Product catalog table');table.parentNode.insertBefore(scroll,table);scroll.appendChild(table);}
    card.classList.add('catalog-enhanced');
    root.querySelectorAll('.form-order-by a').forEach(function(a){var u=new URL(a.href,location.href),field=u.searchParams.get('orderByField').replace(/^-/,'');var descending=!!a.querySelector('.fa-caret-down');u.searchParams.set('orderByField',(descending?'-':'')+field);u.searchParams.set('pageIndex','0');a.href=u.href;a.setAttribute('aria-label','Sort '+a.closest('.form-title').textContent.trim().replace(/[\u25b2\u25bc]/g,'')+(descending?' descending':' ascending'));});
    rowActions(root);
  }
  var scheduled=false;
  function scan(){scheduled=false;var root=document.getElementById('productCatalog');if(root)init(root);else {movedLinks.reverse().forEach(function(m){if(m.parent.isConnected)m.parent.insertBefore(m.node,m.next&&m.next.parentNode===m.parent?m.next:null);});movedLinks=[];}}
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(scan);}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule);else schedule();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
})();
