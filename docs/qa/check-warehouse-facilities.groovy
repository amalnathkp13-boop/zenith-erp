import javax.xml.parsers.DocumentBuilderFactory
import freemarker.template.*
import java.sql.Timestamp

// Executes the page's real read actions/template with isolated synthetic rows; no database writes.
// java -cp 'WEB-INF/lib/*' groovy.ui.GroovyMain check-warehouse-facilities.groovy <repo>
def source = new File(args[0], 'component/zenith-erp-inventory/screen/zenith/inventory/FindFacility.xml')
def doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(source)
def action = doc.getElementsByTagName('actions').item(0).getElementsByTagName('script').item(0).textContent
def tables = [
 'mantle.facility.Facility': [
  [facilityId:'A1',ownerPartyId:'ORG_A',facilityName:'<Literal & name>',facilityTypeEnumId:'FcTpRetailStore',gstStateCode:'',facilityGstin:'',description:'',postalCode:'',statusId:null,openedDate:null,closedDate:null],
  [facilityId:'A2',ownerPartyId:'ORG_A',facilityName:'Closed warehouse',facilityTypeEnumId:'FcTpWarehouse',gstStateCode:'',facilityGstin:'',description:'',postalCode:'',statusId:null,openedDate:null,closedDate:Timestamp.valueOf('2026-10-01 00:00:00')],
  [facilityId:'A3',ownerPartyId:'ORG_A',facilityName:'Inactive warehouse',facilityTypeEnumId:'FcTpWarehouse',gstStateCode:'',facilityGstin:'',description:'',postalCode:'',statusId:'QA_INACTIVE',openedDate:null,closedDate:null],
  [facilityId:'B1',ownerPartyId:'ORG_B',facilityName:'Other organization',facilityTypeEnumId:'FcTpWarehouse',gstStateCode:'',facilityGstin:'',description:'',postalCode:'',statusId:null,openedDate:null,closedDate:null]],
 'moqui.basic.Enumeration': [[enumId:'FcTpWarehouse',enumTypeId:'FacilityType',description:'Warehouse'],[enumId:'FcTpRetailStore',enumTypeId:'FacilityType',description:'Retail Store']],
 'moqui.basic.StatusItem': [[statusId:'QA_INACTIVE',statusTypeId:'Facility',description:'Inactive']]
]
class FacilityQuery {
 List rows
 FacilityQuery condition(String key,Object value) { rows=rows.findAll { it[key]==value };this }
 FacilityQuery orderBy(String order) { rows.sort { it.facilityName };this }
 List list() { rows }
}
def run = { org, canWrite=true ->
 def ec = [user:[getPreference:{name->org}, userId:'QA_USER',nowTimestamp:Timestamp.valueOf('2026-10-14 12:00:00')],
           entity:[find:{name->new FacilityQuery(rows:new ArrayList(tables[name] ?: []))}],web:[parameters:[:]]]
 def shell = new GroovyShell(new Binding([ec:ec,invCanWrite:canWrite]))
 shell.evaluate(action); shell.context.variables
}
def normal = run('ORG_A')
assert normal.facilityTotal==3 && normal.facilityActive==1 && normal.facilityRetail==1 && normal.facilityWarehouses==2
assert normal.facilityRows*.id == ['A1','A2','A3']
assert normal.facilityRows.find { it.id=='A2' }.status=='Inactive'
assert normal.facilityRows.find { it.id=='A3' }.active==false
assert run(null).facilityTotal==0 && run('_NA_').facilityTotal==0
assert run('ORG_B').facilityRows*.id==['B1']
assert normal.facilityViewKey != run('ORG_B').facilityViewKey
def config = new Configuration(Configuration.VERSION_2_3_34);config.numberFormat='computer';config.booleanFormat='c'
def text = (0..<doc.getElementsByTagName('text').length).collect { doc.getElementsByTagName('text').item(it) }.find { it.getAttribute('template')=='true' }
for(def context:[normal,run(null),run('ORG_A',false)]) {
 def writer = new StringWriter()
 new Template('warehouse',new StringReader(text.textContent),config).process(context,writer)
 def html=writer.toString()
 assert html.contains('Warehouses &amp; Facilities') && html.contains('Saved Views') && html.contains('Select all facilities on this page')
 if(context.facilityTotal) assert html.contains('&lt;Literal &amp; name&gt;') && !html.contains('Other organization')
 if(!context.invCanWrite) assert !html.contains('class="wf-edit"')
}
println 'PASS: organization-scoped rows/KPIs, no-organization empty result, operating dates/status, escaped labels, read-only controls and warehouse FreeMarker template.'
