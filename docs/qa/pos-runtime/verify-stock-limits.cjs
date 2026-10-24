module.exports=async function({a,base,check,q,invoke,post}) {
 const qty=id=>Number(q(`SELECT coalesce(sum(quantity_on_hand_total),0) AS n FROM asset WHERE product_id='${id}' AND facility_id='POS_QA_A_FAC'`)[0].n);
 const row=id=>q(`SELECT * FROM pos_transaction WHERE transaction_id='${id}'`)[0];
 const session=async terminalId=>{const existing=q(`SELECT session_id FROM pos_session WHERE terminal_id='${terminalId}' AND status_id='PsOpen'`);return existing.length?{sessionId:existing[0].session_id}:invoke('open',{terminalId,openingCash:'100'});};
 const s=await session('POS_QA_A_TERM1');
 const cart=async sessionId=>invoke('cart',{sessionId});
 const add=async(t,id,quantity,reject=false)=>invoke('add',{transactionId:t.transactionId,productId:id,quantity:String(quantity),taxOn:'N'},reject);
 // An empty operator session is deliberately retired when a new terminal opens.
 // Finish a valid paid sale so this session remains active for the two-till race.
 const anchor=await cart(s.sessionId);await add(anchor,'POS_QA_A_P18',1);await invoke('pay',{transactionId:anchor.transactionId,paymentMethod:'Cash',amount:'100'});await invoke('complete',{transactionId:anchor.transactionId});
 const s2=await session('POS_QA_A_TERM2');
 const empty=await cart(s.sessionId);await add(empty,'POS_QA_A_EMPTY',1,true);
 check('empty stock cannot create a bill line',Number(q(`SELECT count(*) AS n FROM pos_transaction_item WHERE transaction_id='${empty.transactionId}'`)[0].n)===0);
 const first=await cart(s.sessionId),second=await cart(s2.sessionId);
 const li=await add(first,'POS_QA_A_SELL',2);await add(first,'POS_QA_A_SELL',4,true);await add(second,'POS_QA_A_SELL',5);
 const edit=await post('Terminal','ajaxCart',{action:'updateQty',transactionId:first.transactionId,itemSeqId:li.itemSeqId,newQty:'6',taxOn:'N'});
 check('quantity edit above shop stock is rejected without modifying the cart',!(await edit.json()).success&&Number(q(`SELECT quantity FROM pos_transaction_item WHERE transaction_id='${first.transactionId}'`)[0].quantity)===2);
 await invoke('pay',{transactionId:first.transactionId,paymentMethod:'Cash',amount:'200'});
 await invoke('complete',{transactionId:first.transactionId});
 check('completion posts stock immediately across lots',qty('POS_QA_A_SELL')===3&&row(first.transactionId).stock_posted==='Y');
 await invoke('sync',{transactionId:first.transactionId});await invoke('sync',{transactionId:first.transactionId});
 check('invoice sync never issues checkout stock twice',qty('POS_QA_A_SELL')===3);
 await invoke('pay',{transactionId:second.transactionId,paymentMethod:'Card',amount:'500'},true);
 check('stale cart is rejected before recording payment',row(second.transactionId).status_id==='PtCreated'&&Number(q(`SELECT count(*) AS n FROM pos_payment WHERE transaction_id='${second.transactionId}'`)[0].n)===0&&qty('POS_QA_A_SELL')===3);
 await invoke('void',{transactionId:second.transactionId});
 // Two tills each see five on hand and attempt four in one atomic checkout.
 const racers=await Promise.all([cart(s.sessionId),cart(s2.sessionId)]);
 for(const t of racers)await add(t,'POS_QA_A_SELL_RACE',4);
 await Promise.all(racers.map(t=>post('Terminal','payAndComplete',{transactionId:t.transactionId,paymentMethod:'Cash',amount:'400',wantJson:'true'})));
 const completed=racers.filter(t=>row(t.transactionId).status_id==='PtCompleted');
 const rejected=racers.find(t=>row(t.transactionId).status_id==='PtCreated');
 check('concurrent checkout issues one bill and rolls back the rejected tender',completed.length===1&&!!rejected&&qty('POS_QA_A_SELL_RACE')===1&&Number(q(`SELECT count(*) AS n FROM pos_payment WHERE transaction_id='${rejected.transactionId}'`)[0].n)===0);
 await invoke('void',{transactionId:rejected.transactionId});
 const credit=await cart(s.sessionId);await add(credit,'POS_QA_A_SELL',3);
 await invoke('credit',{transactionId:credit.transactionId,customerName:'Synthetic credit customer',customerPhone:'9000000091'});
 check('credit checkout also consumes exact remaining stock',qty('POS_QA_A_SELL')===0&&row(credit.transactionId).stock_posted==='Y');
 check('other shop quantities remain untouched',Number(q("SELECT quantity_on_hand_total FROM asset WHERE asset_id='POS_QA_SELL_OTHER'")[0].quantity_on_hand_total)===50);
 const neg=await session('POS_QA_A_TERM_NEG'),negative=await cart(neg.sessionId);
 await add(negative,'POS_QA_A_EMPTY',1);await invoke('pay',{transactionId:negative.transactionId,paymentMethod:'Cash',amount:'100'});await invoke('complete',{transactionId:negative.transactionId});
 check('explicit issue-over-QOH policy is respected without auto-created found stock',Number(q("SELECT sum(quantity_on_hand_total) AS n FROM asset WHERE product_id='POS_QA_A_EMPTY' AND facility_id='POS_QA_A_FAC_NEG'")[0].n)===-1);
};
