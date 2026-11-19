"""Exercise real CRM and Sales forms in a disposable all-modules fixture.

Install pypdf for native print verification. Set CRM_QA_PASSWORD to the disposable fixture password, then run:
python3 check-opportunity.py http://127.0.0.1:18919 postgres-container
"""
import base64
import csv
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import http.cookiejar
import io
from html.parser import HTMLParser
import os
import re
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
import uuid

from pypdf import PdfReader

base, database_container = sys.argv[1:]
assert urllib.parse.urlsplit(base).hostname in ("localhost", "127.0.0.1")
root = base.rstrip("/") + "/apps/zenith/"



def sql(statement):
    return subprocess.check_output([
        "docker", "exec", database_container, "psql", "-U", "moqui", "-d", "moqui",
        "-At", "-v", "ON_ERROR_STOP=1", "-c", statement,
    ], text=True).strip()


def page(route, parameters=None):
    url = root + route
    if parameters:
        url += "?" + urllib.parse.urlencode(parameters)
    return browser.open(url, timeout=45).read().decode()


def post(session, route, fields):
    opener, csrf_token = session
    data = urllib.parse.urlencode(dict(moquiSessionToken=csrf_token, **fields)).encode()
    return opener.open(root + route, data=data, timeout=45).read().decode()


def submit(route, **fields):
    return post((browser, token), route, fields)


def assert_amounts(query, expected, context):
    result = sql(query)
    assert result, f"{context}: missing row"
    values = [Decimal(v) for v in result.split("|")]
    assert values == list(expected), f"{context}: expected {expected}, observed {values}"


def check_pricing(order_id, product, gst):
    tax = Decimal(gst)
    total = Decimal(180) + tax
    assert_amounts(
        f"select quantity, unit_amount, discount_amount, taxable_amount, total_tax_amount, "
        f"taxable_amount+total_tax_amount from order_item where order_id='{order_id}' and product_id='{product}'",
        [2, 100, 20, 180, tax, total], f"Product pricing on {order_id}")
    # The fixture has exactly one part. Checking it and the header separately catches divergent native totals.
    assert_amounts(f"select part_total from order_part where order_id='{order_id}'", [total], f"Part {order_id}")
    assert_amounts(f"select grand_total from order_header where order_id='{order_id}'", [total], f"Header {order_id}")
    return total


class ScreenText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        if data.strip():
            self.parts.append(data.strip())


def check_screen_total(screen, order_id, label, amount):
    content = ScreenText()
    content.feed(page("sales/" + screen, {"orderId": order_id}))
    visible = " ".join(content.parts)
    assert re.search(re.escape(label) + r"\s*(?:₹|INR)\s*" + re.escape(format(amount, ".2f")), visible), (
        f"{screen} did not display {label} {amount:.2f} for {order_id}")


def check_list_total(screen, search_key, order_id, total):
    for shell in ("apps", "qapps"):
        route = f"{base.rstrip('/')}/{shell}/zenith/sales/{screen}"
        filters = {search_key: order_id}
        view = route + (".qvt" if shell == "qapps" else "") + "?" + urllib.parse.urlencode(filters)
        rendered = browser.open(view, timeout=45).read().decode()
        assert re.search(r"(?:₹|INR)\s*" + re.escape(format(total, ".2f")), rendered), (shell, screen, total)
        query = urllib.parse.urlencode(filters | {"renderMode": "csv", "lastStandalone": "true", "pageNoLimit": "true"})
        with browser.open(route + "?" + query, timeout=45) as response:
            rows = list(csv.DictReader(io.StringIO(response.read().decode("utf-8-sig"))))
        assert len(rows) == 1 and Decimal(rows[0]["Total"]) == total, (shell, screen, rows)


def check_print(route, id_field, record_id, total, *, invoice=False):
    request = root + "sales/" + route + "?" + urllib.parse.urlencode({id_field: record_id})
    with browser.open(request, timeout=45) as response:
        pdf = response.read()
    assert pdf.startswith(b"%PDF-"), f"{route} returned a non-PDF response"
    text = " ".join(" ".join(p.extract_text().split()) for p in PdfReader(io.BytesIO(pdf)).pages)
    label = r"\bTotal" if invoice else r"Grand Total(?: \(Inc\. GST\))?"
    assert re.search(label + r"\s*(?:Rs\.?|₹|INR)\s*" + re.escape(format(total, ".2f")), text, re.I), (
        f"{route} did not print a total of {total:.2f}")
    if invoice:
        assert re.search(r"Two Hundred(?: and)? Twelve Rupees and Forty Paise", text, re.I), text


