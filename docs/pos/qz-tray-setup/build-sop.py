#!/usr/bin/env python3
# Build the ZetaERP POS - QZ Tray setup SOP as a polished, beginner-friendly PDF.
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                PageBreak, KeepTogether, HRFlowable)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "qz-tray-setup-sop.pdf")
CERT = open(os.path.join(HERE, "digital-certificate.txt"), encoding="ascii").read().strip()
SCRIPT = open(os.path.join(HERE, "setup-qz-trust.ps1"), encoding="utf-8").read()

# ---- palette (ZetaERP brand) ----
VIOLET   = colors.HexColor("#7C3AED")
VIOLET_D = colors.HexColor("#5B21B6")
GREEN    = colors.HexColor("#059669"); GREEN_BG = colors.HexColor("#ECFDF5")
AMBER    = colors.HexColor("#B45309"); AMBER_BG = colors.HexColor("#FFFBEB")
RED      = colors.HexColor("#B91C1C"); RED_BG   = colors.HexColor("#FEF2F2")
BLUE     = colors.HexColor("#1D4ED8"); BLUE_BG  = colors.HexColor("#EFF6FF")
CODE_BG  = colors.HexColor("#F3F4F6")
INK      = colors.HexColor("#1F2937")
MUTE     = colors.HexColor("#6B7280")
RULE     = colors.HexColor("#E5E7EB")
ROWALT   = colors.HexColor("#F9FAFB")

def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def ascii_code(t):
    # keep code blocks to safe glyphs
    return (t.replace("\u2014", "-").replace("\u2013", "-")
             .replace("\u2018", "'").replace("\u2019", "'")
             .replace("\u201c", '"').replace("\u201d", '"'))

styles = getSampleStyleSheet()
BODY = ParagraphStyle("Body", parent=styles["Normal"], fontName="Helvetica", fontSize=10.5,
                      leading=15, textColor=INK, spaceAfter=5)
TITLE = ParagraphStyle("TitleBig", fontName="Helvetica-Bold", fontSize=23, leading=27,
                       textColor=VIOLET_D, spaceAfter=2)
SUB = ParagraphStyle("Sub", fontName="Helvetica", fontSize=12, leading=16, textColor=MUTE, spaceAfter=4)
H1 = ParagraphStyle("H1", fontName="Helvetica-Bold", fontSize=14.5, leading=18, textColor=VIOLET_D,
                    spaceBefore=14, spaceAfter=6)
H2 = ParagraphStyle("H2", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=INK,
                    spaceBefore=8, spaceAfter=3)
STEP = ParagraphStyle("Step", parent=BODY, leftIndent=18, firstLineIndent=-18, spaceAfter=5)
NOTE = ParagraphStyle("Note", parent=BODY, fontSize=10, leading=14, spaceAfter=0)
CODE = ParagraphStyle("Code", fontName="Courier", fontSize=8.8, leading=12, textColor=colors.HexColor("#111827"))
CODE_SM = ParagraphStyle("CodeSm", fontName="Courier", fontSize=7.6, leading=10.4, textColor=colors.HexColor("#111827"))
CELL = ParagraphStyle("Cell", parent=BODY, fontSize=9.3, leading=12.5, spaceAfter=0)
CELLH = ParagraphStyle("CellH", parent=CELL, fontName="Helvetica-Bold", textColor=colors.white)

story = []

def step(n, text):
    story.append(Paragraph('<font color="#7C3AED"><b>%d.</b></font>&nbsp;&nbsp;%s' % (n, text), STEP))

def code(text, small=False):
    src = ascii_code(text)
    def line(l):
        s = l.lstrip(" ")
        return "&nbsp;" * (len(l) - len(s)) + esc(s)
    body = "<br/>".join(line(l) for l in src.split("\n"))
    st = ParagraphStyle("codebox",
                        fontName="Courier", fontSize=(7.6 if small else 8.8),
                        leading=(10.6 if small else 12.2), textColor=colors.HexColor("#111827"),
                        backColor=CODE_BG, borderColor=RULE, borderWidth=0.5,
                        borderPadding=(6, 8, 6, 8), spaceBefore=3, spaceAfter=6)
    story.append(Paragraph(body, st))

def callout(label, text, accent, bg):
    inner = Paragraph('<b><font color="%s">%s</font></b>&nbsp;&nbsp;%s' % (_hex(accent), label, text), NOTE)
    t = Table([[inner]], colWidths=[165*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1),bg),
        ("LINEBEFORE",(0,0),(0,-1),3,accent),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7),
    ]))
    story.append(Spacer(1,3)); story.append(t); story.append(Spacer(1,7))

def _hex(c):
    return "#%02X%02X%02X" % (int(c.red*255), int(c.green*255), int(c.blue*255))

