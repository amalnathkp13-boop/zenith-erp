const { randomUUID } = require('node:crypto');
const path = require('node:path');

module.exports = async ({a,base,check,out}) => {
  const page=await a.c.newPage();
  try {
    for (const shell of ['apps','qapps']) {
      await page.setViewportSize({width:shell==='apps'?1366:390,height:840});
      await page.goto(base+'/'+shell+'/zenith/Inventory/FindProduct',{waitUntil:'domcontentloaded'});
      await (shell==='apps'?page.locator('#CreateProductDialog-button'):page.getByRole('button',{name:'New Product',exact:true})).click();
      const form=page.locator('#CreateProductForm');
      await form.locator('input[name=productName]').waitFor();
      await page.locator('#CreateProductForm[data-bound=true]').waitFor();
      check(shell+' product creation only requires Name and Unit',
        (await form.locator('[required]').evaluateAll(fields=>fields.map(f=>f.name))).join(',')==='productName,uqcEnumId');
      const basic=form.locator('section[aria-labelledby="pe-create-basic"]');
      check(shell+' Basic Info shows generated Item Code and Barcode',
        await basic.getByLabel('Item Code',{exact:true}).inputValue()==='Generated on save'&&
        await basic.getByLabel('Barcode',{exact:true}).inputValue()==='Generated on save');
      const name='Mode form QA '+randomUUID().slice(0,8);
      const nameField=form.locator('input[name=productName]');
      const print=form.locator('input[name=printName]');
      await nameField.fill(name);
      check(shell+' print name follows product name initially',await print.inputValue()===name);
      await print.fill('Thermal '+name);
      await nameField.fill(name+' Updated');
      check(shell+' product rename preserves a manually edited print name',await print.inputValue()==='Thermal '+name);
      await form.locator('select[name=uqcEnumId]').selectOption('PCS',{force:true});
      const mrp=form.locator('input[name=mrpAmount]');
      const prices=form.locator('[data-pe-mode-id]');
      check(shell+' sales modes load as fixed rows',await prices.count()>=2&&await form.locator('.pe-mode-prices select').count()===0);
      await mrp.fill('100');
      await prices.first().fill('100');
      await mrp.fill('110');
      check(shell+' equal custom price stays fixed while inherited price follows MRP',
        await prices.first().inputValue()==='100'&&await prices.nth(1).inputValue()===''&&
        await prices.nth(1).getAttribute('placeholder')==='110');
      if(out) await page.screenshot({path:path.join(out,'product-create-'+shell+'.png')});
      await page.route('**/FindProduct/createProduct',route=>route.abort(),{times:1});
      const submit=form.locator('#CreateProductForm_submitButton');
      await submit.click();
      await form.locator('[data-pe-status][data-error=true]').waitFor();
      check(shell+' failed save leaves the typed product and override available',
        await nameField.inputValue()===name+' Updated'&&await prices.first().inputValue()==='100');
      await Promise.all([page.waitForURL('**/EditProduct?*'),submit.click()]);
      const edit=page.locator('#productEditorForm');
      await edit.locator('input[name=productName]').waitFor();
      await page.locator('#productEditor[data-bound=true]').waitFor();
      const code=await edit.getByLabel('Item Code',{exact:true}).inputValue();
      const barcode=await edit.getByLabel('Barcode',{exact:true}).inputValue();
      const stored=edit.locator('[data-pe-mode-id]').first();
      check(shell+' generated Item Code and Barcode and saved override survive navigation',
        !!code&&barcode===code&&await stored.inputValue()==='100'&&
        await edit.locator('input[name=printName]').inputValue()==='Thermal '+name);
      await stored.fill('');
      await Promise.all([page.waitForURL(url=>url.searchParams.get('productSaved')==='Y'),
        edit.locator('.pe-savebar button[type=submit]').click()]);
      check(shell+' clearing an override persists MRP inheritance after save',
        await stored.inputValue()===''&&await stored.getAttribute('placeholder')==='110');
      await page.goto(base+'/'+shell+'/zenith/Inventory/FindProduct',{waitUntil:'domcontentloaded'});
      await (shell==='apps'?page.locator('#CreateProductDialog-button'):page.getByRole('button',{name:'New Product',exact:true})).click();
      const blank=page.locator('#CreateProductForm[data-bound=true]');
      await blank.locator('[name=productName]').fill('Blank MRP QA '+randomUUID().slice(0,8));
      await blank.locator('[name=uqcEnumId]').selectOption('PCS',{force:true});
      for(const input of await blank.locator('[data-pe-mode-id]').all()) await input.fill('4.5');
      await Promise.all([page.waitForURL('**/EditProduct?*'),blank.locator('#CreateProductForm_submitButton').click()]);
      const saved=page.locator('#productEditorForm');
      await saved.locator('[data-pe-mode-id]').first().waitFor();
      check(shell+' creates a product with blank MRP, tax and stock and decimal mode prices',
        await saved.locator('[name=mrpAmount]').inputValue()===''&&
        await saved.locator('[data-pe-mode-id]').evaluateAll(inputs=>inputs.every(input=>Number(input.value)===4.5)));
    }
  } finally { await page.close(); }
};
