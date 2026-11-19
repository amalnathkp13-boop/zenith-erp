"""Exercise real CRM and Sales forms in a disposable all-modules fixture.

Set CRM_QA_PASSWORD to the disposable fixture password, then run:
python3 check-opportunity.py http://127.0.0.1:18919 postgres-container
"""
import base64
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import http.cookiejar
import os
import re
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
import uuid

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

submit("Crm/Pipeline/createOpportunity", **create)
opportunity = sql(f"select sales_opportunity_id from sales_opportunity where opportunity_name='{name}' and organization_party_id='AUDIT_QA_A'")
assert opportunity, "Opportunity must persist under the signed-in organization"
assert sql(f"select next_step from sales_opportunity where sales_opportunity_id='{opportunity}'") == create["nextStep"]
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
submit("sales/EditQuotation/createRevision", orderId=order)
assert sql(f"select count(*) from sales_opportunity_order where sales_opportunity_id='{opportunity}'") == "2"
customer_page = page("Crm/ContactDetail", {"partyId": customer})
for target, key in (("FindQuotation", "customerPartyId"), ("FindOrder", "customerPartyId"), ("FindInvoice", "toPartyId")):
    assert f"/sales/{target}?{key}={customer}" in customer_page
print("Native quotation, customer and currency, retry, revision and customer transaction navigation passed.")

submit("sales/EditQuotation/addItem", orderId=order, productId="AUDIT_QA_PRODUCT_A", quantity="2",
       unitAmount="100", discountPercent="10", taxPercentage="0", itemTypeEnumId="ItemProduct")
line = sql(f"select quantity,unit_amount,discount_amount,taxable_amount,total_tax_amount from order_item where order_id='{order}' and product_id='AUDIT_QA_PRODUCT_A'")
assert [Decimal(value) for value in line.split("|")] == [2, 100, 20, 180, 0]
submit("sales/EditQuotation/convertToOrder", orderId=order)
assert sql(f"select document_type from order_header where order_id='{order}'") == "SALES_ORDER"
assert "Sales order " in page("Crm/EditOpportunity", {"salesOpportunityId": opportunity})
submit("sales/EditOrder/convertToInvoice", orderId=order)
invoice = sql(f"select distinct invoice_id from order_item_billing where order_id='{order}'")
assert invoice and sql(f"select from_party_id || '|' || to_party_id from invoice where invoice_id='{invoice}'") == "AUDIT_QA_A|AUDIT_QA_CUST_A"
assert [Decimal(v) for v in sql(f"select total_taxable_amount,total_tax_amount,invoice_total from invoice where invoice_id='{invoice}'").split("|")] == [180, 0, 180]
assert "Payment Details" in page("sales/EditInvoice", {"invoiceId": invoice})
assert f"/sales/EditInvoice?invoiceId={invoice}" in page("Crm/EditOpportunity", {"salesOpportunityId": opportunity})
submit("sales/EditInvoice/updateInvoice", invoiceId=invoice, statusId="InvoiceFinalized")
assert sql(f"select unpaid_total > 0 from invoice where invoice_id='{invoice}'") == "t"
assert "Outstanding · INR" in page("Crm/ContactDetail", {"partyId": customer})
submit("sales/EditInvoice/markPaidCash", invoiceId=invoice)
assert sql(f"select status_id || '|' || (unpaid_total = 0) from invoice where invoice_id='{invoice}'") == "InvoicePmtRecvd|true"
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
line_sql = f"select taxable_amount,total_tax_amount,taxable_amount+total_tax_amount from order_item where order_id='{order}' and product_id='AUDIT_QA_CRM_GST18'"
expected = [180, Decimal("32.40"), Decimal("212.40")]
assert [Decimal(v) for v in sql(line_sql).split("|")] == expected
submit("sales/EditQuotation/convertToOrder", orderId=order)
assert [Decimal(v) for v in sql(line_sql).split("|")] == expected
submit("sales/EditOrder/convertToInvoice", orderId=order)
invoice = sql(f"select distinct invoice_id from order_item_billing where order_id='{order}'")
invoice_amounts = sql(f"select total_taxable_amount,total_tax_amount,invoice_total from invoice where invoice_id='{invoice}'")
assert [Decimal(v) for v in invoice_amounts.split("|")] == expected, invoice_amounts
header = sql(f"select grand_total from order_header where order_id='{order}'")
print("Configured GST agrees across quote and order lines and the ERP invoice: 180.00 + 32.40 = 212.40.")
print(f"Native order header grand total: {header}. Compare with the invoiced total of 212.40.")
