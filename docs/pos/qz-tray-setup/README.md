# QZ Tray silent printing — POS machine setup kit

This folder is the setup kit for enabling **silent thermal receipt printing** on a new
ZetaERP POS machine using [QZ Tray](https://qz.io). Keep these files together (e.g. on the
setup USB).

## Files

| File | Purpose |
|------|---------|
| **`qz-tray-setup-sop.pdf`** | The step-by-step setup guide. Print it or keep it on the setup USB. Written for non-technical staff: installing QZ Tray, trusting the ZetaERP certificate, auto-starting QZ Tray on boot, testing, and troubleshooting. |
| **`setup-qz-trust.ps1`** | Run on each POS machine in an **admin** PowerShell. Installs the certificate as QZ Tray's trusted `authcert.override` and restarts QZ Tray so printing is silent. Idempotent. |
| **`digital-certificate.txt`** | The **public** signing certificate (`CN=ZetaERP POS`). Safe to distribute. The matching private key stays on the server (`/opt/moqui/WEB-INF/classes/qz-private-key.pem`) and is never committed. |
| **`build-sop.py`** | Regenerates `qz-tray-setup-sop.pdf` from the two files above. `pip install reportlab`, then `python build-sop.py`. |

## How silent printing works

The ZetaERP app (`zenith-erp-app/.../js/pos-terminal.js`) signs each QZ print request
(**SHA1withRSA** via the `/apps/qzSign` endpoint) and presents this certificate. QZ Tray 2.1+
prints silently **only when it trusts the certificate** — otherwise it prompts on every receipt
or the browser's print dialog appears. Installing `digital-certificate.txt` as QZ Tray's
`authcert.override` (what `setup-qz-trust.ps1` does) is what makes printing silent, per machine.

Receipts are sent to QZ as inline HTML with `flavor:'plain'` — without it, QZ 2.3 treats the
HTML as a URL and prints a Jetty "400 Ambiguous URI" page instead of the receipt.

## New machine — short version

1. Install QZ Tray (https://qz.io/download/) and start it.
2. Copy `digital-certificate.txt` + `setup-qz-trust.ps1` to the machine and run the script as admin.
3. Enable QZ Tray **Automatically start** (so it runs on every boot).
4. Reload the POS terminal and ring a test sale — the receipt prints silently.

See **`qz-tray-setup-sop.pdf`** for the full, illustrated steps and troubleshooting.
