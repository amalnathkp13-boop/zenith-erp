/* === Wastage screen: expiring/expired perishables panel + one-click write-off === */
(function() {
    if (window.ZPosWastage) return; window.ZPosWastage = true;
    var shops = [], activeShop = "";
    function wEsc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

    function wtok(){ try{ if(window.moqui&&window.moqui.webrootVue&&window.moqui.webrootVue.moquiSessionToken) return window.moqui.webrootVue.moquiSessionToken; }catch(e){} var el=document.querySelector('[name=moquiSessionToken]');return el?el.value:''; }
    // Keep the current shell and module on both the parent route and the explicit entry route.
    function wurl(rel){
        var path = window.location.pathname;
        var module = /\/zenith\/(?:pos|kot)\//.exec(path);
        return (module ? path.slice(0, module.index + module[0].length) : '/qapps/zenith/pos/') + rel;
    }
    function wpost(rel,params){ var p=new URLSearchParams(); for(var k in params){ p.append(k, params[k]==null?'':params[k]); } p.append('moquiSessionToken', wtok()); return fetch(wurl(rel),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:p,credentials:'same-origin'}).then(function(r){if(!r.ok)throw new Error('Wastage request failed');return r.json();}).catch(function(){return {success:false,error:'Unable to load wastage information. Refresh and retry.'};}); }
    function wfmt(n){ return Number(n||0).toFixed(2); }
    function renderExpiring(){
        var root=document.getElementById('wastage-expiring-root'); if(!root) return;
        var canWrite = root.dataset.canWrite === 'Y';
        wpost('Wastage/WastageEntry/expiringProductsJson',{}).then(function(d){
            shops = (d && d.shops) || []; activeShop = (d && d.activeShop) || '';
            if(!d||!d.success){root.textContent=(d&&d.error)||'Unable to load wastage information. Refresh and retry.';return;} if(!d.rows||!d.rows.length){ root.innerHTML='<div style="padding:14px;color:#999">No perishable products with expiry dates.</div>'; return; }
            var exp=d.rows.filter(function(r){return r.status==='EXPIRED';}).length, soon=d.rows.filter(function(r){return r.status==='SOON';}).length;
            var h='<div style="margin-bottom:8px;font-size:13px">'+(exp?'<span style="color:#c62828;font-weight:700">'+exp+' expired</span>&nbsp;&nbsp;':'')+(soon?'<span style="color:#e65100;font-weight:700">'+soon+' expiring soon</span>':'')+'</div>';
            h+='<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="border-bottom:2px solid #eee;text-align:left"><th style="padding:6px">Status</th><th style="padding:6px">SKU</th><th style="padding:6px">Product</th><th style="padding:6px">Expiry</th><th style="padding:6px;text-align:right">Cost</th><th></th></tr></thead><tbody>';
            d.rows.forEach(function(r,i){
                var c=r.status==='EXPIRED'?'#c62828':(r.status==='SOON'?'#e65100':'#2e7d32');
                var lbl=r.status==='EXPIRED'?'EXPIRED':(r.status==='SOON'?'EXPIRING SOON':'OK');
                h+='<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:6px"><span style="color:'+c+';font-weight:700">'+lbl+'</span></td><td style="padding:6px">'+wEsc(r.sku)+'</td><td style="padding:6px">'+wEsc(r.productName)+'</td><td style="padding:6px">'+wEsc(r.expiry)+'</td><td style="padding:6px;text-align:right">'+wfmt(r.cost)+'</td><td style="padding:6px;text-align:right">'+(canWrite?'<button class="wexp-btn" data-i="'+i+'" style="padding:6px 10px;background:#c62828;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">Record Wastage</button>':'')+'</td></tr>';
            });
            h+='</tbody></table>';
            root.innerHTML=h;
            root.querySelectorAll('.wexp-btn').forEach(function(b){ b.addEventListener('click', function(){ openWasteOverlay(d.rows[parseInt(b.dataset.i)]); }); });
        });
    }
    function openWasteOverlay(r){
        var requestId = window.crypto.randomUUID();
        var ov=document.createElement('div'); ov.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
        ov.innerHTML='<div style="background:#fff;border-radius:16px;width:380px;max-width:92vw;box-shadow:0 12px 48px rgba(0,0,0,0.3);overflow:hidden">'
            +'<div style="padding:16px 20px;background:#c62828;color:#fff;text-align:center;font-size:16px;font-weight:700">Record Wastage (Expired)</div>'
            +'<div style="padding:20px 24px">'
            +'<div style="font-size:14px;font-weight:600;margin-bottom:4px">'+wEsc(r.productName)+'</div>'
            +'<div style="font-size:12px;color:#777;margin-bottom:14px">'+wEsc(r.sku)+' · Expiry '+wEsc(r.expiry)+' · Cost ₹'+wfmt(r.cost)+'</div>'
            +'<label>Shop / stock location<select id="wexp-shop" style="display:block;width:100%;padding:9px;margin:6px 0 12px"><option value="">Choose shop</option>'+shops.map(function(shop){return '<option value="'+wEsc(shop.id)+'"'+(shop.id===activeShop?' selected':'')+'>'+wEsc(shop.name)+'</option>';}).join('')+'</select></label>'
            +'<label style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px">Quantity to write off</label>'
            +'<input id="wexp-qty" type="number" step="1" value="1" style="width:100%;padding:11px 14px;border:2px solid #c62828;border-radius:8px;font-size:18px;font-weight:700;text-align:center;box-sizing:border-box;outline:none"/>'
            +'<div style="display:flex;gap:10px;margin-top:18px"><button id="wexp-cancel" style="flex:1;padding:13px;border:2px solid #ccc;border-radius:10px;font-weight:700;cursor:pointer;background:#fff;color:#555">Cancel</button><button id="wexp-confirm" style="flex:1;padding:13px;border:none;border-radius:10px;font-weight:700;cursor:pointer;background:#c62828;color:#fff">Record Wastage</button></div>'
            +'</div></div>';
        document.body.appendChild(ov); ov.addEventListener('click',function(e){ if(e.target===ov) ov.remove(); });
        document.getElementById('wexp-cancel').addEventListener('click',function(){ ov.remove(); });
        document.getElementById('wexp-confirm').addEventListener('click',function(){
            var facilityId=document.getElementById('wexp-shop').value; if(!facilityId){alert('Choose a shop / stock location.');return;}
            var q=Number(document.getElementById('wexp-qty').value||0); if(q<=0){ return; }
            var btn=document.getElementById('wexp-confirm'); btn.disabled=true; btn.textContent='Recording...';
            wpost('Wastage/WastageEntry/recordExpiredWastage',{productId:r.productId, facilityId:facilityId, requestId:requestId, quantity:q, unitCost:r.cost}).then(function(d){
                if(d&&d.success){ ov.remove(); var t=document.createElement('div'); t.textContent='✔ Wastage recorded'; t.style.cssText='position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999999;background:#2e7d32;color:#fff;padding:14px 28px;border-radius:10px;font-weight:700;box-shadow:0 6px 24px rgba(0,0,0,0.3)'; document.body.appendChild(t); setTimeout(function(){ window.location.reload(); },500); }
                else { btn.disabled=false; btn.textContent='Record Wastage'; alert((d&&d.error)||'Error recording wastage'); }
            });
        });
    }
    setInterval(function(){
        var root=document.getElementById('wastage-expiring-root');
        if(root && !root.dataset.wr){ root.dataset.wr='1'; renderExpiring(); }
        var date=document.getElementById('AddWastage_wastageDate');
        if(date && !date.dataset.pickerBelow && window.jQuery){
            var picker=jQuery(date).data('DateTimePicker');
            if(picker){
                picker.widgetPositioning({vertical:'bottom'});
                jQuery(date).on('dp.show.wastage',function(){ requestAnimationFrame(function(){
                    var widget=date.parentElement.querySelector('.bootstrap-datetimepicker-widget');
                    if(widget){
                        widget.scrollIntoView({block:'nearest',behavior:'instant'});
                        var overflow=widget.getBoundingClientRect().bottom-innerHeight+16;
                        if(overflow>0)window.scrollBy({top:overflow,behavior:'instant'});
                    }
                }); });
                date.dataset.pickerBelow='1';
            }
        }
    }, 700);
})();

