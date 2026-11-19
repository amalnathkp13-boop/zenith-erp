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


class FormInputs(HTMLParser):
    def __init__(self, action):
        super().__init__()
        self.action = action
        self.in_form = False
        self.values = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form":
            self.in_form = urllib.parse.urlsplit(attrs.get("action", "")).path.endswith("/" + self.action)
        elif self.in_form and tag == "input" and attrs.get("name"):
            self.values[attrs["name"]] = attrs.get("value", "")

    def handle_endtag(self, tag):
        if tag == "form":
            self.in_form = False


def form_inputs(path, action):
    parser = FormInputs(action)
    with user[0].open(BASE + path, timeout=120) as response:
        parser.feed(response.read().decode())
    assert parser.values, f"Missing {action} form"
    return parser.values


class ReceivingTables(HTMLParser):
    """Read table cell text from Bootstrap tables and Quasar's nested divs."""
    def __init__(self):
        super().__init__()
        self.cells = {"FindPendingReceiptsList_table": [], "IncomingGrnList_table": []}
        self.active = None
        self.tag = None
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        table_id = dict(attrs).get("id")
        if table_id in self.cells:
            self.active, self.tag, self.depth = table_id, tag, 1
        elif self.active and tag == self.tag:
            self.depth += 1

    def handle_endtag(self, tag):
        if self.active and tag == self.tag:
            self.depth -= 1
            if not self.depth:
                self.active = None

    def handle_data(self, data):
        if self.active and data.strip():
            self.cells[self.active].append(data.strip())


def receiving_tables(order_id):
    for shell, suffix in (("apps", ""), ("qapps", ".qvt")):
        args = urllib.parse.urlencode({"orderId": order_id, "orderId_op": "equals"})
        path = f"/{shell}/zenith/Inventory/FindReceipt{suffix}?{args}"
        parser = ReceivingTables()
        with user[0].open(BASE + path, timeout=120) as response:
            parser.feed(response.read().decode())
        yield parser.cells["FindPendingReceiptsList_table"], parser.cells["IncomingGrnList_table"]


def verify_draft_editor():
    initial_stock = quantity()
    po = invoke("createPo", vendorPartyId="PP_QA_SUPPLIER_A")["orderId"]
    assert row("order_header", "order_id", po)["currency_uom_id"] == "INR"
    order_page = "/apps/zenith/Purchase/EditPurchaseOrder"
    default_qty = form_inputs(order_page + "?orderId=" + po, "addItem")["quantity"]
    assert Decimal(default_qty) == 1
    for qty, description in [(default_qty, ""), ("2", "Custom packing line")]:
        post(user, order_page + "/addItem", dict(orderId=po, productId="PP_QA_PRODUCT_A",
             itemDescription=description, quantity=qty, unitAmount="12.50"))
    items = query(f"SELECT ORDER_ITEM_SEQ_ID,ITEM_DESCRIPTION FROM ORDER_ITEM WHERE ORDER_ID='{po}' ORDER BY ORDER_ITEM_SEQ_ID")
    catalog_name = row("product", "product_id", "PP_QA_PRODUCT_A")["product_name"]
    assert [item["item_description"] for item in items] == [catalog_name, "Custom packing line"]
    first, second = [item["order_item_seq_id"] for item in items]
    invoke("updatePo", orderId=po, statusId="OrderPlaced")
    if row("order_header", "order_id", po)["status_id"] == "OrderPlaced":
        invoke("updatePo", orderId=po, statusId="OrderApproved")

    grn = invoke("create", purchaseOrderId=po, receiptDate="2026-02-03")["grnId"]
    assert invoke("get", grnId=grn)["order"]["currencyUomId"] == "INR"
    path = "/apps/zenith/Purchase/GoodsReceiptDetail"
    url = path + "?grnId=" + grn
    draft = form_inputs(url, "saveDraft")
    assert [Decimal(draft["qty_" + seq]) for seq in (first, second)] == [1, 2]
    draft.update(facilityId="PP_QA_A_STORE", vendorInvoiceNumber="QA-BULK-SAVE", draftAction="save")
    draft["qty_" + second] = "1"
    post(user, path + "/saveDraft", draft)

    def saved_state():
        header = row("goods_receipt_note", "grn_id", grn)
        lines = query(f"SELECT PLANNED_QUANTITY,UNIT_AMOUNT FROM GOODS_RECEIPT_NOTE_ITEM WHERE GRN_ID='{grn}' ORDER BY ORDER_ITEM_SEQ_ID")
        return (header["status_id"], header["facility_id"], header["vendor_invoice_number"],
                [(Decimal(line["planned_quantity"]), Decimal(line["unit_amount"])) for line in lines])

    saved = ("GrnDraft", "PP_QA_A_STORE", "QA-BULK-SAVE", [(1, Decimal("12.50")), (1, Decimal("12.50"))])
    assert saved_state() == saved
    current = form_inputs(url, "saveDraft")
    assert all(current["version_" + seq] for seq in (first, second))
    assert [Decimal(current["qty_" + seq]) for seq in (first, second)] == [1, 1]
    current.update(facilityId="PP_QA_A_STORE", draftAction="save")
    post(user, path + "/saveDraft", {**draft, "vendorInvoiceNumber":"STALE"})
    assert saved_state() == saved, "An older draft overwrote saved values"
    post(user, path + "/saveDraft", {**current, "cost_" + first:"22", "qty_" + second:"3",
                                     "vendorInvoiceNumber":"INVALID"})
    assert saved_state() == saved, "A bad second line committed part of the draft"
    post(user, path + "/saveDraft", {**current, "draftAction":"send"})
    assert saved_state() == ("GrnPending", *saved[1:])
    assert quantity() == initial_stock
    invoke("receive", orderId=po, orderItemSeqId=first, grnId=grn, grnReceivedBefore="0",
           facilityId="PP_QA_A_STORE", quantityAccepted="1")
    assert quantity() == initial_stock + 1
    assert row("goods_receipt_note", "grn_id", grn)["status_id"] == "GrnPartial"
    invoke("cancel", grnId=grn)
    print("PASS PO entry defaults, bulk draft save, stale rejection, rollback, send and stock confirmation", flush=True)


