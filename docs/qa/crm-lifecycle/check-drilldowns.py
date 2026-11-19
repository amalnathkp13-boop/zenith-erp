"""Check CRM dashboard links against dated records in the disposable all-modules fixture.

Set CRM_QA_PASSWORD and run with the fixture's PostgreSQL container name as the argument.
The loopback URL and optional port come from check-follow-ups.py.
"""
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
import html
from pathlib import Path
import re
import runpy
import subprocess
import sys
import uuid
from zoneinfo import ZoneInfo

fixture = runpy.run_path(str(Path(__file__).with_name("check-follow-ups.py")))
browser, _ = fixture["session"]("audit.qa")
root = fixture["ROOT"] + "/apps/zenith/Crm/"
prefix = "KD" + uuid.uuid4().hex[:10]


def sql(statement):
    return subprocess.check_output(
        ["docker", "exec", sys.argv[1], "psql", "-U", "moqui", "-d", "moqui",
         "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement], text=True).strip()


def read(url):
    return browser.open(url, timeout=40).read().decode()


def card(page, title):
    match = re.search(r'>' + re.escape(title) + r'</span>\s*<h4[^>]*>(.*?)</h4>.*?href="([^"]+)"',
                      page, re.S)
    assert match, title
    return html.unescape(match[1]), html.unescape(match[2])


# Moqui's disposable fixture stores timestamps in UTC. The test user has a separate timezone.
zone = ZoneInfo(sql("select time_zone from user_account where username='audit.qa'"))
today = datetime.now(zone).date()
monday = today - timedelta(days=today.weekday())
month = today.replace(day=1)


def midnight(day):
    return datetime.combine(day, time(), zone)

local_dates = [midnight(today) - timedelta(seconds=1), midnight(today) + timedelta(seconds=1),
               midnight(today + timedelta(days=1)), midnight(monday) - timedelta(seconds=1),
               midnight(month) - timedelta(seconds=1)]

def db_time(value):
    return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


try:
    for i, value in enumerate(local_dates):
        stamp = db_time(value)
        won_stamp = db_time(local_dates[(i + 1) % len(local_dates)])
        lead_status = ["LeadNew", "LeadConverted", "LeadQualified"][i % 3]
        sql(f"""insert into lead(lead_id,first_name,organization_party_id,status_id,created_date)
                values ('{prefix}L{i}','{prefix} lead {i}','AUDIT_QA_A','{lead_status}','{stamp}');
                insert into sales_opportunity(sales_opportunity_id,opportunity_name,organization_party_id,
                    opportunity_stage_id,estimated_close_date,won_date,currency_uom_id,estimated_amount,estimated_probability)
                values ('{prefix}O{i}','{prefix} open {i}','AUDIT_QA_A','SoProspecting','{stamp}',null,'INR',120,0.25),
                       ('{prefix}W{i}','{prefix} won {i}','AUDIT_QA_A','SoClosedWon','{stamp}','{won_stamp}','INR',120,1);""")

    for period, first in [("today", today), ("week", monday), ("month", month), ("all", None)]:
        window = "" if not first else " and FIELD >= '{}' and FIELD < '{}'".format(
            db_time(midnight(first)), db_time(midnight(today + timedelta(days=1))))
        leads = " from lead where organization_party_id='AUDIT_QA_A'" + window.replace("FIELD", "created_date")
        qualified = leads + " and status_id in ('LeadQualified','LeadConverted')"
        deals = " from sales_opportunity where organization_party_id='AUDIT_QA_A'"
        open_deals = deals + " and opportunity_stage_id not in ('SoClosedWon','SoClosedLost')" + window.replace("FIELD", "estimated_close_date")
        won_deals = deals + " and opportunity_stage_id='SoClosedWon'" + window.replace("FIELD", "won_date")
        count = int(sql("select count(*)" + leads))
        qualified_count = int(sql("select count(*)" + qualified))
        dashboard = read(root + "Dashboard?period=" + period)
        for title, cohort, query, id_column in [
            ("New leads", "created", leads, "lead_id"),
            ("Qualified rate", "qualified", qualified, "lead_id"),
            ("Weighted pipeline", "open", open_deals, "sales_opportunity_id"),
            ("Open pipeline value", "open", open_deals, "sales_opportunity_id"),
            ("Closed-won deal value", "won", won_deals, "sales_opportunity_id"),
        ]:
            metric, link = card(dashboard, title)
            assert f"period={period}" in link and f"cohort={cohort}" in link, link
            target = read(link + "&pageSize=500")
            assert "Back to dashboard" in target and f"Dashboard?period={period}" in target
            expected = set(sql("select " + id_column + query).splitlines())
            key = "leadId" if id_column == "lead_id" else "salesOpportunityId"
            # Compare actual row links independently of board cards or application menu links.
            table = target.split('id="LeadListForm_hdialog"' if key == "leadId" else 'Manage opportunities</h5>')[1]
            visible = set(re.findall(r'/Edit(?:Lead|Opportunity)\?' + key + r'=([^"&]+)"', table))
            assert expected == visible, (period, title, expected - visible, visible - expected)
            if cohort == "created":
                assert metric == str(count), (period, title, metric, count)
            elif cohort == "qualified":
                assert metric == f"{qualified_count * 100 // count if count else 0}%"
            else:
                amount = "coalesce(estimated_amount,0)"
                if title == "Weighted pipeline":
                    amount += "*coalesce(estimated_probability,0)"
                rows = sql("select coalesce(currency_uom_id,'Unspecified'),sum(" + amount + ")" + query +
                           " group by 1 order by 1").splitlines()
                totals = [f"{currency} {Decimal(value):,.2f}" for currency, value in (row.split("|") for row in rows)]
                assert metric == (" / ".join(totals) or "—"), (title, metric, totals)
        if period == "today":
            assert "Manage follow-up rules" in dashboard, "Organization owner should reach the rules from the follow-up queue"
            _, link = card(dashboard, "Open pipeline value")
            filtered = read(link + "&searchText=" + prefix)
            table = filtered.split("Manage opportunities</h5>")[1]
            filtered_ids = set(re.findall(r'/EditOpportunity\?salesOpportunityId=([^"&]+)"', table))
            matching_ids = set(sql("select sales_opportunity_id" + open_deals +
                                   f" and opportunity_name like '{prefix}%'").splitlines())
            assert matching_ids and matching_ids == filtered_ids, "Pipeline search and cohort must apply to the same rows"
        print(f"{period}: five dashboard values, links, record sets and return period passed.", flush=True)
finally:
    sql(f"delete from sales_opportunity where sales_opportunity_id like '{prefix}%'; delete from lead where lead_id like '{prefix}%';")
