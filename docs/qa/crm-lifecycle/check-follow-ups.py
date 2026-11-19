"""Exercise the disposable all-modules fixture over loopback. Set CRM_QA_PASSWORD to its demo password."""
import base64
import http.cookiejar
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = "http://127.0.0.1:" + str(int(os.environ.get("CRM_QA_PORT", "18919")))
HELPER = ROOT + "/apps/zenith/Crm/AllModulesQa"


def session(username):
    browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    auth = base64.b64encode((username + ":" + os.environ["CRM_QA_PASSWORD"]).encode()).decode()
    page = browser.open(urllib.request.Request(HELPER, headers={"Authorization": "Basic " + auth})).read().decode()
    token = re.search(r'name="moquiSessionToken"[^>]*value="([^"]+)"', page)
    assert token, "The disposable QA screen must be installed and initialized"

    def post(route, fields):
        data = urllib.parse.urlencode({"moquiSessionToken": token[1], **fields}).encode()
        try:
            response = browser.open(HELPER + "/" + route, data=data)
        except urllib.error.HTTPError as error:
            if error.headers.get_content_type() != "application/json":
                raise
            response = error
        with response:
            return json.load(response)

    return browser, post


def invoke(post, operation, **fields):
    return post("invoke", {"op": operation, "input": json.dumps(fields)})


def expect_success(response):
    assert not response.get("errors") and not response.get("validation"), response
    return response.get("result") or {}


def main():
    admin_browser, admin_post = session("john.doe")
    member_browser, member_post = session("audit.qa")
    admin_post("scope", {"organizationPartyId": "AUDIT_QA_A"})
    subject = "Disposable follow-up " + uuid.uuid4().hex[:12]
    item = expect_success(invoke(admin_post, "activity.schedule", activityType="Task", subject=subject,
                                 dueDate="2030-06-05 10:00:00"))
    activity_id = item["activityId"]
    expect_success(invoke(admin_post, "activity.reassign", activityId=activity_id, assignedToUserId="AUDIT_QA_USER_A"))
    mine = member_browser.open(ROOT + "/apps/zenith/Crm/Activities?view=mine").read().decode()
    assert subject in mine, "Assigned task missing from recipient queue"
    expect_success(invoke(member_post, "activity.reschedule", activityId=activity_id, dueDate="2030-06-06 10:00:00"))
    rejected = invoke(member_post, "activity.cancel", activityId=activity_id, note="   ")
    assert rejected.get("errors") or rejected.get("validation"), "Cancellation requires a reason"
    expect_success(invoke(member_post, "activity.cancel", activityId=activity_id, note="Customer withdrew request"))
    for operation, fields in [("activity.complete", {"outcome": "Done"}), ("activity.reschedule", {"dueDate": "2030-06-07 10:00:00"})]:
        assert invoke(member_post, operation, activityId=activity_id, **fields).get("errors"), operation
    detail = member_browser.open(ROOT + "/apps/zenith/Crm/ActivityDetail?activityId=" + activity_id).read().decode()
    for expected in [subject, "Reassigned", "Rescheduled", "Cancelled", "Customer withdrew request"]:
        assert expected in detail, expected
    history = admin_browser.open(ROOT + "/apps/zenith/Crm/Activities?view=cancelled").read().decode()
    assert subject in history, "Cancelled task missing from history"
    print("Passed assignment, recipient queue, reschedule, cancellation reason, terminal state and audit history.")


if __name__ == "__main__":
    main()
