(function () {
    'use strict';
    if (window.ZPosCreditHistory) return;
    var esc = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
    var money = function (value) { return Number(value || 0).toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2}); };
    function request(action, params) {
        var token = document.querySelector('[name=moquiSessionToken]');
        var data = new URLSearchParams(Object.assign({moquiSessionToken:token ? token.value : ''}, params));
        var root = document.getElementById('credit-bills-root');
        var module = root && root.dataset.creditModule === 'kot' ? 'kot' : 'pos';
        return fetch('/apps/zenith/' + module + '/CreditBills/' + action, {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:data})
            .then(function (response) { if (!response.ok) throw new Error('Request denied. Refresh and check your permission.'); return response.json(); })
            .then(function (result) { if (!result.success) throw new Error(result.error || 'Could not save.'); return result; });
    }
    function open(transactionId) {
        var old = document.getElementById('pos-credit-history'); if (old) old.remove();
        var overlay = document.createElement('div'); overlay.id = 'pos-credit-history'; overlay.className = 'pch-overlay';
        overlay.innerHTML = '<section role="dialog" aria-modal="true" aria-label="Credit repayment history" class="pch-dialog"><header><h2>Credit repayment history</h2><button type="button" data-close aria-label="Close history">×</button></header><div class="pch-content">Loading…</div></section>';
        document.body.appendChild(overlay);
        var previousFocus = document.activeElement;
        function close() { overlay.remove(); document.removeEventListener('keydown',keys); if (previousFocus && previousFocus.isConnected) previousFocus.focus(); }
        function keys(event) { if (event.key === 'Escape') close(); if(event.key==='Tab'){var fields=Array.from(overlay.querySelectorAll('button,input,select')).filter(function(el){return !el.disabled&&el.getClientRects().length;});var first=fields[0],last=fields[fields.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}} }
        document.addEventListener('keydown',keys); overlay.addEventListener('click',function (event) { if(event.target===overlay||event.target.closest('[data-close]'))close(); });
        overlay.querySelector('[data-close]').focus();
        function render() {
            return request('history',{transactionId:transactionId}).then(function (result) {
                if (!overlay.isConnected) return;
                var h = result.history, host = overlay.querySelector('.pch-content');
                host.innerHTML = '<h3>'+esc(h.billNo)+' · '+esc(h.customer)+'</h3>'
                    +'<div class="pch-summary"><div>Total<strong>₹'+money(h.total)+'</strong></div><div>Paid<strong>₹'+money(h.paid)+'</strong></div><div>Balance<strong>₹'+money(h.outstanding)+'</strong></div><div>'+esc(h.status)+'<strong>'+esc(h.dueDate||'Due date not set')+'</strong></div></div>'
                    +'<p>Due through the end of '+esc(h.dueDate||'the assigned date')+' ('+esc(h.dueTimeZone)+'). '+(h.status==='Settled'?'Fully settled':h.status==='Cancelled'?'Bill cancelled':h.daysRemaining==null?'':h.daysRemaining<0?Math.abs(h.daysRemaining)+' days overdue':h.daysRemaining+' days remaining')+'</p>'
                    +'<p>Last payment: '+esc(h.lastPayment||'No payments recorded')+'<br>Settled on: '+esc(h.settledOn||'—')+'</p>'
                    +'<div class="pch-table"><table><thead><tr><th>Payment date</th><th>Amount</th><th>Method / reference</th><th>Recorded by</th><th>Balance after payment</th></tr></thead><tbody>'
                    +h.payments.map(function(p){return '<tr><td>'+esc(p.date||'Not recorded (legacy)')+'</td><td>₹'+money(p.amount)+'</td><td>'+esc(p.method)+'<br>'+esc(p.reference)+'</td><td>'+esc(p.recordedBy)+'</td><td>₹'+money(p.balance)+'</td></tr>';}).join('')
                    +(h.payments.length?'':'<tr><td colspan="5">No successful repayments yet.</td></tr>')+'</tbody></table></div>'
                    +(h.canManageTerms?'<details class="pch-settings"><summary>Customer credit terms and bill due date</summary><p>Customer terms apply to future bills. An existing bill changes only through its separate due-date action.</p><label>Customer credit days<input id="pch-days" type="number" min="0" max="3650" step="1" value="'+esc(h.customerCreditDays==null?'':h.customerCreditDays)+'" placeholder="e.g. 2 or 30"></label><label>Reason<input id="pch-terms-reason" maxlength="255"></label><button type="button" id="pch-save-terms">Save customer terms</button><label>This bill’s due date<input id="pch-due" type="date" value="'+esc(h.dueDate||'')+'"></label><label>Reason for changing this bill<input id="pch-due-reason" maxlength="255"></label><button type="button" id="pch-save-due">Change bill due date</button></details>':'')
                    +'<details class="pch-settings"><summary>Credit terms change history</summary><ul>'+h.termChanges.map(function(change){return '<li>'+esc(change.date)+' · '+esc(change.scope)+': '+esc(change.before==null?'Not set':change.before)+' &rarr; '+esc(change.after)+'<br>'+esc(change.reason)+'</li>';}).join('')+'</ul></details>'
                    +'<details class="pch-settings"><summary>Reminder settings and attempts</summary><p class="pch-notice">Automatic delivery is disabled until a supported messaging provider is configured. No customer message is sent by these settings.</p>'
                    +(h.canManageTerms?'<label><input id="pch-consent" type="checkbox" '+(h.reminderPolicy.consent==='Y'?'checked':'')+'> Customer consent verified</label><label>Channel<select id="pch-channel"><option>SMS</option><option>WhatsApp</option><option>Email</option></select></label><label>Days between reminders<input id="pch-interval" type="number" min="1" max="365" value="'+h.reminderPolicy.intervalDays+'"></label><label>Maximum attempts<input id="pch-max" type="number" min="1" max="12" value="'+h.reminderPolicy.maxAttempts+'"></label><button type="button" id="pch-save-reminders">Save reminder policy</button>':'')
                    +'<ul>'+h.reminders.map(function(r){return '<li>'+esc(r.date)+' · '+esc(r.channel)+' · '+esc(r.status)+' · ₹'+money(r.amount)+'<br>'+esc(r.error)+'</li>';}).join('')+'</ul></details><p id="pch-message" role="status" aria-live="polite"></p>';
                if(h.canManageTerms){
                    host.querySelector('#pch-channel').value=h.reminderPolicy.channel;
                    function bind(id,action,values){host.querySelector(id).addEventListener('click',function(){var button=this;button.disabled=true;request(action,values()).then(render).catch(function(error){host.querySelector('#pch-message').textContent=error.message;button.disabled=false;});});}
                    bind('#pch-save-terms','saveCustomerTerms',function(){return {customerPartyId:h.customerPartyId,creditDays:host.querySelector('#pch-days').value,reason:host.querySelector('#pch-terms-reason').value};});
                    bind('#pch-save-due','changeDueDate',function(){return {transactionId:transactionId,dueDate:host.querySelector('#pch-due').value,reason:host.querySelector('#pch-due-reason').value};});
                    bind('#pch-save-reminders','saveReminderPolicy',function(){return {customerPartyId:h.customerPartyId,consent:host.querySelector('#pch-consent').checked?'Y':'N',channel:host.querySelector('#pch-channel').value,intervalDays:host.querySelector('#pch-interval').value,maxAttempts:host.querySelector('#pch-max').value};});
                }
            }).catch(function(error){if(overlay.isConnected)overlay.querySelector('.pch-content').textContent=error.message;});
        }
        render();
    }
    window.ZPosCreditHistory = {open:open};
})();
