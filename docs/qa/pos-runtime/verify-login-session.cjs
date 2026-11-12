const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

module.exports = async ({ browser, base, check }) => {
  const config = readFileSync(resolve(__dirname, '../../../component/zenith-erp-saas/MoquiConf.xml'), 'utf8');
  const timeout = Number(config.match(/<session-config\b[^>]*\btimeout="(\d+)"/)?.[1]);
  check('The server HTTP session has a positive idle timeout', Number.isSafeInteger(timeout) && timeout > 0);

  const dashboard = base + '/qapps/zenith/Dashboard';
  const login = base + '/Login#login';

  for (const remember of [false, true]) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(login);
      const form = page.locator('#login_form');
      await form.locator('[name=organizationId]').fill('POS_QA_A');
      await form.locator('[name=username]').fill('pos.qa');
      await form.locator('[name=password]').fill('moqui');
      await form.locator('[name=rememberMe]').setChecked(remember);
      await Promise.all([page.waitForURL(dashboard), form.locator('[type=submit]').click()]);

      const otherTab = await context.newPage();
      await otherTab.goto(login);
      check('A new tab shares an active login with Remember Me ' + (remember ? 'on' : 'off'),
        otherTab.url() === dashboard);
      await otherTab.close();

      const key = (await context.cookies()).find(cookie => cookie.name === 'moquiLoginKey');
      assert(remember ? key?.httpOnly && key.expires > 0 : !key);
      const restarted = await browser.newContext();
      try {
        const persistent = (await context.cookies()).filter(cookie => cookie.expires > 0);
        await restarted.addCookies(persistent);
        const restored = await restarted.newPage();
        await restored.goto(login);
        check('A fresh session uses only the opted-in persistent login', remember
          ? restored.url() === dashboard : await restored.locator('#login_form').isVisible());
      } finally {
        await restarted.close();
      }

      await page.goto(base + '/Login/idleLogout');
      await form.waitFor();
      await page.goto(login);
      check('Revisiting ERP after idle sign-out honors Remember Me ' + (remember ? 'on' : 'off'),
        remember ? page.url() === dashboard : await form.isVisible());

      if (remember) {
        await context.request.get(base + '/Login/logout');
        await page.goto(login);
        check('Explicit sign-out clears Remember Me and returns to the sign-in form',
          !(await context.cookies()).some(cookie => cookie.name === 'moquiLoginKey') && await form.isVisible());
      }
    } finally {
      await context.close();
    }
  }
};
