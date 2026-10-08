import java.sql.*;
import java.nio.charset.StandardCharsets;

/** Independent SELECT-only probe; accepts only the named disposable loopback runtime. */
public class PosReferenceDbProbe {
    static String json(String value) {
        return value == null ? "null" : "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") + "\"";
    }
    public static void main(String[] args) throws Exception {
        String url=System.getenv("POS_REFERENCE_DB_URL");
        if (!"jdbc:h2:tcp://127.0.0.1:19097/mem:purchase-pricing-qa;IFEXISTS=TRUE".equals(url)) throw new IllegalArgumentException("Disposable loopback database required");
        String sql=new String(System.in.readAllBytes(), StandardCharsets.UTF_8).trim();
        if (!sql.toUpperCase().startsWith("SELECT ") || sql.contains(";")) throw new IllegalArgumentException("One SELECT required");
        try (Connection connection=DriverManager.getConnection(url,"sa", "")) {
            connection.setReadOnly(true);
            try (Statement statement=connection.createStatement(); ResultSet result=statement.executeQuery(sql)) {
                ResultSetMetaData meta=result.getMetaData(); StringBuilder output=new StringBuilder("["); boolean first=true;
                while (result.next()) {
                    if (!first) output.append(','); first=false; output.append('{');
                    for (int i=1;i<=meta.getColumnCount();i++) { if(i>1) output.append(','); output.append(json(meta.getColumnLabel(i).toLowerCase())).append(':').append(json(result.getString(i))); }
                    output.append('}');
                }
                System.out.println(output.append(']'));
            }
        }
    }
}
