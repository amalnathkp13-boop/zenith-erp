// Carry the login into a clean profile and simulate a workstation without QZ.
module.exports = async context => {
  const printContext = await context.browser().newContext({
    storageState: { cookies: await context.cookies(), origins: [] },
    serviceWorkers: 'block',
    viewport: { width: 1366, height: 768 }
  });
  await printContext.route('**/qz-tray@*/qz-tray.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: '/* Disposable browser printing QA. */'
  }));
  return printContext;
};