# ============ TITLE ============
story.append(Paragraph("QZ Tray Setup for ZetaERP POS", TITLE))
story.append(Paragraph("How to set up silent receipt printing on a new POS machine", SUB))
story.append(HRFlowable(width="100%", thickness=2, color=VIOLET, spaceBefore=4, spaceAfter=10))

callout("WHAT THIS IS.",
        "A step-by-step guide to make a new billing computer print receipts straight to the thermal "
        "printer - with no pop-ups, every time. It is written for anyone: no technical experience needed. "
        "Just follow the parts in order. It takes about 15 minutes.", BLUE, BLUE_BG)

story.append(Paragraph("Before you start - what you need", H1))
for t in [
    "The new POS computer (Windows 10 or 11), switched on and connected to the internet.",
    "The thermal receipt printer plugged into it, with its printer driver already installed.",
    "Permission to install software on the computer (the ability to click <b>Yes</b> on Windows permission pop-ups).",
    "Two small setup files from your POS setup kit (USB or shared folder): "
    "<font name=\"Courier\" size=\"9\">digital-certificate.txt</font> and "
    "<font name=\"Courier\" size=\"9\">setup-qz-trust.ps1</font>. "
    "If you do not have them, you can recreate them from <b>Appendix A</b> and <b>Appendix B</b> at the end.",
]:
    story.append(Paragraph("&bull;&nbsp;&nbsp;" + t, ParagraphStyle("b", parent=BODY, leftIndent=12, firstLineIndent=-12)))

callout("GOOD TO KNOW.",
        "You do NOT need to change anything on the ZetaERP website - the printing is already set up there. "
        "This guide only sets up the POS computer itself.", GREEN, GREEN_BG)

# ============ PART 1 ============
story.append(Paragraph("Part 1 &nbsp;&middot;&nbsp; Install QZ Tray", H1))
story.append(Paragraph("QZ Tray is a small free helper program that lets the website print directly to your thermal printer.", BODY))
step(1, "On the POS computer, open a web browser (Chrome or Microsoft Edge).")
step(2, "Go to this address:")
code("https://qz.io/download/")
step(3, "Click the <b>Windows</b> download button and save the installer file.")
step(4, "Open the downloaded file. If Windows asks <i>&ldquo;Do you want to allow this app to make changes?&rdquo;</i>, click <b>Yes</b>.")
step(5, "Click <b>Next</b> / <b>Install</b> / <b>Finish</b>, keeping the default options.")
step(6, "When it finishes, QZ Tray starts by itself. Look at the <b>bottom-right of the screen, near the clock</b>. "
        "Click the small up-arrow ( ^ ) to show hidden icons, and find the QZ Tray <b>diamond icon</b>.")
callout("CHECK.", "You should now see the QZ Tray diamond icon near the clock. If it is there, QZ Tray is installed and running.",
        GREEN, GREEN_BG)

# ============ PART 2 ============
story.append(Paragraph("Part 2 &nbsp;&middot;&nbsp; Make QZ Tray trust ZetaERP (this makes printing silent)", H1))
callout("WHY THIS MATTERS.",
        "Without this step, QZ Tray shows an &ldquo;Allow this website to print?&rdquo; box on every receipt, "
        "or the browser's own Print window keeps popping up. This step tells QZ Tray to trust ZetaERP, so it "
        "prints silently.", AMBER, AMBER_BG)

story.append(Paragraph("Easy way (recommended) - run the setup script", H2))
step(1, "Copy the two setup files - <font name=\"Courier\" size=\"9\">digital-certificate.txt</font> and "
        "<font name=\"Courier\" size=\"9\">setup-qz-trust.ps1</font> - into the <b>Downloads</b> folder on this "
        "computer (keep them together).")
step(2, "Click the <b>Start</b> button and type: <font name=\"Courier\" size=\"9\">PowerShell</font>")
step(3, "Right-click <b>Windows PowerShell</b> and choose <b>Run as administrator</b>. Click <b>Yes</b> on the prompt.")
step(4, "Copy and paste this exact line, then press <b>Enter</b>:")
code('powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\setup-qz-trust.ps1"')
step(5, "The script installs the certificate, configures QZ Tray and restarts it. When it shows the green "
        "message <b>&ldquo;DONE. QZ Tray is running and now trusts the ZetaERP cert&rdquo;</b>, this part is finished.")
callout("IF IT SAYS QZ IS NOT INSTALLED.",
        "Go back to Part 1, make sure the QZ Tray diamond icon is showing near the clock, then run the line again.",
        AMBER, AMBER_BG)

story.append(Paragraph("Manual way (only if the script will not run)", H2))
step(1, "Copy <font name=\"Courier\" size=\"9\">digital-certificate.txt</font> into this folder "
        "(create the <font name=\"Courier\" size=\"9\">auth</font> folder if it is not there):")