def check_revision(opportunity_id, order_id, product, gst):
    submit("sales/EditQuotation/createRevision", orderId=order_id)
    revisions = sql(f"select order_id from sales_opportunity_order where sales_opportunity_id='{opportunity_id}' "
                    f"and order_id<>'{order_id}'").splitlines()
    assert len(revisions) == 1, revisions
    revision = revisions[0]
    assert sql(f"select document_type from order_header where order_id='{revision}'") == "QUOTATION"
    total = check_pricing(revision, product, gst)
    check_screen_total("EditQuotation", revision, "Estimated Grand Total", total)


def checked_invoice(order_id, gst, taxable="180", line_count=1):
    # Posting the normal conversion twice must reuse the invoice and its product billing link.
    def billing_rows():
        return sql(f"select invoice_id,invoice_item_seq_id from order_item_billing where order_id='{order_id}' order by order_item_seq_id")
    submit("sales/EditOrder/convertToInvoice", orderId=order_id)
    first = billing_rows()
    assert first and len(first.splitlines()) == line_count, first
    assert len({row.split("|")[0] for row in first.splitlines()}) == 1, first
    submit("sales/EditOrder/convertToInvoice", orderId=order_id)
    assert billing_rows() == first, f"Repeat conversion changed {first}"
    invoice_id = first.split("|")[0]
    gst = Decimal(gst)
    taxable = Decimal(taxable)
    assert_amounts(f"select total_taxable_amount,total_tax_amount,invoice_total from invoice where invoice_id='{invoice_id}'",
                   [taxable, gst, taxable + gst], f"Invoice {invoice_id}")
    return invoice_id


assert sql("select count(*) from party where party_id in ('AUDIT_QA_A','AUDIT_QA_CUST_A')") == "2"
def actor(username):
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    credentials = base64.b64encode((username + ":" + os.environ["CRM_QA_PASSWORD"]).encode()).decode()
    helper = urllib.request.Request(root + "Crm/AllModulesQa", headers={"Authorization": "Basic " + credentials})
    html = opener.open(helper, timeout=45).read().decode()
    csrf_token = re.search(r'name="moquiSessionToken"[^>]*value="([^"]+)"', html)[1]
    return opener, csrf_token


browser, token = actor("audit.qa")
name = "QA quotation " + uuid.uuid4().hex
customer = "AUDIT_QA_CUST_A"
create = dict(opportunityName=name, accountPartyId=customer, estimatedAmount="4500",
              nextStep="Confirm delivery dates", opportunityStageId="SoProspecting")
submit("Crm/Pipeline/createOpportunity", **(create | {"opportunityStageId": "SoClosedLost"}))
assert sql(f"select count(*) from sales_opportunity where opportunity_name='{name}'") == "0"

submit("Crm/Pipeline/createOpportunity", **create, competitorPartyId="AUDIT_QA_COMPETITOR")
opportunity = sql(f"select sales_opportunity_id from sales_opportunity where opportunity_name='{name}' and organization_party_id='AUDIT_QA_A'")
assert opportunity, "Opportunity must persist under the signed-in organization"
assert sql(f"select next_step from sales_opportunity where sales_opportunity_id='{opportunity}'") == create["nextStep"]
competitor = dict(salesOpportunityId=opportunity, competitorPartyId="AUDIT_QA_COMPETITOR")
competitor_count = f"select count(*) from sales_opportunity_competitor where sales_opportunity_id='{opportunity}' and competitor_party_id='AUDIT_QA_COMPETITOR'"
assert sql(competitor_count) == "1"
submit("Crm/EditOpportunity/addCompetitor", **competitor)
submit("Crm/EditOpportunity/updateOpportunity", salesOpportunityId=opportunity, opportunityName=name,
       estimatedProbability="0.6", estimatedAmount="4500")
