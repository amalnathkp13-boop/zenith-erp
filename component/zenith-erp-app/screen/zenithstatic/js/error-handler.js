/* ZE-TAX-010 — never expose raw backend exception details to end users.
 * ZE-INV-017 — and don't ALARM users over a transient background asset load.
 *
 * Wraps Moqui's core client error handler (moqui.handleAjaxError). When a request
 * fails with a server error (HTTP status >= 500) whose response body has NO
 * structured user messages (messageInfos / errors / validationErrors), we show a
 * single generic message instead of the raw exception / stack / internal path.
 *
 * NEW (ZE-INV-017): a jQuery ajaxPrefilter stamps the request URL + method onto
 * each jqXHR (jQuery's jqXHR otherwise exposes only status/responseText — no URL).
 * We then SUPPRESS the generic "contact support" toast for a transient failure to
 * load a UI COMPONENT/asset — a GET whose URL ends in .qvue/.vue/.js (these are
 * loaded by moqui.loadComponent/httpVueLoader during app boot; a 500 there is a
 * cold-cache/concurrent-boot serving hiccup that self-heals on the next load, so
 * it must NOT tell the user to contact support). Console-warn only; the component
 * simply re-fetches (and succeeds) on the next navigation. Genuine data/action
 * failures (POST, REST data, screen transitions) still show the generic message.
 *
 * Everything else is delegated to the original handler untouched, so:
 *   - real validation & business messages (structured) still display normally,
 *   - 401 (re-login) and 0 (no connection) behaviour is preserved,
 *   - the server still logs the full technical detail.
 *
 * Loaded app-wide after WebrootVue(.qvt); works on both /apps and /qapps because
 * it wraps the shared global moqui.handleAjaxError.
 */
(function () {
    if (typeof moqui === 'undefined' || typeof moqui.handleAjaxError !== 'function') return;
    if (moqui._zenithErrorWrapped) return;
    moqui._zenithErrorWrapped = true;

    // Stamp the request URL + method onto every jqXHR so the error handler below can
    // tell a background asset load apart from a real user action. Harmless annotate-only.
    var jq = (typeof jQuery !== 'undefined') ? jQuery : (typeof $ !== 'undefined' ? $ : null);
    if (jq && typeof jq.ajaxPrefilter === 'function') {
        jq.ajaxPrefilter(function (options, originalOptions, jqXHR) {
            try { jqXHR._url = options.url; jqXHR._method = (options.type || 'GET').toUpperCase(); } catch (e) { /* ignore */ }
        });
    }

    // A GET for a Vue component / JS module (loaded during boot by moqui.loadComponent).
    // A 500 on one of these is a transient serving hiccup, not something to alarm over.
    function isTransientAssetLoad(jqXHR) {
        var url = jqXHR && jqXHR._url;
        if (!url) return false;                                   // unknown request -> treat as real (safe default)
        if ((jqXHR._method || 'GET') !== 'GET') return false;     // only idempotent GET loads
        var path = String(url).split('?')[0].split('#')[0];
        return /\.(qvue|vue|js)$/i.test(path);
    }

    var GENERIC = "Something went wrong on our end. Please try again — if the problem continues, contact support.";
    var orig = moqui.handleAjaxError;

    moqui.handleAjaxError = function (jqXHR, textStatus, errorThrown, responseText) {
        try {
            if (jqXHR && jqXHR.status === 403 && jqXHR.getResponseHeader('X-Zenith-Role-Denied') === '1') {
                location.replace('/apps/zenith/AccessDenied');
                return;
            }
            // Let the original handle blob decoding (it re-invokes this with responseText set).
            var isBlobPending = jqXHR && jqXHR.responseType === 'blob' && !responseText;
            if (jqXHR && jqXHR.status >= 500 && !isBlobPending) {
                var resp = responseText || jqXHR.responseText;
                var respObj = null;
                try { respObj = JSON.parse(resp); } catch (e) { /* body is not JSON (e.g. a raw exception dump) */ }
                var hasStructured = respObj && moqui.isPlainObject && moqui.isPlainObject(respObj) &&
                    (respObj.messageInfos || respObj.errors || respObj.validationErrors);
                if (!hasStructured) {
                    // preserve the CSRF-token refresh the qvt client performs on error responses
                    if (moqui.webrootVue && moqui.webrootVue.getCsrfToken) {
                        try { moqui.webrootVue.getCsrfToken(jqXHR); } catch (e2) { /* ignore */ }
                    }
                    // A transient UI-component/asset load failure: never tell the user to contact
                    // support — it self-heals on the next fetch. Log for diagnosis and stay silent.
                    if (isTransientAssetLoad(jqXHR)) {
                        if (typeof console !== 'undefined' && console.warn) {
                            console.warn('suppressed transient asset load error ' + jqXHR.status + ' for ' + jqXHR._url);
                        }
                        return;
                    }
                    moqui.notifyMessages(null, GENERIC);
                    if (typeof console !== 'undefined' && console.warn) {
                        console.warn('server error ' + jqXHR.status + ' (' + textStatus + '): ' + errorThrown);
                    }
                    return;
                }
            }
        } catch (e) {
            /* on any wrapper failure, fall through to the original handler */
        }
        return orig.apply(this, arguments);
    };
})();
