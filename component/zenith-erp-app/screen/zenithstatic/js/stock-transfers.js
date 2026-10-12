/* Stock Transfers enhancement: native queries, dialogs and exports remain authoritative. */
(function () {
  'use strict';
  var scheduled = false, moved = [];
  function node(tag, cls, text) { var n = document.createElement(tag); n.className = cls || ''; if (text != null) n.textContent = text; return n; }
  function icon(name) { var n = node('span', 'material-icons', name); n.setAttribute('aria-hidden', 'true'); return n; }
  function button(label, glyph, action, cls) { var b = node('button', cls || 'st-page-button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); if (glyph) b.appendChild(icon(glyph)); b.addEventListener('click', action); return b; }
  function chrome(root) {
    if (!root) {
      moved.reverse().forEach(function (m) { if (m.parent.isConnected) m.parent.insertBefore(m.link, m.next && m.next.parentNode === m.parent ? m.next : null); }); moved = [];
      return;
    }
    var side = document.querySelector('#zq-sidebar .zqs-scroll,#z-sidebar .zs-scroll');
    if (side && !moved.length) Array.from(side.querySelectorAll('a')).filter(function (a) { return /\/zenith\/(pricing|barcode|tax|expenses)(\/|$)/i.test(new URL(a.href, location.href).pathname); }).forEach(function (link) { moved.push({link:link,parent:link.parentNode,next:link.nextSibling}); side.appendChild(link); });
  }
  function enhance(root) {
    var card = root.querySelector('.st-stock-card'), native = card && card.querySelector('.form-list-nav-row');
    if (!native) return;
    var pattern = /(\d+)\s*-\s*(\d+)\s*(?:\/|of)\s*(\d+)/i;
    var counter = Array.from(native.querySelectorAll('.q-pagination button,ul.pagination a,ul.pagination span')).find(function (n) { return pattern.test(n.textContent.replace(/,/g,'')); });
    var text = counter ? counter.textContent.replace(/,/g,'') : '', count = text.match(pattern), page = text.match(/(?:Page\s*)?(\d+)\s*(?:\/|of)\s*(\d+)/i);
    if (!count || !page) {
      if (native.querySelector('.q-pagination,ul.pagination')) return;
      var length = card.querySelectorAll('#TransferListForm_table .tbody>.tr,#TransferListForm_table>tbody>tr:not(.form-list-nav-row)').length;
      count = ['',length?'1':'0',String(length),String(length)]; page = ['','1','1'];
    }
    var signature = count.slice(1).join(':') + ':' + page.slice(1).join(':') + ':' + location.href;
    if (card.__transferNative === native && card.__transferSignature === signature) return;
    var head = card.querySelector('.st-card-head'), table = card.querySelector('#TransferListForm_table');
    if (!head || !table) return;
    head.querySelectorAll('.st-pagination,.st-tools').forEach(function (n) { n.remove(); });
    var find = Array.from(native.querySelectorAll('button,a')).find(function (n) { return /Find Options/.test(n.textContent); });
    var tools = node('details','st-tools'), summary = node('summary',''); summary.setAttribute('aria-label','Table options'); summary.appendChild(icon('more_horiz')); tools.appendChild(summary);
    var options = node('div','st-table-options');
    if (find) { var f = button('Find Options','search',function () { tools.open=false;find.click(); }); f.appendChild(node('span','','Find Options')); options.appendChild(f); }
    var csv = Array.from(native.querySelectorAll('a')).find(function (a) { return /CSV/.test(a.textContent) || /renderMode=csv/.test(a.href); });
    if (csv) { var download = node('a','','CSV'); download.href=csv.href;download.prepend(icon('file_download'));options.appendChild(download); }
    var size=node('label','','Rows'),select=node('select',''),nativeSize=native.querySelector('.q-btn-dropdown .block,select[name="pageSize"]');
    var chosen=new URL(location.href).searchParams.get('pageSize')||(nativeSize && (nativeSize.value || nativeSize.textContent.trim()))||'20'; select.setAttribute('aria-label','Rows per page');
    Array.from(new Set(['20','50','100',chosen])).forEach(function(value) {var option=node('option','',value);option.value=value;option.selected=value===chosen;select.appendChild(option);});
    select.addEventListener('change',function () { var url=new URL(location.href);url.searchParams.set('pageSize',select.value);url.searchParams.set('pageIndex','0');location.assign(url.href); }); size.appendChild(select);options.appendChild(size);
    var refresh=button('Refresh transfers','refresh',function () {location.reload();});refresh.appendChild(node('span','','Refresh'));options.appendChild(refresh);tools.appendChild(options);head.appendChild(tools);
    var pager=node('nav','st-pagination');pager.setAttribute('aria-label','Stock transfers pages');
    var current=Math.max(1,+page[1]),pages=Math.max(1,+page[2]);if(+count[3]===0) {count[1]='0';count[2]='0';}
    pager.appendChild(node('span','st-page-info','Page '+current+' of '+pages+' ('+count[1]+'-'+count[2]+' of '+count[3]+')'));
    function link(label,p,glyph) {var a=node('a','st-page-button',glyph?null:String(p)),url=new URL(location.href);url.searchParams.set('pageIndex',String(p-1));a.href=url.href;a.setAttribute('aria-label',label);if(glyph)a.appendChild(icon(glyph));if(!glyph&&p===current){a.classList.add('current');a.setAttribute('aria-current','page');}pager.appendChild(a);}
    function arrow(label,p,glyph,enabled) {if(enabled)link(label,p,glyph);else {var b=button(label,glyph,function () {});b.disabled=true;pager.appendChild(b);}}
    arrow('First page',1,'first_page',current>1);arrow('Previous page',current-1,'chevron_left',current>1);
    var start=Math.max(1,Math.min(current-2,pages-4));
    for(var p=start;p<=Math.min(pages,start+4);p++)link('Page '+p,p);
    if(start+4<pages){pager.appendChild(node('span','st-page-button','…'));link('Page '+pages,pages);}
    arrow('Next page',current+1,'chevron_right',current<pages);head.appendChild(pager);
    if(!table.parentNode.classList.contains('st-table-scroll')){var scroll=node('div','st-table-scroll');scroll.setAttribute('tabindex','0');scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Stock transfers table');table.parentNode.insertBefore(scroll,table);scroll.appendChild(table);}
    var empty=card.querySelector('.st-empty');if(empty)empty.remove();if(+count[3]===0){empty=node('div','st-empty','No transfers match these filters. Use Filters to change or clear your search.');empty.setAttribute('role','status');table.parentNode.after(empty);}
    card.classList.add('st-enhanced');card.__transferNative=native;card.__transferSignature=signature;
    var filter=root.querySelector('.st-filter');if(filter)filter.onclick=function () {if(find)find.click();};
  }
  document.addEventListener('click',function (event) {
    var root=document.getElementById('stockTransfers');if(!root)return;
    var logistics=event.target.closest('.st-logistics-proxy');
    if(logistics){var row=logistics.closest('.tr,tr'),source=row&&row.querySelector('.st-native-logistics button,.st-native-logistics a');if(source){logistics.closest('details').open=false;source.click();}}
    root.querySelectorAll('details[open]').forEach(function(d){if(!d.contains(event.target))d.open=false;});
  });
  document.addEventListener('keydown',function(event){if(event.key==='Escape'){var root=document.getElementById('stockTransfers');if(root)root.querySelectorAll('details[open]').forEach(function(d){d.open=false;d.querySelector('summary').focus();});}});
  document.addEventListener('toggle',function(event){
    var menu=event.target;if(!menu.matches('#stockTransfers .st-row-menu')||!menu.open)return;
    document.querySelectorAll('#stockTransfers details[open]').forEach(function(other){if(other!==menu)other.open=false;});
    var popup=menu.querySelector('.st-row-options'),anchor=menu.querySelector('summary').getBoundingClientRect();
    popup.style.left=Math.max(8,Math.min(innerWidth-popup.offsetWidth-8,anchor.right-popup.offsetWidth))+'px';
    var height=popup.offsetHeight,below=anchor.bottom+4;
    popup.style.top=(below+height<=innerHeight-8?below:Math.max(8,anchor.top-height-4))+'px';
  },true);
  function closeRowMenus(){document.querySelectorAll('#stockTransfers .st-row-menu[open]').forEach(function(menu){menu.open=false;});}
  window.addEventListener('resize',closeRowMenus);
  document.addEventListener('scroll',function(event){if(!event.target.closest||!event.target.closest('.st-row-options'))closeRowMenus();},true);
  function confirmAction(form){
    var root=document.getElementById('stockTransfers');if(!root||root.querySelector('.st-confirm-dialog[open]'))return;
    var label=form.querySelector('button[type="submit"]').textContent.trim(),dialog=node('dialog','st-confirm-dialog');
    var title=node('h2','',label==='Delete draft'?'Delete draft transfer':label+' transfer');title.id='st-confirm-title';dialog.setAttribute('aria-labelledby',title.id);
    var message=node('p','',form.dataset.confirm);message.id='st-confirm-message';dialog.setAttribute('aria-describedby',message.id);
    var actions=node('div','st-confirm-actions'),cancel=button('Cancel',null,function(){dialog.close();},'st-confirm-cancel');cancel.textContent='Cancel';cancel.autofocus=true;
    var confirm=button(label,null,function(){confirm.disabled=true;HTMLFormElement.prototype.submit.call(form);},label==='Delete draft'?'st-confirm-submit st-confirm-delete':'st-confirm-submit');confirm.textContent=label;
    actions.append(cancel,confirm);dialog.append(title,message,actions);root.appendChild(dialog);
    dialog.addEventListener('close',function(){dialog.remove();var summary=form.closest('details')?.querySelector('summary');if(summary)summary.focus();});
    dialog.showModal();
  }
  document.addEventListener('click',function(event){var submit=event.target.closest('#stockTransfers .st-action-form button[type="submit"]');if(submit){event.preventDefault();event.stopImmediatePropagation();confirmAction(submit.form);}},true);
  document.addEventListener('submit',function(event){var form=event.target;if(form.matches('#stockTransfers .st-action-form')){event.preventDefault();event.stopImmediatePropagation();confirmAction(form);}},true);
  function scan(){scheduled=false;var root=document.getElementById('stockTransfers');chrome(root);if(root)enhance(root);}
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(scan);}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule);else schedule();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
})();