assert sql(competitor_count) == "1", "Retry and unrelated forecast edits must preserve the competitor"
assert "Disposable competitor" in page("Crm/EditOpportunity", {"salesOpportunityId": opportunity})
submit("Crm/EditOpportunity/removeCompetitor", **competitor)
assert sql(competitor_count) == "0"
print("Optional competitor, idempotent add, forecast edit, rendered name and removal passed.", flush=True)
stage = dict(salesOpportunityId=opportunity, opportunityStageId="SoClosedLost", confirmOutcome="Y")
submit("Crm/EditOpportunity/advanceStage", **stage)
assert sql(f"select opportunity_stage_id from sales_opportunity where sales_opportunity_id='{opportunity}'") == "SoProspecting"
submit("Crm/EditOpportunity/advanceStage", **stage, lostReason="Budget deferred")
submit("Crm/EditOpportunity/advanceStage", **stage, lostReason="Budget deferred")
assert sql(f"select count(*) from crm_audit_event where record_id='{opportunity}' and action='StageChanged'") == "1"
submit("Crm/EditOpportunity/advanceStage", salesOpportunityId=opportunity, opportunityStageId="SoProspecting")
assert sql(f"select (lost_reason is null and lost_date is null and won_date is null) from sales_opportunity where sales_opportunity_id='{opportunity}'") == "t"
print("Closed-stage guard, explicit loss, retry and reopening passed.", flush=True)

params = dict(salesOpportunityId=opportunity, customerPartyId=customer)
detail = page("Crm/EditOpportunity", {"salesOpportunityId": opportunity})
assert "Create quotation" in detail, "The CRM record must expose the native Sales form"
assert 'name="salesOpportunityId"' in page("sales/CreateQuotation", params)
count_sql = "select count(*) from order_part where vendor_party_id='AUDIT_QA_A' and customer_party_id='AUDIT_QA_CUST_A'"
count = int(sql(count_sql))
second_session = actor("audit.qa")
ready = threading.Barrier(2)


def concurrent_quote(session):
    ready.wait(timeout=10)
    return post(session, "sales/CreateQuotation/createQuotation", params | {"orderDate": "2026-11-19"})


with ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(concurrent_quote, [(browser, token), second_session]))
order = sql(f"select order_id from sales_opportunity_order where sales_opportunity_id='{opportunity}'")
assert order and int(sql(count_sql)) == count + 1, "One native Sales document must be linked"
assert sql(f"select status_id || '|' || currency_uom_id || '|' || document_type from order_header where order_id='{order}'") == "OrderProposed|INR|QUOTATION"
submit("sales/CreateQuotation/createQuotation", **params, orderDate="2026-11-19")
assert int(sql(count_sql)) == count + 1, "Retry must not create another draft"
detail = page("Crm/EditOpportunity", {"salesOpportunityId": opportunity})
assert "EditQuotation" in detail and order in detail and "Create quotation" not in detail
customer_page = page("Crm/ContactDetail", {"partyId": customer})
for target, key in (("FindQuotation", "customerPartyId"), ("FindOrder", "customerPartyId"), ("FindInvoice", "toPartyId")):
    assert f"/sales/{target}?{key}={customer}" in customer_page
print("Native quotation, customer and currency, retry and customer transaction navigation passed.")

submit("sales/EditQuotation/addItem", orderId=order, productId="AUDIT_QA_PRODUCT_A", quantity="2",
       unitAmount="100", discountPercent="10", taxPercentage="0", itemTypeEnumId="ItemProduct")
total = check_pricing(order, "AUDIT_QA_PRODUCT_A", "0")
check_screen_total("EditQuotation", order, "Estimated Grand Total", total)
check_revision(opportunity, order, "AUDIT_QA_PRODUCT_A", "0")
submit("sales/EditQuotation/convertToOrder", orderId=order)
assert sql(f"select document_type from order_header where order_id='{order}'") == "SALES_ORDER"
assert "Sales order " in page("Crm/EditOpportunity", {"salesOpportunityId": opportunity})
check_pricing(order, "AUDIT_QA_PRODUCT_A", "0")
check_screen_total("EditOrder", order, "Grand Total", total)
invoice = checked_invoice(order, "0")
assert invoice and sql(f"select from_party_id || '|' || to_party_id from invoice where invoice_id='{invoice}'") == "AUDIT_QA_A|AUDIT_QA_CUST_A"
assert "Payment Details" in page("sales/EditInvoice", {"invoiceId": invoice})
assert f"/sales/EditInvoice?invoiceId={invoice}" in page("Crm/EditOpportunity", {"salesOpportunityId": opportunity})
submit("sales/EditInvoice/updateInvoice", invoiceId=invoice, statusId="InvoiceFinalized")
assert sql(f"select unpaid_total > 0 from invoice where invoice_id='{invoice}'") == "t"
assert "Outstanding · INR" in page("Crm/ContactDetail", {"partyId": customer})
submit("sales/EditInvoice/markPaidCash", invoiceId=invoice)
assert sql(f"select status_id || '|' || (unpaid_total = 0) from invoice where invoice_id='{invoice}'") == "InvoicePmtRecvd|true"
submit("sales/EditInvoice/markPaidCash", invoiceId=invoice)
assert_amounts(f"select count(*),sum(amount) from payment where for_invoice_id='{invoice}'", [1, 180],
               "Tax-free cash settlement after retry")
