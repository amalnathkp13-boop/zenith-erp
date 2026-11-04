(function(){
 'use strict';
 if(window.initProductCreation)return;
 function bindModePrices(form){
  const rows=[...form.querySelectorAll('[data-pe-mode-id]')];
  const mrp=form.elements.namedItem('mrpAmount');
  const output=form.elements.namedItem('modePricesJson');
  function refresh(){
   const prices=Object.create(null);
   rows.forEach(input=>{
    prices[input.dataset.peModeId]=input.value===''?null:input.value;
    input.placeholder=mrp.value===''?'—':mrp.value;
    input.parentElement.querySelector('[data-pe-mode-status]').textContent=input.value!==''?'Override':(mrp.value===''?'No price set':'Uses MRP');
   });
   output.value=JSON.stringify(prices);
  }
  form.addEventListener('input',event=>{if(event.target===mrp||event.target.matches('[data-pe-mode-id]'))refresh();});
  refresh();
  return refresh;
 }
 async function submitProduct(form,status,prepare){
  if(form.getAttribute('aria-busy')==='true')return;
  form.setAttribute('aria-busy','true');
  status.dataset.error='false';
  status.textContent='Saving product…';
  try {
   const body=new URLSearchParams(new FormData(form));
   prepare(body);
   const response=await fetch(form.action,{method:'POST',body,credentials:'same-origin',cache:'no-store'});
   const target=new URL(response.url,location.href);
   const saved=response.ok&&target.origin===location.origin&&target.pathname.endsWith('/EditProduct')&&
    (form.dataset.peSave==='create'?target.searchParams.has('productId'):target.searchParams.get('productSaved')==='Y');
   if(saved){location.assign(target.href);return;}
   const html=new DOMParser().parseFromString(await response.text(),'text/html');
   const errors=[...html.querySelectorAll('.alert-danger,.q-notification.bg-negative,.text-negative[role="alert"]')]
    .map(element=>element.textContent.trim()).filter(Boolean);
   throw Error(errors[0]||'The product could not be saved. Check the values and try again.');
  }catch(error){
   status.dataset.error='true';
   status.textContent=error instanceof TypeError?'Connection lost while saving. Check the product list before retrying.':error.message;
   form.removeAttribute('aria-busy');
  }
 }
 window.initProductCreation=function(){
  const form=document.getElementById('CreateProductForm');
  if(!form||form.dataset.bound)return;
  form.dataset.bound='true';
  const refresh=bindModePrices(form);
  const name=form.elements.namedItem('productName'),print=form.elements.namedItem('printName');
  let custom=false;
  name.addEventListener('input',()=>{if(!custom)print.value=name.value;});
  print.addEventListener('input',()=>{custom=print.value.trim()!=='';});
  print.addEventListener('blur',()=>{if(!custom)print.value=name.value;});
  form.addEventListener('submit',event=>{
   event.preventDefault();refresh();
   submitProduct(form,form.querySelector('[data-pe-status]'),body=>{if(!custom)body.set('printName','');});
  });
 };
 window.initProductEditor=function(){
  const root=document.getElementById('productEditor');if(!root||root.dataset.bound)return;root.dataset.bound='true';
  const form=root.querySelector('#productEditorForm'),field=n=>form.elements.namedItem(n),name=field('productName'),print=field('printName');let pendingImage=false;let custom=print.dataset.custom==='true',dirty=false;
  const refreshModePrices=bindModePrices(form);
  const status=root.querySelector('[data-pe-status]');
  function refresh(){
   if(!custom)print.value=name.value;
   root.querySelector('[data-pe-count]').textContent=field('description').value.length+'/500';
   root.querySelectorAll('[data-pe-summary]').forEach(el=>{const f=field(el.dataset.peSummary);el.textContent=f?.tagName==='SELECT'?f.selectedOptions[0]?.textContent||'—':f?.value||'—';});
  }
  form.addEventListener('input',e=>{if(e.target===print)custom=print.value.trim()!==''&&print.value!==name.value;dirty=true;refresh();status.textContent='Unsaved changes';});
  form.addEventListener('change',()=>{dirty=true;refresh();});
  root.querySelector('[data-pe-reset-name]').addEventListener('click',()=>{custom=false;dirty=true;refresh();print.focus();});
  form.addEventListener('submit',e=>{
   e.preventDefault();
   if(pendingImage){status.textContent='Please wait for the image to finish loading.';return;}
   refreshModePrices();
   submitProduct(form,status,body=>{if(!custom)body.set('printName','');});
  });
  root.querySelectorAll('[data-pe-leave]').forEach(a=>a.addEventListener('click',e=>{if(dirty&&!window.confirm('Discard unsaved product changes?'))e.preventDefault();else dirty=false;}));
  root.querySelector('[data-pe-delete]')?.addEventListener('click',()=>{if(window.confirm('Permanently delete this product? Products with bills, orders or stock history cannot be deleted.')){dirty=false;root.querySelector('#productDeleteForm').requestSubmit();}});
  root.querySelectorAll('.pe-tabs a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();root.querySelectorAll('.pe-tabs a').forEach(b=>b.removeAttribute('aria-current'));a.setAttribute('aria-current','true');root.querySelector(a.getAttribute('href')).scrollIntoView({block:'start'});}));
  const file=root.querySelector('[data-pe-file]'),image=root.querySelector('[data-pe-image]'),blank=root.querySelector('[data-pe-no-image]'),imageStatus=root.querySelector('[data-pe-image-status]'),drop=root.querySelector('[data-pe-drop]');
  let imageRead=0;
  async function loadImage(f){
   if(!f||file.disabled)return;const read=++imageRead;pendingImage=false;
   if(!['image/png','image/jpeg'].includes(f.type)||f.size>2097152){imageStatus.textContent='Choose a JPG or PNG image up to 2 MB.';file.value='';return;}
   pendingImage=true;const reader=new FileReader();reader.onload=()=>{if(read!==imageRead)return;pendingImage=false;field('imageData').value=String(reader.result);field('removeImage').value='N';image.src=String(reader.result);image.hidden=false;blank.hidden=true;dirty=true;imageStatus.textContent='Image ready — Save Changes to keep it.';};reader.onerror=()=>{if(read!==imageRead)return;pendingImage=false;imageStatus.textContent='Could not read that image. Please choose it again.';};reader.readAsDataURL(f);
  }
  file.addEventListener('change',()=>loadImage(file.files[0]));
  drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();file.click();}});
  ['dragover','dragleave','drop'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.toggle('pe-drag',type==='dragover');if(type==='drop')loadImage(e.dataTransfer.files[0]);}));
  root.querySelector('[data-pe-remove-image]').addEventListener('click',()=>{imageRead++;pendingImage=false;field('imageData').value='';field('removeImage').value='Y';image.hidden=true;image.removeAttribute('src');blank.hidden=false;file.value='';dirty=true;imageStatus.textContent='Image removed — Save Changes to keep it.';});
  refresh();
 };
 window.initProductEditor();
 window.initProductCreation();
})();
