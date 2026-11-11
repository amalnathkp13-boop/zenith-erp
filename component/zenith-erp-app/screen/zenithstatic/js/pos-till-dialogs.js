/* The POS and KOT tills use the same cash and close-session cards. */
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

    window.PosTillDialogs = {cashMarkup, updateCash, openClose};
})();
