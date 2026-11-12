// Carry the login into a clean browser profile so earlier POS printer settings cannot select QZ.
module.exports = async context => context.browser().newContext({
  storageState: { cookies: await context.cookies(), origins: [] },
  serviceWorkers: 'block',
  viewport: { width: 1366, height: 768 }
});
