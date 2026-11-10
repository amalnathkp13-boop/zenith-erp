// Execute the actual sales-mode service scripts with bounded synthetic entity results.
import groovy.xml.XmlParser
import org.moqui.entity.EntityCondition

class ModeQuery {
    List rows
    ModeQuery condition(Closure test) { rows = rows.findAll(test); this }
    ModeQuery condition(String name, Object value) { condition { it[name] == value } }
    ModeQuery condition(String name, String operator, List values) {
        assert operator == 'in'
        condition { values.contains(it[name]) }
    }
    ModeQuery orderBy(String ignored) { this }
    ModeQuery selectField(String ignored) { this }
    ModeQuery distinct(boolean ignored) { this }
    ModeQuery disableAuthz() { this }
    List list() { rows }
    def one() { rows ? rows[0] : null }
}

class ModeConditionFactory {
    Closure makeCondition(String name, EntityCondition.ComparisonOperator operator, Object value) {
        assert operator == EntityCondition.ComparisonOperator.EQUALS
        return { row -> row[name] == value }
    }
    Closure makeCondition(List<Closure> conditions, EntityCondition.JoinOperator operator) {
        assert operator == EntityCondition.JoinOperator.OR
        return { row -> conditions.any { it(row) } }
    }
}

def source = new XmlParser().parse(new File(args[0]))
def getScript = { noun -> source.service.find { it.@verb == 'get' && it.@noun == noun }?.actions?.script?.text() }
def organizationScript = getScript('OrganizationModes')
def terminalScript = getScript('TerminalModes')
def definitions = [
    [salesModeId:'RETAIL',organizationPartyId:null,isActive:'Y',isDefault:'Y',modeName:'Retail'],
    [salesModeId:'WHOLESALE',organizationPartyId:null,isActive:'Y',isDefault:'N',modeName:'Wholesale'],
    [salesModeId:'LEGACY_PRICED',organizationPartyId:null,isActive:'Y',isDefault:'N',modeName:'Priced legacy'],
    [salesModeId:'LEGACY_RULED',organizationPartyId:null,isActive:'Y',isDefault:'N',modeName:'Legacy with order rule'],
    [salesModeId:'OWN_R',organizationPartyId:'CLEAN_QA_A',isActive:'Y',isDefault:'Y',modeName:'Retail'],
    [salesModeId:'OWN_W',organizationPartyId:'CLEAN_QA_A',isActive:'Y',isDefault:'N',modeName:'Wholesale'],
    [salesModeId:'FOREIGN_R',organizationPartyId:'CLEAN_QA_B',isActive:'Y',isDefault:'Y',modeName:'Foreign']
]
def run = { org, activeOrg ->
    def data = [
        'zenith.erp.pos.PosTerminal':[[terminalId:'T',facilityId:'F']],
        'zenith.erp.pos.PosSalesModeShop':[],
        'zenith.erp.pos.PosSalesModeOrgRemoval':[[organizationPartyId:'CLEAN_QA_A',salesModeId:'WHOLESALE'],[organizationPartyId:'CLEAN_QA_A',salesModeId:'RETAIL']],
        'zenith.erp.pos.PosTerminalSalesMode':org == 'UNRELATED_QA' ? [[terminalId:'T',salesModeId:'LEGACY_PRICED',isActive:'Y']] : [],
        'zenith.erp.pos.PosProductModePrice':[[organizationPartyId:'CLEAN_QA_B',salesModeId:'LEGACY_PRICED']],
        'zenith.erp.pos.PosSalesModeOrgConfig':[[organizationPartyId:'CLEAN_QA_B',salesModeId:'LEGACY_RULED']],
        'zenith.erp.pos.PosSalesMode':definitions
    ]
    def ec = [user:[isInGroup:{ false },context:[activeOrgId:activeOrg]],entity:[
        conditionFactory:new ModeConditionFactory(),find:{ name -> new ModeQuery(rows:new ArrayList(data[name])) }
    ]]
    def evaluateModes = { script, params ->
        def binding = new Binding(params + [ec:ec])
        new GroovyShell(binding).evaluate(script)
        binding.getVariable('modes')
    }
    def available = organizationScript ? evaluateModes(organizationScript, [organizationPartyId:org]) : []
    evaluateModes(terminalScript, [terminalId:'T',access:[organizationPartyId:org],organizationModes:[modes:available]])*.salesModeId as Set
}
assert run('CLEAN_QA_A','CLEAN_QA_A') == (['OWN_R','OWN_W'] as Set): 'An owned default replaces the shared fallback at this tenant only'
assert run('UNRELATED_QA','UNRELATED_QA') == (['RETAIL','WHOLESALE'] as Set): 'A stale shared mapping must leave both defaults available'
assert run('CLEAN_QA_B','CLEAN_QA_B') == (['RETAIL','WHOLESALE','FOREIGN_R','LEGACY_PRICED','LEGACY_RULED'] as Set): 'Owned modes and configured legacy modes stay available to their organization'
assert run('CLEAN_QA_B','UNRELATED_QA').isEmpty(): 'A different active organization cannot list these modes'
println 'PASS: standard modes, owned defaults, legacy configuration, and organization scope'