other_browser, _ = actor("audit.b.qa")
other_invoices = other_browser.open(root + "sales/FindInvoice?toPartyId=AUDIT_QA_CUST_B", timeout=45).read().decode()
assert "/sales/EditInvoice?invoiceId=" + invoice not in other_invoices
print("Native ERP line arithmetic, order, invoice, payment and separate tenant invoice views passed.")

# The second fixture uses the installed Indian tax engine and an 18% catalogue product.
browser, token = actor("audit.b.qa")
customer = "AUDIT_QA_CUST_B"
name = "QA taxable quotation " + uuid.uuid4().hex
submit("Crm/Pipeline/createOpportunity", **(create | {"opportunityName":name, "accountPartyId":customer}))
opportunity = sql(f"select sales_opportunity_id from sales_opportunity where opportunity_name='{name}' and organization_party_id='AUDIT_QA_B'")
submit("sales/CreateQuotation/createQuotation", salesOpportunityId=opportunity, customerPartyId=customer, orderDate="2026-11-19")
order = sql(f"select order_id from sales_opportunity_order where sales_opportunity_id='{opportunity}'")
submit("sales/EditQuotation/addItem", orderId=order, productId="AUDIT_QA_CRM_GST18", quantity="2",
       unitAmount="100", discountPercent="10", taxPercentage="18", itemTypeEnumId="ItemProduct")
product = "AUDIT_QA_CRM_GST18"
total = check_pricing(order, product, "32.40")
check_screen_total("EditQuotation", order, "Estimated Grand Total", total)
check_revision(opportunity, order, product, "32.40")
check_print("EditQuotation/printQuotation", "orderId", order, total)

# Reproduce an open document saved before the fix, exclusively on this run's synthetic quote.
sql(f"update order_header set grand_total=200 where order_id='{order}'; "
    f"update order_part set part_total=200 where order_id='{order}'")
check_list_total("FindQuotation", "quoteNoSearch", order, total)
assert_amounts(f"select grand_total from order_header where order_id='{order}'", [200], "Quotation list is read-only")
submit("sales/EditQuotation/convertToOrder", orderId=order)
assert sql(f"select document_type from order_header where order_id='{order}'") == "SALES_ORDER"
check_pricing(order, product, "32.40")
submit("sales/EditQuotation/convertToOrder", orderId=order)
check_pricing(order, product, "32.40")
check_screen_total("EditOrder", order, "Grand Total", total)

seller = "AUDIT_QA_PRICE_REP_B"
submit("sales/EditOrder/calculateCommission", orderId=order, partyId=seller)
submit("sales/EditOrder/calculateCommission", orderId=order, partyId=seller)
assert_amounts(f"select order_amount,commission_amount from commission_transaction "
               f"where order_id='{order}' and status_id='ComCalculated'",
               [total, Decimal("21.24")], "Percentage commission after retry")
check_print("EditOrder/printOrder", "orderId", order, total)
invoice = checked_invoice(order, "32.40")
assert_amounts(f"select coalesce(round_off_amount,0),invoice_total+coalesce(round_off_amount,0) "
               f"from invoice where invoice_id='{invoice}'", [0, total], "Draft order-derived payable")
submit("sales/EditInvoice/updateInvoice", invoiceId=invoice, statusId="InvoiceFinalized")
assert sql(f"select status_id from invoice where invoice_id='{invoice}'") == "InvoiceFinalized"
assert_amounts(f"select invoice_total,unpaid_total from invoice where invoice_id='{invoice}'", [total, total],
               "Finalized invoice and outstanding amount")
check_print("EditInvoice/printInvoice", "invoiceId", invoice, total, invoice=True)
submit("sales/EditInvoice/markPaidCash", invoiceId=invoice)
submit("sales/EditInvoice/markPaidCash", invoiceId=invoice)
assert_amounts(f"select applied_payments_total,unpaid_total from invoice where invoice_id='{invoice}'",
               [total, 0], "Settled invoice")
