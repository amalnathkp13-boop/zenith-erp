// Synthetic receipt geometry only; no sales, devices or production connections.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../../..'),context=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(process.env.POS_RECEIPT_SOURCE||path.join(root,'component/zenith-erp-app/screen/zenithstatic/js/pos-receipt-layout.js'),'utf8'),context);
(async()=>{
 const executablePath=process.env.POS_QA_CHROME||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
 const browser=await chromium.launch({headless:true,executablePath});
 try{
  const page=await browser.newPage();
  for(const width of [58,80])for(const revised of [false,true]){
   const data={store:{name:'Example Shop',receiptWidth:width+'mm'},bill:{number:'QA/2026-27/00001',date:'01/11/2026',customer:'Synthetic customer with a deliberately long display name',cashier:'Synthetic cashier'},items:[{name:'Example product with a long name that must wrap without moving numeric columns',qty:12.5,uom:'kg',rate:1234.56,total:15432},{name:'Cup',qty:1,uom:'Nos',rate:4,total:4}],summary:{subtotal:15436,total:15436}};
   const html=context.window.PosReceiptLayout.render(data,false,revised)+'</body></html>';
   await page.setContent(html);
   const geometry=await page.evaluate(()=>{
    const table=document.querySelector('table:has(thead)'),rows=[...table.rows];
    return {layout:getComputedStyle(table).tableLayout,width:table.getBoundingClientRect().width,
     rows:rows.map(r=>[...r.cells].map(c=>{const b=c.getBoundingClientRect();return {x:b.x,right:b.right,width:b.width,overflow:c.scrollWidth>c.clientWidth+1}}))};
   });
   for(const row of geometry.rows){assert.ok(row[1].width>=geometry.width*.34,'readable item column');for(const cell of row)assert.ok(!cell.overflow,'receipt text must stay inside its column');}
   for(let col=0;col<5;col++)assert.ok(Math.abs(geometry.rows[0][col].x-geometry.rows[2][col].x)<1,'header and rows align');
   data.items[0].name='Cup';await page.setContent(context.window.PosReceiptLayout.render(data,false,revised)+'</body></html>');
   const shortColumns=await page.locator('table:has(thead) tr').first().locator('th').evaluateAll(cells=>cells.map(c=>c.getBoundingClientRect().x));
   for(let col=0;col<5;col++)assert.ok(Math.abs(geometry.rows[0][col].x-shortColumns[col])<1,'column positions must not change between receipts with short and long product names');
   await page.setContent(html);
   if(process.env.POS_RECEIPT_OUT){fs.mkdirSync(process.env.POS_RECEIPT_OUT,{recursive:true});await page.locator('.rcpt').screenshot({path:path.join(process.env.POS_RECEIPT_OUT,'receipt-'+width+(revised?'-revised':'')+'.png')});await page.pdf({path:path.join(process.env.POS_RECEIPT_OUT,'receipt-'+width+(revised?'-revised':'')+'.pdf'),width:width+'mm',printBackground:true});}
  }
  console.log('PASS receipt geometry: 58/80mm, long labels, decimal quantities and revised bills');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
