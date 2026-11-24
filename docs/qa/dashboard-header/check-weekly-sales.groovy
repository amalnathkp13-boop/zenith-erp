// Run from the repository root with Moqui's Groovy + groovy-json jars on the classpath:
// java -cp '<runtime>/WEB-INF/lib/*' groovy.ui.GroovyMain docs/qa/dashboard-header/check-weekly-sales.groovy
// Executes the actual chart actions with synthetic sales; no server, login or database is used.
import groovy.json.JsonSlurper
import java.sql.Timestamp
import java.time.LocalDateTime
import java.time.ZoneId

def source = new File('component/zenith-erp-app/screen/zenith/Dashboard.xml').getText('UTF-8')
def actions = source.substring(source.indexOf('// The period and hourly charts'), source.indexOf('// ZE-DASH layout:'))
def chart = { String from, String through, String zone, List entries ->
    def tz = TimeZone.getTimeZone(zone)
    def stamp = { String text -> Timestamp.from(LocalDateTime.parse(text.replace(' ', 'T')).atZone(ZoneId.of(zone)).toInstant()) }
    def now = stamp('2026-11-24 12:00:00')
    def start = stamp(from + ' 00:00:00')
    def end = stamp(java.time.LocalDate.parse(through).plusDays(1).toString() + ' 00:00:00')
    def sales = entries.collect { [date:stamp(it[0]), amount:it[1] as BigDecimal] }
    def fmt = new java.text.SimpleDateFormat('yyyy-MM-dd'); fmt.timeZone = tz
    def binding = new Binding([
        ec:[user:[timeZone:tz], l10n:[parseTimestamp:{ value, ignored -> stamp(value) }]],
        _now:now, _todayStr:'2026-11-24', _sdf:fmt, dayStart:start, dayEndExcl:end,
        dashDate:from, dashDateTo:through, acRangeLabel:from == through ? from : from + ' to ' + through,
        homeSaleEntries:sales, homeMoney:{ value -> value.toString() },
        homeSalesBetween:{ a,b -> sales.findAll { !it.date.before(a) && it.date.before(b) }.sum(BigDecimal.ZERO) { it.amount } }
    ])
    new GroovyShell(binding).evaluate(actions)
    def json = new JsonSlurper()
    assert binding.dayStart == start && binding.dayEndExcl == end : 'Chart must not change the KPI filter'
    [cats:json.parseText(binding.baWeekLabelsJson), series:json.parseText(binding.baWeekDataJson),
     total:binding.baWeekTotal, sub:binding.baWeekLabel, hours:json.parseText(binding.baHourDataJson), hourly:binding.baHourTotal]
}
def daily = chart('2026-11-24','2026-11-24','Asia/Kolkata',[
    ['2026-11-17 23:59:59.999',999], ['2026-11-18 00:00:00',10],
    ['2026-11-24 23:59:59.999',20], ['2026-11-25 00:00:00',999]
])
assert daily.cats == ['18 Nov','19 Nov','20 Nov','21 Nov','22 Nov','23 Nov','24 Nov']
assert daily.series == [10,0,0,0,0,0,20] && daily.total == 30
assert daily.sub == '2026-11-18 to 2026-11-24'
assert daily.hours.size() == 24 && daily.hours[23] == 20 && daily.hourly == 20
def empty = chart('2027-01-01','2027-01-01','Asia/Kolkata',[])
assert empty.cats == ['26 Dec','27 Dec','28 Dec','29 Dec','30 Dec','31 Dec','01 Jan']
assert empty.series == [0,0,0,0,0,0,0] && empty.total == 0
def leap = chart('2024-03-01','2024-03-01','UTC',[['2024-02-29 12:00:00',15]])
assert leap.cats.size() == 7 && leap.cats[-2] == '29 Feb' && leap.total == 15
def dst = chart('2026-03-10','2026-03-10','America/New_York',[
    ['2026-03-04 00:00:00',11], ['2026-03-08 03:30:00',12], ['2026-03-11 00:00:00',999]
])
assert dst.cats == ['04 Mar','05 Mar','06 Mar','07 Mar','08 Mar','09 Mar','10 Mar'] && dst.total == 23
def custom = chart('2026-10-01','2026-10-20','Asia/Kolkata',[['2026-10-07 10:00:00',25]])
assert custom.cats.size() == 20 && custom.total == 25 && custom.sub == '2026-10-01 to 2026-10-20'
def year = chart('2026-01-01','2026-12-31','Asia/Kolkata',[['2026-05-01 00:00:00',30]])
assert year.cats.size() == 12 && year.total == 30
println 'PASS weekly sales: seven calendar days, gaps, totals, midnight bounds, hourly independence, historical/year/leap/DST dates and selected ranges'
