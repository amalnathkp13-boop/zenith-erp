(function () {
    'use strict';
    var root=document.getElementById('receiptEditor');
    if(!root||root.dataset.bound)return;
    root.dataset.bound='1';
    var form=root.querySelector('#receiptEditorForm'),frame=root.querySelector('iframe'),dirty=false,submitting=false;
    var options=JSON.parse(root.querySelector('[data-re-initial]').value),initial=JSON.parse(root.querySelector('[data-re-template]').value);
    var fallback=JSON.parse(root.querySelector('[data-re-fallback]').value);
    root.querySelectorAll('[data-re-option]').forEach(function(input){var value=options[input.dataset.reOption];if(input.type==='checkbox')input.checked=value===true;else input.value=value==null?'':value;});
    function values(){
        var selected={};
        root.querySelectorAll('[data-re-option]').forEach(function(input){selected[input.dataset.reOption]=input.type==='checkbox'?input.checked:input.value;});
        return selected;
    }
    function refresh(){
        options=values();form.elements.optionsJson.value=JSON.stringify(options);
        var template=Object.assign({},initial);
        Array.from(form.elements).forEach(function(input){if(Object.prototype.hasOwnProperty.call(template,input.name))template[input.name]=input.value;});
        if(root.dataset.design!=='normal')['headerText','footerText','termsText'].forEach(function(key){template[key]=template[key]||fallback[key]||'';});
        var data={success:true,options:options,store:{name:template.companyName||'Company name',address:[template.addressLine1,template.addressLine2,template.city,template.state,template.pincode].filter(Boolean).join(', '),phone:template.phone,email:template.email,taxReg:template.taxRegistrationNumber},
            bill:{number:'SAMPLE-0001',date:'31/10/2026 10:30 AM',customer:'Sample customer',customerPhone:'0000000000',cashier:'Sample cashier'},
            items:[{name:'Sample cup',qty:2,uom:'Nos',rate:25,total:50,tax:2.5},{name:'Sample rice',qty:1.25,uom:'kg',rate:40,total:50,tax:5}],
            summary:{subtotal:100,tax:7.5,taxBreakdown:[{name:'CGST',amount:3.75},{name:'SGST',amount:3.75}],total:108,roundOff:0.5},payments:[{method:'Cash',amount:110}],change:2,
            isCredit:root.dataset.design==='credit',edited:root.dataset.design==='revised',outstanding:root.dataset.design==='credit'?108:0};
        ['headerText','footerText','termsText','receiptWidth','showLogo','logoUrl','showTaxBreakdown','showDiscount','showCustomerInfo','showPaymentDetails','showItemTax'].forEach(function(key){data.store[key]=template[key];});
        if(data.isCredit){data.payments=[];data.change=0;}
        frame.style.width=template.receiptWidth==='58mm'?'230px':'320px';
        root.querySelector('[data-re-preview-width]').value=template.receiptWidth||'80mm';
        frame.srcdoc=window.PosReceiptLayout.render(data,true,data.edited)+'</body></html>';
    }
    frame.addEventListener('load',function(){
        if(!frame.contentDocument)return;
        frame.style.height=(frame.contentDocument.documentElement.scrollHeight+15)+'px';
        var failed=Array.from(frame.contentDocument.images).some(function(img){return img.complete&&!img.naturalWidth;});
        root.querySelector('[data-re-error]').textContent=failed?'The logo could not load. Check its URL and image access.':'';
    });
    form.addEventListener('input',function(event){
        if(event.target.dataset.reOption==='openingPreset'){
            var preset=event.target.value;if(preset!=='custom'&&preset!=='none')root.querySelector('[data-re-option=openingMessage]').value=preset;
        }
        dirty=true;refresh();
    });
    root.querySelector('[data-re-preview-width]').addEventListener('change',function(event){form.elements.receiptWidth.value=event.target.value;dirty=true;refresh();});
    form.addEventListener('change',refresh);
    form.addEventListener('submit',function(){submitting=true;form.elements.optionsJson.value=JSON.stringify(values());});
    root.querySelectorAll('[data-re-leave]').forEach(function(link){link.addEventListener('click',function(event){if(dirty&&!confirm('Discard unsaved receipt changes?'))event.preventDefault();else submitting=true;});});
    window.addEventListener('beforeunload',function(event){if(root.isConnected&&dirty&&!submitting){event.preventDefault();event.returnValue='';}});
    var remove=root.querySelector('[data-re-delete]');
    if(remove)remove.addEventListener('click',function(){if(confirm('Delete this receipt template? Existing bills will not be deleted.')){submitting=true;root.querySelector('#receiptDeleteForm').submit();}});
    root.querySelector('[data-re-test]').addEventListener('click',function(){frame.contentWindow.focus();frame.contentWindow.print();});
    root.querySelector('[data-re-preview]').addEventListener('click',function(){root.querySelector('.re-preview').scrollIntoView({behavior:'smooth'});});
    if(root.dataset.write!=='true')form.querySelectorAll('input,select,textarea').forEach(function(input){input.disabled=true;});
    refresh();
})();