admin = session("john.doe")
assert json.loads(post(admin, "/apps/zenith/pricing/GrnQa/initialize", {}))["initialized"]
user = session("purchase.pricing.qa")
viewer = session("purchase.pricing.viewer")
before_billing = fingerprint()
before_stock = quantity()
for _, deliveries in receiving_tables("PP_QA_PO_A"):
    assert "PP_QA_GRN_A" in deliveries and "Needs review" in deliveries and "Receive delivery" not in deliveries
for orders, deliveries in receiving_tables("PP_QA_PO_B"):
    assert "PP_QA_PO_B" not in orders and "PP_QA_GRN_B" not in deliveries
primary_po = invoke("createPo", vendorPartyId="PP_QA_SUPPLIER_A")["orderId"]
for orders, _ in receiving_tables(primary_po):
    assert primary_po in orders and "Awaiting products" in orders and "Receive Stock" not in orders
invoke("addPoLine", orderId=primary_po, productId="PP_QA_PRODUCT_A",
       quantity="2", unitAmount="100", itemDescription="Disposable receipt arithmetic control")
item = query(f"SELECT ORDER_ITEM_SEQ_ID FROM ORDER_ITEM WHERE ORDER_ID='{primary_po}'")[0]["order_item_seq_id"]
grn = invoke("create", purchaseOrderId=primary_po, receiptDate="2026-01-02")["grnId"]
for orders, deliveries in receiving_tables(primary_po):
    assert primary_po in orders and "Open" in orders and "Awaiting approval" in orders and "Receive Stock" not in orders
    assert grn in deliveries and "Draft" in deliveries and "Receive delivery" not in deliveries
invoke("receive", orderId=primary_po, orderItemSeqId=item, facilityId="PP_QA_A_STORE", quantityAccepted="1", denied=True)
invoke("details", grnId=grn, facilityId="PP_QA_A_STORE", vendorInvoiceNumber="QA-INVOICE")
invoke("line", grnId=grn, orderItemSeqId=item, plannedQuantity="2", unitAmount="100")
assert quantity() == before_stock
invoke("submit", grnId=grn, denied=True)
assert row("goods_receipt_note", "grn_id", grn)["status_id"] == "GrnDraft"
invoke("updatePo", orderId=primary_po, statusId="OrderPlaced")
assert row("order_header", "order_id", primary_po)["status_id"] in ("OrderApproved", "OrderPlaced")
if row("order_header", "order_id", primary_po)["status_id"] == "OrderPlaced":
    invoke("updatePo", orderId=primary_po, statusId="OrderApproved")
for orders, deliveries in receiving_tables(primary_po):
    assert primary_po in orders and "Receive Stock" in orders
    assert grn in deliveries and "Receive delivery" not in deliveries
invoke("submit", grnId=grn)
invoke("submit", grnId=grn)
assert quantity() == before_stock
assert Decimal(invoke("reserved", orderId=primary_po)["reservedByItem"][item]) == 2
assert row("goods_receipt_note", "grn_id", grn)["status_id"] == "GrnPending"
for orders, deliveries in receiving_tables(primary_po):
    assert primary_po not in orders and grn in deliveries and "Receive delivery" in deliveries
