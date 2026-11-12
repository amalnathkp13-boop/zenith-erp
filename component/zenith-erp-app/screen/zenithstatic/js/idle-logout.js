/* KOT Billing signs out after one hour without cashier input.
 * Loaded from the shared footer so /qapps can activate it on in-place navigation.
 */
(function () {
  'use strict';
  if (window.__zIdleLogout) return;            // guard against double-load
  window.__zIdleLogout = 1;

  if (!/\/(apps|qapps)\/zenith(\/|$)/.test(location.pathname)) return;

  var KOT_IDLE_MS = 60 * 60 * 1000;
  var WARN_MS   = 60 * 1000;       // show the "you're about to be signed out" warning this long before
  var CHECK_MS  = 5 * 1000;        // how often we re-evaluate idleness
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

  function onActivity(event) {
    // Programmatic scrolls can produce trusted events. Count the gesture instead.
    if (loggingOut || !event.isTrusted || event.type === 'scroll') return;
    var time = now();
    if (!activeKotScreen(time)) return;
    if (time - lastKotActivity >= KOT_IDLE_MS) {
      if (event.type === 'keydown' || event.type === 'click') event.preventDefault();
      event.stopImmediatePropagation();
      doLogout();
      return;
    }
    lastKotActivity = time;
    if (warned) hideWarning();
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
    // End the active session and leave any opted-in remembered login available for a later visit.
    location.href = '/Login/idleLogout';
  }

  function checkIdle() {
    var time = now();
    if (!activeKotScreen(time)) {
      if (warned) hideWarning();
      return;
    }
    var remaining = KOT_IDLE_MS - (time - lastKotActivity);
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
    return Math.min(CHECK_MS, remaining);
  }

  function tick() {
    clearTimeout(checkTimer);
    if (loggingOut) return;
    var delay = checkIdle();
    if (!loggingOut) checkTimer = setTimeout(tick, delay || CHECK_MS);
  }

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'click']
    .forEach(function (ev) {
      window.addEventListener(ev, onActivity, { passive: ev !== 'keydown' && ev !== 'click', capture: true });
    });
  window.addEventListener('focus', tick);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });

  tick();
})();
