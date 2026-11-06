// Exercise the real rendered form: an HTTP-only test misses qvt navigation instead of POST.
module.exports=async({a,base,check,q,out})=>{
 const page=await a.c.newPage();
 try {
  for(const shell of ['apps','qapps']) for(const facilityId of ['', 'POS_QA_A_FAC']) {
   await page.goto(`${base}/${shell}/zenith/pos/ReceiptConfig/Templates`);
   const form=page.locator('#CreateTemplate');
   await form.getByLabel('Template Name',{exact:true}).waitFor();
   const name='Receipt form QA '+shell+' '+Date.now();
   await form.getByLabel('Template Name',{exact:true}).fill(name);
   await form.getByLabel('Company Name',{exact:true}).fill('Synthetic receipt company');
   await form.getByLabel('Shop',{exact:true}).selectOption(facilityId);
   await form.getByLabel('Receipt Width',{exact:true}).selectOption('58mm');
   check(shell+' receipt form submits with POST',await form.getAttribute('method')==='post');
   for(const width of [1366,390]) {
    await page.setViewportSize({width,height:900});
    check(shell+' creation form fits '+width+'px',await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   }
   await page.setViewportSize({width:1366,height:900});
   const sent=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/createTemplate'));
   await form.getByRole('button',{name:'Create Template',exact:true}).click();
   const response=await sent;
   await page.waitForLoadState('domcontentloaded');
   await page.getByRole('link',{name,exact:true}).waitFor();
   const row=q(`SELECT organization_party_id,facility_id,receipt_width,is_active FROM pos_receipt_template WHERE template_name='${name}'`)[0];
   check(shell+' creates a persisted '+(facilityId?'shop':'organization')+' template',response.status()===302&&row?.organization_party_id==='POS_QA_A'&&(row.facility_id||'')===facilityId&&row.receipt_width==='58mm'&&row.is_active==='Y',row);
   check(shell+' creation keeps its layout',new URL(page.url()).pathname.startsWith('/'+shell+'/'));
   if(out) await page.screenshot({path:require('path').join(out,'receipt-create-'+shell+(facilityId?'-shop':'')+'.png')});
  }
 } finally {await page.close();}
};
