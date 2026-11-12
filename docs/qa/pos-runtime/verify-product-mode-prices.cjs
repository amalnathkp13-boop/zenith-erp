const { randomUUID } = require('node:crypto');

module.exports = async ({a,foreign,base,check,q,invoke,post}) => {
  const key=randomUUID().slice(0,8);
  const productName='Disposable mode pricing '+key;
  const inventory=(screen,fields,actor=a)=>actor.c.request.post(base+'/apps/zenith/Inventory/'+screen,{
    form:{moquiSessionToken:actor.t,...fields},maxRedirects:0
  });
  const find=name=>q(`SELECT product_id,pseudo_id,mrp_amount FROM product WHERE owner_party_id='POS_QA_A' AND product_name='${name}'`);
  const minimal={productName,uqcEnumId:'PCS'};
  await inventory('FindProduct/createProduct',{...minimal,uqcEnumId:''});
  check('Product without a unit cannot be created',find(productName).length===0);
  await inventory('FindProduct/createProduct',{...minimal,modePricesJson:'{"RETAIL":"90","WHOLESALE":"-1"}'});
  check('Invalid later mode rolls back product and earlier override',find(productName).length===0);
  const created=await inventory('FindProduct/createProduct',{...minimal,modePricesJson:'{}'});
  const [product]=find(productName);
  check('Name and Unit alone create a product without a zero price',
    created.status()===302&&product?.pseudo_id?.startsWith('ZC-')&&product.mrp_amount==null,{status:created.status(),product});
  const id=product.product_id;
  const [barcode]=q(`SELECT barcode_value FROM product_barcode WHERE organization_party_id='POS_QA_A' AND product_id='${id}' AND is_primary='Y'`);
  check('Generated barcode is available from the real barcode table',barcode?.barcode_value===product.pseudo_id,barcode);
  const update=(mrp,modePricesJson,actor=a)=>inventory('EditProduct/updateProduct',{
    productId:id,productName,uqcEnumId:'PCS',gstSlabId:'GST_18',mrpAmount:mrp,modePricesJson
  },actor);
  const success=r=>(r.headers().location||'').includes('productSaved=Y');
  const prices=()=>q(`SELECT sales_mode_id,price FROM pos_product_mode_price WHERE product_id='${id}' ORDER BY sales_mode_id`);
  const body=async(action,form,actor=a)=>{
    const res=await post('Terminal',action,form,actor);
    const raw=await res.text();
    try { return JSON.parse(raw); }
    catch { throw Error(action+' HTTP '+res.status()+' '+raw.slice(0,500)); }
  };
  const terminalId='POS_QA_A_MPR_'+key;
  await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable pricing QA',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
  const {sessionId}=await invoke('open',{terminalId,openingCash:'0'});
  const {transactionId}=await invoke('cart',{sessionId});
  const args={sessionId,transactionId,taxOn:'N'};
  const line=()=>q(`SELECT unit_price,manual_price FROM pos_transaction_item WHERE transaction_id='${transactionId}' ORDER BY item_seq_id`);
  try {
    const unpriced=await body('lookupProducts',{sessionId,salesModeId:'WHOLESALE',term:barcode.barcode_value});
    check('Barcode lookup identifies an unpriced product with an editable ₹0 placeholder',
      unpriced.some(p=>p.productId===id&&p.pricePending&&Number(p.mrpAmount)===0),unpriced);
    const add=(salesModeId='WHOLESALE')=>body('ajaxCart',{...args,action:'addItem',productId:id,unitPrice:'1',salesModeId});
    const pending=await add();
    check('An unpriced POS product can be added, and the client cannot supply its own rate on add',
      pending.success&&pending.items[0]?.pricePending&&Number(line()[0]?.unit_price)===0,pending);
    await invoke('pay',{transactionId,paymentMethod:'Cash',amount:'1'},true);
    const removed=await body('ajaxCart',{...args,action:'removeItem',itemSeqId:pending.addedItemSeqId});
    check('The cashier can remove an unpriced line before continuing',removed.success&&line().length===0,removed);
    check('Explicit price equal to MRP is saved',success(await update('100','{"RETAIL":"100","WHOLESALE":null}'))&&
      prices().length===1&&Number(prices()[0].price)===100,prices());
    check('A foreign account cannot alter the product or price',
      !success(await update('3','{"RETAIL":"3"}',foreign))&&Number(find(productName)[0].mrp_amount)===100);
    const since=(await body('catalogRevision',{sessionId})).revision;
    check('Catalog revision endpoint is available to the active session',typeof since==='string'&&since.length===64);
    const rejected=await post('Terminal','catalogRevision',{sessionId},foreign);
    check('Catalog revision denies the other organization access',
      rejected.status()===403||!(await rejected.json().catch(()=>null))?.success);
    const modeName='Disposable sale mode '+key;
    await post('SalesMode','createMode',{modeName,modeCode:'MP'+key.toUpperCase(),priceSource:'PpsFixedProduct'});
    const [mode]=q(`SELECT sales_mode_id FROM pos_sales_mode WHERE organization_party_id='POS_QA_A' AND mode_name='${modeName}'`);
    const modeRefresh=await body('catalogRevision',{sessionId,since});
    check('An already open terminal receives the new mode',modeRefresh.changed&&modeRefresh.modes.some(m=>m.id===mode?.sales_mode_id),modeRefresh);
    const customLookup=await body('lookupProducts',{sessionId,salesModeId:mode.sales_mode_id,term:barcode.barcode_value});
    check('A newly created mode inherits the product MRP',Number(customLookup.find(p=>p.productId===id)?.mrpAmount)===100,customLookup);
    const added=await add();
    check('Wholesale inherits MRP and stale display price is ignored',added.success&&Number(line()[0]?.unit_price)===100,added);
    check('Changing MRP preserves the explicit Retail rate',success(await update('110','{"RETAIL":"100","WHOLESALE":null}'))&&
      Number(prices()[0]?.price)===100,prices());
    const refreshed=await body('catalogRevision',{...args,since});
    check('An open draft reprices when inherited MRP changes',refreshed.success&&refreshed.changed&&refreshed.cartChanged&&
      Number(line()[0]?.unit_price)===110,refreshed);
    const edited=await body('ajaxCart',{...args,action:'updatePrice',itemSeqId:added.addedItemSeqId,newPrice:'107',unitPrice:'107'});
    check('Cashier price edit is persisted',edited.success&&Number(line()[0]?.unit_price)===107,edited);
    const freshMode=await body('catalogRevision',{...args,since:refreshed.revision,revalidate:'Y'});
    check('Refreshing a live manual price does not overwrite it',freshMode.success&&!freshMode.cartChanged&&
      Number(line()[0]?.unit_price)===107,freshMode);
    const held=await invoke('hold',{transactionId});
    check('A later price update commits',success(await update('120','{"RETAIL":null,"WHOLESALE":null}'))&&prices().length===0,prices());
    const recalled=await invoke('recall',{sessionId,heldId:held.heldId});
    check('A held bill resumes with its original transaction',recalled.transactionId===transactionId,recalled);
    const stale=await body('payAndComplete',{...args,catalogRevision:refreshed.revision,wantJson:'Y',paymentMethod:'Card',amount:'107'});
    const tenders=()=>q(`SELECT payment_id FROM pos_payment WHERE transaction_id='${transactionId}'`);
    check('A stale checkout token cannot record a tender or rewrite the held rate',stale.priceReview&&!stale.success&&
      tenders().length===0&&Number(line()[0]?.unit_price)===107,stale);
    const paid=await body('payAndComplete',{...args,catalogRevision:stale.revision,wantJson:'Y',paymentMethod:'Card',amount:'107'});
    check('Reviewed payment completes once at the held price',paid.success&&tenders().length===1,paid);
    check('Changing the catalog cannot alter an issued receipt rate',success(await update('130','{"RETAIL":null,"WHOLESALE":null}'))&&
      Number(line()[0]?.unit_price)===107);
    const retail=(await invoke('cart',{sessionId})).transactionId;
    const retailArgs={sessionId,transactionId:retail,taxOn:'Y'};
    try {
      const before=(await body('catalogRevision',{sessionId})).revision;
      const retailAdded=await body('ajaxCart',{...retailArgs,action:'addItem',productId:id,salesModeId:'RETAIL'});
      check('Tax-on Retail can add an inherited price',retailAdded.success&&Number(retailAdded.items[0]?.price)===130,retailAdded);
      check('Retail MRP update commits',success(await update('140','{}')));
      const retailReview=await body('catalogRevision',{...retailArgs,since:before,revalidate:'Y'});
      const retailCart=await body('ajaxCart',{...retailArgs,action:'refresh'});
      check('Tax-on Retail revalidation refreshes inherited price and GST',
        retailReview.success&&retailReview.cartChanged&&Number(retailCart.items[0]?.price)===140&&
        Number(retailCart.tax)===25.2,{retailReview,retailCart});
    } finally {
      await invoke('void',{transactionId:retail});
    }

    const discountModeName='Disposable discount mode '+key;
    await post('SalesMode','createMode',{modeName:discountModeName,modeCode:'MD'+key.toUpperCase(),
      priceSource:'PpsDiscountMrp',discountPercent:'10'});
    const [discountMode]=q(`SELECT sales_mode_id FROM pos_sales_mode WHERE organization_party_id='POS_QA_A' AND mode_name='${discountModeName}'`);
    const discounted=(await invoke('cart',{sessionId})).transactionId;
    const discountArgs={sessionId,transactionId:discounted,taxOn:'N'};
    const addDiscounted=()=>body('ajaxCart',{...discountArgs,action:'addItem',productId:id,salesModeId:discountMode.sales_mode_id});
    const setOverride=value=>update('140',JSON.stringify({[discountMode.sales_mode_id]:value}));
    const refreshDiscount=async since=>{
      const refreshed=await body('catalogRevision',{...discountArgs,since});
      const cart=await body('ajaxCart',{...discountArgs,action:'refresh'});
      return {refreshed,cart};
    };
    try {
      const inherited=await addDiscounted();
      check('New draft applies the configured mode discount',inherited.success&&Number(inherited.disc)===14,inherited);
      let revision=(await body('catalogRevision',{sessionId})).revision;
      check('Same-MRP explicit discounted-mode price saves',success(await setOverride('140')));
      let result=await refreshDiscount(revision);
      check('Explicit same-price override removes the automatic mode discount',result.refreshed.cartChanged&&
        Number(result.cart.items[0]?.price)===140&&Number(result.cart.disc)===0,result);
      revision=result.refreshed.revision;
      check('Clearing discounted-mode override saves',success(await setOverride(null)));
      result=await refreshDiscount(revision);
      check('Removing the override restores the automatic mode discount',result.refreshed.cartChanged&&
        Number(result.cart.disc)===14,result);
      const manual=await body('ajaxCart',{...discountArgs,action:'applyDiscount',billDiscType:'pct',billDiscValue:'0'});
      check('Cashier can explicitly clear the automatic discount',manual.success&&Number(manual.discount)===0,manual);
      revision=result.refreshed.revision;
      check('New MRP saves after a manual zero discount',success(await update('150','{}')));
      result=await refreshDiscount(revision);
      check('MRP refresh preserves an explicit zero cashier discount',result.refreshed.cartChanged&&
        Number(result.cart.items[0]?.price)===150&&Number(result.cart.disc)===0,result);
    } finally {
      await invoke('void',{transactionId:discounted});
    }
  } finally {
    const [txn]=q(`SELECT status_id FROM pos_transaction WHERE transaction_id='${transactionId}'`);
    if(txn?.status_id==='PtCreated') await invoke('void',{transactionId});
    await invoke('close',{sessionId,closingCash:'0'});
  }
};