assert_amounts(f"select count(*),sum(amount) from payment where for_invoice_id='{invoice}'", [1, total],
               "GST cash settlement after retry")
check_pricing(order, product, "32.40")
print("Quote and populated revision, parts, headers, order, invoice and retries agree for INR 180.00 and 212.40.")
print("The old open quote was repaired on conversion. Commission used 212.40 and tax-free cash settlement used 180.00.")


# An accepted manual rate overrides the catalog, including separate paisa rounding for intra-state GST.
name = "QA manual rate " + uuid.uuid4().hex
submit("Crm/Pipeline/createOpportunity", **(create | {"opportunityName": name, "accountPartyId": customer}))
manual_opportunity = sql(f"select sales_opportunity_id from sales_opportunity where opportunity_name='{name}' "
                         "and organization_party_id='AUDIT_QA_B'")
submit("sales/CreateQuotation/createQuotation", salesOpportunityId=manual_opportunity, customerPartyId=customer,
       orderDate="2026-11-19")
manual_order = sql(f"select order_id from sales_opportunity_order where sales_opportunity_id='{manual_opportunity}'")
# Add two differently priced lines concurrently from independent sessions on this quotation.
# The same catalog item is used twice so neither its default rate nor product matching can replace the agreed rates.
start = threading.Barrier(2)
def add_manual_line(session, price, rate):
    start.wait(timeout=10)
    post(session, "sales/EditQuotation/addItem", dict(orderId=manual_order, productId=product, quantity="1",
         unitAmount=price, discountPercent="0", taxPercentage=rate, itemTypeEnumId="ItemProduct"))


with ThreadPoolExecutor(max_workers=2) as pool:
    second = actor("audit.b.qa")
    futures = [pool.submit(add_manual_line, (browser, token), "10.20", "5"),
               pool.submit(add_manual_line, second, "10.00", "0")]
    for future in futures:
        future.result()
components = [Decimal(v) for v in ("10.20", "0.26", "0.26", "0.00", "0.52")]
component_fields = "taxable_amount,coalesce(cgst_amount,0),coalesce(sgst_amount,0),coalesce(igst_amount,0),coalesce(total_tax_amount,0)"
def check_manual_components(table, key, document):
    for taxable, amounts in (("10.20", components), ("10.00", [10, 0, 0, 0, 0])):
        assert_amounts(f"select {component_fields} from {table} where {key}='{document}' and product_id='{product}' "
                       f"and taxable_amount={taxable}", amounts, f"Accepted manual rate on {document} at {taxable}")


check_manual_components("order_item", "order_id", manual_order)
assert_amounts(f"select part_total from order_part where order_id='{manual_order}'", [Decimal("20.72")],
               "Concurrent lines in the quotation part")
submit("sales/EditQuotation/convertToOrder", orderId=manual_order)
assert_amounts(f"select grand_total from order_header where order_id='{manual_order}'",
               [Decimal("20.72")], "Manual rates at order conversion")
manual_invoice = checked_invoice(manual_order, "0.52", "20.20", line_count=2)
check_manual_components("invoice_item", "invoice_id", manual_invoice)

# Normal Sales users can start directly from Create Order, without a CRM deal or quotation.
def create_direct_order(buyer):
    screen = submit("sales/CreateOrder/createOrder", customerPartyId=buyer, facilityId="AUDIT_QA_FAC_B",
                    orderDate="2026-11-19")
    return re.search(r'name="orderId"[^>]*value="([^"]+)"', screen)[1]


direct_order = create_direct_order(customer)
submit("sales/EditOrder/addItem", orderId=direct_order, productId=product, quantity="2", unitAmount="100",
       discountPercent="10", itemTypeEnumId="ItemProduct")
total = check_pricing(direct_order, product, "32.40")
check_screen_total("EditOrder", direct_order, "Grand Total", total)
sql(f"update order_header set grand_total=200 where order_id='{direct_order}'; "
    f"update order_part set part_total=200 where order_id='{direct_order}'")
check_list_total("FindOrder", "orderNoSearch", direct_order, total)
assert_amounts(f"select grand_total from order_header where order_id='{direct_order}'", [200], "Order list is read-only")
checked_invoice(direct_order, "32.40")
check_pricing(direct_order, product, "32.40")
print("Direct order uses catalog GST. Concurrent manual 0% and 5% lines retained their chosen rates and separate 0.26 CGST + 0.26 SGST through invoicing.")

