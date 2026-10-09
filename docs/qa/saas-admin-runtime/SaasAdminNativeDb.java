// Fixture-only database adapter. Never deploy; fixed loopback memory DB, no live credentials.
import java.sql.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
public class SaasAdminNativeDb {
  static String esc(String s) { return "\""+s.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n").replace("\r","\\r").replace("\t","\\t")+"\""; }
  public static void main(String[] args) throws Exception {
    String sql=new String(System.in.readAllBytes(),StandardCharsets.UTF_8).trim();
    if(!"true".equals(System.getenv("SAASADMIN_NATIVE_QA")) || sql.contains(";")) throw new IllegalArgumentException("Disposable single statement only");
    try(Connection c=DriverManager.getConnection("jdbc:h2:tcp://127.0.0.1:19097/mem:purchase-pricing-qa;IFEXISTS=TRUE","sa","")) {
      try(Statement s=c.createStatement();ResultSet r=s.executeQuery("SELECT COUNT(*) FROM SAAS_TENANT WHERE TENANT_ID='SAASADMIN_QA_S'")) { r.next();if(r.getInt(1)!=1)throw new IllegalStateException("Missing synthetic fixture"); }
      if(!sql.toUpperCase(Locale.ROOT).startsWith("SELECT ")) {
        boolean allowed=sql.matches("(?is)update saas_plan set is_active='[YN]' where plan_id='ENTERPRISE'")
          || sql.matches("(?is)update saas_tenant set status_id='SaasTenant(?:Cancelled|Active)' where tenant_id='SAASADMIN_QA_B'")
          || sql.matches("(?is)update user_account set disabled='[YN]' where user_id='SAASADMIN_QA_DISABLED'")
          || sql.matches("(?is)update saas_invoice set status_id='SiOverdue',due_date=.* where saas_invoice_id='SAASADMIN_QA_S'")
          || (sql.toLowerCase(Locale.ROOT).startsWith("insert into saas_subscription(") && sql.contains("'SAASADMIN_QA_STALE_TRIAL','SAASADMIN_QA_S'"));
        var m=java.util.regex.Pattern.compile("(?is)^update saas_subscription set (?:start_date|end_date)=.* where subscription_id='([A-Za-z0-9_]+)'$").matcher(sql);
        if(m.matches()) {
          try(PreparedStatement p=c.prepareStatement("SELECT COUNT(*) FROM SAAS_SUBSCRIPTION WHERE SUBSCRIPTION_ID=? AND TENANT_ID='SAASADMIN_QA_S'")) { p.setString(1,m.group(1));try(ResultSet r=p.executeQuery()){r.next();allowed=r.getInt(1)==1;} }
        }
        if(!allowed)throw new IllegalArgumentException("Fixture mutation outside captured selectors");
        try(Statement s=c.createStatement()){s.executeUpdate(sql);}System.out.print("[]");return;
      }
      try(Statement s=c.createStatement();ResultSet r=s.executeQuery(sql)) {
        var md=r.getMetaData();var rows=new ArrayList<String>();
        while(r.next()){var fields=new ArrayList<String>();for(int i=1;i<=md.getColumnCount();i++){Object v=r.getObject(i);fields.add(esc(md.getColumnLabel(i).toLowerCase(Locale.ROOT))+":"+(v==null?"null":esc(v.toString())));}rows.add("{"+String.join(",",fields)+"}");}
        System.out.print("["+String.join(",",rows)+"]");
      }
    }
  }
}
