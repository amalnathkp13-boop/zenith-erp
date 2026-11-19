"""Verify private native reminders against the disposable all-modules fixture. Set CRM_QA_PASSWORD and pass the local PostgreSQL container."""
import re
import runpy
import subprocess
import sys
import time
import urllib.parse
import uuid
from pathlib import Path


def main(container):
    def sql(statement):
        return subprocess.run(
            ["docker", "exec", "-i", container, "sh", "-c",
             'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
            input=statement, text=True, check=True, capture_output=True
        ).stdout.strip()

    assert sql("select count(*) from user_account where user_id in ('AUDIT_QA_REP_A','AUDIT_QA_USER_B','AUDIT_QA_NO_CRM_A')") == "3"
    assert sql("select cron_expression from service_job where job_name='zenith_CrmDueFollowUps' and paused='N'") == "0 * * * * ?"
    followups = runpy.run_path(str(Path(__file__).with_name("check-follow-ups.py")))
    browser, _ = followups["session"]("john.doe")
    route = followups["ROOT"] + "/apps/system/ServiceJob/Jobs/ServiceJobDetail"
    job = {"jobName": "zenith_CrmDueFollowUps"}
    page = browser.open(route + "?" + urllib.parse.urlencode(job)).read().decode()
    token = re.search(r'name="moquiSessionToken"[^>]*value="([^"]+)"', page)[1]

    def run_job():
        ran = "from service_job_run where job_name='zenith_CrmDueFollowUps' and end_time is not null"
        before = int(sql("select count(*) " + ran))
        data = urllib.parse.urlencode({**job, "moquiSessionToken": token}).encode()
        browser.open(route + "/runJob", data=data, timeout=30).close()
        for _ in range(60):
            if int(sql("select count(*) " + ran)) > before:
                error = sql("select coalesce(errors,'') " + ran + " order by end_time desc limit 1")
                assert not error, error
                return
            time.sleep(0.5)
        raise AssertionError("Native service job did not finish")

    prefix = "DR" + uuid.uuid4().hex[:12]
    rows = [
        # Suffix, organization, user, status, due offset in days.
        ("due", "A", "AUDIT_QA_USER_A", "Scheduled", -1),
        ("future", "A", "AUDIT_QA_USER_A", "Scheduled", 2),
        ("done", "A", "AUDIT_QA_USER_A", "Completed", -1),
        ("cancel", "A", "AUDIT_QA_USER_A", "Cancelled", -1),
        ("foreign", "A", "AUDIT_QA_USER_B", "Scheduled", -1),
        ("norole", "A", "AUDIT_QA_NO_CRM_A", "Scheduled", -1),
        ("optout", "A", "AUDIT_QA_REP_A", "Scheduled", -1),
    ]
    prefs = "where topic='CrmFollowUpDue' and user_id in ('AUDIT_QA_REP_A','AUDIT_QA_USER_B')"
    assert sql("select count(*) from notification_topic_user " + prefs) == "0", "Use fresh QA notification preferences"
    values = [f"('{prefix}{name}','AUDIT_QA_{org}','{owner}','{status}',now() + interval '{offset} days','Private QA task')"
              for name, org, owner, status, offset in rows]
    sql("begin; insert into notification_topic_user(topic,user_id,receive_notifications,all_notifications) values "
        "('CrmFollowUpDue','AUDIT_QA_REP_A','N','N'),('CrmFollowUpDue','AUDIT_QA_USER_B','Y','Y');"
        "insert into crm_activity(activity_id,organization_party_id,assigned_to_user_id,status_id,due_date,subject) values "
        + ",".join(values) + "; commit;")

    inbox = (" from notification_message m join notification_message_user u using(notification_message_id) "
             f"where m.topic='CrmFollowUpDue' and m.message_json::jsonb->>'recordId' like '{prefix}%'")
    marker = f" from crm_follow_up_reminder where activity_id like '{prefix}%'"
    try:
        run_job()
        assert sql("select u.user_id||'|'||(m.message_json::jsonb->>'recordId')" + inbox) == f"AUDIT_QA_USER_A|{prefix}due"
        assert sql("select count(*)" + marker) == "4"
        assert sql("select count(*)" + marker + " and notification_message_id is null") == "3"
        recipient, _ = followups["session"]("audit.qa")
        detail = followups["ROOT"] + "/apps/zenith/Crm/ActivityDetail?activityId=" + prefix
        assert "Delivered to the assignee" in recipient.open(detail + "due").read().decode()
        assert "Awaiting the due-time reminder" in recipient.open(detail + "future").read().decode()
        run_job()
        assert sql("select count(*)" + inbox) == "1", "Repeating the same scheduled run sent a duplicate"
        sql(f"update crm_activity set due_date=due_date + interval '1 minute' where activity_id='{prefix}due'")
        run_job()
        assert sql("select count(*)" + inbox + " and u.user_id='AUDIT_QA_USER_A'") == "2"
        assert sql("select count(*)" + inbox) == "2"
        print("Native service job passed due, future, completed, cancelled, tenant, role, opt-out, private subscription, replay and reschedule checks.")
    finally:
        sql("begin; delete from notification_topic_user " + prefs + ";"
            f"delete from crm_follow_up_reminder where activity_id like '{prefix}%';"
            f"delete from crm_activity where activity_id like '{prefix}%';"
            f"delete from notification_message_user where notification_message_id in (select notification_message_id from notification_message "
            f"where topic='CrmFollowUpDue' and message_json::jsonb->>'recordId' like '{prefix}%');"
            f"delete from notification_message where topic='CrmFollowUpDue' and message_json::jsonb->>'recordId' like '{prefix}%';commit;")


if __name__ == "__main__":
    main(sys.argv[1])