code("C:\\Program Files\\QZ Tray\\auth\\")
step(2, "Open this file with <b>Notepad</b> (run Notepad as administrator):")
code(r"C:\Program Files\QZ Tray\qz-tray.properties")
step(3, "Add this line at the end - use forward slashes exactly as shown:")
code("authcert.override=C:/Program Files/QZ Tray/auth/digital-certificate.txt")
step(4, "<b>Save</b> and close.")
step(5, "Restart QZ Tray: right-click the diamond icon near the clock, choose <b>Exit</b>; then open "
        "<b>QZ Tray</b> again from the Start menu.")

# ============ PART 3 ============
story.append(Paragraph("Part 3 &nbsp;&middot;&nbsp; Make QZ Tray start automatically on boot", H1))
story.append(Paragraph("So nobody has to start it by hand after the computer turns on.", BODY))
story.append(Paragraph("Easiest way - QZ Tray's own setting", H2))
step(1, "Right-click the QZ Tray <b>diamond icon</b> near the clock.")
step(2, "Click <b>Advanced</b>.")
step(3, "Click <b>Automatically start</b> so it shows a tick. (If it is already ticked, leave it.)")
story.append(Paragraph("Backup way - Windows Startup folder (use this if you do not see the option above)", H2))
step(1, "Press the <b>Windows key</b> and <b>R</b> together. A small <b>Run</b> box opens.")
step(2, "Type <font name=\"Courier\" size=\"9\">shell:startup</font> and press <b>Enter</b>. A folder opens.")
step(3, "Click <b>Start</b>, find <b>QZ Tray</b>, right-click it and choose <b>Open file location</b>.")
step(4, "Right-click the <b>QZ Tray</b> shortcut and choose <b>Copy</b>.")
step(5, "Go back to the Startup folder you opened and <b>paste</b> (Ctrl+V) the shortcut there.")
callout("TIP FOR UNATTENDED TILLS.",
        "Set Windows to log in automatically to the till account, so QZ Tray starts with no one needing to type "
        "a password. Ask your admin if unsure.", BLUE, BLUE_BG)

# ============ PART 4 ============
story.append(Paragraph("Part 4 &nbsp;&middot;&nbsp; Test that it works", H1))
step(1, "<b>Restart</b> the POS computer (turn it off and on, or choose Restart). Let it fully start up.")
step(2, "Look near the clock - the QZ Tray <b>diamond icon</b> should appear on its own. "
        "(That proves auto-start is working.)")
step(3, "Open a browser and go to:")
code("https://localhost.qz.io:8181")
story.append(Paragraph("You should see a page titled <b>About</b> showing <b>QZ Tray</b> and a version number. "
                       "If you see it, QZ Tray is running and reachable.", NOTE))
story.append(Spacer(1,5))
step(4, "Open the ZetaERP POS billing terminal, ring up one small <b>test sale</b> and take payment.")
step(5, "The receipt should print straight to the thermal printer - with <b>no print pop-up</b>, "
        "<b>no &ldquo;Allow&rdquo; box</b>, and <b>no error page</b>.")
step(6, "Cancel or clean up the test sale.")
callout("DONE.", "If the test receipt printed by itself, the machine is ready for billing. You are finished!",
        GREEN, GREEN_BG)

# ============ TROUBLESHOOTING ============
story.append(PageBreak())
story.append(Paragraph("Troubleshooting", H1))
story.append(Paragraph("If something is not right, find the symptom below and follow the fix.", BODY))
story.append(Spacer(1,4))

