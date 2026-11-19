"""Exercise the owner's follow-up rules on an initialized disposable loopback tenant."""
import os
import re
import subprocess
import urllib.parse
import uuid
from urllib.error import HTTPError
from pathlib import Path
from runpy import run_path

helpers = run_path(str(Path(__file__).with_name("check-follow-ups.py")))
root, session = helpers["ROOT"], helpers["session"]
invoke, success = helpers["invoke"], helpers["expect_success"]
db = os.environ["CRM_QA_DB_CONTAINER"]
suffix = uuid.uuid4().hex[:10]
subject = "Call back " + suffix


def scalar(sql):
    return subprocess.check_output(
        ["docker", "exec", db, "psql", "-U", "moqui", "-d", "moqui", "-Atc", sql],
        text=True,
    ).strip()


owner, post = session("audit.qa")
other_owner, other_post = session("audit.b.qa")
seller, _ = session("audit.rep.qa")
form_url = root + "/apps/zenith/Crm/Workflows"


def configure(browser, enabled):
    form = browser.open(form_url).read().decode()
    token = re.search(r'name="moquiSessionToken"[^>]*value="([^"]+)"', form)
    if not token:
        return
    fields = {"moquiSessionToken": token[1], "triggerId": "lead-created",
              "taskSubject": subject, "daysUntilDue": "2", "isActive": enabled}
    browser.open(form_url + "/saveWorkflow", urllib.parse.urlencode(fields).encode()).read()


def intake(account_post, title, **params):
    data = dict(firstName=title, leadSourceId="Website", email=title + "@example.test", externalSubmissionId=title, **params)
    return success(invoke(account_post, "lead.create", **data))["leadId"]


def tasks(lead_id):
    assert re.fullmatch(r'[a-zA-Z0-9_-]+', lead_id)
    return scalar("select subject || '|' || assigned_to_user_id from crm_activity where lead_id='" +
                  lead_id + "' and status_id='Scheduled' order by activity_id")


assert "Set up a follow-up" in owner.open(form_url).read().decode()
configure(owner, "Y")
try:
    assert scalar("select is_active from crm_lead_follow_up_rule where organization_party_id='AUDIT_QA_A'") == "Y"
    lead = intake(post, "OwnerRule" + suffix, assignedToUserId="AUDIT_QA_REP_A")
    assert intake(post, "OwnerRule" + suffix, assignedToUserId="AUDIT_QA_REP_A") == lead
    assert tasks(lead) == subject + "|AUDIT_QA_REP_A", tasks(lead)
    assert scalar("select (due_date::date - activity_date::date) from crm_activity where lead_id='" + lead + "'") == "2"
    manual = intake(post, "Manual" + suffix, followUpSubject="Customer chose a date", followUpDue="2030-03-10 10:00:00")
    assert tasks(manual) == "Customer chose a date|AUDIT_QA_USER_A", tasks(manual)
    task_id = scalar("select activity_id from crm_activity where lead_id='" + lead + "' and status_id='Scheduled'")
    history = owner.open(form_url).read().decode()
    assert re.search(r'ActivityDetail[^"<>]*activityId=' + re.escape(task_id) + r'\b', history), "Generated task missing from owner history"
    assert subject not in other_owner.open(form_url).read().decode()
    assert not tasks(intake(other_post, "OtherOrg" + suffix))
    try:
        assert "Set up a follow-up" not in seller.open(form_url).read().decode()
    except HTTPError as denied:
        assert denied.code == 403, denied.code
    success(invoke(post, "activity.log", activityType="SMS", subject=suffix, leadId=lead))
    assert scalar("select count(*) from crm_activity where activity_type='SMS' and lead_id='" + lead + "'") == "1"
finally:
    configure(owner, "N")
assert not tasks(intake(post, "Paused" + suffix))
assert tasks(lead) == subject + "|AUDIT_QA_REP_A"
print("Passed owner rules, seller assignment, due date, retry, manual override, tenant isolation, pause, and SMS log.")
