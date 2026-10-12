/* Stock Levels presentation enhancement. Native query, controls and exports stay authoritative. */
(function () {
  'use strict';
  var moved = [], scheduled = false;
  function node(tag, cls, text) { var n = document.createElement(tag); n.className = cls || ''; if (text != null) n.textContent = text; return n; }
  function icon(name) { var n = node('span', 'material-icons', name); n.setAttribute('aria-hidden', 'true'); return n; }
  function button(label, glyph, action, cls) { var b = node('button', cls || 'sl-button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); if (glyph) b.appendChild(icon(glyph)); b.addEventListener('click', action); return b; }
  function chrome(root) {
    if (!root) {
      moved.reverse().forEach(function (m) { if (m.parent.isConnected) m.parent.insertBefore(m.link, m.next && m.next.parentNode === m.parent ? m.next : null); }); moved = [];
      return;
    }
    var side = document.querySelector('#zq-sidebar .zqs-scroll,#z-sidebar .zs-scroll');
    if (side && !moved.length) Array.from(side.querySelectorAll('a')).filter(function (a) { return /\/zenith\/(pricing|barcode|tax|expenses)(\/|$)/i.test(new URL(a.href, location.href).pathname); }).forEach(function (link) { moved.push({link:link,parent:link.parentNode,next:link.nextSibling}); side.appendChild(link); });
  }
  function enhance(root) {
    var card = root.querySelector('.sl-stock-card'), native = card && card.querySelector('.form-list-nav-row');
    if (!native) return;
    var pattern = /(\d+)\s*-\s*(\d+)\s*(?:\/|of)\s*(\d+)/i;
    var counter = Array.from(native.querySelectorAll('.q-pagination button,ul.pagination a,ul.pagination span')).find(function (n) { return pattern.test(n.textContent.replace(/,/g,'')); });
    var text = counter ? counter.textContent.replace(/,/g,'') : '', count = text.match(pattern), page = text.match(/(?:Page\s*)?(\d+)\s*(?:\/|of)\s*(\d+)/i);
    if (!count || !page) {
      if (native.querySelector('.q-pagination,ul.pagination')) return;
      var length = card.querySelectorAll('#StockLevelForm_table .tbody>.tr,#StockLevelForm_table>tbody>tr:not(.form-list-nav-row)').length;
      count = ['',length?'1':'0',String(length),String(length)]; page = ['','1','1'];
    }
    var signature = count.slice(1).join(':') + ':' + page.slice(1).join(':') + ':' + location.href;
    if (card.__stockNative === native && card.__stockSignature === signature) return;
    var previous = card.querySelector('.sl-toolbar'); if (previous) previous.remove();
    var toolbar = node('div','sl-toolbar'), left = node('div','sl-tools'), right = node('nav','sl-pagination'); right.setAttribute('aria-label','Stock levels pages');
    var find = Array.from(native.querySelectorAll('button,a')).find(function (n) { return /Find Options/.test(n.textContent); });
    if (find) { var findButton = button('Find Options','search',function () { find.click(); }); findButton.appendChild(node('span','','Find Options')); left.appendChild(findButton); }
    var csv = root.querySelector('#sl-hdr-export');
    if (csv) { var download = node('a','sl-button'); download.href = csv.href; download.appendChild(icon('file_download')); download.appendChild(node('span','','CSV')); left.appendChild(download); }
    var current = Math.max(1,+page[1]), pages = Math.max(1,+page[2]);
    if (+count[3] === 0) { count[1]='0'; count[2]='0'; }
    right.appendChild(node('span','sl-page-info','Page '+current+' of '+pages+' ('+count[1]+'-'+count[2]+' of '+count[3]+')'));
    var arrows = {}, qp = native.querySelector('.q-pagination');
    if (qp) ['skip_previous','fast_rewind','fast_forward','skip_next'].forEach(function (name) { arrows[name] = Array.from(qp.querySelectorAll('button')).find(function (b) { return b.textContent.indexOf(name)>=0; }); });
    else { var items = native.querySelectorAll('ul.pagination>li'); if (items.length >= 5) { arrows.skip_previous=items[0].querySelector('a'); arrows.fast_rewind=items[1].querySelector('a'); arrows.fast_forward=items[items.length-2].querySelector('a'); arrows.skip_next=items[items.length-1].querySelector('a'); } }
    function arrow(label,glyph,key) { var source=arrows[key],b=button(label,glyph,function () { source.click(); },'sl-page-button'); b.disabled=!source || source.disabled || source.classList.contains('disabled') || source.parentNode.classList.contains('disabled'); right.appendChild(b); }
    arrow('First page','first_page','skip_previous'); arrow('Previous page','keyboard_double_arrow_left','fast_rewind');
    var start=Math.max(1,Math.min(current-2,pages-4));
    for(var p=start;p<=Math.min(pages,start+4);p++) { var link=node('a','sl-page-button',String(p)),url=new URL(location.href); url.searchParams.set('pageIndex',String(p-1)); link.href=url.href; link.setAttribute('aria-label','Page '+p); if(p===current) {link.classList.add('current');link.setAttribute('aria-current','page');} right.appendChild(link); }
    arrow('Next page','keyboard_double_arrow_right','fast_forward'); arrow('Last page','last_page','skip_next');
    var size=node('label','sl-page-size'),select=node('select',''),nativeSize=native.querySelector('.q-btn-dropdown .block,select[name="pageSize"]');
    var chosen=new URL(location.href).searchParams.get('pageSize')||(nativeSize && (nativeSize.value || nativeSize.textContent.trim()))||'20'; select.setAttribute('aria-label','Rows per page');
    Array.from(new Set(['20','50','100',chosen])).forEach(function(value) {var option=node('option','',value);option.value=value;option.selected=value===chosen;select.appendChild(option);});
    select.addEventListener('change',function () { var url=new URL(location.href);url.searchParams.set('pageSize',select.value);url.searchParams.set('pageIndex','0');location.assign(url.href); }); size.appendChild(select);right.appendChild(size);
    var refresh=button('Refresh stock','refresh',function () {location.reload();});refresh.classList.add('sl-refresh');right.appendChild(refresh);
    toolbar.appendChild(left);toolbar.appendChild(right);
    var table=card.querySelector('#StockLevelForm_table');
    if (!table) return;
    if (!table.parentNode.classList.contains('sl-table-scroll')) {var scroll=node('div','sl-table-scroll');scroll.setAttribute('tabindex','0');scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Stock by warehouse table');table.parentNode.insertBefore(scroll,table);scroll.appendChild(table);}
    var empty=card.querySelector('.sl-empty');if(empty)empty.remove();
    if (+count[3]===0) {empty=node('div','sl-empty','No stock matches these filters. Use Find Options to change or clear your search.');empty.setAttribute('role','status');table.parentNode.after(empty);}
    table.parentNode.before(toolbar);card.classList.add('sl-enhanced');card.__stockNative=native;card.__stockSignature=signature;
    var filter=root.querySelector('.sl-filter');if(filter && !filter.__stockBound) {filter.addEventListener('click',function () {findButton ? findButton.click() : find && find.click();});filter.__stockBound=true;}
  }
  function scan() {scheduled=false;var root=document.getElementById('stockLevels');chrome(root);if(root)enhance(root);}
  function schedule() {if(!scheduled) {scheduled=true;requestAnimationFrame(scan);}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule);else schedule();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
})();
