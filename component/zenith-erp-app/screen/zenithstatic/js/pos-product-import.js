/* Shared product import UI for both POS and KOT. */
(function () {
    'use strict';
    function piEsc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

    function piTok(){ var token=document.getElementById('pi-token'); if(token && token.value) return token.value; try{ if(window.moqui&&window.moqui.webrootVue&&window.moqui.webrootVue.moquiSessionToken) return window.moqui.webrootVue.moquiSessionToken; }catch(e){} return ''; }
    function piPost(url, params){
        var token=piTok();
        if(!token) return Promise.reject(new Error('Your session is unavailable. Refresh the page and try again.'));
        var p=new URLSearchParams(); for(var k in params){ p.append(k, params[k]==null?'':params[k]); } p.append('moquiSessionToken', token);
        return fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:p,credentials:'same-origin'}).then(function(r){
            if(!r.ok) throw new Error('Request failed (HTTP '+r.status+'). Refresh the page and try again.');
            return r.json();
        });
    }
    function g(id){ return document.getElementById(id); }
    var FIELDS = ['pi-sku','pi-name','pi-description','pi-listPrice','pi-mrp','pi-productTaxCode','pi-reorderPoint','pi-reorderQuantity','pi-expiryDate','pi-unit'];
    function wire(){
        var form = g('pi-form');
        if(!form || !g('pos-csv-text') || form.dataset.piBound) return;
        form.dataset.piBound='1';
        var s=g('pi-search'), results=g('pi-results'), modeEl=g('pi-mode'), resEl=g('pi-result'), sv=g('pi-save');
        var lastProducts=[]; var tmr=null;
        function setMode(sku){ if(!modeEl) return; modeEl.innerHTML = sku ? '<span style="color:#e65100;font-weight:600">✎ Updating existing product (SKU: '+piEsc(sku)+')</span>' : 'Adding a new product'; }
        function fillFrom(pr){ if(!pr) return; g('pi-sku').value=pr.sku; g('pi-name').value=pr.name; g('pi-description').value=pr.description; g('pi-listPrice').value=pr.price; g('pi-mrp').value=pr.price; g('pi-productTaxCode').value=pr.taxCode; g('pi-reorderPoint').value=pr.reorderPoint; g('pi-reorderQuantity').value=pr.reorderQuantity; if(g('pi-expiryDate')) g('pi-expiryDate').value=pr.expiryDate||''; if(g('pi-unit')) g('pi-unit').value=pr.unit||''; setMode(pr.sku); if(results){results.style.display='none';} if(s){s.value='';} if(resEl){resEl.innerHTML='';} }
        if(s){
            s.addEventListener('input', function(){
                clearTimeout(tmr); var q=s.value.trim();
                if(q.length<1){ results.style.display='none'; return; }
                tmr=setTimeout(function(){
                    piPost(form.dataset.searchUrl,{term:q}).then(function(d){
                        if(s.value.trim()!==q) return;
                        lastProducts=(d&&d.products)?d.products:[];
                        if(!lastProducts.length){ results.innerHTML='<div style="padding:10px;color:#999;font-size:13px">No match — fill the fields to add it as new</div>'; results.style.display='block'; return; }
                        var h=''; lastProducts.forEach(function(pr,i){ h+='<div class="pi-opt" data-i="'+i+'" style="padding:9px 11px;border-bottom:1px solid #f0f0f0;cursor:pointer;display:flex;justify-content:space-between;gap:8px"><span><b>'+piEsc(pr.name)+'</b> <span style="color:#999;font-size:12px">'+piEsc(pr.sku)+'</span></span><span style="color:#2e7d32;font-weight:700;white-space:nowrap">'+(pr.price!==''?('₹'+pr.price):'')+'</span></div>'; });
                        results.innerHTML=h; results.style.display='block';
                        results.querySelectorAll('.pi-opt').forEach(function(o){
                            o.addEventListener('mouseover', function(){ o.style.background='#ECE8FB'; });
                            o.addEventListener('mouseout', function(){ o.style.background='#fff'; });
                            o.addEventListener('click', function(){ fillFrom(lastProducts[parseInt(o.dataset.i)]); });
                        });
                    }).catch(function(error){
                        if(s.value.trim()!==q) return;
                        results.textContent=error.message;
                        results.style.display='block';
                    });
                }, 300);
            });
        }
        if(g('pi-sku')){ g('pi-sku').addEventListener('input', function(){ setMode(g('pi-sku').value.trim()); }); }
        if(g('pi-clear')){ g('pi-clear').addEventListener('click', function(){ FIELDS.forEach(function(id){ g(id).value=''; }); setMode(''); if(resEl){resEl.innerHTML='';} if(s){s.value='';} }); }
        if(sv){
            sv.addEventListener('click', function(){
                var name=g('pi-name').value.trim();
                if(!name){ resEl.innerHTML='<span style="color:#e53935">Product Name is required</span>'; g('pi-name').focus(); return; }
                sv.disabled=true; var ot=sv.innerHTML; sv.textContent='Saving...';
                piPost(form.dataset.saveUrl,{sku:g('pi-sku').value.trim(), productName:name, description:g('pi-description').value.trim(), listPrice:g('pi-listPrice').value.trim(), mrp:g('pi-mrp').value.trim(), productTaxCode:g('pi-productTaxCode').value.trim(), reorderPoint:g('pi-reorderPoint').value.trim(), reorderQuantity:g('pi-reorderQuantity').value.trim(), expiryDate:(g('pi-expiryDate')?g('pi-expiryDate').value.trim():''), unit:(g('pi-unit')?g('pi-unit').value:'')}).then(function(d){
                    sv.disabled=false; sv.innerHTML=ot;
                    if(d&&d.success){ resEl.innerHTML='<span style="color:#2e7d32;font-weight:700">✔ Product '+(d.created?'added':'updated')+': '+piEsc(d.name)+'</span>'; FIELDS.forEach(function(id){ g(id).value=''; }); setMode(''); }
                    else { resEl.innerHTML='<span style="color:#e53935">'+piEsc((d&&d.error)||'Error')+'</span>'; }
                }).catch(function(e){ sv.disabled=false; sv.innerHTML=ot; resEl.innerHTML='<span style="color:#e53935">'+piEsc(e.message)+'</span>'; });
            });
        }
        // CSV bulk import (file read client-side or paste)
        var tu=document.getElementById('imp-tab-upload'), tp=document.getElementById('imp-tab-paste');
        var up=document.getElementById('imp-upload-pane'), pp=document.getElementById('imp-paste-pane');
        function show(which){ var u=(which==='upload');
            if(tu){ tu.style.color=u?'#7C3AED':'#6B7280'; tu.style.borderBottomColor=u?'#7C3AED':'transparent'; tu.style.fontWeight=u?'600':'500'; }
            if(tp){ tp.style.color=!u?'#7C3AED':'#6B7280'; tp.style.borderBottomColor=!u?'#7C3AED':'transparent'; tp.style.fontWeight=!u?'600':'500'; }
            if(up) up.style.display=u?'block':'none'; if(pp) pp.style.display=u?'none':'block'; }
        if(tu) tu.addEventListener('click',function(){show('upload');});
        if(tp) tp.addEventListener('click',function(){show('paste');});
        var dz=document.getElementById('imp-dropzone'), ta=document.getElementById('pos-csv-text'), fn=document.getElementById('imp-filename');
        if(dz){
            ['dragover','dragenter'].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.style.borderColor='#7C3AED'; dz.style.background='#F5F3FF'; }); });
            ['dragleave','dragend'].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.style.borderColor='#DDD6FE'; dz.style.background='#FBFAFF'; }); });
            dz.addEventListener('drop',function(e){ e.preventDefault(); dz.style.borderColor='#DDD6FE'; dz.style.background='#FBFAFF';
                var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]; if(!f) return;
                var r=new FileReader(); r.onload=function(ev){ if(ta) ta.value=ev.target.result; if(fn) fn.textContent='Selected: '+f.name; }; r.readAsText(f); });
        }
        var cf=g('pos-csv-file');
        if(cf) cf.addEventListener('change',function(){
            var file=cf.files&&cf.files[0]; if(!file) return;
            var reader=new FileReader();
            reader.onload=function(){ ta.value=reader.result; if(fn) fn.textContent='Selected: '+file.name; };
            reader.readAsText(file);
        });
        var cta=g('pos-csv-text'), cbtn=g('pos-csv-import'), cres=g('pos-csv-result');
        if(cbtn){
            cbtn.addEventListener('click', function(){
                var txt=(cta.value||'').trim(); if(!txt){ cres.innerHTML='<span style="color:#e53935">Choose a CSV file or paste rows first</span>'; return; }
                cbtn.disabled=true; var ot=cbtn.innerHTML; cbtn.textContent='Importing...';
                piPost(form.dataset.importUrl,{csvText:txt}).then(function(d){
                    cbtn.disabled=false; cbtn.innerHTML=ot;
                    if(d&&d.success){ var h='<span style="color:#2e7d32;font-weight:700">✔ Imported/updated '+d.imported+', skipped '+d.skipped+'</span>'; if(d.errors&&d.errors.length){ h+='<div style="color:#e65100;font-size:12px;margin-top:6px">'+d.errors.map(piEsc).join('<br>')+'</div>'; } cres.innerHTML=h; }
                    else { cres.innerHTML='<span style="color:#e53935">'+piEsc((d&&d.error)||'Import failed')+'</span>'; }
                }).catch(function(e){ cbtn.disabled=false; cbtn.innerHTML=ot; cres.innerHTML='<span style="color:#e53935">'+piEsc(e.message)+'</span>'; });
            });
        }
    }
    document.addEventListener('click', function(event){
        var results=g('pi-results'), search=g('pi-search');
        if(results && event.target!==search && !results.contains(event.target)) results.style.display='none';
    });
    wire();
    new MutationObserver(wire).observe(document.body,{childList:true,subtree:true});
})();
