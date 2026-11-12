/* The POS and KOT tills use the same payment and close-session cards. */
(function () {
    'use strict';
    const CS = '₹';
    const fmt = n => Number(n).toLocaleString('en-IN', {maximumFractionDigits:2});
    const fmt2 = n => Number(n).toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2});
    const esc = value => String(value).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    function cashQuickBtns(total) {
        var seen = {}, amounts = [], steps = [1, 10, 50, 100, 500, 1000];
        amounts.push(total); seen[total] = true;
        for (var i = 0; i < steps.length; i++) {
            var r = Math.ceil(total / steps[i]) * steps[i];
            if (r > total && !seen[r]) { amounts.push(r); seen[r] = true; }
            if (amounts.length >= 5) break;
        }
        var h = '';
        for (var i = 0; i < amounts.length; i++) {
            h += '<button type="button" class="pos-cash-quick" data-amt="'+amounts[i]+'" style="padding:10px 16px;border:1px solid #4caf50;border-radius:8px;background:#fff;color:#2e7d32;font-size:15px;font-weight:700;cursor:pointer">'
                + CS + fmt(amounts[i]) + '</button>';
        }
        return h;
    }

    function cashMarkup(total, submit) {
        return '<div class="pos-cash-panel" style="border:2px solid #4caf50;border-radius:10px;padding:14px;background:#e8f5e9">'
                + '<div style="text-align:center;font-size:17px;font-weight:700;color:#2e7d32;margin-bottom:6px" id="pos-cash-title">CASH PAYMENT</div>'
                + '<div style="text-align:center;font-size:24px;font-weight:800;color:#333;margin-bottom:14px">Bill: '+CS+fmt(total)+'</div>'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
                + '<label for="pos-cash-received" style="min-width:80px;font-size:14px;font-weight:700;color:#2e7d32;text-align:right">Received</label>'
                + '<input id="pos-cash-received" name="cashAmount" type="number" class="pos-cash-input" value="" placeholder="Enter amount" step="0.01" min="0" autocomplete="off" style="flex:1;min-width:0;padding:14px 10px;border:2px solid #4caf50;border-radius:8px;font-size:22px;text-align:right;box-sizing:border-box;outline:none"/>'
                + '</div>'
                + '<div class="pos-cash-change" aria-live="polite" style="text-align:center;font-size:20px;font-weight:700;margin-bottom:12px;min-height:32px"></div>'
                + '<button type="' + (submit ? 'submit' : 'button') + '" class="pos-cash-confirm" disabled style="width:100%;padding:16px;background:#4caf50;color:#fff;border:none;border-radius:10px;font-size:17px;font-weight:700;cursor:pointer;margin-bottom:8px;opacity:0.5">&#128176; CONFIRM PAYMENT</button>'
                + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;justify-content:center">'
                + cashQuickBtns(total) + '</div>'
                + '<button type="button" class="pos-cash-cancel" style="display:block;width:100%;text-align:center;padding:12px;background:#f5f5f5;border:none;border-radius:8px;color:#666;font-size:14px;font-weight:600;cursor:pointer">&#10006; CANCEL</button>'
                + '</div>';
    }

    function updateCash(panel, total) {
        const input = panel.querySelector('.pos-cash-input');
        const change = panel.querySelector('.pos-cash-change');
        const confirm = panel.querySelector('.pos-cash-confirm');
        const diff = Math.round(Number(input.value) * 100) - Math.round(total * 100);
        const valid = input.value !== '' && input.validity.valid;
        change.textContent = !valid ? '' : diff < 0 ? '⚠ Short: '+CS+fmt(-diff/100)+' more needed'
            : diff === 0 ? '✔ Exact Amount' : 'Change: '+CS+fmt(diff/100);
        change.style.color = diff < 0 ? '#e53935' : diff === 0 ? '#2e7d32' : '#7C3AED';
        change.style.fontSize = diff < 0 ? '20px' : diff === 0 ? '22px' : '26px';
        change.style.letterSpacing = diff > 0 ? '0.5px' : '';
        confirm.disabled = !valid || diff < 0;
        confirm.style.opacity = confirm.disabled ? '0.5' : '1';
        return !confirm.disabled;
    }

    function digitalMarkup(method, due) {
        const isUpi = method === 'UPI';
        const icon = isUpi ? '&#128241;' : '&#128179;';
        const label = isUpi ? 'UPI Payment' : 'Card Payment';
        const where = isUpi ? 'UPI / QR app' : 'card machine';
        const accent = isUpi ? '#9c27b0' : '#2196f3';
        return '<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,0.4);font-family:inherit">'
            + '<div style="font-size:18px;font-weight:800;color:#222;margin-bottom:14px" id="pos-digital-title">' + icon + ' ' + label + '</div>'
            + '<div style="display:flex;justify-content:space-between;align-items:center;font-size:16px;margin-bottom:6px"><span style="color:#666">Amount</span><b style="color:#222;font-size:24px">&#8377; ' + due.toFixed(2) + '</b></div>'
            + '<div style="font-size:14px;color:#5d4037;line-height:1.6;margin:12px 0 18px;padding:11px 13px;background:#fff8e1;border:1px solid #ffe082;border-radius:9px">Take the payment on the <b>' + where + '</b> first. Press <b>Confirm</b> only after it shows <b>approved</b>. If it failed or you tapped by mistake, press <b>Cancel</b> &mdash; no bill is created.</div>'
            + '<div data-pos-tender-row style="display:flex;gap:10px"><button type="button" id="posPayConfCancel" style="flex:1;padding:14px;font-size:15px;font-weight:700;border:1px solid #bbb;background:#f5f5f5;color:#444;border-radius:10px;cursor:pointer">Cancel</button>'
            + '<button type="button" id="posPayConfOk" style="flex:2;padding:14px;font-size:16px;font-weight:800;border:none;background:' + accent + ';color:#fff;border-radius:10px;cursor:pointer">Confirm Payment Received</button></div>'
            + '</div>';
    }

    function upiReceiptMarkup(due) {
        const accent = '#9c27b0';
        return '<h2 id="pos-upi-title" style="font-size:18px;margin:0 0 12px">Save UPI bill</h2>'
                + '<p style="color:#444;margin:0 0 18px">UPI payment received: &#8377; ' + due.toFixed(2) + '.</p>'
                + '<div data-pos-tender-row style="display:flex;gap:10px">'
                + '<button type="button" id="posPaySave" style="flex:1;padding:14px;border:1px solid #bbb;background:#f5f5f5;color:#444;border-radius:10px;font-weight:700">Save</button>'
                + '<button type="button" id="posPaySavePrint" style="flex:1;padding:14px;border:0;background:' + accent + ';color:#fff;border-radius:10px;font-weight:800">Save and print</button></div>';
    }

    function splitMarkup(total, formOpen = '', formClose = '') {
        return '<div class="pos-split-panel" style="border:2px solid #7C3AED;border-radius:10px;padding:14px;background:#ECE8FB">'
            + '<div style="text-align:center;font-size:17px;font-weight:700;color:#7C3AED;margin-bottom:6px" id="pos-split-title">SPLIT PAYMENT</div>'
            + '<div style="text-align:center;font-size:24px;font-weight:800;color:#333;margin-bottom:14px">Total: '+CS+fmt(total)+'</div>'
            + formOpen
            + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
            + '<span style="min-width:55px;font-size:14px;font-weight:700;color:#2e7d32;text-align:right">&#128176; Cash</span>'
            + '<input type="number" name="cashAmount" aria-label="Cash amount" value="0" step="any" min="0" onfocus="this.select()" style="flex:1;padding:12px 10px;border:2px solid #4caf50;border-radius:8px;font-size:18px;text-align:right;box-sizing:border-box;outline:none"/>'
            + '</div>'
            + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">'
            + '<span style="min-width:55px;font-size:14px;font-weight:700;color:#7C3AED;text-align:right">&#128179; Card</span>'
            + '<input type="number" name="cardAmount" aria-label="Card amount" value="0" step="any" min="0" onfocus="this.select()" style="flex:1;padding:12px 10px;border:2px solid #2196f3;border-radius:8px;font-size:18px;text-align:right;box-sizing:border-box;outline:none"/>'
            + '</div>'
            + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-left:65px">'
            + '<input type="text" name="cardRef" aria-label="Card reference number" placeholder="Card reference #" style="flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;box-sizing:border-box;outline:none"/>'
            + '</div>'
            + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">'
            + '<span style="min-width:55px;font-size:14px;font-weight:700;color:#7b1fa2;text-align:right">&#128241; UPI</span>'
            + '<input type="number" name="upiAmount" aria-label="UPI amount" value="0" step="any" min="0" onfocus="this.select()" style="flex:1;padding:12px 10px;border:2px solid #9c27b0;border-radius:8px;font-size:18px;text-align:right;box-sizing:border-box;outline:none"/>'
            + '</div>'
            + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-left:65px">'
            + '<input type="text" name="upiRef" aria-label="UPI reference number" placeholder="UPI reference #" style="flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;box-sizing:border-box;outline:none"/>'
            + '</div>'
            + '<button type="submit" style="width:100%;padding:16px;background:#7C3AED;color:#fff;border:none;border-radius:10px;font-size:17px;font-weight:700;cursor:pointer;margin-bottom:8px">&#10003; CONFIRM SPLIT</button>'
            + formClose
            + '<button type="button" class="pos-split-cancel" style="display:block;width:100%;text-align:center;padding:12px;background:#f5f5f5;border:none;border-radius:8px;color:#666;font-size:14px;font-weight:600;cursor:pointer">&#10006; CANCEL</button>'
            + '</div>';
    }

    function creditMarkup() {
        return '<div style="background:#fff;border-radius:16px;width:420px;max-width:90vw;max-height:90vh;overflow-y:auto;box-shadow:0 12px 48px rgba(0,0,0,0.3)">'
            + '<div style="padding:18px 20px;background:#e65100;color:#fff;text-align:center;font-size:18px;font-weight:700" id="pos-credit-title">&#128196; Credit / Pay Later</div>'
            + '<div style="padding:20px 24px">'
            + '<div style="font-size:13px;color:#666;margin-bottom:14px">Choose a saved customer or add one below. Record any amount paid now; the balance remains in Credit Bills.</div>'
            + '<label for="credit-name" style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px">Customer Name *</label>'
            + '<div style="position:relative;margin-bottom:12px">'
            + '<input id="credit-name" type="text" autocomplete="off" placeholder="Type to search your saved customers&hellip;" style="width:100%;padding:11px 14px;border:2px solid #ffb74d;border-radius:8px;font-size:15px;box-sizing:border-box;outline:none"/>'
            + '<div id="credit-cust-results" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.18);max-height:160px;overflow-y:auto;margin-top:4px"></div>'
            + '</div>'
            + '<label for="credit-phone" style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px">Customer Phone *</label>'
            + '<input id="credit-phone" type="tel" inputmode="tel" autocomplete="off" placeholder="10 to 15 digits" style="width:100%;padding:11px 14px;border:2px solid #ffb74d;border-radius:8px;font-size:15px;box-sizing:border-box;outline:none"/>'
            + '<button id="credit-add-customer" type="button" style="margin-top:7px;padding:0;border:0;background:none;color:#7C3AED;font-weight:700;cursor:pointer">+ Add customer with this name and phone</button>'
            + '<div data-pos-tender-row style="display:flex;gap:10px;margin-top:15px"><label style="flex:1;font-size:13px;font-weight:600;color:#555">Paid now (₹)<input id="credit-upfront" type="number" min="0" step="0.01" inputmode="decimal" value="0" style="display:block;width:100%;margin-top:4px;padding:11px 14px;border:2px solid #ffb74d;border-radius:8px;font-size:15px;box-sizing:border-box"/></label>'
            + '<label style="flex:1;font-size:13px;font-weight:600;color:#555">Method<select id="credit-upfront-method" style="display:block;width:100%;margin-top:4px;padding:11px 14px;border:2px solid #ffb74d;border-radius:8px;font-size:15px;box-sizing:border-box"><option value="Cash">Cash</option><option value="Card">Card</option><option value="UPI">UPI</option></select></label></div>'
            + '<label style="display:block;margin-top:12px">Credit days for this bill<input id="credit-days" type="number" min="0" max="3650" step="1" placeholder="Customer term, e.g. 2 or 30" style="display:block;width:100%;padding:10px;border:1px solid #ddd6fe;border-radius:8px;box-sizing:border-box"></label>'
            + '<p id="credit-date-preview" style="font-size:12px;color:#6b7280" aria-live="polite"></p>'
            + '<label style="display:block">Reason if overriding customer terms (manager)<input id="credit-terms-reason" maxlength="255" style="display:block;width:100%;padding:10px;border:1px solid #ddd6fe;border-radius:8px;box-sizing:border-box"></label>'
            + '<div id="credit-due-preview" aria-live="polite" style="margin-top:9px;font-size:13px;font-weight:700;color:#c62828"></div>'
            + '<div data-pos-tender-row style="display:flex;gap:12px;margin-top:20px">'
            + '<button type="button" id="credit-cancel" style="flex:1;padding:14px;border:2px solid #ccc;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:#fff;color:#555">Cancel</button>'
            + '<button type="button" id="credit-confirm" style="flex:1;padding:14px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:#e65100;color:#fff">Complete Credit Sale</button>'
            + '</div></div></div>';
    }

    function openClose({sessionId, summary:d, close, onClosed, warning}) {
        if (document.getElementById('posCloseSessionOverlay')) return;
        const dialog = document.createElement('dialog');
        dialog.className = 'pos-close-overlay';
        dialog.id = 'posCloseSessionOverlay';
        dialog.setAttribute('aria-labelledby','pos-close-title');
        var row = function(label, val, color) {
            return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee">'
                + '<span style="color:#555;font-size:15px">'+label+'</span>'
                + '<span style="font-weight:700;font-size:15px;color:'+(color||'#333')+'">'+CS+fmt2(val)+'</span></div>';
        };
        var html = '<div style="background:#fff;border-radius:16px;padding:28px 32px;width:484px;max-width:100%;max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);overflow-y:auto;overscroll-behavior:contain;box-sizing:border-box;box-shadow:0 12px 40px rgba(0,0,0,0.3)">'
            + '<div style="text-align:center;font-size:22px;font-weight:800;color:#463D7A;margin-bottom:4px" id="pos-close-title">Close Session</div>'
            + '<div style="text-align:center;font-size:13px;color:#888;margin-bottom:18px">Session #'+esc(sessionId)+'</div>'
            + '<div style="background:#f5f5f5;border-radius:10px;padding:14px 16px;margin-bottom:16px">'
            + '<div style="font-size:13px;font-weight:700;color:#777;text-transform:uppercase;margin-bottom:8px">Session Summary</div>'
            + '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee">'
            + '<span style="color:#555;font-size:15px">Bills Completed</span>'
            + '<span style="font-weight:700;font-size:15px;color:#7C3AED">'+Number(d.billCount)+'</span></div>'
            + row('Total Sales', d.totalSales, '#2e7d32')
            + '</div>'
            + '<div style="background:#f5f5f5;border-radius:10px;padding:14px 16px;margin-bottom:16px">'
            + '<div style="font-size:13px;font-weight:700;color:#777;text-transform:uppercase;margin-bottom:8px">Cash Breakdown</div>'
            + row('Opening Cash', d.openingCash)
            + row('Cash Received', d.cashReceived, '#2e7d32')
            + row('Change Given', d.changeGiven, '#e65100')
            + (Number(d.movementNet) ? row('Cash Movements (Net)', d.movementNet) : '')
            + '<div style="display:flex;justify-content:space-between;padding:10px 0 4px;border-top:2px solid #463D7A;margin-top:6px">'
            + '<span style="font-weight:800;font-size:17px;color:#463D7A">Expected Cash</span>'
            + '<span style="font-weight:800;font-size:17px;color:#463D7A">'+CS+fmt2(d.expectedCash)+'</span></div>'
            + '</div>'
            + (d.cardReceived > 0 || d.upiReceived > 0 ? '<div style="background:#f5f5f5;border-radius:10px;padding:14px 16px;margin-bottom:16px">'
                + '<div style="font-size:13px;font-weight:700;color:#777;text-transform:uppercase;margin-bottom:8px">Other Payments</div>'
                + (d.cardReceived > 0 ? row('Card', d.cardReceived, '#7C3AED') : '')
                + (d.upiReceived > 0 ? row('UPI', d.upiReceived, '#7b1fa2') : '')
                + '</div>' : '')
            + '<div style="margin-bottom:16px">'
            + '<label for="pos-closing-cash" style="font-size:14px;font-weight:700;color:#333;display:block;margin-bottom:6px">Enter Closing Cash Amount</label>'
            + '<input id="pos-closing-cash" type="number" class="pos-close-cash" step="0.01" min="0" value="'+Math.max(0, Number(d.expectedCash)).toFixed(2)+'" style="width:100%;padding:14px 16px;border:2px solid #463D7A;border-radius:10px;font-size:22px;font-weight:700;text-align:right;box-sizing:border-box;outline:none;color:#463D7A"/>'
            + '<div class="pos-close-diff" aria-live="polite" style="text-align:right;margin-top:6px;font-size:14px;font-weight:600"></div>'
            + '</div>'
            + (warning ? '<p style="color:#8a4c10">'+esc(warning)+'</p>' : '')
            + '<p class="pos-close-error" role="alert" hidden style="color:#c62828"></p>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
            + '<button type="button" class="pos-close-cancel" style="padding:14px;border:2px solid #999;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;background:#fff;color:#666">Cancel</button>'
            + '<button type="button" class="pos-close-confirm" style="padding:14px;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;background:#c62828;color:#fff">&#9724; CLOSE SESSION</button>'
            + '</div></div>';
        dialog.innerHTML = html;
        const input = dialog.querySelector('.pos-close-cash');
        const difference = dialog.querySelector('.pos-close-diff');
        const cancel = dialog.querySelector('.pos-close-cancel');
        const confirm = dialog.querySelector('.pos-close-confirm');
        const error = dialog.querySelector('.pos-close-error');
        let closing = false;
        function update() {
            const valid = input.value !== '' && input.validity.valid;
            const diff = Math.round(Number(input.value)*100) - Math.round(Number(d.expectedCash)*100);
            difference.textContent = !valid ? '' : diff === 0 ? '✓ Exact match' : diff > 0 ? 'Excess: +'+CS+fmt2(diff/100) : 'Short: '+CS+fmt2(-diff/100);
            difference.style.color = diff === 0 ? '#2e7d32' : diff > 0 ? '#e65100' : '#c62828';
            confirm.disabled = !valid || closing;
        }
        input.addEventListener('input', update);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); confirm.click(); } });
        dialog.addEventListener('click', e => { if (e.target === dialog && !closing) dialog.close(); });
        dialog.addEventListener('cancel', e => { if (closing) e.preventDefault(); });
        dialog.addEventListener('close', () => dialog.remove());
        cancel.addEventListener('click', () => dialog.close());
        confirm.addEventListener('click', async () => {
            if (confirm.disabled) return;
            closing = true; update(); cancel.disabled = true; input.disabled = true;
            const label = confirm.textContent;
            confirm.textContent = 'Closing…'; error.hidden = true;
            let result;
            try { result = await close(input.value); }
            catch (failure) {
                error.textContent = failure.message; error.hidden = false;
                closing = false; cancel.disabled = false; input.disabled = false; confirm.textContent = label; update(); return;
            }
            dialog.close(); onClosed(result);
        });
        (document.fullscreenElement || document.body).append(dialog);
        dialog.showModal(); update(); input.focus(); input.select();
    }

    window.PosTillDialogs = {cashMarkup, updateCash, digitalMarkup, upiReceiptMarkup, splitMarkup, creditMarkup, openClose};
})();
