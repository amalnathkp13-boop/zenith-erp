// Runs in the standard POS profile against H2 locally and PostgreSQL in CI.
module.exports=async function({browser,base,q,check,out}){
 const contexts=[];
 try{
  async function actor(username){
   const c=await browser.newContext({viewport:{width:1366,height:900}});contexts.push(c);
   const login=await c.request.get(base+(username==='pos.cashier.qa'?'/apps/zenith/pos/Terminal':'/apps/zenith/Contacts/Customers'),{headers:{Authorization:'Basic '+Buffer.from(username+':moqui').toString('base64')}});
   const token=(await login.text()).match(/name="moquiSessionToken"[^>]*value="([^"]+)"/)?.[1];if(!token)throw Error('Free-item fixture login failed');
   const post=(screen,transition,data={})=>c.request.post(base+'/apps/zenith/pos/'+screen+'/'+transition,{form:{moquiSessionToken:token,...data},maxRedirects:0});
   return{c,token,post,invoke:async(op,data={})=>(await post('PosQaAcceptance','invoke',{op,...data})).json()};
  }
  const manager=await actor('pos.qa'),cashier=await actor('pos.cashier.qa'),foreign=await actor('pos.b.qa');
  const existing=q("SELECT session_id FROM pos_session WHERE terminal_id='POS_QA_A_TERM1' AND organization_party_id='POS_QA_A' AND status_id='PsOpen'")[0];
  const session=existing?{sessionId:existing.session_id}:(await manager.invoke('open',{terminalId:'POS_QA_A_TERM1',openingCash:'0'})).result;
  if(!session?.sessionId)throw Error('Free-item fixture needs an open disposable session');
  async function cart(mixed=false){const id=(await manager.invoke('cart',{sessionId:session.sessionId,reuseOpenCart:'false'})).result.transactionId;
   await manager.c.request.get(base+'/apps/zenith/pos/Terminal?sessionId='+session.sessionId+'&transactionId='+id+'&taxOn=N');
   await manager.invoke('add',{transactionId:id,productId:'POS_QA_A_P5',quantity:'1',discountPercent:'100',taxOn:'N'});
   if(mixed)await manager.invoke('add',{transactionId:id,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});return id;
  }
  const id=await cart(true),free=await cart(),credit=await cart(true);
  const pay=await cashier.invoke('pay',{transactionId:id,paymentMethod:'Cash',amount:'100'});
  check('Free-item gate blocks money before approval',pay.errors?.length>0&&q(`SELECT * FROM pos_payment WHERE transaction_id='${id}'`).length===0);
  const complete=await cashier.invoke('complete',{transactionId:free});
  check('Free-item gate blocks direct zero-total completion',complete.errors?.length>0&&q(`SELECT status_id FROM pos_transaction WHERE transaction_id='${free}'`)[0].status_id==='PtCreated');
  const cr=await cashier.invoke('credit',{transactionId:credit,customerName:'Synthetic Free Approval',customerPhone:'9990001234'});
  check('Free-item gate blocks credit completion',cr.errors?.length>0&&q(`SELECT status_id FROM pos_transaction WHERE transaction_id='${credit}'`)[0].status_id==='PtCreated');
  await require('../pos-drive-reports/free-items-policy.cjs')({manager,cashier,foreign,session,id,free,credit,cart,q,check,out,base});
 }finally{for(const context of contexts)await context.close();}
};