print("PASS draft/approval/submit creates incoming quantities without changing stock", flush=True)

invoke("details", grnId=grn, facilityId="PP_QA_B_STORE", denied=True)
invoke("details", grnId=grn, facilityId="PP_QA_A_STORE", invoiceId="PP_QA_PAY_A", denied=True)
# Keep the other invoice checks independent of the currency mismatch above.
usd_control = invoke("create", purchaseOrderId="PP_QA_PO_A", receiptDate="2026-01-02")["grnId"]
for invoice_id in ("PP_QA_PAY_B", "PP_QA_PAY_CANCELLED", "PP_QA_WRONG_TYPE"):
    invoke("details", grnId=usd_control, facilityId="PP_QA_A_STORE", invoiceId=invoice_id, denied=True)
invoke("cancel", grnId=usd_control)
invoke("line", grnId=grn, orderItemSeqId=item, plannedQuantity="1", unitAmount="1", denied=True)
invoke("submit", client=viewer, grnId=grn, denied=True)
assert invoke("get", grnId="PP_QA_GRN_B")["allowed"] is False
assert quantity() == before_stock
print("PASS location, invoice, submitted-line and viewer boundaries", flush=True)

second = invoke("create", purchaseOrderId=primary_po, receiptDate="2026-01-02")["grnId"]
invoke("details", grnId=second, facilityId="PP_QA_A_STORE")
invoke("line", grnId=second, orderItemSeqId=item, plannedQuantity="1", unitAmount="100")
invoke("submit", grnId=second, denied=True)
receipt = dict(orderId=primary_po, orderItemSeqId=item, grnId=grn,
               facilityId="PP_QA_A_STORE", quantityAccepted="1", grnReceivedBefore="0")
invoke("receive", **{**receipt, "quantityAccepted": "3"}, denied=True)
invoke("receive", **{**receipt, "facilityId": "PP_QA_B_STORE"}, denied=True)
invoke("receive", orderId=primary_po, orderItemSeqId=item,
       facilityId="PP_QA_A_STORE", quantityAccepted="1", denied=True)
assert quantity() == before_stock
print("PASS overallocated and invalid deliveries create no stock", flush=True)

received = invoke("receive", **receipt)
assert quantity() == before_stock + 1
assert row("goods_receipt_note", "grn_id", grn)["status_id"] == "GrnPartial"
assert Decimal(invoke("reserved", orderId=primary_po)["reservedByItem"][item]) == 1
invoke("receive", **receipt, denied=True)
assert quantity() == before_stock + 1
asset = row("asset", "asset_id", received["assetId"])
assert Decimal(asset["valuation_rate"]) == 100 and asset["acquire_cost_uom_id"] == "INR"
invoke("receive", **{**receipt, "grnReceivedBefore": "1"})
assert quantity() == before_stock + 2
assert row("goods_receipt_note", "grn_id", grn)["status_id"] == "GrnReceived"
invoke("receive", **{**receipt, "grnReceivedBefore": "2"}, denied=True)
assert quantity() == before_stock + 2
assert Decimal(invoke("received", orderId=primary_po)["receivedByItem"][item]) == 2
print("PASS partial/final receipts update stock once and preserve recorded cost", flush=True)

invoke("details", grnId=grn, facilityId="PP_QA_A_STORE", invoiceId="PP_QA_GRN_BILL_INR", vendorInvoiceNumber="QA-INVOICE")
assert fingerprint() == before_billing
invoke("cancel", grnId=second)
for orders, deliveries in receiving_tables(primary_po):
    assert primary_po not in orders and grn not in deliveries and second not in deliveries
assert quantity() == before_stock + 2
assert invoke("reserved", orderId=primary_po)["reservedByItem"] == {}
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
                                            "orderId": primary_po, "item": item,
                                            "currencyUomId": invoke("get", grnId=grn)["order"]["currencyUomId"]}), encoding="utf-8")
print("PASS invoice linking and cancellation preserve stock and billing records", flush=True)
verify_draft_editor()
direct_stock_before = quantity()
direct = invoke("receive", productId="PP_QA_PRODUCT_A", facilityId="PP_QA_A_STORE",
                quantityAccepted="1", valuationRate="7.25")
direct_asset = row("asset", "asset_id", direct["assetId"])
assert Decimal(direct_asset["acquire_cost"]) == Decimal("7.25")
assert direct_asset["acquire_cost_uom_id"] == "INR"
assert quantity() == direct_stock_before + 1
print("PASS direct receipt retains its unit cost in INR", flush=True)
print("PASS GRN regression checks completed", flush=True)
