import javax.xml.parsers.DocumentBuilderFactory
import freemarker.template.*
import java.sql.Timestamp

// Executes the real screen actions and templates with synthetic in-memory rows. No DB or service writes.
// java -cp 'WEB-INF/lib/*' groovy.ui.GroovyMain check-pos-chart.groovy <repo>
def repo = new File(args[0])
def source = new File(repo, 'component/zenith-erp-pos/screen/zenith/pos/Pos/Dashboard.xml')
def doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(source)
def loader = new GroovyClassLoader(getClass().classLoader)
// Use the framework's EntityCondition when running in the local Moqui container.
def action = new StringBuilder()
// Locate the screen's direct actions, independently of transition count.
def children = (0..<doc.documentElement.childNodes.length).collect { doc.documentElement.childNodes.item(it) }.find { it.nodeName == 'actions' }
for (int i=0; i<children.childNodes.length; i++) {
    def node = children.childNodes.item(i)
    if (node.nodeName == 'script') action.append(node.textContent).append('\n')
    if (node.nodeName == 'entity-find') {
        action.append("${node.getAttribute('list')} = ec.entity.find('${node.getAttribute('entity-name')}')\n")
        for (int j=0; j<node.childNodes.length; j++) {
            def c = node.childNodes.item(j)
            if (c.nodeName == 'econdition') {
                def val = c.hasAttribute('from') ? c.getAttribute('from') : "'${c.getAttribute('value')}'"
                def statement = "${node.getAttribute('list')}.condition('${c.getAttribute('field-name')}', '${c.getAttribute('operator') ?: 'equals'}', ${val})\n"
                if (c.getAttribute('ignore-if-empty') == 'true') statement = "if (${val}) " + statement
                action.append(statement)
            }
            if (c.nodeName == 'order-by') action.append("${node.getAttribute('list')}.orderBy('${c.getAttribute('field-name')}')\n")
        }
        action.append("${node.getAttribute('list')} = ${node.getAttribute('list')}.list()\n")
    }
}
action.append('return binding.variables + [dayStart:dayStart, dayEnd:dayEnd]\n')
def scriptClass = loader.parseClass(action.toString())
class Query {
    List rows
    Set fields
    Query condition(Object... args) {
        if (args.length < 2) return this
        def key=args[0]; def op=args.length==2?'equals':args[1].toString(); def value=args[-1]
        if(fields != null && !fields.contains(key)) throw new IllegalArgumentException('Unknown field: '+key)
        rows=rows.findAll { r -> def v=r[key]; switch(op) {
            case ['in','IN']: return value.contains(v)
            case ['greater-equals','GREATER_THAN_EQUAL_TO']: return v!=null && v>=value
            case ['less-equals','LESS_THAN_EQUAL_TO']: return v!=null && v<=value
            case ['less','LESS_THAN']: return v!=null && v<value
            case ['greater','GREATER_THAN']: return v!=null && v>value
            default: return v==value
        } }; this
    }
    Query orderBy(String key) { rows.sort { it[key] }; this }
    List list() { rows }
    long count() { rows.size() }
    Map one() { rows ? rows[0] : null }
}
class TestL10n {
    TimeZone zone
    String format(Object value, String pattern) { new java.text.DecimalFormat(pattern).format(value) }
    Timestamp parseTimestamp(String text, String pattern) {
        def f=new java.text.SimpleDateFormat(pattern); f.timeZone=zone
        new Timestamp(f.parse(text).time)
    }
}
class TestFmt { String inr(Object value) { value.toString() } }
def zone = TimeZone.getTimeZone('Asia/Kolkata')
def stamp = { String text, TimeZone tz=zone ->
    def f = new java.text.SimpleDateFormat('yyyy-MM-dd HH:mm:ss.SSS'); f.timeZone=tz
    new Timestamp(f.parse(text).time)
}
def tables = [
    'mantle.facility.Facility': [
        [facilityId:'SHOP',ownerPartyId:'ORG',facilityTypeEnumId:'FcTpRetailStore',facilityName:'Shop'],
        [facilityId:'EMPTY',ownerPartyId:'ORG',facilityTypeEnumId:'FcTpRetailStore',facilityName:'Empty shop'],
        [facilityId:'FOREIGN',ownerPartyId:'OTHER',facilityTypeEnumId:'FcTpRetailStore']],
    'zenith.erp.pos.PosTerminal': [[terminalId:'T1',organizationPartyId:'ORG',facilityId:'SHOP'],[terminalId:'T2',organizationPartyId:'ORG',facilityId:'SHOP']],
    'zenith.erp.pos.PosSession': [[sessionId:'S1',organizationPartyId:'ORG',terminalId:'T1',statusId:'PsOpen'],[sessionId:'S2',organizationPartyId:'ORG',terminalId:'T2',statusId:'PsOpen'],[sessionId:'FOREIGN',organizationPartyId:'OTHER',statusId:'PsOpen']],
    'zenith.erp.pos.PosTransaction': [
        [transactionId:'FIRST',organizationPartyId:'ORG',sessionId:'S1',entryDate:stamp('2026-10-11 00:00:00.000'),statusId:'PtCompleted',payableAmount:100G,changeAmount:20G,transactionNumber:'B1',customerName:'<b>literal</b>'],
        [transactionId:'LAST',organizationPartyId:'ORG',sessionId:'S2',entryDate:stamp('2026-10-11 23:59:59.999'),statusId:'PtCompleted',payableAmount:50G,transactionNumber:'B2'],
        [transactionId:'PRIOR',organizationPartyId:'ORG',sessionId:'S1',entryDate:stamp('2026-10-10 23:59:59.999'),statusId:'PtCompleted',payableAmount:75G],
        [transactionId:'NEXT',organizationPartyId:'ORG',sessionId:'S1',entryDate:stamp('2026-10-12 00:00:00.000'),statusId:'PtCompleted',payableAmount:999G],
        [transactionId:'FOREIGN',organizationPartyId:'OTHER',entryDate:stamp('2026-10-11 12:00:00.000'),statusId:'PtCompleted',payableAmount:999999G]],
    'zenith.erp.pos.PosPayment': [[transactionId:'FIRST',paymentMethod:'Cash',amount:70G],[transactionId:'FIRST',paymentMethod:'Cash',amount:50G],[transactionId:'LAST',paymentMethod:'Card',amount:50G]],
    'zenith.erp.pos.PosTransactionAmendment': [[transactionId:'FIRST'],[transactionId:'FIRST'],[transactionId:'FOREIGN']],
    'zenith.erp.pos.PosTransactionItem': [[transactionId:'FIRST',productId:'P1',productName:'<img src=x>',quantity:1G,lineTotal:100G],[transactionId:'LAST',productId:'P2',productName:'<img src=x>',quantity:1G,lineTotal:50G]],
    'zenith.erp.pos.PosCashEntry': [[organizationPartyId:'ORG',sessionId:'S1',entryDate:stamp('2026-10-11 23:59:59.999'),entryType:'CashIn',amount:10G],[organizationPartyId:'OTHER',entryDate:stamp('2026-10-11 12:00:00.000'),entryType:'CashIn',amount:999G]],
    'zenith.erp.pos.PosExpense': [[organizationPartyId:'ORG',sessionId:'S2',expenseDate:stamp('2026-10-11 12:00:00.000'),amount:5G]],
    'zenith.erp.pos.PosStockWastage': [[organizationPartyId:'ORG',wastageDate:stamp('2026-10-11 12:00:00.000'),totalLoss:2G]],
    'zenith.erp.pos.KitchenOrderTicket': [[organizationPartyId:'ORG',terminalId:'T1',statusId:'KotNew'],[organizationPartyId:'OTHER',terminalId:'FOREIGN',statusId:'KotNew']],
    'mantle.product.Product': [[productId:'P1',ownerPartyId:'ORG',inventoryTracked:'Y']],
    'zenith.erp.inventory.ProductStockView': [[productId:'P1',ownerPartyId:'ORG',totalQoh:0G],[productId:'UNTRACKED',ownerPartyId:'ORG',totalQoh:0G],[ownerPartyId:'OTHER',totalQoh:0G]]
]
def execute = { Map extra=[:], Map data=tables ->
    def tz=extra.zone ?: zone
    def prefs=[ACTIVE_ORGANIZATION:'ORG',POS_DASH_ORDER:'payments,salesKpi'] + (extra.prefs ?: [:])
    def service=new Expando(); service.name={ n->service }; service.call={->[activeShopId:extra.activeShop]}
    def ec=[entity:[find:{ name->new Query(rows:new ArrayList(data[name] ?: []), fields:name=='zenith.erp.pos.PosTransactionAmendment' ? ['transactionId'] as Set : null)}],
        user:[timeZone:tz,nowTimestamp:stamp('2026-10-12 12:00:00.000',tz),userGroupIdSet:extra.groups ?: ['ADMIN'],isInGroup:{ g->(extra.groups ?: ['ADMIN']).contains(g) },getPreference:{ name->prefs[name] }],
        service:[sync:{->service}],l10n:new TestL10n(zone:tz),
        web:[request:[requestURI:extra.uri ?: '/qapps/zenith/pos/Dashboard'],sessionToken:'synthetic-token']]
    def b=new Binding([ec:ec,context:[:],posOrganizationPartyId:'ORG',zinr:new TestFmt(),dashDate:'2026-10-11',dashDateTo:'2026-10-11',dashLoc:'',dateMode:'custom',chartMode:null,showSettings:'1'] + extra)
    def script=scriptClass.newInstance(); script.binding=b; script.run()
}
// Keep this fixture local and synthetic, and exercise only this request's behavior.
tables.values().each { rows -> rows.removeAll { it.organizationPartyId == 'OTHER' || it.ownerPartyId == 'OTHER' || it.transactionId == 'FOREIGN' } }
def normal = execute()
assert normal.chartBuckets.size() == 24
assert normal.chartBuckets[0].amount == 100G && normal.chartBuckets[23].amount == 50G
assert normal.chartBuckets[0].label == '12 AM' && normal.chartBuckets[12].label == '12 PM'
assert normal.salesLineSvg.contains('linearGradient') && normal.salesLineSvg.contains(' C')
def svg = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(new ByteArrayInputStream(normal.salesLineSvg.getBytes('UTF-8')))
def line = (0..<svg.getElementsByTagName('path').length).collect { svg.getElementsByTagName('path').item(it) }.find { it.getAttribute('fill') == 'none' }
def coordinates = (line.getAttribute('d') =~ /-?\d+(?:\.\d+)?/).collect { it as BigDecimal }
assert coordinates.withIndex().findAll { value,index -> index % 2 == 1 }.every { value,index -> value >= 16 && value <= 176 }
assert normal.totalSales == 150G // includes the final millisecond of the selected day
for (def mode : ['hourly','daily','weekly','monthly']) {
    def result = execute([chartMode:mode, dashDate:'2026-10-10', dashDateTo:'2026-10-13'])
    assert result.chartBuckets.sum { it.amount } == 1224G
    assert result.salesLineSvg.contains('data-chart-mode="' + mode + '"')
    assert !result.salesLineSvg.contains('NaN') && !result.salesLineSvg.contains('Infinity')
    assert result.urlYear.contains('chartMode=' + mode)
}
def days = execute([chartMode:'daily', dashDate:'2026-10-10', dashDateTo:'2026-10-13'])
assert execute([dashLoc:'T1',chartMode:'daily']).urlYear.contains('dashLoc=T1')
assert days.chartBuckets*.label == ['10 Oct','11 Oct','12 Oct','13 Oct']
assert days.chartBuckets*.amount == [75G,150G,999G,0G]
def weeks = execute([chartMode:'weekly', dashDate:'2026-10-10', dashDateTo:'2026-10-13'])
assert weeks.chartBuckets*.label == ['10 Oct','12 Oct']
assert weeks.chartBuckets*.amount == [225G,999G]
assert weeks.chartBuckets*.description == ['10 Oct – 11 Oct','12 Oct – 13 Oct']
def months = execute([chartMode:'monthly',dashDate:'2026-09-28',dashDateTo:'2026-11-03'])
assert months.chartBuckets*.label == ['Sep 2026','Oct 2026','Nov 2026']
assert months.chartBuckets*.amount == [0G,1224G,0G]
assert execute([chartMode:'monthly',dashDate:'2026-01-01',dashDateTo:'2026-10-13']).salesLineSvg.count('class="pos-chart-x-label"') == 10
assert execute([chartMode:'daily',dashDate:'2024-02-28',dashDateTo:'2024-03-01']).chartBuckets*.label == ['28 Feb','29 Feb','01 Mar']
assert execute([chartMode:'monthly',dashDate:'2025-12-30',dashDateTo:'2026-01-02']).chartBuckets*.label == ['Dec 2025','Jan 2026']
assert execute([chartMode:'unknown']).chartMode == 'hourly'
assert execute([dashDate:'2026-02-30']).dateError
assert execute([dashDate:'garbage']).dateError
assert execute([chartMode:'daily',dashDate:'2026-10-13',dashDateTo:'2026-10-10']).chartBuckets*.amount == days.chartBuckets*.amount
def dstRows = tables + ['zenith.erp.pos.PosTransaction': [
    [organizationPartyId:'ORG',transactionId:'DST1',statusId:'PtCompleted',entryDate:Timestamp.from(java.time.Instant.parse('2026-11-01T05:30:00Z')),payableAmount:10G],
    [organizationPartyId:'ORG',transactionId:'DST2',statusId:'PtCompleted',entryDate:Timestamp.from(java.time.Instant.parse('2026-11-01T06:30:00Z')),payableAmount:20G]]]
