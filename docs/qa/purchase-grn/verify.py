"""GRN/stock regression against a fresh disposable loopback Moqui + H2 runtime.

Install qa-screen.xml as Pricing/GrnQa.xml and the existing purchase-remaining
fixture as PurchaseRemainingQaFixture.xml in that runtime. Set PURCHASE_QA_RUNTIME,
PURCHASE_QA_JAVA and PURCHASE_QA_OUT. Start with purchase.pricing.qa.disposable=true.
The database must be destroyed after the run, including on failure.
"""
import base64
import hashlib
import http.cookiejar
import json
import os
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:18085"
HERE = Path(__file__).resolve().parent
JAVA = Path(os.environ["PURCHASE_QA_JAVA"])
RUNTIME = Path(os.environ["PURCHASE_QA_RUNTIME"])
OUT = Path(os.environ["PURCHASE_QA_OUT"])
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run([str(JAVA.with_name("javac.exe")), "-d", str(OUT),
                str(HERE.parent / "purchase-remaining/PurchaseRemainingDbProbe.java")], check=True)


class Tokens(HTMLParser):
    def __init__(self):
        super().__init__()
        self.token = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "input" and attrs.get("name") == "moquiSessionToken":
            self.token = attrs.get("value")


def session(user):
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    auth = base64.b64encode((user + ":moqui").encode()).decode()
    request = urllib.request.Request(BASE + "/apps/zenith/Purchase/FindPurchaseOrder",
                                     headers={"Authorization": "Basic " + auth})
    with opener.open(request, timeout=120) as response:
        parser = Tokens()
        parser.feed(response.read().decode())
    assert parser.token, "Expected an authenticated disposable runtime"
    return opener, parser.token


def post(client, path, data):
    opener, token = client
    body = urllib.parse.urlencode({"moquiSessionToken": token, **data}).encode()
    with opener.open(BASE + path, data=body, timeout=120) as response:
        opener.last_response_url = response.geturl()
        return response.read().decode()


def invoke(op, *, client=None, denied=False, **data):
    raw = post(client or user, "/apps/zenith/pricing/GrnQa/invoke", {"op": op, **data})
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        assert denied and client is viewer and client[0].last_response_url.endswith("/Dashboard"), raw[:500]
        return {}
    assert bool(result.get("errors")) == denied, (op, result)
    return result.get("result", {})


def query(sql):
    cp = str(next((RUNTIME / "WEB-INF/lib").glob("h2-*.jar"))) + os.pathsep + str(OUT)
    result = subprocess.run([str(JAVA), "-cp", cp, "PurchaseRemainingDbProbe"],
                            input=sql, text=True, encoding="utf-8", capture_output=True, check=True)
    return json.loads(result.stdout)


def row(table, key, value):
    assert value.replace("_", "").replace("-", "").isalnum()
    return query(f"SELECT * FROM {table} WHERE {key}='{value}'")[0]


def quantity():
    rows = query("SELECT SUM(QUANTITY_ON_HAND_TOTAL) AS QTY FROM ASSET WHERE OWNER_PARTY_ID='PP_QA_A'")
    return Decimal(rows[0]["qty"] or "0")


def fingerprint():
    return hashlib.sha256(json.dumps({table: query("SELECT * FROM " + table + " ORDER BY 1")
                                      for table in ("invoice", "invoice_item", "payment", "payment_application")},
                                     sort_keys=True).encode()).hexdigest()


admin = session("john.doe")
assert json.loads(post(admin, "/apps/zenith/pricing/GrnQa/initialize", {}))["initialized"]
user = session("purchase.pricing.qa")
viewer = session("purchase.pricing.viewer")
before_billing = fingerprint()
before_stock = quantity()
invoke("addPoLine", orderId="PP_QA_PO_A", productId="PP_QA_PRODUCT_A",
       quantity="2", unitAmount="100", itemDescription="Disposable receipt arithmetic control")
item = query("SELECT ORDER_ITEM_SEQ_ID FROM ORDER_ITEM WHERE ORDER_ID='PP_QA_PO_A'")[0]["order_item_seq_id"]
grn = invoke("create", purchaseOrderId="PP_QA_PO_A", receiptDate="2026-01-02")["grnId"]
invoke("details", grnId=grn, facilityId="PP_QA_A_STORE", vendorInvoiceNumber="QA-INVOICE")
invoke("line", grnId=grn, orderItemSeqId=item, plannedQuantity="2", unitAmount="100")
assert quantity() == before_stock
invoke("submit", grnId=grn, denied=True)
assert row("goods_receipt_note", "grn_id", grn)["status_id"] == "GrnDraft"
invoke("updatePo", orderId="PP_QA_PO_A", statusId="OrderPlaced")
assert row("order_header", "order_id", "PP_QA_PO_A")["status_id"] in ("OrderApproved", "OrderPlaced")
if row("order_header", "order_id", "PP_QA_PO_A")["status_id"] == "OrderPlaced":
    invoke("updatePo", orderId="PP_QA_PO_A", statusId="OrderApproved")
invoke("submit", grnId=grn)
invoke("submit", grnId=grn)
assert quantity() == before_stock
assert Decimal(invoke("reserved", orderId="PP_QA_PO_A")["reservedByItem"][item]) == 2
assert row("goods_receipt_note", "grn_id", grn)["status_id"] == "GrnPending"
print("PASS draft/approval/submit creates incoming quantities without changing stock", flush=True)

