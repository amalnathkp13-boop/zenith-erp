/* ============================================================================
 * ZetaERP POS till idle-lock  (ZE-INV-014 f/u / IV-118)
 * ----------------------------------------------------------------------------
 * Locks the BILLING TERMINAL after N idle minutes and re-arms with the cashier's
 * 4-digit PIN (or their login password until a PIN is set) WITHOUT a full logout
 * — the session and the open cart are preserved, so a quiet-hour walk-away is
 * secured with a quick PIN instead of a disruptive re-login.
 *
 * Self-contained: loaded app-wide via footer_scripts, but only ACTIVATES on the
 * POS terminal (/pos/Terminal). It builds its own overlay + keypad in JS, and
 * talks to the PosLock screen's config/verify endpoints — Terminal.xml is never
 * touched. Endpoints: <pos>/PosLock/config (read-only) and .../verify (POST).
 *
 * FAIL-SAFE by design (this runs on MARUTHI's live till):
 *  - config fetch fails or timeout=0  -> no lock at all, till works normally.
 *  - the overlay ALWAYS offers "Sign out" so a cashier can never be trapped.
 *  - while locked it pings config to keep the session alive, so a PIN always
 *    unlocks (no surprise "session expired"); a truly expired session -> Sign in.
 *  - while locked it swallows the terminal's F-key shortcuts so a locked till
 *    can't be operated.
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__zPosLock) return;
  window.__zPosLock = 1;

  var path = location.pathname || '';
  if (!/\/pos\/Terminal(\/|$)/i.test(path)) return;   // ONLY the billing terminal
  var base = path.replace(/\/Terminal(\/.*)?$/i, '/PosLock');

  function tok() {
    try { if (window.moqui && window.moqui.webrootVue && window.moqui.webrootVue.moquiSessionToken) return window.moqui.webrootVue.moquiSessionToken; } catch (e) {}
    var el = document.querySelector('input[name="moquiSessionToken"]');
    return el ? el.value : '';
  }
  function post(url, params) {
    var p = new URLSearchParams();
    for (var k in params) p.append(k, params[k] == null ? '' : params[k]);
    p.append('moquiSessionToken', tok());
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p, credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); });
  }

  fetch(base + '/config?_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      var mins = cfg && cfg.idleMin ? parseInt(cfg.idleMin, 10) : 0;
      if (!mins || mins <= 0) return;              // disabled for this shop -> do nothing
      arm(mins * 60 * 1000, cfg || {});
    })
    .catch(function () { /* fail-safe: no config -> no lock */ });

  function arm(idleMs, cfg) {
    var lastActivity = Date.now();
    var locked = false, overlay = null, pinBuf = '', mode = 'pin', busy = false;
    var hasPin = !!cfg.hasPin;
    var name = cfg.name || '';
    if (!hasPin) mode = 'password';

    var ACT = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel', 'click'];
    var throttled = false;
    function onActivity() {
      if (locked || throttled) return;
      throttled = true; setTimeout(function () { throttled = false; }, 800);
      lastActivity = Date.now();
    }
    ACT.forEach(function (ev) { window.addEventListener(ev, onActivity, { passive: true, capture: true }); });

    // while LOCKED, swallow the terminal's keyboard shortcuts and route digits to the keypad
    function keyGuard(e) {
      if (!locked) return;
      // Stop before the event reaches the terminal's keyboard handlers.
      e.stopImmediatePropagation();
      var k = e.key;
      if (mode === 'pin') {
        if (/^[0-9]$/.test(k)) addDigit(k);
        if (k === 'Backspace') { pinBuf = pinBuf.slice(0, -1); renderPin(); }
      } else {
        if (k === 'Enter' && !e.isComposing) { e.preventDefault(); submitPassword(); return; }
        // Let the lock's own password field handle native typing and editing.
        if (e.target.id === '__zpw' && overlay.contains(e.target) && !/^F\d+$/.test(k)) return;
      }
      if (k !== 'Tab') e.preventDefault();
    }
    window.addEventListener('keydown', keyGuard, true);

    setInterval(function () {
      if (!locked && Date.now() - lastActivity >= idleMs) lock();
      if (locked) keepAlive();
    }, 5000);

    var lastKa = 0;
    function keepAlive() {
      var t = Date.now();
      if (t - lastKa < 4 * 60 * 1000) return;   // at most every 4 min
      lastKa = t;
      fetch(base + '/config?ka=' + t, { credentials: 'same-origin', cache: 'no-store' }).catch(function () {});
    }

    function el(tag, css, txt) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; }

    function lock() {
      if (locked) return;
      locked = true; pinBuf = ''; busy = false;
      buildOverlay();
    }
    function unlock() {
      locked = false; lastActivity = Date.now();
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
    }

    function buildOverlay() {
      overlay = el('div', 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,18,30,0.86);' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)');
      var card = el('div', 'width:340px;max-width:92vw;background:#fff;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:26px 24px;text-align:center;box-sizing:border-box');
      card.appendChild(el('div', 'font-size:34px;line-height:1', '🔒'));
      card.appendChild(el('div', 'font-weight:800;font-size:19px;color:#1e293b;margin-top:8px', 'Till locked'));
      card.appendChild(el('div', 'font-size:13px;color:#64748b;margin-top:2px', (name ? (name + ' — ') : '') + 'enter your unlock ' + (mode === 'pin' ? 'PIN' : 'password') + ' to continue'));

      var body = el('div', 'margin-top:18px');
      card.appendChild(body);

      var err = el('div', 'min-height:18px;font-size:13px;color:#c62828;margin-top:12px;font-weight:600', '');

      function renderPinUI() {
        body.innerHTML = '';
        var dots = el('div', 'display:flex;gap:14px;justify-content:center;margin-bottom:18px');
        for (var i = 0; i < 4; i++) dots.appendChild(el('div', 'width:16px;height:16px;border-radius:50%;border:2px solid #94a3b8;background:' + (i < pinBuf.length ? '#7C3AED' : 'transparent') + ';border-color:' + (i < pinBuf.length ? '#7C3AED' : '#94a3b8')));
        body.appendChild(dots);
        var pad = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px');
        var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];
        keys.forEach(function (kk) {
          if (kk === 'back') { var bk = el('button', padBtnCss('#f1f5f9', '#334155'), '⌫'); bk.type = 'button'; bk.onclick = function () { pinBuf = pinBuf.slice(0, -1); renderPin(); }; pad.appendChild(bk); return; }
          if (kk === 'ok') { var okb = el('button', padBtnCss('#f1f5f9', '#334155'), '↵'); okb.type = 'button'; okb.onclick = function () { if (pinBuf.length >= 4) submitPin(); }; pad.appendChild(okb); return; }
          var b = el('button', padBtnCss('#fff', '#1e293b'), kk); b.type = 'button'; b.onclick = function () { addDigit(kk); }; pad.appendChild(b);
        });
        body.appendChild(pad);
      }
      function renderPwUI() {
        body.innerHTML = '';
        var inp = el('input', 'width:100%;box-sizing:border-box;padding:12px 14px;font-size:16px;border:1px solid #cbd5e1;border-radius:10px;text-align:center');
        inp.type = 'password'; inp.autocomplete = 'off'; inp.placeholder = 'Your login password'; inp.id = '__zpw';
        body.appendChild(inp);
        var go = el('button', 'width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;background:#7C3AED;color:#fff;font-weight:700;font-size:15px;cursor:pointer', 'Unlock');
        go.type = 'button'; go.onclick = submitPassword; body.appendChild(go);
        setTimeout(function () { try { inp.focus(); } catch (e) {} }, 30);
      }
      function padBtnCss(bg, fg) { return 'padding:16px 0;font-size:20px;font-weight:700;border:1px solid #e2e8f0;border-radius:12px;background:' + bg + ';color:' + fg + ';cursor:pointer;-webkit-tap-highlight-color:rgba(0,0,0,.1)'; }

      renderPin = function () { if (mode === 'pin') renderPinUI(); };
      addDigit = function (d) { if (mode !== 'pin' || pinBuf.length >= 4) return; pinBuf += d; renderPinUI(); if (pinBuf.length === 4) setTimeout(submitPin, 80); };
      submitPin = function () { doVerify('pin', pinBuf); };
      submitPassword = function () { var i = document.getElementById('__zpw'); doVerify('password', i ? i.value : ''); };

      function doVerify(m, cred) {
        if (busy || !cred) return;
        busy = true; err.textContent = '';
        post(base + '/verify', { credential: cred, mode: m }).then(function (r) {
          busy = false;
          if (r && r.ok) { unlock(); return; }
          if (r && r.expired) { err.textContent = 'Session ended. Signing in again…'; setTimeout(signOut, 900); return; }
          if (r && r.locked) { err.textContent = 'Too many attempts. Signing out…'; setTimeout(signOut, 1100); return; }
          pinBuf = '';
          var left = (r && typeof r.attemptsLeft === 'number') ? r.attemptsLeft : null;
          err.textContent = (m === 'pin' ? 'Wrong PIN.' : 'Wrong password.') + (left != null ? (' ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.') : '');
          if (mode === 'pin') renderPinUI();
        }).catch(function () { busy = false; err.textContent = 'Could not verify — check the connection and try again.'; });
      }

      if (mode === 'pin') renderPinUI(); else renderPwUI();
      card.appendChild(err);

      // toggle between PIN and password (password is always available as a fallback)
      var toggle = el('button', 'margin-top:16px;background:none;border:0;color:#7C3AED;font-size:13px;font-weight:600;cursor:pointer;text-decoration:underline', hasPin ? 'Use password instead' : '');
      toggle.type = 'button';
      toggle.onclick = function () { mode = (mode === 'pin') ? 'password' : 'pin'; pinBuf = ''; err.textContent = ''; toggle.textContent = (mode === 'pin') ? 'Use password instead' : 'Use PIN instead'; if (mode === 'pin') renderPinUI(); else renderPwUI(); };
      if (hasPin) card.appendChild(toggle);

      var out = el('button', 'margin-top:10px;display:block;width:100%;background:none;border:0;color:#94a3b8;font-size:12px;cursor:pointer', 'Sign out instead');
      out.type = 'button'; out.onclick = signOut;
      card.appendChild(out);

      overlay.appendChild(card);
      (document.body || document.documentElement).appendChild(overlay);
    }

    var renderPin = function () {}, addDigit = function () {}, submitPin = function () {}, submitPassword = function () {};
    function signOut() { location.href = '/Login/logout'; }
  }
})();
