"""Integration regression against the loopback disposable all-modules fixture."""
import base64
from concurrent.futures import ThreadPoolExecutor
from http.cookiejar import CookieJar
import json
import os
import re
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import build_opener, HTTPCookieProcessor, Request
from uuid import uuid4


base = os.environ.get("CRM_QA_URL", "http://127.0.0.1:18919").rstrip("/")
assert urlsplit(base).hostname in ("127.0.0.1", "localhost", "::1"), "Disposable loopback fixture required"
root = base + "/apps/zenith/"
tag = uuid4().hex[:10]


class Session:
    def __init__(self, username, entry="Crm/AllModulesQa"):
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))
        auth = base64.b64encode((username + ":" + os.environ["CRM_QA_PASSWORD"]).encode()).decode()
        response = self.opener.open(Request(root + entry, headers={"Authorization": "Basic " + auth}))
        html = response.read().decode()
        self.csrf = re.search(r'name="moquiSessionToken"[^>]*value="([^"]+)"', html)[1]

    def get(self, path, **params):
        return self.opener.open(root + path + "?" + urlencode(params)).read().decode()

    def post(self, path, **values):
        data = urlencode(dict(moquiSessionToken=self.csrf, **values)).encode()
        try:
            return self.opener.open(Request(root + path, data=data))
        except HTTPError as error:
            return error


user = Session("audit.qa")
foreign = Session("audit.b.qa")


def create(path, **values):
    response = user.post("Contacts/Customers/" + path, **values)
    assert "EditContact" in response.geturl(), "Shared Contacts creation failed"
    return parse_qs(urlsplit(response.geturl()).query)["partyId"][0]


def save(actor, target, person, designation, channel, primary):
    return actor.post("Crm/ContactDetail/saveContact", partyId=target, personPartyId=person,
                      designation=designation, preferredChannel=channel, primaryContact=primary)


def page(**values):
    return user.get("Crm/ContactDetail", partyId=company, **values)


def person_row(html, name):
    return next(row for row in re.findall(r"<tr\b.*?</tr>", html, re.S | re.I) if name in row)


def check(label, passed):
    assert passed, label
    print("PASS", label, flush=True)


company = create("createOrganization", organizationName="QA business " + tag)
a_name, b_name = "Alice" + tag, "Basim" + tag
email = tag + "@example.com"
phone = "8" + str(int(tag, 16)).zfill(9)[-9:]
first = create("createPerson", firstName=a_name, emailAddress=email, contactNumber=phone)
second = create("createPerson", firstName=b_name)
choices = json.loads(user.get("Crm/ContactDetail/findAccountPerson", partyId=company, term=a_name))
check("Picker resolves the existing ERP person", any(r["value"] == first for r in choices))
check("Foreign fixture person is excluded from the picker", not json.loads(user.get(
    "Crm/ContactDetail/findAccountPerson", partyId=company, term="AUDIT_QA_CUST_B")))
save(user, company, first, "Buyer", "Email", "Y")
save(user, company, first, "Buyer", "Email", "Y")
detail = page()
row = person_row(detail, a_name)
check("Native contact details, primary flag and preferences render together",
      all(value in row for value in [email, phone, "Buyer", "Email", "Yes"]))
check("Saving the same link twice displays one row", sum(a_name in r for r in re.findall(r"<tr\b.*?</tr>", detail, re.S)) == 1)
save(user, company, second, "Director", "Phone", "Y")
detail = page()
check("Changing the primary contact preserves both people and demotes the first",
      "Yes" in person_row(detail, b_name) and "Yes" not in person_row(detail, a_name))
edit = page(editPersonId=second)
check("Editing an existing contact loads its saved designation", 'value="Director"' in edit)
save(user, company, second, "Approver", "SMS", "Y")
save(user, company, second, "Invalid override", "CarrierPigeon", "Y")
save(foreign, company, second, "Foreign override", "Phone", "N")
save(user, company, "AUDIT_QA_CUST_B", "Foreign person", "Phone", "Y")
detail = page()
row = person_row(detail, b_name)
check("Saved preferences survive invalid channels and foreign write attempts",
      all(v in row for v in ["Approver", "SMS", "Yes"]) and not any(
          v in detail for v in ["Foreign override", "Foreign person", "Invalid override"]))
if os.environ.get("CRM_QA_RESTRICTED_USER"):
    restricted = Session(os.environ["CRM_QA_RESTRICTED_USER"], "MyNotifications")
    save(restricted, company, second, "Restricted override", "Phone", "N")
    check("Staff without the Contacts grant cannot change the relationship",
          "Restricted override" not in page() and "Yes" in person_row(page(), b_name))

other_session = Session("audit.qa")
with ThreadPoolExecutor(max_workers=2) as pool:
    first_save = pool.submit(save, user, company, first, "Buyer", "Email", "Y")
    second_save = pool.submit(save, other_session, company, second, "Approver", "SMS", "Y")
    first_save.result()
    second_save.result()
detail = page()
check("Simultaneous primary selections leave exactly one primary contact",
      sum("Yes" in person_row(detail, name) for name in (a_name, b_name)) == 1)
