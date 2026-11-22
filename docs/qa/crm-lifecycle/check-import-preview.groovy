// Run with the runtime's Groovy version. Pass ImportLeads.xml as the first argument.
def screen = new groovy.xml.XmlSlurper().parse(new File(args[0]))
def action = { name -> screen.transition.find { it.@name == name && it.@method == 'post' }.actions.script.text() }
def session = [:], errors = [], submitted = []
def entityQuery = { name ->
    def query = [:]
    query.condition = { String field, Object value -> query }
    query.selectFields = { fields -> query }
    query.list = { -> name.endsWith('LeadSource') ? [[leadSourceId:'Web', description:'Web']] : [] }
    query
}
def serviceCall = [:]
serviceCall.name = { name -> serviceCall }
serviceCall.parameters = { fields -> submitted << fields; serviceCall }
serviceCall.requireNewTransaction = { enabled -> serviceCall }
serviceCall.call = { -> [leadId:'L1'] }
def web = [sessionAttributes:session, parameters:[:], requestParameters:[:]]
def ec = [web:web, context:[:], user:[userId:'user'], entity:[find:entityQuery],
          message:[addError:{ msg -> errors << msg }, hasError:{ -> !errors.isEmpty() }],
          service:[sync:{ -> serviceCall }]]
def binding = new Binding([ec:ec, crmWrite:[activeOrg:'org']])
def shell = new GroovyShell(binding)
def previewScript = action('previewImport')
// Optional column mappings normally come from the screen context.
(previewScript =~ /\b(\w+Column) \?:/).each { match -> binding.setVariable(match[1], null) }
def csv = 'FirstName,Company,Email,Source\nAda,Example Ltd,ada@example.test,Web'
def preview = { contents, nameColumn ->
    errors.clear()
    web.parameters.csvText = contents
    binding.setVariable('firstNameColumn', nameColumn)
    shell.evaluate(previewScript)
    session.crmLeadImport
}
def commit = { id ->
    errors.clear()
    binding.setVariable('previewId', id)
    shell.evaluate(action('commitImport'))
}

def original = preview(csv, 'FirstName')
def remapped = preview(csv, 'Company')
assert original.rows[0].firstName == 'Ada' && remapped.rows[0].firstName == 'Example Ltd'
commit(original.previewId)
assert errors && submitted.empty
commit(remapped.previewId)
assert !errors && submitted.last().firstName == 'Example Ltd'
commit(remapped.previewId)
assert submitted.size() == 2 && submitted*.externalSubmissionId.unique().size() == 1
assert preview('Invalid header', null) == null
assert errors && !session.crmLeadImportResult
commit(remapped.previewId)
assert errors && submitted.size() == 2
println 'Passed stale tab, remapped CSV, retry identity and failed replacement preview.'
