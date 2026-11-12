/* ============================================================================
 * ZetaERP inactivity auto-logout  (ZE-INV-014 / IV-118)
 * ----------------------------------------------------------------------------
 * The HTTP session already expires server-side after 30 min idle
 * (zenith-erp-saas/MoquiConf.xml <session-config timeout="30">), but nothing
 * PROACTIVELY enforces it: the /qapps Quasar SPA keeps showing cached UI (and a
 * "Remember Me" login-key can silently re-authenticate), so an idle user never
 * sees a login prompt. This script watches for real user activity and, after
 * IDLE_MS with none, warns and ends the active session. The idle tab lands on
 * the sign-in form while a later visit can still use an opted-in remembered login.
 *
 * Loaded app-wide via footer_scripts in ZenithApp.xml, so it runs on BOTH /apps
 * (Bootstrap) and /qapps (Quasar SPA). All UI is built in JS with inline styles
 * (the /qapps SPA strips <style>/<script> from screen content, but this loads in
 * the page footer, not screen content).
 *
 * KOT billing keeps the HTTP session alive for up to an hour without cashier
 * input. The standard POS terminal and other POS screens keep their exemptions.
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__zIdleLogout) return;            // guard against double-load
  window.__zIdleLogout = 1;

  var path = (location.pathname || '');
  // Read the current route on each check because Quasar switches screens in place.
  var inApp = /\/(apps|qapps)\/zenith(\/|$)/.test(path);
  if (!inApp) return;
  function isPosTerminal() {
    return /\/zenith\/pos\/Terminal(?:\/|$)/i.test(location.pathname);
  }

  var IDLE_MS   = 30 * 60 * 1000;  // must match the server session-config timeout (30 min)
  var KOT_IDLE_MS = 60 * 60 * 1000;
  var WARN_MS   = 60 * 1000;       // show the "you're about to be signed out" warning this long before
  var CHECK_MS  = 5 * 1000;        // how often we re-evaluate idleness
  var LS_KEY    = 'zIdleLastActivity';   // shared across tabs so activity in ANY tab keeps them all alive
  var KEEPALIVE_THROTTLE = 5 * 60 * 1000; // at most one server keep-alive per 5 min of activity

  var lastKeepAlive = 0;
  var banner = null, countdownEl = null, warned = false;
  var kotScreen = null, lastKotActivity = 0, checkTimer;

  function now() { return Date.now(); }

  function activeKotScreen(time) {
    var onKotRoute = /\/zenith\/(?:kot|pos\/Kitchen)\/KotBilling\/?$/i.test(location.pathname);
    var screen = onKotRoute ? document.getElementById('kb-wrap') : null;
    if (screen !== kotScreen) {
      kotScreen = screen;
      lastKotActivity = time;
    }
    return !!screen;
  }

  function readLast() {
    var v;
    try { v = parseInt(localStorage.getItem(LS_KEY), 10); } catch (e) { v = 0; }
    return v && !isNaN(v) ? v : now();
  }
  function writeLast(t) { try { localStorage.setItem(LS_KEY, String(t)); } catch (e) {} }

  // Lightweight server ping so the HTTP session's last-access tracks real user
  // activity (the SPA can go a while between screen loads). Read-only, cheap.
  function keepAlive() {
    var t = now();
    if (t - lastKeepAlive < KEEPALIVE_THROTTLE) return;
    lastKeepAlive = t;
    try {
      var base = path.replace(/(\/(?:apps|qapps)\/zenith)(\/.*)?$/, '$1/saasConfig');
      fetch(base + (base.indexOf('?') < 0 ? '?' : '&') + '_ka=' + t, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store'
      }).catch(function () {});
    } catch (e) {}
  }

  function markActivity() {
    writeLast(now());
    if (warned) hideWarning();
    keepAlive();
  }

  // Throttle high-frequency events (mousemove/scroll) so we don't hammer localStorage.
  var throttled = false;
  function onActivity(event) {
    if (loggingOut) return;
    var time = now();
    if (activeKotScreen(time)) {
      // Programmatic scrolls also produce trusted scroll events. Count the gesture instead.
      if (!event.isTrusted || event.type === 'scroll') return;
      if (time - lastKotActivity >= KOT_IDLE_MS) {
        if (event.type === 'keydown' || event.type === 'click') event.preventDefault();
        event.stopImmediatePropagation();
        doLogout();
        return;
      }
      lastKotActivity = time;
      if (warned) hideWarning();
    }
    if (throttled) return;
    throttled = true;
    setTimeout(function () { throttled = false; }, 1000);
    markActivity();
  }

  function buildBanner() {
    if (banner) return;
    banner = document.createElement('div');
    banner.setAttribute('role', 'alertdialog');
    banner.style.cssText = [
      'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:2147483647', 'max-width:92vw', 'box-sizing:border-box',
      'background:#fff8e1', 'color:#5f4300', 'border:1px solid #ffc107',
      'border-left:5px solid #f59e0b', 'border-radius:10px',
      'box-shadow:0 8px 28px rgba(0,0,0,.22)', 'padding:14px 18px',
      'font:500 14px/1.4 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
      'display:flex', 'align-items:center', 'gap:14px'
    ].join(';');
    var msg = document.createElement('div');
    msg.innerHTML = 'You’ve been inactive. For your security you’ll be signed out in ' +
      '<b><span id="zIdleCountdown">60</span>s</b>.';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Stay signed in';
    btn.style.cssText = [
      'flex:0 0 auto', 'cursor:pointer', 'border:0', 'border-radius:8px',
      'background:#7C3AED', 'color:#fff', 'font-weight:600', 'font-size:14px',
      'padding:8px 16px', 'white-space:nowrap'
    ].join(';');
    btn.onclick = function () { lastKeepAlive = 0; markActivity(); };
    banner.appendChild(msg);
    banner.appendChild(btn);
    (document.body || document.documentElement).appendChild(banner);
    countdownEl = banner.querySelector('#zIdleCountdown');
  }

  function showWarning() {
    warned = true;
    buildBanner();
    var container = document.fullscreenElement || document.body;
    if (banner.parentNode !== container) container.appendChild(banner);
    banner.style.display = 'flex';
  }
  function hideWarning() {
    warned = false;
    if (banner) banner.style.display = 'none';
  }

  var loggingOut = false;
  function doLogout() {
    if (loggingOut) return;
    loggingOut = true;
    if (countdownEl) countdownEl.parentNode.innerHTML = 'Signing you out due to inactivity…';
    location.href = '/Login/idleLogout';
  }

  function checkIdle() {
    var time = now();
    var kot = activeKotScreen(time);
    if (!kot && isPosTerminal()) {
      markActivity();
      return;
    }
    if (!kot && /\/zenith\/pos(?:\/|$)/i.test(location.pathname)) {
      if (warned) hideWarning();
      return;
    }
    var remaining = kot ? KOT_IDLE_MS - (time - lastKotActivity) : IDLE_MS - (time - readLast());
    if (remaining <= 0) {
      doLogout();
      return;
    }
    if (remaining <= WARN_MS) {
      showWarning();
      countdownEl.textContent = Math.ceil(remaining / 1000);
    } else if (warned) {
      hideWarning();
    }
    if (kot) {
      // Keep the shared login alive in other app tabs without resetting the cashier's deadline.
      writeLast(time);
      keepAlive();
      return Math.min(CHECK_MS, remaining);
    }
  }

  function tick() {
    clearTimeout(checkTimer);
    if (loggingOut) return;
    var delay = checkIdle();
    if (!loggingOut) checkTimer = setTimeout(tick, delay || CHECK_MS);
  }

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel', 'click']
    .forEach(function (ev) {
      window.addEventListener(ev, onActivity, { passive: ev !== 'keydown' && ev !== 'click', capture: true });
    });
  window.addEventListener('focus', tick);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });

  writeLast(now());          // seed activity on load
  tick();
})();
