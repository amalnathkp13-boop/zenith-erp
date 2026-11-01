// Run the actual shared access script with synthetic entities, including forged ids.
import groovy.xml.XmlParser
class AssignmentQuery {
    List rows
    def condition(String key,Object value){rows=rows.findAll{it[key]==value};this}
    def disableAuthz(){this}
    def one(){rows?rows[0]:null}
    def list(){rows}
}
def script=new XmlParser().parse(new File(args[0])).service.find{it.@verb=='assert'&&it.@noun=='PosAccess'}.actions.script.text()
def data=[
 'zenith.erp.pos.PosTerminal':[[terminalId:'T1',organizationPartyId:'QA',facilityId:'F1',isActive:'Y'],[terminalId:'T2',organizationPartyId:'QA',facilityId:'F2',isActive:'Y']],
 'zenith.erp.pos.PosTerminalAssignment':[[organizationPartyId:'QA',userId:'CLERK',terminalId:'T1']],
 'zenith.erp.pos.PosSession':[[sessionId:'S1',terminalId:'T1',organizationPartyId:'QA',operatorPartyId:'CLERK'],[sessionId:'S2',terminalId:'T2',organizationPartyId:'QA',operatorPartyId:'CLERK']],
 'zenith.erp.pos.PosTransaction':[[transactionId:'B1',sessionId:'S1',organizationPartyId:'QA',statusId:'PtCreated'],[transactionId:'B2',sessionId:'S2',organizationPartyId:'QA',statusId:'PtCompleted']]
]
def run={Map request,boolean admin=false->
 def errors=[],user=[context:[:],userId:'CLERK',userAccount:[partyId:'CLERK'],getPreference:{name->'QA'},isInGroup:{g->admin&&g=='ZENITH_ADMIN'}]
 def call=[parameters:{p->delegate},disableAuthz:{->delegate},call:{->[activeOrgId:'QA',userOrgIds:['QA']]}]
 call.parameters={p->call};call.disableAuthz={->call}
 def ec=[user:user,entity:[find:{name->new AssignmentQuery(rows:new ArrayList(data[name]?:[]))}],service:[sync:{->[name:{n->call}]}],message:[addError:{s->errors<<s}]]
 def inputs=['transactionId','sessionId','terminalId','heldId','productId','templateId','cashEntryId','expenseId','wastageId','returnId','customerPartyId','facilityId','printerId','kotId','waiterId','qrPaymentId'].collectEntries{[(it):null]}
 def b=new Binding(inputs+request+[ec:ec]);new GroovyShell(b).evaluate(script);b.getVariable('allowed')
}
assert run([terminalId:'T1'])
assert !run([terminalId:'T2']):'A cashier must not choose an unassigned terminal in the same organization'
assert !run([sessionId:'S2']):'A session id must not bypass the assigned terminal'
assert !run([transactionId:'B2']):'A saved bill id must not bypass the assigned terminal'
assert run([terminalId:'T2'],true):'An organization admin can manage its terminals'
assert !run([terminalId:'FOREIGN'],true):'Administrator access remains organization scoped'
data['zenith.erp.pos.PosTerminal'][0].isActive='N'
assert !run([terminalId:'T1']):'An inactive assigned terminal must not be usable'
data['zenith.erp.pos.PosTerminal'][0].isActive='Y'
data['zenith.erp.pos.PosTerminalAssignment']=[]
assert !run([terminalId:'T1']):'An unassigned cashier must fail closed'
println 'PASS assigned terminal guard, session/bill ids, admin access and missing assignment'
