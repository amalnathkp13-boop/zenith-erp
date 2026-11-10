// Read-only local regression. Optional fixture: fixtures/product-catalog.sql, on local Docker only.
// Run CATALOG_QA_FIXTURE=1 with that fixture, then apply fixtures/product-catalog-cleanup.sql.
import assert from 'node:assert/strict';
const base=process.env.CATALOG_URL || 'http://localhost:8080';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Local verification only');
const auth='Basic '+Buffer.from(`${process.env.SMOKE_USER || 'john.doe'}:${process.env.SMOKE_PASS || 'moqui'}`).toString('base64');
const route='/apps/zenith/Inventory/FindProduct';
async function read(query='',suffix='') {
  const r=await fetch(base+route+suffix+query,{headers:{Authorization:auth}});
  const text=await r.text(); assert.equal(r.status,200);
  assert(!/Template Error|Error rendering|Exception running|ScreenRenderException/.test(text),query);
  return text;
}
const anonymous=await fetch(base+route,{redirect:'manual'});
assert([302,303].includes(anonymous.status),'Authentication required');
for(const query of ['', '?pageIndex=-1&pageSize=0','?pageIndex=oops&pageSize=oops','?orderByField=invalidField','?mrpAmount_from=oops','?catalogSearch=%22%3E%3Cscript%3E']) await read(query);
await read('','.qvt');
const exportQuery='renderMode=csv&lastStandalone=true';
const csv=await read('?'+exportQuery);
assert(csv.startsWith('Item Code,Product Name'),'CSV starts with clean headers, without page chrome');
assert(!csv.includes('MRP (null)'),'Currency header is defined in standalone CSV');
if(process.env.CATALOG_QA_FIXTURE==='1') {
  const query='?catalogSearch=A%20Catalog%20test&pageSize=10';
  const first=await read(query),second=await read(query+'&pageIndex=1'),third=await read(query+'&pageIndex=2');
  assert(first.includes('CATQA-01')&&!first.includes('CATQA-11'),'First page');
  assert(second.includes('CATQA-11')&&!second.includes('CATQA-01'),'Second page');
  assert(third.includes('CATQA-25')&&!third.includes('CATQA-01'),'Third page');
  const sorted=await read('?catalogSearch=A%20Catalog%20test&orderByField=-mrpAmount&orderByField=productName&pageSize=1');
  assert(sorted.includes('CATQA-25')&&!sorted.includes('CATQA-01'),'Legacy multi-column sort is honored');
  const name=await read('?catalogSearch=a%20catalog%20TEST%2025');
  assert(name.includes('CATQA-25')&&!name.includes('CATQA-01'),'Case-insensitive name search across pages');
  assert((await read('?catalogSearch=CATQA-SECONDARY')).includes('CATQA-25'),'Secondary active barcode');
  assert(!(await read('?catalogSearch=CATQA-INACTIVE')).includes('CATQA-24'),'Inactive barcode excluded');
  assert(!(await read('?catalogSearch=CATQA-FOREIGN')).includes('Foreign catalog test'),'Foreign barcode excluded');
  assert(!(await read('?ownerPartyId=ORG_ZINC')).includes('Foreign catalog test'),'Client cannot override org scope');
  const stock=await read('?catalogSearch=CATQA-06&'+exportQuery);
  assert(stock.includes('17.5')&&!stock.includes('999')&&!stock.includes('888'),'Owned inventory and legacy unowned lots only');
  assert((await read('?catalogSearch=CATQA-07')).includes('CATQA-07'),'Product with only foreign stock still lists');
  const zeroMrp=JSON.parse(await read('?catalogSearch=A%20Catalog%20test&mrpMin=0&mrpMax=0&gstRates=0','/catalogQuery'));
  assert.deepEqual(zeroMrp.rows.map(product=>product.pseudoId),['CATQA-01'],'Inclusive zero MRP and GST filters combine');
  assert((await read('?catalogTaxCode=CATQA-SAC')).includes('CATQA-02'),'Tax-code filter searches SAC as well as HSN');
  const zero=await read('?catalogSearch=CATQA-01');
  assert(zero.includes('0.00'),'Zero MRP remains visible');
  const full=await read('?catalogSearch=A%20Catalog%20test&pageIndex=2&pageSize=1&'+exportQuery);
  assert.equal((full.match(/CATQA-\d\d/g)||[]).length,25,'CSV exports all filtered rows, independent of page');
  assert(!full.includes('Foreign catalog test'),'CSV scope');
  assert((await read('?catalogSearch=CATQA-03&'+exportQuery)).includes('Digital'),'Digital type');
  assert((await read('?catalogSearch=CATQA-04&'+exportQuery)).includes('Virtual'),'Virtual type');
  assert((await read('?catalogSearch=CATQA-05&'+exportQuery)).includes('Kit / Assembly'),'Assembly type');
}
console.log('PASS: catalog authentication, input normalization, SPA render, CSV'+(process.env.CATALOG_QA_FIXTURE==='1'?', search/barcodes, pagination, stock ownership, zero values and product types.':'.'));