# Import-style fixture. Native Sales entry uses one part, so split its own saved lines into two
# parts to exercise older multi-part documents. This buyer isolates orphan-invoice checks.
buyer = "QCMP" + uuid.uuid4().hex[:14]
sql(f"insert into party(party_id,party_type_enum_id,owner_party_id) values('{buyer}','PtyPerson','AUDIT_QA_B'); "
    f"insert into person(party_id,first_name,last_name) values('{buyer}','Disposable','Multi-part buyer'); "
    f"insert into party_role(party_id,role_type_id) values('{buyer}','Customer')")
split_order = create_direct_order(buyer)
for qty in ("1", "2"):
    submit("sales/EditOrder/addItem", orderId=split_order, productId=product, quantity=qty, unitAmount="100",
           discountPercent="10", itemTypeEnumId="ItemProduct")
sql(f"insert into order_part(order_id,order_part_seq_id,vendor_party_id,customer_party_id,facility_id,settlement_term_id,status_id,part_total) "
    f"select order_id,'02',vendor_party_id,customer_party_id,null,settlement_term_id,status_id,212.40 "
    f"from order_part where order_id='{split_order}' and order_part_seq_id='01'; "
    f"update order_item set order_part_seq_id='02' where order_id='{split_order}' and quantity=2; "
    f"update order_part set part_total=106.20 where order_id='{split_order}' and order_part_seq_id='01'")
blocked = submit("sales/EditOrder/convertToInvoice", orderId=split_order)
assert "different customers, shops or payment terms" in blocked
invoice_count = f"select count(*) from invoice where to_party_id='{buyer}'"
assert sql(invoice_count) == "0" and sql(f"select count(*) from order_item_billing where order_id='{split_order}'") == "0"

sql(f"update order_part set facility_id='AUDIT_QA_FAC_B' where order_id='{split_order}' and order_part_seq_id='02'")
split_invoice = checked_invoice(split_order, "48.60", "270", line_count=2)
assert_amounts(f"select grand_total from order_header where order_id='{split_order}'", [Decimal("318.60")], "Two-part order")
assert sql(invoice_count) == "1"
assert sql(f"select count(*) from order_item_billing b join order_item o using(order_id,order_item_seq_id) "
           f"join invoice_item i using(invoice_id,invoice_item_seq_id) where b.order_id='{split_order}' "
           f"and i.invoice_id='{split_invoice}' and b.quantity=o.quantity and i.quantity=o.quantity "
           f"and i.taxable_amount=o.taxable_amount and i.total_tax_amount=o.total_tax_amount") == "2"

# A partial historical allocation must stay partial. Reposting must not invoice both parts again.
sql(f"update order_item_billing set quantity=1 where order_id='{split_order}' and quantity=2")
try:
    partial = submit("sales/EditOrder/convertToInvoice", orderId=split_order)
    assert "partial billing" in partial and sql(invoice_count) == "1"
    assert_amounts(f"select count(*),sum(quantity) from order_item_billing where order_id='{split_order}'",
                   [2, 2], "Previously billed quantity retained")
finally:
    sql(f"update order_item_billing b set quantity=o.quantity from order_item o where b.order_id='{split_order}' "
        "and b.order_id=o.order_id and b.order_item_seq_id=o.order_item_seq_id")
print("Two compatible parts billed once at INR 318.60. Mixed shops and previous partial billing both held for review.")

# A stored zero taxable amount is valid. A 100% discount must never fall back to the item's list price.
free_order = create_direct_order(customer)
submit("sales/EditOrder/addItem", orderId=free_order, productId=product, quantity="1", unitAmount="100",
       discountPercent="100", itemTypeEnumId="ItemProduct")
assert_amounts(f"select discount_amount,taxable_amount,total_tax_amount from order_item where order_id='{free_order}'",
               [100, 0, 0], "Fully discounted catalog item")
assert_amounts(f"select h.grand_total,p.part_total from order_header h join order_part p using(order_id) "
               f"where h.order_id='{free_order}'", [0, 0], "Fully discounted part and header")
check_screen_total("EditOrder", free_order, "Grand Total", Decimal("0"))
checked_invoice(free_order, "0", "0")
print("The fully discounted INR 100 catalog item produced a zero part, order and invoice.")
