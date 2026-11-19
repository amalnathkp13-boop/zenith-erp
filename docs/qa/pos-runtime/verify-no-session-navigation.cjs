const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');

const terminal=fs.readFileSync(path.resolve(__dirname,'../../../component/zenith-erp-pos/screen/zenith/pos/Pos/Terminal.xml'),'utf8');
const noSession=terminal.split('name="NoSessionSection"')[1]?.split('name="ActiveSessionSection"')[0]||'';
assert.match(noSession,/Back to POS/);
assert.match(noSession,/posBillingBack!'\/apps\/zenith\/pos\/Dashboard'/);
assert.match(noSession,/">Back to POS<\/a>/);
assert.doesNotMatch(noSession,/href="\/(?:qapps\/zenith"|apps\/zenith\/Dashboard")/);
console.log('No-session POS return target is the POS dashboard');
