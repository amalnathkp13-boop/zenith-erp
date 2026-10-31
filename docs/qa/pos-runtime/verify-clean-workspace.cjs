// Synthetic-only, runs in the existing loopback/tmpfs POS harness; never on production.
const crypto=require('crypto');
module.exports=async function({browser,base,q,check,out,admin,token}) {
  const page=await admin.newPage();
  try {
    const stamp=crypto.randomBytes(5).toString('hex');
    const b={schemaVersion:1,source:{sha256:'a'.repeat(64),companyId:22,companyName:'Synthetic legacy POS',productCount:2,orphanPriceCount:0,duplicateDisplayCodeCount:1},
      workspace:{name:'Clean QA replacement',code:'cleanqa-'+stamp,planId:'PROFESSIONAL',adminEmail:`owner-${stamp}@example.com`,adminFirstName:'Clean',adminLastName:'Owner',regionGeoId:'33',permanentAccessReason:'Synthetic migration acceptance only'},
      shops:[{key:'a',name:'Clean QA Shop A'},{key:'b',name:'Clean QA Shop B'}],
      terminals:[{key:'a1',name:'Clean QA Counter A1',shopKey:'a'},{key:'a2',name:'Clean QA Counter A2',shopKey:'a'},{key:'b1',name:'Clean QA Counter B1',shopKey:'b'}],
      cashiers:[{username:`cashier-a-${stamp}@example.com`,fullName:'Clean QA Cashier A',shopKey:'a'},{username:`cashier-b-${stamp}@example.com`,fullName:'Clean QA Cashier B',shopKey:'b'}],
      pricesIncludeGst:false,modeNames:['Retail','Wholesale'],excluded:[],issues:[],products:[1,2].map(id=>({sourceId:String(id),sku:'SRC-22-'+id,name:'Clean QA Product '+id,sourceCode:'DUP',localName:'தமிழ்',barcode:'',hsn:'',amountUomId:'OTH_ea',sourceUnit:'PCS',category:'Clean QA category',cgst:'6',sgst:'6',retail:String(id*100)+'.00',wholesale:String(id*90)+'.00',sourceMrp:String(id*110)}))};
    const clone=()=>JSON.parse(JSON.stringify(b));
    const tables=['saas_tenant','saas_subscription','saas_invoice','saas_payment','product','pos_sales_mode','pos_product_mode_price','pos_terminal','store','user_account','invoice','payment','pos_transaction','asset','party','person','organization','party_role','party_relationship','user_preference','user_group','user_group_member','company_settings','facility','pos_receipt_template','product_category','product_category_member','product_barcode'];
    const counts=()=>{const row=q('SELECT '+tables.map((t,i)=>`(SELECT count(*) FROM ${t}) AS c${i}`).join(','))[0];return Object.fromEntries(tables.map((t,i)=>[t,Number(row['c'+i])]))};
    const before=counts();
    const foreignBefore=q("SELECT product_id,owner_party_id,mrp_amount FROM product WHERE owner_party_id IN ('POS_QA_A','POS_QA_B') ORDER BY product_id");
    const sharedBefore=q('SELECT * FROM pos_sales_mode WHERE organization_party_id IS NULL ORDER BY sales_mode_id');
    const passwords=Array.from({length:3},()=>crypto.randomBytes(18).toString('hex')+'Aa1!');
    async function invoke(bundle,apply=false,confirmationDigest='',actor=admin,csrf=token) {
      const fields={moquiSessionToken:csrf,apply:String(apply),confirmationDigest,adminPassword:passwords[0],cashierOnePassword:passwords[1],cashierTwoPassword:passwords[2]};
      const json=JSON.stringify(bundle);
      const payload=json.length>150000?{multipart:{...fields,bundleFile:{name:'synthetic-catalog.json',mimeType:'application/json',buffer:Buffer.from(json)}}}:{form:{...fields,bundleJson:json}};
      const response=await actor.request.post(base+'/apps/zenith/pos/PosQaAcceptance/cleanWorkspace',{...payload,maxRedirects:0,timeout:120000});
      const text=await response.text();let body;try{body=JSON.parse(text)}catch{throw Error('Clean migration HTTP '+response.status()+': '+text.slice(0,240))}
      return {status:response.status(),...body};
    }
    const first=await invoke(b);
    check('clean migration preview succeeds without writes',first.result?.preview===true&&!first.errors&&JSON.stringify(before)===JSON.stringify(counts()),first);
    for(const [name,alter] of [
      ['source issues',x=>x.issues.push({sourceId:'3',reason:'missing canonical price'})],
      ['duplicate source keys',x=>x.products[1].sourceId='1'],
      ['wrong product owner injection',x=>x.products[0].ownerPartyId='POS_QA_B'],
      ['zero price',x=>x.products[0].retail='0'],
      ['negative price',x=>x.products[0].wholesale='-1'],
      ['unknown UOM',x=>x.products[0].amountUomId='INVALID_UOM'],
      ['unknown GST slab',x=>x.products[0].cgst='17.123'],
      ['insufficient plan',x=>x.workspace.planId='STARTER'],
      ['cross-shop counter',x=>x.terminals[0].shopKey='foreign'],
      ['duplicate user',x=>x.cashiers[0].username=x.workspace.adminEmail],
      ['old test transactions',x=>x.transactions=[{credit:'DO NOT COPY'}]],
    ]) {
      const changed=clone();alter(changed);const r=await invoke(changed);
      check('clean migration rejects '+name,!!r.errors&&!r.result&&JSON.stringify(before)===JSON.stringify(counts()),r);
    }
    const mismatch=await invoke(b,true,'0'.repeat(64));
    check('clean migration refuses an unreviewed apply digest',!!mismatch.errors&&JSON.stringify(before)===JSON.stringify(counts()),mismatch);
    // Distinct raw strings can be the same scan alias; this failure occurs during
    // the second barcode insertion, after users/shops/products have been written.
    const late=clone();late.products[0].barcode='012345678905';late.products[1].barcode='0012345678905';
    const latePreview=await invoke(late);
    check('clean migration late-failure case passes initial preview',!!latePreview.result&&!latePreview.errors,latePreview);
    const failed=await invoke(late,true,latePreview.result.bundleDigest);
    check('late migration failure rolls back the entire new workspace',/barcode is already assigned/.test(failed.errors)&&!failed.result&&JSON.stringify(before)===JSON.stringify(counts()),failed);
    const tenant=await browser.newContext();
    try {
      await tenant.request.get(base+'/apps/zenith/pos/Dashboard',{headers:{Authorization:'Basic '+Buffer.from('pos.qa:moqui').toString('base64')}});
      const p=await tenant.newPage();await p.goto(base+'/apps/zenith/pos/Terminal');const t=await p.locator('[name=moquiSessionToken]').first().inputValue();
      const rejected=await invoke(b,false,'',tenant,t);
      check('tenant administrator cannot provision or grant permanent access',!!rejected.errors&&JSON.stringify(before)===JSON.stringify(counts()),rejected);
    } finally {await tenant.close()}
    const created=await invoke(b,true,first.result.bundleDigest);
    check('reviewed clean workspace created',created.result?.nonExpiringAccess===true&&!created.errors,created);
    const org=created.result.organizationPartyId;check('new workspace uses a new organization',org&&!['100000','POS_QA_A','POS_QA_B'].includes(org));
    const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
    const n=(table,where)=>Number(q(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)[0].n);
    check('new workspace has exactly two shops',n('store',`organization_party_id=${literal(org)}`)===2);
    check('new workspace has exactly three tenant users and no platform admin grant',n('user_group_member',`user_group_id=${literal('TENANT_'+b.workspace.code.toUpperCase())}`)===3&&n('user_group_member',`user_group_id='ADMIN' AND user_id IN (SELECT user_id FROM user_group_member WHERE user_group_id=${literal('TENANT_'+b.workspace.code.toUpperCase())})`)===0);
    check('new workspace has exactly three counters in its own shops',n('pos_terminal',`organization_party_id=${literal(org)}`)===3&&q(`SELECT t.terminal_id FROM pos_terminal t LEFT JOIN facility f ON f.facility_id=t.facility_id WHERE t.organization_party_id=${literal(org)} AND (f.owner_party_id IS NULL OR f.owner_party_id<>${literal(org)})`).length===0);
    const imported=q(`SELECT pseudo_id,mrp_amount FROM product WHERE owner_party_id=${literal(org)} ORDER BY pseudo_id`);
    check('duplicate display codes retain distinct products and canonical retail prices',imported.length===2&&imported[0].pseudo_id==='SRC-22-1'&&Number(imported[0].mrp_amount)===100&&Number(imported[1].mrp_amount)===200,imported);
    const rates=q(`SELECT p.pseudo_id,m.price FROM pos_product_mode_price m JOIN product p ON p.product_id=m.product_id JOIN pos_sales_mode s ON s.sales_mode_id=m.sales_mode_id WHERE m.organization_party_id=${literal(org)} AND s.mode_code='WSL' ORDER BY p.pseudo_id`);
    check('canonical wholesale prices persisted independently',rates.length===2&&Number(rates[0].price)===90&&Number(rates[1].price)===180,rates);
    const sub=q(`SELECT status_id,billing_cycle,end_date,renewal_date,trial_end_date FROM saas_subscription WHERE tenant_id=${literal(created.result.tenantId)} AND status_id='SubActive'`);
    check('new tenant has one non-expiring non-renewing manual grant',sub.length===1&&sub[0].billing_cycle==='Manual'&&!sub[0].end_date&&!sub[0].renewal_date&&!sub[0].trial_end_date,sub);
    for(const table of ['pos_transaction','pos_session','asset','pos_cash_entry','pos_expense'])check('no old '+table+' copied',n(table,`${table==='asset'?'owner_party_id':'organization_party_id'}=${literal(org)}`)===0);
    check('existing product prices and shared sales modes unchanged',JSON.stringify(foreignBefore)===JSON.stringify(q("SELECT product_id,owner_party_id,mrp_amount FROM product WHERE owner_party_id IN ('POS_QA_A','POS_QA_B') ORDER BY product_id"))&&JSON.stringify(sharedBefore)===JSON.stringify(q('SELECT * FROM pos_sales_mode WHERE organization_party_id IS NULL ORDER BY sales_mode_id')));
    for(const table of ['invoice','payment','saas_invoice','saas_payment'])check('migration creates no '+table,counts()[table]===before[table]);
    const replay=await invoke(b,true,first.result.bundleDigest);
    check('replaying the same import never creates a second workspace',!!replay.errors&&n('saas_tenant',`subdomain=${literal(b.workspace.code)}`)===1,replay);
    const bulk=clone();bulk.workspace.code+='-bulk';bulk.workspace.adminEmail='bulk-'+bulk.workspace.adminEmail;bulk.cashiers.forEach(u=>u.username='bulk-'+u.username);
    bulk.source.productCount=1212;bulk.products=Array.from({length:1212},(_,i)=>({...b.products[0],sourceId:String(i+1),sku:'SRC-22-'+(i+1),name:'Clean QA bulk product '+(i+1)}));
    bulk.products[0].sourceCode='LEGACY-QA-BULK-1';
    const bulkPreview=await invoke(bulk);check('1212-product migration validates',!!bulkPreview.result&&!bulkPreview.errors);
    const started=Date.now(),bulkCreated=await invoke(bulk,true,bulkPreview.result.bundleDigest);
    check('1212-product migration commits complete retail and wholesale catalogs',!!bulkCreated.result&&!bulkCreated.errors&&n('product',`owner_party_id=${literal(bulkCreated.result?.organizationPartyId)}`)===1212&&n('pos_product_mode_price',`organization_party_id=${literal(bulkCreated.result?.organizationPartyId)}`)===2424,{elapsedMs:Date.now()-started,products:bulkCreated.result?.products,errors:bulkCreated.errors});
    check('same source SKUs in another workspace never overwrite the first import',JSON.stringify(imported)===JSON.stringify(q(`SELECT pseudo_id,mrp_amount FROM product WHERE owner_party_id=${literal(org)} ORDER BY pseudo_id`)));
    check('unambiguous legacy SKU labels retained without ambiguous duplicate aliases',bulkCreated.result.legacyScanAliases===1&&n('product_barcode',`organization_party_id=${literal(bulkCreated.result.organizationPartyId)} AND barcode_value='LEGACY-QA-BULK-1'`)===1&&n('product_barcode',`organization_party_id=${literal(bulkCreated.result.organizationPartyId)} AND barcode_value='DUP'`)===0);

    // Creating owned RTL/WSL codes must not disable another tenant's quantity pricing.
    const existing=await browser.newContext();try{
      const login=await existing.request.get(base+'/apps/zenith/pos/Terminal',{headers:{Authorization:'Basic '+Buffer.from('pos.qa:moqui').toString('base64')}});
      const csrf=(await login.text()).match(/name="moquiSessionToken" value="([^"]+)"/)?.[1];
      const op=async(action,params={})=>{const r=await existing.request.post(base+'/apps/zenith/pos/PosQaAcceptance/invoke',{form:{moquiSessionToken:csrf,op:action,...params}});const body=await r.json();check('existing tenant '+action+' after migration',r.status()===200&&!body.errors?.length,{status:r.status(),errors:body.errors,denied:body.denied});return body.result;};
      const session=await op('open',{terminalId:'POS_QA_A_TERM1',openingCash:'0'}),cart=await op('cart',{sessionId:session.sessionId});
      await op('add',{transactionId:cart.transactionId,productId:'POS_QA_A_BREAK',quantity:'5',taxOn:'N'});
      const line=q(`SELECT sales_mode_id,unit_price FROM pos_transaction_item WHERE transaction_id=${literal(cart.transactionId)}`)[0];
      check('foreign owned mode codes cannot disable existing quantity pricing',line.sales_mode_id==='WHOLESALE'&&Number(line.unit_price)===90,line);
      await op('void',{transactionId:cart.transactionId});await op('close',{sessionId:session.sessionId,closingCash:'0'});
    }finally{await existing.close()}

    for(let i=0;i<3;i++){
      const c=await browser.newContext();try{
        const username=[b.workspace.adminEmail,...b.cashiers.map(u=>u.username)][i];
        const r=await c.request.get(base+'/apps/zenith/pos/Dashboard',{headers:{Authorization:'Basic '+Buffer.from(username+':'+passwords[i]).toString('base64')}});
        const p=await c.newPage();await p.goto(base+'/apps/zenith/pos/PosSessions',{waitUntil:'domcontentloaded'});await p.locator('.z-pos-page').first().waitFor();
        check('new login '+(i+1)+' reaches its POS workspace',r.status()===200&&await p.locator('.z-pos-page').count()>0,{status:r.status(),url:p.url(),title:await p.title(),content:(await p.locator('body').innerText()).slice(0,400)});
        if(i===0){
          await p.goto(base+'/apps/zenith/pos/ProductPricing',{waitUntil:'networkidle'});
          const headers=await p.locator('thead').innerText();
          check('new owner sees editable retail and wholesale price columns',headers.includes('Retail')&&headers.includes('Wholesale')&&await p.locator('input[data-mode-id]').count()===4,{headers});
          await p.goto(base+'/apps/zenith/pos/PosSessions',{waitUntil:'networkidle'});
          const csrf=await p.locator('[name=moquiSessionToken]').first().inputValue();
          const submit=async(screen,transition,params)=>c.request.post(`${base}/apps/zenith/pos/${screen}/${transition}`,{form:{moquiSessionToken:csrf,...params},maxRedirects:0});
          const terminal=q(`SELECT terminal_id FROM pos_terminal WHERE organization_party_id=${literal(org)} ORDER BY terminal_id`)[0].terminal_id;
          await submit('PosSessions','openSession',{terminalId:terminal,openingCash:'0'});
          const session=q(`SELECT session_id FROM pos_session WHERE terminal_id=${literal(terminal)} AND status_id='PsOpen'`)[0];
          check('new owner opens an imported counter',!!session);
          const retail=q(`SELECT sales_mode_id FROM pos_sales_mode WHERE organization_party_id=${literal(org)} AND mode_code='RTL'`)[0].sales_mode_id;
          const wholesale=q(`SELECT sales_mode_id FROM pos_sales_mode WHERE organization_party_id=${literal(org)} AND mode_code='WSL'`)[0].sales_mode_id;
          const product=q(`SELECT product_id FROM product WHERE owner_party_id=${literal(org)} AND pseudo_id='SRC-22-1'`)[0].product_id;
          await submit('Terminal','addItem',{sessionId:session.session_id,productId:product,addQty:'1',taxOn:'N',salesModeId:retail});
          const cart=q(`SELECT transaction_id,grand_total FROM pos_transaction WHERE organization_party_id=${literal(org)} AND status_id='PtCreated'`)[0];
          check('new catalog creates a tax-off retail cart at the imported price',Number(cart?.grand_total)===100,cart);
          const line=()=>q(`SELECT item_seq_id,sales_mode_id,unit_price,manual_price FROM pos_transaction_item WHERE transaction_id=${literal(cart.transaction_id)}`)[0];
          const parameters={transactionId:cart.transaction_id,sessionId:session.session_id,itemSeqId:line().item_seq_id,taxOn:'N',salesModeId:retail};
          await submit('Terminal','setItemMode',{...parameters,itemMode:wholesale});
          check('new catalog switches the line to its imported wholesale price',Number(line().unit_price)===90);
          await submit('Terminal','setItemMode',{...parameters,itemMode:'__AUTO__'});
          check('automatic line reset uses this workspace default',line().sales_mode_id===retail&&Number(line().unit_price)===100&&line().manual_price==='N',line());
          await submit('Terminal','toggleTax',{...parameters,taxOn:'Y'});
          check('new catalog GST rates calculate on the fresh account',Number(q(`SELECT total_tax_amount FROM pos_transaction WHERE transaction_id=${literal(cart.transaction_id)}`)[0].total_tax_amount)===12);
          await submit('Terminal','toggleTax',{...parameters,taxOn:'N'});
          check('new catalog tax-off removes the computed tax',Number(q(`SELECT total_tax_amount FROM pos_transaction WHERE transaction_id=${literal(cart.transaction_id)}`)[0].total_tax_amount)===0);
          const marker=async mode=>{const r=await admin.request.post(base+'/apps/zenith/pos/PosQaAcceptance/cleanWorkspace',{form:{moquiSessionToken:token,bundleJson:JSON.stringify(b),markerMode:mode}});return (await r.json()).changed};
          try{
            check('synthetic permanent marker changed for authorization probe',await marker('foreign'));
            await p.reload();check('a foreign permanent marker cannot unlock an undated grant',await p.getByText('Account Suspended',{exact:true}).count()===1);
          }finally{check('synthetic permanent marker restored',await marker('restore'))}
          await p.reload();check('only the matching permanent marker restores access',await p.locator('.z-pos-page').count()>0);
          check('manual expiry job leaves permanent access active',await marker('expire')&&q(`SELECT status_id FROM saas_tenant WHERE tenant_id=${literal(created.result.tenantId)}`)[0].status_id==='SaasTenantActive');
        }
      }finally{await c.close()}
    }
    for(const shell of ['apps','qapps']){
      for(const transition of ['previewWorkspace','createWorkspace']){
        const r=await admin.request.get(`${base}/${shell}/zenith/saas-admin/CleanWorkspace/${transition}`);
        check(shell+' '+transition+' refuses GET',r.status()===405);
      }
      await page.goto(`${base}/${shell}/zenith/saas-admin/CleanWorkspace`,{waitUntil:'networkidle'});
      await page.getByText('Create a clean shop workspace',{exact:true}).waitFor();
      check(shell+' clean workspace form renders',await page.getByText('Create a clean shop workspace',{exact:true}).count()===1&&await page.locator('input[type=password]').count()===3);
      const ui=clone();ui.workspace.code+='-'+shell;ui.workspace.adminEmail=shell+'-'+ui.workspace.adminEmail;ui.cashiers.forEach(u=>u.username=shell+'-'+u.username);
      const form=page.locator('form').filter({has:page.getByRole('button',{name:'Preview only',exact:true})});
      await form.locator('input[type=file]').setInputFiles({name:'synthetic-catalog.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(ui))});
      const oldCounts=counts();
      const previewNavigation=shell==='apps'?page.waitForNavigation({waitUntil:'networkidle'}):Promise.resolve();
      const [submitted]=await Promise.all([page.waitForResponse(r=>r.url().includes('/previewWorkspace')&&r.request().method()==='POST'),page.getByRole('button',{name:'Preview only',exact:true}).click(),previewNavigation]);
      await page.waitForLoadState('networkidle');
      const expectedDigest=crypto.createHash('sha256').update(JSON.stringify(ui)).digest('hex');
      const previewText=submitted.status()>=300&&submitted.status()<400?await page.content():await submitted.text();
      check(shell+' real preview form validates without creating records',previewText.includes(expectedDigest)&&JSON.stringify(oldCounts)===JSON.stringify(counts()));
      await page.getByText('Create a clean shop workspace',{exact:true}).waitFor();
      const applyForm=page.locator('form').filter({has:page.getByRole('button',{name:'Create new workspace',exact:true})});
      await applyForm.locator('input[type=file]').setInputFiles({name:'synthetic-catalog.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(ui))});
      await applyForm.locator('[name=confirmationDigest]').fill('0'.repeat(64));
      for(const [i,name] of ['adminPassword','cashierOnePassword','cashierTwoPassword'].entries())await applyForm.locator('[name='+name+']').fill(passwords[i]);
      const deniedNavigation=shell==='apps'?page.waitForNavigation({waitUntil:'networkidle'}):Promise.resolve();
      const [deniedApply]=await Promise.all([page.waitForResponse(r=>r.url().includes('/createWorkspace')&&r.request().method()==='POST'),page.getByRole('button',{name:'Create new workspace',exact:true}).click(),deniedNavigation]);
      const deniedText=deniedApply.status()>=300&&deniedApply.status()<400?await page.content():await deniedApply.text();
      check(shell+' invalid apply cannot echo credentials or create records',!passwords.some(password=>deniedText.includes(password))&&JSON.stringify(oldCounts)===JSON.stringify(counts()));
      await page.getByText('Create a clean shop workspace',{exact:true}).waitFor();
      if(shell==='apps')await page.screenshot({path:require('path').join(out,'clean-workspace-preview.png'),fullPage:true});
      await page.goto(`${base}/${shell}/zenith/saas-admin/PlanAssignments?tenantId=${created.result.tenantId}`,{waitUntil:'networkidle'});
      check(shell+' permanent access is displayed without an expiry countdown',await page.getByText('Non-expiring manual access',{exact:true}).count()===1);
    }
  }finally{await page.close()}
};