rows = [
    [Paragraph("What you see", CELLH), Paragraph("What it means", CELLH), Paragraph("What to do", CELLH)],
    [Paragraph("The browser's <b>Print</b> window opens on every sale", CELL),
     Paragraph("QZ Tray is not running, or does not trust ZetaERP yet", CELL),
     Paragraph("Check the QZ diamond icon is near the clock (Parts 1 &amp; 3). Re-run the setup script (Part 2).", CELL)],
    [Paragraph("A box says &ldquo;QZ Tray did not confirm printing&rdquo;", CELL),
     Paragraph("The website cannot reach QZ Tray", CELL),
     Paragraph("Make sure QZ Tray is running; open <font name=\"Courier\" size=\"8\">https://localhost.qz.io:8181</font> to confirm. Check security software is not blocking it.", CELL)],
    [Paragraph("A pop-up asks &ldquo;Allow this site to access printers?&rdquo; each time", CELL),
     Paragraph("The certificate is not installed as the trusted override", CELL),
     Paragraph("Run the setup script (Part 2). Or click <b>Allow</b> and tick <b>Remember this decision</b>.", CELL)],
    [Paragraph("The printer prints a page saying &ldquo;HTTP 400 ... Ambiguous URI&rdquo;", CELL),
     Paragraph("The POS page is an old version in the browser", CELL),
     Paragraph("On the POS page press <b>Ctrl+Shift+R</b> to reload, then try again. (This is already fixed on the website.)", CELL)],
    [Paragraph("It prints to the wrong printer", CELL),
     Paragraph("The thermal printer was not chosen", CELL),
     Paragraph("On the first print, pick your thermal printer in the QZ selection box. It is remembered after that.", CELL)],
    [Paragraph("QZ icon is missing after a restart", CELL),
     Paragraph("Auto-start is not set", CELL),
     Paragraph("Redo Part 3.", CELL)],
]
tbl = Table(rows, colWidths=[46*mm, 45*mm, 74*mm], repeatRows=1)
tstyle = [
    ("BACKGROUND",(0,0),(-1,0),VIOLET),
    ("VALIGN",(0,0),(-1,-1),"TOP"),
    ("LEFTPADDING",(0,0),(-1,-1),7),("RIGHTPADDING",(0,0),(-1,-1),7),
    ("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6),
    ("LINEBELOW",(0,0),(-1,-1),0.4,RULE),
    ("BOX",(0,0),(-1,-1),0.5,RULE),
    ("LINEAFTER",(0,0),(-2,-1),0.4,RULE),
]
for r in range(1,len(rows)):
    if r % 2 == 0:
        tstyle.append(("BACKGROUND",(0,r),(-1,r),ROWALT))
tbl.setStyle(TableStyle(tstyle))
story.append(tbl)

callout("HOW IT ALL FITS TOGETHER.",
        "The ZetaERP website signs every print request with a certificate. QZ Tray (running on the POS computer) "
        "checks that signature and, because you installed the matching certificate as a trusted override, prints "
        "silently. The signing is already live on the website - you only ever set up QZ Tray on each new machine.",
        BLUE, BLUE_BG)

# ============ APPENDIX A ============
story.append(PageBreak())
story.append(Paragraph("Appendix A &nbsp;&middot;&nbsp; The ZetaERP certificate", H1))
story.append(Paragraph("This certificate is <b>public and safe to share</b>. The matching private key stays on the "
                       "server and is never distributed.", BODY))
callout("ONLY IF YOU LOST THE FILE.",
        "Open <b>Notepad</b>, paste the text below EXACTLY (including the BEGIN and END lines), then "
        "<b>File &rarr; Save As</b>: File name <font name=\"Courier\" size=\"9\">digital-certificate.txt</font>, "
        "Save as type <b>All Files</b>, Encoding <b>UTF-8</b>. Keep it with your setup kit.", AMBER, AMBER_BG)
code(CERT, small=True)
story.append(Paragraph("<font color=\"#6B7280\">Certificate name: CN=ZetaERP POS &nbsp;&middot;&nbsp; "
                       "fingerprint (SHA-256): 10:3C:29:8B:94:0F:AF:93:E2:5B:40:E8:F1:31:58:BF:DD:FD:5D:28:D8:7E:2C:33:"
                       "E4:35:4A:CD:2C:4F:D0:E5</font>", NOTE))

# ============ APPENDIX B ============
story.append(PageBreak())
story.append(Paragraph("Appendix B &nbsp;&middot;&nbsp; The setup script", H1))
callout("ONLY IF YOU LOST THE FILE.",
        "Open <b>Notepad</b>, paste the text below, then <b>File &rarr; Save As</b>: File name "
        "<font name=\"Courier\" size=\"9\">setup-qz-trust.ps1</font>, Save as type <b>All Files</b>. "
        "Keep it next to <font name=\"Courier\" size=\"9\">digital-certificate.txt</font>.", AMBER, AMBER_BG)
code(SCRIPT, small=True)

# ---- header / footer ----
def deco(canvas, doc):
    canvas.saveState()
    w, h = A4
    # footer rule + text
    canvas.setStrokeColor(RULE); canvas.setLineWidth(0.5)
    canvas.line(18*mm, 14*mm, w-18*mm, 14*mm)
    canvas.setFont("Helvetica", 8); canvas.setFillColor(MUTE)
    canvas.drawString(18*mm, 9.5*mm, "ZetaERP POS  -  QZ Tray Setup Guide")
    canvas.drawRightString(w-18*mm, 9.5*mm, "Page %d" % doc.page)
    canvas.drawCentredString(w/2, 9.5*mm, "Keep with your POS setup kit")
    canvas.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm,
                        topMargin=16*mm, bottomMargin=18*mm,
                        title="ZetaERP POS - QZ Tray Setup Guide", author="ZetaERP")
doc.build(story, onFirstPage=deco, onLaterPages=deco)
print("WROTE:", OUT, "(%d bytes)" % os.path.getsize(OUT))
