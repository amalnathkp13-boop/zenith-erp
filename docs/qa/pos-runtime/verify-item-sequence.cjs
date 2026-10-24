// A removed middle row must not make the next insert reuse a surviving sequence.
module.exports=async function({invoke,check,q}) {
 const session=await invoke('open',{terminalId:'POS_QA_A_TERM2',openingCash:'100'});
 const cart=await invoke('cart',{sessionId:session.sessionId});
 const add=productId=>invoke('add',{transactionId:cart.transactionId,productId,quantity:'1'});
 const rows=()=>q(`SELECT item_seq_id,product_id,quantity,unit_price,line_total FROM pos_transaction_item WHERE transaction_id='${cart.transactionId}' ORDER BY item_seq_id`);
 try {
  const first=await add('POS_QA_A_P18');await add('POS_QA_A_P5');await add('POS_QA_A_NOWS');
  await invoke('remove',{transactionId:cart.transactionId,itemSeqId:first.itemSeqId});
  const retained=rows(),next=await add('POS_QA_A_P18');
  check('add after deletion chooses a sequence above surviving rows',next.itemSeqId==='00004'&&rows().length===3);
  check('add after deletion preserves every existing row and amount',retained.every(before=>rows().some(after=>JSON.stringify(before)===JSON.stringify(after))));
  const concurrent=await Promise.all([add('POS_QA_A_STOCK'),add('POS_QA_A_BREAK')]);
  check('concurrent different products receive distinct sequence IDs',new Set(concurrent.map(row=>row.itemSeqId)).size===2&&new Set(rows().map(row=>row.item_seq_id)).size===5);
  await Promise.all([add('POS_QA_A_P18'),add('POS_QA_A_P18')]);
  check('concurrent repeated product adds merge without losing quantity',rows().filter(row=>row.product_id==='POS_QA_A_P18').length===1&&Number(rows().find(row=>row.product_id==='POS_QA_A_P18').quantity)===3);
  const beforeHold=JSON.stringify(rows()),held=await invoke('hold',{transactionId:cart.transactionId,holdReason:'Disposable sequence-gap regression'});
  const resumed=await invoke('recall',{heldId:held.heldId,sessionId:session.sessionId});
  check('hold and resume preserve the same cart, line IDs and values',resumed.transactionId===cart.transactionId&&JSON.stringify(rows())===beforeHold);
 } finally {
  await invoke('void',{transactionId:cart.transactionId});
  await invoke('close',{sessionId:session.sessionId,closingCash:'100'});
 }
};
