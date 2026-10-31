// Only synthetic receipts in the guarded disposable runtime.
const path=require('node:path');
module.exports=async({a,foreign,base,check,q,invoke,post,out})=>{
 const id='POS_QA_A_RECEIPT',page=await a.c.newPage();
 const saved=()=>q(`SELECT * FROM pos_receipt_template WHERE template_id='${id}'`)[0];
 const update=(design,values={},actor=a,csrf=true)=>post('ReceiptConfig/EditTemplate','updateTemplate',{templateId:id,receiptDesign:design,...values},actor,csrf);
 const baseline=saved();let defaultOptions,qaSession;
 try{
  for(const shell of ['apps','qapps']){
   await page.goto(`${base}/${shell}/zenith/pos/ReceiptConfig/Templates`,{waitUntil:'networkidle'});
   await page.getByText('Disposable POS A receipt',{exact:true}).waitFor();
   const row=page.locator('a[href*="templateId=POS_QA_A_RECEIPT"]');
   for(const design of ['Normal','Credit','Revised'])check(shell+' template exposes Edit '+design,await row.filter({hasText:new RegExp('Edit '+design+'$')}).count()===1);
   await row.filter({hasText:/Edit Credit$/}).click();
   await page.locator('[name=receiptDesign][value=credit]').waitFor({state:'attached'});
   await page.locator('#receiptEditor[data-bound="1"][data-design="credit"]').waitFor();
   check(shell+' internal settings are hidden from the editor',!await page.locator('[data-re-initial]').isVisible());
   defaultOptions ||= JSON.parse(await page.locator('[data-re-initial]').inputValue());
   check(shell+' credit editor identifies its design',await page.locator('#receiptEditor[data-design=credit]').count()===1);
   await page.locator('[data-re-option=openingPreset]').selectOption('Praise the Lord');
   await page.frameLocator('iframe[title="Live receipt preview"]').getByText('Praise the Lord',{exact:true}).waitFor();
   check(shell+' greeting changes immediately in the shared preview',await page.locator('[data-re-option=openingMessage]').inputValue()==='Praise the Lord');
   await page.locator('[data-re-option=billNumberLabel]').fill('Receipt No:');
   await page.frameLocator('iframe').getByText('Receipt No:',{exact:true}).waitFor();
   await page.locator('[data-re-option=showBillNumber]').uncheck();
   check(shell+' hidden bill number removes both label and value',await page.frameLocator('iframe').getByText('SAMPLE-0001',{exact:true}).count()===0);
   await page.locator('[name=receiptWidth]').selectOption('58mm');
   check(shell+' preview uses selected paper width',await page.frameLocator('iframe').locator('.rcpt').getAttribute('data-paper-width')==='58');
   for(const width of [1440,1024,768,390]){
    await page.setViewportSize({width,height:900});
    check(shell+' editor fits '+width+'px',await page.locator('#receiptEditor').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   }
   await page.setViewportSize({width:1440,height:1000});
   if(out)await page.screenshot({path:path.join(out,shell+'-receipt-editor.png'),fullPage:true});
   page.once('dialog',d=>d.accept());
  }
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}),page.locator('.re-top button[form=receiptEditorForm]').click()]);
  await page.locator('#receiptEditor[data-bound="1"]').waitFor();
  check('editor Save submits options and returns to the same design',saved().receipt_width==='58mm'&&JSON.parse(saved().receipt_options_json).credit.showBillNumber===false&&await page.locator('[name=receiptDesign]').inputValue()==='credit');
  for(const design of ['normal','credit','revised']){
   await update(design,{headerText:'QA '+design+' header <literal>',footerText:'QA '+design+' footer',termsText:'QA '+design+' terms'});
   const row=saved(),prefix=design==='normal'?'':design+'_';
   check(design+' text persists independently',row[prefix+'header_text']==='QA '+design+' header <literal>'&&row[prefix+'footer_text']==='QA '+design+' footer'&&row[prefix+'terms_text']==='QA '+design+' terms');
  }
  check('variant editing preserves normal text and company ownership',saved().header_text==='QA normal header <literal>'&&saved().company_name===baseline.company_name&&saved().organization_party_id===baseline.organization_party_id);
  const before=JSON.stringify(saved());
  await update('unknown',{headerText:'QA invalid design'});check('invalid design cannot overwrite a template',JSON.stringify(saved())===before);
  await update('credit',{headerText:'QA forbidden foreign write'},foreign);check('foreign organization cannot edit a receipt design',JSON.stringify(saved())===before);
  await update('credit',{headerText:'QA missing CSRF'},a,false);check('receipt design update requires CSRF',JSON.stringify(saved())===before);
  await update('normal',{facilityId:'POS_QA_B_FAC'});check('receipt template cannot target another tenant shop',JSON.stringify(saved())===before);
  for(const optionsJson of [JSON.stringify({openingMessage:'x'.repeat(301)}),JSON.stringify({showBillNumber:'false'}),JSON.stringify({companyTone:'invisible'}),JSON.stringify({transactionNumber:'FORGED'})]){
   await update('normal',{optionsJson});check('invalid presentation configuration does not write',JSON.stringify(saved())===before);
  }
  await update('normal',{optionsJson:JSON.stringify({openingPreset:'custom',openingMessage:'QA greeting',billNumberLabel:'Receipt No:',showCashier:false,productsTone:'darkGrey',density:'dark'})});
  await update('credit',{optionsJson:JSON.stringify({openingPreset:'custom',openingMessage:'QA credit greeting',billNumberLabel:'Credit No:',showCashier:false})});
  check('presentation options persist without changing the template company',JSON.parse(saved().receipt_options_json).normal.billNumberLabel==='Receipt No:'&&saved().company_name===baseline.company_name);
  let readonly;
  try{
   await post('PosQaAcceptance','priceRoleProbe',{role:'view'});
   readonly=await a.c.browser().newContext();
   await readonly.request.get(base+'/apps/zenith/pos/Dashboard',{headers:{Authorization:'Basic '+Buffer.from('pos.cashier.qa:moqui').toString('base64')}});
   const readPage=await readonly.newPage();await readPage.goto(base+'/apps/zenith/pos/ReceiptConfig/EditTemplate?templateId='+id);
   const token=await readPage.locator('[name=moquiSessionToken]').first().inputValue();
   const protectedRow=JSON.stringify(saved());
   await update('credit',{headerText:'forbidden read-only edit'},{c:readonly,t:token});
   check('view-only role cannot save receipt configuration',JSON.stringify(saved())===protectedRow);
  }finally{if(readonly)await readonly.close();await post('PosQaAcceptance','priceRoleProbe',{role:'restore'});}
  const terminalId='POS_QA_A_RECEIPT_TERM';
  await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable receipt design counter',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
  for(const prior of q(`SELECT session_id FROM pos_session WHERE terminal_id='${terminalId}' AND organization_party_id='POS_QA_A' AND status_id='PsOpen'`))await post('Terminal','closeSession',{sessionId:prior.session_id,closingCash:'0',wantJson:'1'});
  const session=qaSession=await invoke('open',{terminalId,openingCash:'0'});
  const bill=async()=>{const t=await invoke('cart',{sessionId:session.sessionId});const item=await invoke('add',{transactionId:t.transactionId,productId:'POS_QA_A_P18',quantity:'1',salesModeId:'RETAIL',taxOn:'N'});return {...t,item};};
  const normal=await bill();await invoke('pay',{transactionId:normal.transactionId,paymentMethod:'Cash',amount:'100'});await invoke('complete',{transactionId:normal.transactionId});
  const credit=await bill();await invoke('credit',{transactionId:credit.transactionId,customerName:'Synthetic Credit',customerPhone:'0000000000'});
  for(const [design,t] of [['normal',normal],['credit',credit]]){
   const r=(await invoke('receipt',{transactionId:t.transactionId})).receipt;
   check(design+' saved receipt selects its own text',r.store.headerText==='QA '+design+' header <literal>'&&r.store.footerText==='QA '+design+' footer'&&r.store.termsText==='QA '+design+' terms');
   check(design+' saved receipt carries validated independent display settings',r.options.openingMessage===(design==='normal'?'QA greeting':'QA credit greeting')&&r.options.showCashier===false&&r.options.billNumberLabel===(design==='normal'?'Receipt No:':'Credit No:'));
  }
  const response=await post('Terminal','ajaxCart',{action:'amendBill',editTxId:normal.transactionId,editType:'PRICE_CHANGE',editItemSeqId:normal.item.itemSeqId,newPrice:'90',editReason:'Synthetic revised receipt design'});
  check('synthetic revised bill saves',response.status()===200&&(await response.json()).success);
  const moneyBefore=JSON.stringify(q(`SELECT * FROM pos_transaction WHERE transaction_id='${normal.transactionId}'`));
  const revised=(await invoke('receipt',{transactionId:normal.transactionId})).receipt;
  check('revised receipt selects revised text and its marker',revised.edited===true&&revised.store.headerText==='QA revised header <literal>'&&revised.store.footerText==='QA revised footer'&&revised.store.termsText==='QA revised terms');
  check('receipt rendering leaves recorded bill money unchanged',moneyBefore===JSON.stringify(q(`SELECT * FROM pos_transaction WHERE transaction_id='${normal.transactionId}'`)));
  await update('credit',{headerText:'',footerText:'',termsText:''});
  const inherited=(await invoke('receipt',{transactionId:credit.transactionId})).receipt;
  check('blank variant inherits existing normal settings',inherited.store.headerText==='QA normal header <literal>');
  const creditEdit=await post('Terminal','ajaxCart',{action:'amendBill',editTxId:credit.transactionId,editType:'PRICE_CHANGE',editItemSeqId:credit.item.itemSeqId,newPrice:'95',editReason:'Synthetic revised credit receipt'});
  check('credit revision saves through the existing amendment workflow',creditEdit.status()===200&&(await creditEdit.json()).success);
  const revisedCredit=(await invoke('receipt',{transactionId:credit.transactionId})).receipt;
  check('revised credit keeps both the revision marker and outstanding balance',revisedCredit.edited===true&&revisedCredit.isCredit===true&&Number(revisedCredit.outstanding)===95&&revisedCredit.store.headerText==='QA revised header <literal>');
  const pdf=await a.c.request.get(base+'/fop/apps/zenith/pos/ReceiptPdf?transactionId='+normal.transactionId);
  check('saved revised receipt PDF renders escaped template text',pdf.status()===200&&(pdf.headers()['content-type']||'').includes('pdf'),{status:pdf.status()});
  if(out)require('node:fs').writeFileSync(path.join(out,'revised-design-receipt.pdf'),await pdf.body());
  // A shop-specific template must not replace or disable the organization fallback.
  const scopeName='QA receipt shop override';
  await post('ReceiptConfig/Templates','createTemplate',{templateName:scopeName,companyName:'QA scoped shop',facilityId:'POS_QA_A_FAC',receiptWidth:'58mm'});
  const scoped=q(`SELECT * FROM pos_receipt_template WHERE template_name='${scopeName}'`)[0];
  check('shop template creation persists inside the active organization',scoped&&scoped.facility_id==='POS_QA_A_FAC'&&scoped.organization_party_id==='POS_QA_A');
  const selectScope=await post('ReceiptConfig/EditTemplate','updateTemplate',{templateId:scoped.template_id,isDefault:'Y'});
  check('shop default leaves the organization fallback default intact',selectScope.status()<400&&saved().is_default==='Y');
  check('saved bill selects its terminal shop receipt',(await invoke('receipt',{transactionId:normal.transactionId})).receipt.store.name==='QA scoped shop');
  await post('ReceiptConfig/EditTemplate','updateTemplate',{templateId:scoped.template_id,isActive:'N'});
  check('inactive shop template falls back to the active organization template',(await invoke('receipt',{transactionId:normal.transactionId})).receipt.store.name===baseline.company_name);
  await post('ReceiptConfig/EditTemplate','deleteTemplate',{templateId:scoped.template_id});
  check('template deletion removes only the selected synthetic template',q(`SELECT count(*) AS n FROM pos_receipt_template WHERE template_id='${scoped.template_id}'`)[0].n==0&&saved().template_id===id);
  await update('normal',{isActive:'N'});
  check('no active template uses a safe terminal fallback',(await invoke('receipt',{transactionId:normal.transactionId})).receipt.store.name==='Disposable receipt design counter');
  const fallbackPdf=await a.c.request.get(base+'/fop/apps/zenith/pos/ReceiptPdf?transactionId='+normal.transactionId);
  check('receipt PDF works without any active template',fallbackPdf.status()===200&&(fallbackPdf.headers()['content-type']||'').includes('pdf'));
  await update('normal',{isActive:baseline.is_active});
  if(out){await page.goto(`${base}/apps/zenith/pos/ReceiptConfig/EditTemplate?templateId=${id}&receiptDesign=revised`,{waitUntil:'networkidle'});await page.screenshot({path:path.join(out,'receipt-revised-design.png'),fullPage:true});}
 }finally{
  if(qaSession)await post('Terminal','closeSession',{sessionId:qaSession.sessionId,closingCash:'0',wantJson:'1'});
  for(const design of ['normal','credit','revised']){const p=design==='normal'?'':design+'_';await update(design,{headerText:baseline[p+'header_text']||'',footerText:baseline[p+'footer_text']||'',termsText:baseline[p+'terms_text']||'',...(defaultOptions?{optionsJson:JSON.stringify(defaultOptions)}:{})});}
  await update('normal',{receiptWidth:baseline.receipt_width||'80mm',isActive:baseline.is_active});
  await page.close();
 }
};
