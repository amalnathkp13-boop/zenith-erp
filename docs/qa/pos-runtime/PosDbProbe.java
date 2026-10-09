import java.sql.*;
import java.nio.charset.StandardCharsets;
public class PosDbProbe {
    static String json(String s) {
        if (s == null) return "null";
        return "\""+s.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n").replace("\r","\\r").replace("\t","\\t")+"\"";
    }
    public static void main(String[] args) throws Exception {
        String url=System.getenv("POS_QA_DB_URL");
        if (!"jdbc:h2:tcp://127.0.0.1:19096/mem:pos-qa;IFEXISTS=TRUE".equals(url)) throw new IllegalArgumentException("Disposable POS memory DB required");
        String sql=new String(System.in.readAllBytes(),StandardCharsets.UTF_8).trim();
        if (!sql.toUpperCase().startsWith("SELECT ")) throw new IllegalArgumentException("Read-only SELECT only");
        try (var c=DriverManager.getConnection(url,"sa", "")) {
            c.setReadOnly(true);
            try (var st=c.createStatement();var r=st.executeQuery(sql)) {
                var m=r.getMetaData();var out=new StringBuilder("[");boolean first=true;
                while(r.next()) { if(!first)out.append(',');first=false;out.append('{');for(int i=1;i<=m.getColumnCount();i++){if(i>1)out.append(',');out.append(json(m.getColumnLabel(i).toLowerCase())).append(':').append(json(r.getString(i)));}out.append('}'); }
                System.out.println(out.append(']'));
            }
        }
    }
}
