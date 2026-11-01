// Runs the actual resolver against synthetic rows; no database or live tenant is touched.
import groovy.xml.XmlSlurper

def root = new File(args ? args[0] : '.')
def service = new XmlSlurper(false, false).parse(new File(root,
    'component/zenith-erp-base/service/zenith/base/ShopServices.xml'))
def source = service.service.find { it.@noun == 'ActiveShopScope' }.actions.script.text()
def rows = [
    'mantle.facility.Facility': [
        [facilityId:'QA_DEFAULT', facilityName:'Default facility', ownerPartyId:'QA_ORG', facilityTypeEnumId:'FcTpRetailStore'],
        [facilityId:'QA_A', facilityName:'Shop A', ownerPartyId:'QA_ORG', facilityTypeEnumId:'FcTpRetailStore'],
        [facilityId:'QA_B', facilityName:'Shop B', ownerPartyId:'QA_ORG', facilityTypeEnumId:'FcTpRetailStore'],
        [facilityId:'QA_FOREIGN', facilityName:'Foreign', ownerPartyId:'QA_OTHER', facilityTypeEnumId:'FcTpRetailStore']],
    'zenith.erp.stores.Store': [
        [storeId:'QA_STORE_A', facilityId:'QA_A', organizationPartyId:'QA_ORG', storeName:'Shop A'],
        [storeId:'QA_STORE_B', facilityId:'QA_B', organizationPartyId:'QA_ORG', storeName:'Shop B'],
        [storeId:'QA_STORE_OTHER', facilityId:'QA_FOREIGN', organizationPartyId:'QA_OTHER']],
    'zenith.erp.pos.PosTerminal': [
        [terminalId:'QA_T1', facilityId:'QA_A', organizationPartyId:'QA_ORG'],
        [terminalId:'QA_T2', facilityId:'QA_A', organizationPartyId:'QA_ORG'],
        [terminalId:'QA_T3', facilityId:'QA_B', organizationPartyId:'QA_ORG']],
    'zenith.erp.pos.PosSession': [
        [sessionId:'QA_S1', terminalId:'QA_T1', organizationPartyId:'QA_ORG', operatorPartyId:'QA_ADMIN'],
        [sessionId:'QA_S2', terminalId:'QA_T2', organizationPartyId:'QA_ORG', operatorPartyId:'QA_BILL1'],
        [sessionId:'QA_S3', terminalId:'QA_T3', organizationPartyId:'QA_ORG', operatorPartyId:'QA_BILL2'],
        [sessionId:'QA_BAD', terminalId:'QA_T1', organizationPartyId:'QA_OTHER', operatorPartyId:'QA_OTHER_USER']]]
def entity = new Expando()
entity.find = { String name ->
    assert rows.containsKey(name): "Unexpected entity: ${name}"
    def selected = rows[name].collect { new LinkedHashMap(it) }
    def query = new Expando()
    query.condition = { Object... parts ->
        selected = selected.findAll { row -> parts.length == 2 ? row[parts[0]] == parts[1] :
            (parts[1] == 'in' ? parts[2].contains(row[parts[0]]) : false) }
        query
    }
    query.useCache = { boolean ignored -> query }
    query.list = { -> selected }
    query
}
def resolve = { String shop ->
    def ec = new Expando(entity:entity,
        user:new Expando(getPreference:{ key -> key == 'ACTIVE_ORGANIZATION' ? 'QA_ORG' : shop }),
        artifactExecution:new Expando(disableAuthz:{ -> false }, enableAuthz:{ -> }))
    def binding = new Binding([ec:ec, facilityId:null, includePosScope:true])
    new GroovyShell(binding).evaluate(source)
    binding.variables
}
def all = resolve(null)
assert all.shopCount == 2: "Expected two registered shops, got ${all.shopCount}"
assert all.shopList*.id as Set == ['QA_A','QA_B'] as Set
assert all.sessionIds == null
def a = resolve('QA_A')
assert a.terminalIds as Set == ['QA_T1','QA_T2'] as Set
assert a.sessionIds as Set == ['QA_S1','QA_S2'] as Set: 'Shop A must combine both operators, without foreign rows'
assert resolve('QA_B').sessionIds == ['QA_S3']
assert resolve('QA_FOREIGN').activeShopId == null
assert resolve('QA_DEFAULT').activeShopId == null
rows['zenith.erp.stores.Store'] = []
assert resolve(null).shopCount == 3: 'Legacy organizations without registered stores retain their facilities'
println 'PASS: registered shops, multi-counter aggregation, organization isolation and legacy fallback'

def app = new XmlSlurper(false, false).parse(new File(root,
    'component/zenith-erp-app/screen/zenith/ZenithApp.xml'))
def switchSource = app.transition.find { it.@name == 'setActiveShop' }.actions.script.text()
def returnUrl = { String supplied ->
    def parameters = [facilityId:'',returnUrl:supplied]
    def request = new Expando(getParameter:{ String key -> parameters[key] })
    def result = [:]
    def web = new Expando(getRequest:{ -> request })
    def ec = new Expando(web:web,user:new Expando(getPreference:{ key -> 'QA_ORG' },setPreference:{ k,v -> }))
    new GroovyShell(new Binding([ec:ec,context:result])).evaluate(switchSource)
    result.zReturnUrl
}
assert returnUrl('/apps/zenith/pos/Dashboard?dashLoc=QA_T1&dashDate=2026-01-15&chartMode=daily') ==
    '/apps/zenith/pos/Dashboard?dashDate=2026-01-15&chartMode=daily'
assert returnUrl('/qapps/zenith/pos/Dashboard?dashLoc=QA_T2') == '/qapps/zenith/pos/Dashboard'
['https://example.com/apps/zenith','//example.com/apps/zenith','http://[invalid','/apps/zenith-other','/apps/zenith\\evil'].each {
    assert returnUrl(it) == '/apps/zenith/Dashboard'
}
println 'PASS: shop switching clears stale counters, preserves shell/date filters, rejects unsafe return URLs'
