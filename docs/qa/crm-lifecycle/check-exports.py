"""Set CRM_QA_PASSWORD and run against a disposable all-modules PostgreSQL container."""
import base64
import csv
import http.cookiejar
import io
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from xml.etree import ElementTree


def main(container):
    base = "http://127.0.0.1:" + str(int(os.environ.get("CRM_QA_PORT", "18919")))

    def sql(statement):
        return subprocess.run(["docker", "exec", "-i", container, "sh", "-c",
                               'exec psql -X -Atq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
                              input=statement, check=True, text=True, capture_output=True).stdout.strip()

    assert sql("select count(*) from party where party_id in ('AUDIT_QA_A','AUDIT_QA_B')") == "2"
    assert sql("select count(*) from user_group_permission where user_permission_id='ZENITH_CRM_EXPORT'"
               " and user_group_id in ('ADMIN','ZENITH_ADMIN','ZENITH_SALES_MGR')") == "3"

    def session(username):
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        auth = base64.b64encode((username + ":" + os.environ["CRM_QA_PASSWORD"]).encode()).decode()
        opener.open(urllib.request.Request(base + "/apps/zenith/Crm/Leads", headers={"Authorization": "Basic " + auth})).close()
        return opener

    def workbook_rows(data):
        with zipfile.ZipFile(io.BytesIO(data)) as workbook:
            sheet = ElementTree.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
            return [[c.findtext(".//{*}t", default="") for c in row.findall("{*}c")]
                    for row in sheet.findall(".//{*}row")]

    prefix = "EX" + uuid.uuid4().hex[:10]
    expected = {prefix + str(i) for i in range(25)}
    sql("insert into lead(lead_id,organization_party_id,first_name,company_name,status_id) "
        f"select '{prefix}'||i, 'AUDIT_QA_A',concat('Seller',i),'{prefix}','LeadNew' from generate_series(0,24) i;"
        f"insert into lead(lead_id,organization_party_id,first_name,company_name,status_id) values "
        f"('{prefix}B','AUDIT_QA_B','Foreign','{prefix}','LeadNew'),('{prefix}X','AUDIT_QA_A','Other','Unmatched','LeadNew');")
    try:
        admin, rep = session("audit.qa"), session("audit.rep.qa")
        for shell in ("apps", "qapps"):
            route = base + "/" + shell + "/zenith/Crm/Leads"
            view = route + (".qvt" if shell == "qapps" else "")
            filtered = admin.open(view + "?" + urllib.parse.urlencode({"companyName": prefix, "period": "all"})).read().decode()
            links = re.findall(r'href="([^"]*exportList[^"]*)"', filtered)
            assert any("companyName=" + prefix in link and "period=all" in link for link in links), shell + " dropped search parameters"
            assert b"Export CSV" not in rep.open(view).read(), shell + " exposed export control"
            for fmt in ("csv", "xlsx"):
                query = urllib.parse.urlencode(dict(dataset="leadList", format=fmt, companyName=prefix, companyName_op="equals",
                                                    pageIndex=2, pageSize=1, organizationPartyId="AUDIT_QA_B"))
                url = route + "/exportList?" + query
                with admin.open(url) as response:
                    assert "attachment" in response.headers.get("Content-Disposition", ""), (shell, fmt)
                    data = response.read()
                rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig")))) if fmt == "csv" else workbook_rows(data)
                assert rows and rows[0][0] == "Lead Id", (shell, fmt, rows[:1])
                assert {r[0] for r in rows[1:]} == expected, (shell, fmt, len(rows))
                for denied in (url, route + "?renderMode=" + fmt):
                    try:
                        rep.open(denied).close()
                    except urllib.error.HTTPError as error:
                        assert error.code == 403, (shell, fmt, error.code)
                    else:
                        raise AssertionError("Restricted user received a CRM download")
        # Grant export to the fixture's lead-only role and revoke it again through native group administration.
        groups = base + "/apps/system/Security/UserGroup/UserGroupDetail"
        group = "ZENITH_ORG_QA_LEADS_A"
        params = {"userGroupId": group, "userPermissionId": "ZENITH_CRM_EXPORT", "fromDate": "2020-01-02 00:00:00"}
        assert sql(f"select count(*) from user_group_permission where user_group_id='{group}' and user_permission_id='ZENITH_CRM_EXPORT'") == "0"
        sys_admin = session("john.doe")
        form = sys_admin.open(groups + "?userGroupId=" + group).read().decode()
        params["moquiSessionToken"] = re.search(r'name="moquiSessionToken"[^>]*value="([^"]+)"', form)[1]
        payload = urllib.parse.urlencode(params).encode()
        try:
            sys_admin.open(groups + "/createUserGroupPermission", data=payload).close()
            limited = session("audit.lead.only.qa")
            endpoint = base + "/apps/zenith/Crm/Leads/exportList?" + urllib.parse.urlencode(
                {"dataset": "leadList", "format": "csv", "companyName": prefix})
            with limited.open(endpoint) as response:
                assert {r[0] for r in list(csv.reader(io.StringIO(response.read().decode("utf-8-sig"))))[1:]} == expected
        finally:
            sys_admin.open(groups + "/deleteUserGroupPermission", data=payload).close()
        assert sql(f"select count(*) from user_group_permission where user_group_id='{group}' and user_permission_id='ZENITH_CRM_EXPORT'") == "0"
        print("CRM exports passed on /apps and /qapps. Both formats retained all 25 matching tenant records. The representative could view leads but could not export.")
    finally:
        sql(f"delete from lead where lead_id like '{prefix}%' and organization_party_id in ('AUDIT_QA_A','AUDIT_QA_B')")


if __name__ == "__main__":
    main(sys.argv[1])
