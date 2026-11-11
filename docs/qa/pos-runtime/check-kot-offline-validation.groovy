// Run the note guard and credit-date step from the actual replay service without a running ERP.
// From the repository root, run with the Groovy jars from an unpacked Moqui runtime:
// java -cp "<Moqui runtime>/WEB-INF/lib/*" groovy.ui.GroovyMain docs/qa/pos-runtime/check-kot-offline-validation.groovy component/zenith-erp-pos/service/zenith/pos/KotOfflineServices.xml
import groovy.xml.XmlParser
import java.sql.Date
import java.time.OffsetDateTime
import java.time.ZoneId

class CreditRow {
    Integer creditDays
    Date creditDueDate
    int updates
    void update() { updates++ }
}

def source = new XmlParser().parse(new File(args[0])).service
    .find { it.@verb == 'import' && it.@noun == 'KotSale' }.actions.script.text()
def between = { String from, String to ->
    int start = source.indexOf(from)
    int end = source.indexOf(to, start)
    assert start >= 0 && end >= start
    source.substring(start, end)
}
def noteGuard = between('def notes=', 'def quote')
[500, 501].each { length ->
    def errors = []
    def binding = new Binding(sale:[notes:'n' * length], customer:[:], customerId:null,
        reject:{ String reason -> errors.add(reason) })
    new GroovyShell(binding).evaluate(noteGuard)
    assert errors.isEmpty() == (length == 500) : "Wrong offline validation for a note of length $length"
}

def checkoutTail = between('if (amount(bill.changeAmount)!=change)', '                } else {\n                    def display')
def zone = ZoneId.of('Asia/Kolkata')
def issuedAt = OffsetDateTime.parse('2026-11-11T23:59:30+05:30').toInstant().toEpochMilli()
def syncDay = OffsetDateTime.parse('2026-11-12T00:01:00+05:30').toLocalDate()
def replay = { String method, Integer days ->
    def row = new CreditRow(creditDays:days, creditDueDate:days == null ? null : Date.valueOf(syncDay.plusDays(days)))
    def entity = [find:{ String name ->
        assert name == 'zenith.erp.pos.PosTransaction'
        [condition:{ String field, String value ->
            assert field == 'transactionId' && value == 'QA-KOT-1'
            [one:{ -> row }]
        }]
    }]
    def binding = new Binding(method:method, bill:[transactionId:'QA-KOT-1',changeAmount:0G],
        issuedAt:issuedAt, change:0G, amount:{ it }, ec:[entity:entity,user:[timeZone:TimeZone.getTimeZone(zone)]])
    new GroovyShell(binding).evaluate(checkoutTail)
    row
}
[0, 2, 30].each { days ->
    def row = replay('Credit', days)
    assert row.creditDueDate.toLocalDate() == syncDay.minusDays(1).plusDays(days)
    assert row.updates == 1
}
assert replay('Credit', null).updates == 0
assert replay('Cash', null).updates == 0
println 'PASS: 500-character note limit and offline KOT credit due dates across local midnight'