invoke("details", grnId=grn, facilityId="PP_QA_B_STORE", denied=True)
invoke("details", grnId=grn, facilityId="PP_QA_A_STORE", invoiceId="PP_QA_PAY_B", denied=True)
invoke("details", grnId=grn, facilityId="PP_QA_A_STORE", invoiceId="PP_QA_PAY_CANCELLED", denied=True)
invoke("details", grnId=grn, facilityId="PP_QA_A_STORE", invoiceId="PP_QA_WRONG_TYPE", denied=True)
invoke("line", grnId=grn, orderItemSeqId=item, plannedQuantity="1", unitAmount="1", denied=True)
invoke("submit", client=viewer, grnId=grn, denied=True)
assert invoke("get", grnId="PP_QA_GRN_B")["allowed"] is False
assert quantity() == before_stock
print("PASS location, invoice, submitted-line and viewer boundaries", flush=True)

second = invoke("create", purchaseOrderId="PP_QA_PO_A", receiptDate="2026-01-02")["grnId"]
invoke("details", grnId=second, facilityId="PP_QA_A_STORE")
invoke("line", grnId=second, orderItemSeqId=item, plannedQuantity="1", unitAmount="100")
invoke("submit", grnId=second, denied=True)
receipt = dict(orderId="PP_QA_PO_A", orderItemSeqId=item, grnId=grn,
               facilityId="PP_QA_A_STORE", quantityAccepted="1", grnReceivedBefore="0")
invoke("receive", **{**receipt, "quantityAccepted": "3"}, denied=True)
invoke("receive", **{**receipt, "facilityId": "PP_QA_B_STORE"}, denied=True)
invoke("receive", orderId="PP_QA_PO_A", orderItemSeqId=item,
       facilityId="PP_QA_A_STORE", quantityAccepted="1", denied=True)
assert quantity() == before_stock
print("PASS overallocated and invalid deliveries create no stock", flush=True)

received = invoke("receive", **receipt)
assert quantity() == before_stock + 1
assert row("goods_receipt_note", "grn_id", grn)["status_id"] == "GrnPartial"
assert Decimal(invoke("reserved", orderId="PP_QA_PO_A")["reservedByItem"][item]) == 1
invoke("receive", **receipt, denied=True)
assert quantity() == before_stock + 1
assert Decimal(row("asset", "asset_id", received["assetId"])["valuation_rate"]) == 100
invoke("receive", **{**receipt, "grnReceivedBefore": "1"})
assert quantity() == before_stock + 2
assert row("goods_receipt_note", "grn_id", grn)["status_id"] == "GrnReceived"
invoke("receive", **{**receipt, "grnReceivedBefore": "2"}, denied=True)
assert quantity() == before_stock + 2
assert Decimal(invoke("received", orderId="PP_QA_PO_A")["receivedByItem"][item]) == 2
print("PASS partial/final receipts update stock once and preserve recorded cost", flush=True)

invoke("details", grnId=grn, facilityId="PP_QA_A_STORE", invoiceId="PP_QA_PAY_A", vendorInvoiceNumber="QA-INVOICE")
assert fingerprint() == before_billing
invoke("cancel", grnId=second)
assert quantity() == before_stock + 2
assert invoke("reserved", orderId="PP_QA_PO_A")["reservedByItem"] == {}
po = invoke("createPo", vendorPartyId="PP_QA_SUPPLIER_A")["orderId"]
invoke("addPoLine", orderId=po, productId="PP_QA_PRODUCT_A", quantity="2", unitAmount="100")
seq = query(f"SELECT ORDER_ITEM_SEQ_ID FROM ORDER_ITEM WHERE ORDER_ID='{po}'")[0]["order_item_seq_id"]
invoke("updatePo", orderId=po, statusId="OrderPlaced")
if row("order_header", "order_id", po)["status_id"] == "OrderPlaced":
    invoke("updatePo", orderId=po, statusId="OrderApproved")
partial = invoke("create", purchaseOrderId=po, receiptDate="2026-01-02")["grnId"]
invoke("details", grnId=partial, facilityId="PP_QA_A_STORE")
invoke("line", grnId=partial, orderItemSeqId=seq, plannedQuantity="2", unitAmount="100")
invoke("submit", grnId=partial)
invoke("receive", orderId=po, orderItemSeqId=seq, grnId=partial, grnReceivedBefore="0",
       facilityId="PP_QA_A_STORE", quantityAccepted="1")
invoke("cancel", grnId=partial)
assert invoke("reserved", orderId=po)["reservedByItem"] == {}
invoke("receive", orderId=po, orderItemSeqId=seq, facilityId="PP_QA_A_STORE", quantityAccepted="1")
assert quantity() == before_stock + 4
assert fingerprint() == before_billing
print("PASS cancellation releases pending quantities and direct PO receipts remain usable", flush=True)

(OUT / "preview.json").write_text(json.dumps({"grnId": grn, "draftGrnId": second,
                                            "orderId": "PP_QA_PO_A", "item": item}), encoding="utf-8")
print("PASS invoice linking and cancellation preserve stock and billing records", flush=True)
print("PASS GRN regression checks completed", flush=True)
