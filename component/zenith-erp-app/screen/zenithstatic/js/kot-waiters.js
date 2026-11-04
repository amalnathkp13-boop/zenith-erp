/* Waiter Management actions for both /apps and /qapps. */
(function(){
            var tok=function(){ var t=''; try{ t=window.moqui.webrootVue.moquiSessionToken; }catch(e){} if(!t){ var h=document.getElementById('wf-token'); t=h?h.value:''; } return t; };
            var txUrl=function(n){ var prefix=location.pathname.indexOf('/qapps/')===0?'/qapps':'/apps'; return prefix + '/zenith' + (location.pathname.includes('/zenith/kot/') ? '/kot' : '/pos/Kitchen') + '/WaiterManagement/' + n; };
            var g=function(id){ var e=document.getElementById(id); return e?(e.value||'').trim():''; };
            window.wfReset=function(){
                document.getElementById('wf-id').value=''; document.getElementById('wf-name').value='';
                document.getElementById('wf-code').value='+91'; document.getElementById('wf-phone').value='';
                document.getElementById('wf-email').value=''; document.getElementById('wf-status').value='Y';
                document.getElementById('wf-notes').value=''; document.getElementById('wf-title').textContent='Add / Edit Waiter';
                Array.prototype.forEach.call(document.querySelectorAll('.wf-row'), function(r){ r.style.background=''; });
                var n=document.getElementById('wf-name'); if(n) n.focus();
            };
            window.wfSearch=function(){
                var q=(document.getElementById('wf-search').value||'').toLowerCase();
                Array.prototype.forEach.call(document.querySelectorAll('.wf-row'), function(r){ r.style.display = (r.getAttribute('data-search')||'').indexOf(q) !== -1 ? '' : 'none'; });
            };
            Array.prototype.forEach.call(document.querySelectorAll('.wf-edit'), function(b){
                b.addEventListener('click', function(){
                    var r=b.closest('.wf-row'); if(!r) return;
                    document.getElementById('wf-id').value=r.getAttribute('data-id');
                    document.getElementById('wf-name').value=r.getAttribute('data-name')||'';
                    var ph=r.getAttribute('data-phone')||''; var m=ph.match(/^(\+\d+)\s+(.*)$/);
                    if(m){ document.getElementById('wf-code').value=m[1]; document.getElementById('wf-phone').value=m[2]; }
                    else { document.getElementById('wf-code').value='+91'; document.getElementById('wf-phone').value=ph; }
                    document.getElementById('wf-email').value=r.getAttribute('data-email')||'';
                    document.getElementById('wf-status').value=(r.getAttribute('data-active')==='N')?'N':'Y';
                    document.getElementById('wf-notes').value=r.getAttribute('data-notes')||'';
                    document.getElementById('wf-title').textContent='Edit Waiter';
                    Array.prototype.forEach.call(document.querySelectorAll('.wf-row'), function(x){ x.style.background=''; });
                    r.style.background='#F5F3FF';
                    try{ document.getElementById('wf-name').scrollIntoView({block:'center'}); }catch(e){}
                });
            });
            window.wfSave=function(){
                var name=g('wf-name'); if(!name){ alert('Waiter Name is required.'); return; }
                var num=g('wf-phone'); if(!num){ alert('Phone Number is required.'); return; }
                var phone=(g('wf-code')+' '+num).trim();
                var id=g('wf-id'); var upd=!!id;
                var body=new URLSearchParams();
                if(upd) body.append('waiterId', id);
                body.append('waiterName', name); body.append('phone', phone); body.append('email', g('wf-email'));
                body.append('isActive', document.getElementById('wf-status').value); body.append('notes', g('wf-notes'));
                body.append('moquiSessionToken', tok());
                var btn=document.getElementById('wf-save'); btn.disabled=true; btn.textContent='Saving...';
                fetch(txUrl(upd?'updateWaiter':'createWaiter'),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body,credentials:'same-origin'})
                    .then(function(r){ if(!r.ok) throw Error('Save failed'); location.href=r.url||location.href; }).catch(function(){ btn.disabled=false; btn.textContent='Save Waiter'; alert('Save failed - please try again.'); });
            };
            window.wfDel=function(id){
                if(!confirm('Delete this waiter? This cannot be undone.')) return;
                var body=new URLSearchParams(); body.append('waiterId', id); body.append('moquiSessionToken', tok());
                fetch(txUrl('deleteWaiter'),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body,credentials:'same-origin'})
                    .then(function(r){ if(!r.ok) throw Error('Delete failed'); location.href=r.url||location.href; }).catch(function(){ alert('Delete failed.'); });
            };
        })();
