
const path=require('node:path');
module.exports=async({a,base,check,invoke,post,out})=>{
 const terminalId='POS_QA_A_HISTORY_FILTER';
 await post('PosTerminals','createTerminal',{terminalId,terminalName:'Disposable history filters',facilityId:'POS_QA_A_FAC',organizationPartyId:'POS_QA_A',stateCode:'33',isActive:'Y'});
 const session=await invoke('open',{terminalId,openingCash:'0'});
 const page=await a.c.newPage();
 try {
  const tx=await invoke('cart',{sessionId:session.sessionId});
  await invoke('add',{transactionId:tx.transactionId,productId:'POS_QA_A_P18',quantity:'1',taxOn:'N'});
  await invoke('pay',{transactionId:tx.transactionId,paymentMethod:'Cash',amount:'100'});
  await invoke('complete',{transactionId:tx.transactionId});
  const query=async criteria=>(await (await post('Terminal','ajaxCart',{action:'billHistory',sessionId:session.sessionId,...criteria})).json());
  const original=await query({});
  const bill=original.bills.find(x=>x.txId===tx.transactionId);
  check('Disposable history contains its issued bill',!!bill,original);
  const parts=bill.date.split(' ')[0].split('/');
  const date=parts.reverse().join('-');
  const filters={historyFromDate:date,historyToDate:date};
  check('Date range includes both ends of the local day',(await query(filters)).bills.some(x=>x.txId===tx.transactionId));
  check('A different date excludes the current bill',(await query({historyFromDate:'2000-01-01',historyToDate:'2000-01-01'})).total===0);
  check('Inverted time range is rejected',(await query({...filters,historyFromTime:'23:30',historyToTime:'01:00'})).success===false);
  check('Incomplete date range is rejected',(await query({historyFromDate:date})).success===false);
  check('Text search and date filters use AND',(await query({...filters,search:'NO_SUCH_BILL'})).total===0);
  const [hour,minute]=bill.date.split(' ')[1].split(':').map(Number);
  const pm=bill.date.toLowerCase().endsWith('pm');
  const seconds=(hour%12+(pm?12:0))*3600+minute*60;
  const time=sec=>[Math.floor(sec/3600),Math.floor(sec/60)%60,sec%60].map(x=>String(x).padStart(2,'0')).join(':');
  check('Same-day time range includes the matching bill',(await query({...filters,historyFromTime:time(seconds),historyToTime:time(seconds+59)})).bills.some(x=>x.txId===tx.transactionId));
  const nonMatch=seconds>3600?{historyFromTime:'00:00',historyToTime:'00:30'}:{historyFromTime:'23:00',historyToTime:'23:30'};
  check('Same-day time range excludes outside bills',(await query({...filters,...nonMatch})).total===0);
  await page.goto(base+'/apps/zenith/pos/Terminal?sessionId='+session.sessionId);
  await page.evaluate(()=>{window.qaHistoryPrint=[];window._posPrintReceipt=(...args)=>window.qaHistoryPrint.push(args[0]);});
  await page.locator('#pos-history-btn').click();
  await page.locator('#hist-filter').click();
  const panel=page.locator('#hist-filter-form');
  await panel.getByLabel('From Date').fill(date); await panel.getByLabel('To Date').fill(date);
  await panel.getByRole('button',{name:'Apply Filter'}).click();
  const row=page.locator('.hist-bill-row[data-tx-id="'+tx.transactionId+'"]');
  await row.waitFor();
  await page.locator('#hist-filter').click(); await page.locator('#hist-filter').click();
  check('Toggling the filter panel keeps applied dates',await panel.getByLabel('From Date').inputValue()===date);
  if(out) await page.screenshot({path:path.join(out,'history-date-filter.png')});
  await row.getByRole('button',{name:'Reprint'}).click();
  await page.waitForFunction(id=>window.qaHistoryPrint.includes(id),tx.transactionId);
  check('Filtered Reprint still targets the selected saved bill',true);
  await panel.getByRole('button',{name:'Reset'}).click();
  await row.waitFor();
  check('Reset clears filter values and returns to default results',await panel.getByLabel('From Date').inputValue()==='');
 } finally {
  await page.close();
  await invoke('close',{sessionId:session.sessionId,closingCash:'100'});
 }
};
