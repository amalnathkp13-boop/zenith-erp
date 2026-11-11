// Exercises production Kitchen route loading in a real browser, without business records.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright');
const scriptPath=path.resolve('component/zenith-erp-app/screen/zenithstatic/js/kitchen-display.js');
const source=fs.existsSync(scriptPath)?fs.readFileSync(scriptPath,'utf8'):'/* baseline has no Kitchen route loading guard */';
const frame=route=>`<section id="kitchen-page-frame" data-kitchen-route="${route}"><main class="${route.endsWith('KitchenDisplay')?'zk-display':''}" id="${route.endsWith('Tables')?'tm-wrap':route.endsWith('KotBilling')?'kb-wrap':'page'}"><h1>${route}</h1></main></section>`;
const html=(content,ready=true)=>`<html><head></head><body><header id="top">Current shared header</header>${ready?'<aside id="z-sidebar">Current sidebar</aside><nav id="z-subnav" class="show">Current POS navigation</nav>':''}<div id="content"><div class="inner"><div class="container-fluid">${content}</div></div></div></body></html>`;
(async()=>{const browser=await (process.env.POS_QA_ENGINE==='webkit'?webkit:chromium).launch({headless:true,...(process.env.POS_QA_ENGINE==='webkit'?{}:{executablePath:process.env.POS_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'})});const results=[];
async function test(name,run){const page=await browser.newPage();try{await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:html('<div id="old-screen">Previous page sentinel</div>')}));await page.goto('http://127.0.0.1:18084/apps/zenith/pos/Dashboard');await page.evaluate(()=>{window.__pending=[];window.moqui={webrootVue:{loading:0,setUrl:function(url){this.loading++;moqui.loadComponent({path:url},comp=>{document.querySelector('#content .container-fluid').innerHTML=comp;this.loading--;});}},loadComponent:function(info,callback){__pending.push({info,callback});return {abort(){}};},handleAjaxError:function(){}};});await page.addScriptTag({content:source});await run(page);results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}finally{await page.close();}}
await test('navigation immediately hides the previous page and keeps shared chrome',async p=>{await p.evaluate(()=>moqui.webrootVue.setUrl('/apps/zenith/pos/Kitchen/KitchenDisplay'));await p.waitForTimeout(40);assert.equal(await p.locator('#old-screen').isVisible(),false);assert.equal(await p.locator('#top').isVisible(),true);assert.equal(await p.locator('#z-subnav').isVisible(),true);assert.equal(await p.locator('#zk-route-status').isVisible(),true);});
await test('slow Billing navigation keeps the previous page visible and inert without a loading card',async p=>{
    const billing='/apps/zenith/pos/Kitchen/KotBilling';
    await p.evaluate(route=>moqui.webrootVue.setUrl(route),billing);
    assert.equal(await p.locator('#old-screen').isVisible(),true);
    assert.equal(await p.locator('#old-screen').evaluate(node=>node.closest('[inert]')!==null),true);
    assert.equal(await p.locator('#zk-route-status').count(),0);
    await p.evaluate(markup=>__pending[0].callback(markup),frame(billing));
    await p.locator('#kb-wrap').waitFor();
    await p.waitForFunction(()=>!document.querySelector('#kb-wrap').closest('[inert]'));
    assert.equal(await p.locator('#zk-route-status').count(),0);
});
await test('ready swaps the loader for one kitchen content frame',async p=>{await p.evaluate(()=>moqui.webrootVue.setUrl('/apps/zenith/pos/Kitchen/KitchenDisplay'));await p.evaluate(markup=>__pending[0].callback(markup),frame('/apps/zenith/pos/Kitchen/KitchenDisplay'));await p.waitForTimeout(60);assert.equal(await p.locator('#old-screen').count(),0);assert.equal(await p.locator('#kitchen-page-frame').isVisible(),true);assert.equal(await p.locator('#zk-route-status').count(),0);});
await test('a late response cannot overwrite a newer kitchen route',async p=>{await p.evaluate(()=>{moqui.webrootVue.setUrl('/apps/zenith/pos/Kitchen/KitchenDisplay');moqui.webrootVue.setUrl('/apps/zenith/pos/Kitchen/Tables');});await p.evaluate(markup=>__pending[1].callback(markup),frame('/apps/zenith/pos/Kitchen/Tables'));await p.evaluate(markup=>__pending[0].callback(markup),frame('/apps/zenith/pos/Kitchen/KitchenDisplay'));await p.waitForTimeout(60);assert.equal(await p.locator('#kitchen-page-frame').getAttribute('data-kitchen-route'),'/apps/zenith/pos/Kitchen/Tables');});
await test('failure retains a Kitchen error and retry while old screen stays hidden',async p=>{await p.evaluate(()=>{moqui.webrootVue.setUrl('/apps/zenith/pos/Kitchen/KitchenDisplay');moqui.handleAjaxError({status:503});});await p.waitForTimeout(30);assert.equal(await p.locator('#old-screen').isVisible(),false);assert.match(await p.locator('#zk-route-status').innerText(),/Retry/);});
await test('leaving KOT Billing cancels a pending tab and keeps the gateway usable',async p=>{
    const base='http://127.0.0.1:18084';
    const billing='/apps/zenith/kot/KotBilling', tables='/apps/zenith/kot/Tables';
    await p.goto(base+billing);
    await p.setContent(html(frame(billing)));
    await p.evaluate(({tables})=>{
        document.querySelector('#z-subnav').innerHTML='<a href="'+tables+'">Tables</a>';
        document.querySelector('#z-sidebar').innerHTML='<a href="/apps/zenith/Inventory">Inventory</a>';
        document.querySelector('#z-sidebar a').addEventListener('click',event=>event.preventDefault(),{once:true});
    },{tables});
    await p.addScriptTag({content:source});
    await p.locator('#zk-route-status').waitFor({state:'hidden'});
    let releaseTab;
    const waitForRelease=new Promise(resolve=>{releaseTab=resolve;});
    await p.route(base+tables,async route=>{
        await waitForRelease;
        await route.fulfill({contentType:'text/html',body:html(frame(tables))}).catch(()=>{});
    });
    const requested=p.waitForRequest(base+tables);
    try {
        await p.getByRole('link',{name:'Tables'}).click();
        await requested;
        assert.equal(await p.locator('#zk-route-status').isVisible(),true);
        await p.getByRole('link',{name:'Inventory'}).click();
        assert.equal(await p.locator('#zk-route-status').count(),0);
        assert.equal(await p.locator('#kb-wrap').isVisible(),true);
        releaseTab();
        await p.getByRole('link',{name:'Inventory'}).click();
        await p.waitForURL(base+'/apps/zenith/Inventory');
    } finally {releaseTab();}
});
await test('direct entry renders Billing while keeping the framework header hidden until the shell is ready',async p=>{await p.goto('http://127.0.0.1:18084/apps/zenith/pos/Kitchen/KotBilling');await p.setContent(html(frame('/apps/zenith/pos/Kitchen/KotBilling'),false));await p.addScriptTag({content:source});assert.equal(await p.locator('#kb-wrap').isVisible(),true);assert.equal(await p.locator('#zk-route-status').count(),0);assert.equal(await p.locator('#top').isVisible(),false);await p.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<aside id="z-sidebar"></aside><nav id="z-subnav" class="show"></nav>');});await p.locator('#top').waitFor();});
await browser.close();console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.passed))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
