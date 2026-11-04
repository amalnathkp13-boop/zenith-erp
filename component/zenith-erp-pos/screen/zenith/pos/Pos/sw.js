const CACHE_NAME = 'zenith-pos-cache-v7';

// Minimal precache — only what's needed for an offline shell.
// NOTE: the Terminal screen is mounted at /apps/zenith/pos/Terminal (NOT .../pos/Pos/...);
// the /Pos/ paths used previously 404'd, so the offline shell never cached anything.
const PRECACHE_ASSETS = [
    '/apps/zenith/pos/Terminal',
    '/apps/zenith/pos/manifest.json'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.allSettled(PRECACHE_ASSETS.map(url => cache.add(url)))
        )
    );
});

// Purge old POS caches so stale app code and navigation preferences are never served.
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith('zenith-pos-cache-') && k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = event.request.url;
    // Never cache authenticated navigation preferences, even when the dashboard is controlled by this worker.
    const path = new URL(url).pathname;
    if (url.includes('/rest/') || url.includes('ajaxCart') || url.includes('/Login') ||
        path === '/apps/zenith/getSidebarConfiguration' || path === '/apps/zenith/getSubnavConfiguration') return;

    // 1) Versioned/immutable static assets (?v=N, libs, fonts, images):
    //    cache-FIRST + background revalidate → instant repeat loads. Safe because each
    //    deployed version has a unique URL (?v= changes), so cache can never serve a wrong version.
    const isImmutable =
        /[?&]v=\d/.test(url) ||
        /\.(woff2?|ttf|otf|eot|png|jpe?g|svg|gif|ico|webp)(\?|$)/i.test(url) ||
        url.includes('/lib/') || url.includes('/ssstatic/');
    if (isImmutable) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                const network = fetch(event.request).then(resp => {
                    if (resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors')) {
                        const clone = resp.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return resp;
                }).catch(() => cached);
                return cached || network; // serve cache instantly when present, revalidate in background
            })
        );
        return;
    }

    // 2) App logic / dynamic screens (unversioned .js/.css, .qvt, Terminal screen) AND every page
    //    NAVIGATION: network-FIRST so deployed updates are always picked up; cache is offline fallback
    //    only. ZE-SHOP fix: page navigations used to fall through to case 3 (cache-first), which froze
    //    every /apps/zenith/pos/* screen (Dashboard, OwnerDashboard, …) — and its ZenithApp nav chrome —
    //    at the first-cached version, so POS-using tenants never saw the new sidebar / top bar. Serving
    //    document navigations network-first keeps the shell (and its authenticated, tenant-specific data)
    //    always fresh; the offline fallback below still yields the cached page or the Terminal shell.
    const networkFirst =
        event.request.mode === 'navigate' ||
        url.includes('Terminal') || url.includes('.qvt') ||
        url.endsWith('.js') || url.includes('.js?') ||
        url.endsWith('.css') || url.includes('.css?');
    if (networkFirst) {
        event.respondWith(
            fetch(event.request).then(response => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() =>
                caches.match(event.request).then(c => c || caches.match('/apps/zenith/pos/Terminal'))
            )
        );
        return;
    }

    // 3) Everything else: cache-first with network fallback.
    event.respondWith(
        caches.match(event.request).then(cached => cached ||
            fetch(event.request).then(response => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {})
        )
    );
});

self.addEventListener('sync', event => {
    // offline transaction queue is pushed from pos-terminal.js on the 'online' event
});