def dst = execute([zone:TimeZone.getTimeZone('America/New_York'),dashDate:'2026-11-01',dashDateTo:'2026-11-01',chartMode:'hourly'],dstRows)
assert dst.chartBuckets[1].amount == 30G
assert dst.dayEnd.time - dst.dayStart.time == 25L * 60 * 60 * 1000 - 1
assert execute([zone:TimeZone.getTimeZone('America/New_York'),dashDate:'2026-11-01',dashDateTo:'2026-11-01',chartMode:'daily'],dstRows).chartBuckets[0].amount == 30G
def cfg = new Configuration(Configuration.VERSION_2_3_34); cfg.numberFormat='computer'; cfg.booleanFormat='c'
def texts = doc.getElementsByTagName('text')
for (def mode : ['hourly','daily','weekly','monthly']) {
    def empty = execute([chartMode:mode],[:])
    assert empty.chartBuckets.every { it.amount == 0 }
    assert !empty.salesLineSvg.contains('NaN') && !empty.salesLineSvg.contains('Infinity')
    def data = execute([chartMode:mode])
    for (int i=0; i<texts.length; i++) {
        def node = texts.item(i)
        if (node.getAttribute('template') != 'true') continue
        for (def context : [data,empty]) {
            def writer = new StringWriter()
            new Template('chart-fixture',new StringReader(node.textContent),cfg).process(context,writer)
            assert writer.toString().contains('POS Overview')
            assert writer.toString().contains('Sales chart interval')
            assert writer.toString().contains('pos-dash-lower')
        }
    }
}
println 'PASS: all chart bucket totals and labels, empty and singleton charts, full-day boundaries, DST, leap day, month/year rollover, invalid/reversed dates, current-layout FreeMarker rendering.'
