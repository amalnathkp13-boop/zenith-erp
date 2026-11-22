import org.moqui.entity.EntityCondition

// Each transition fixes its own catalogue. Only the term comes from the request.
def scope = crmOrganization?.activeOrgId
def term = ec.web.parameters.term?.toString()?.trim()
if (!scope || scope == '_NA_' || !term) {
    ec.web.sendJsonResponse([])
    return
}
def config = [
    lead: ['zenith.erp.crm.Lead', 'leadId', ['firstName', 'lastName']],
    opportunity: ['mantle.sales.opportunity.SalesOpportunity', 'salesOpportunityId', ['opportunityName']],
    campaign: ['zenith.erp.crm.CrmCampaign', 'campaignId', ['campaignName']]
][crmPickerKind]
def (entityName, idField, nameFields) = config
def fields = [idField] + nameFields
def scopedFind = { ec.entity.find(entityName).condition('organizationPartyId', scope).selectFields(fields) }
def option = { row ->
    [value:row[idField], label:nameFields.collect { row[it] }.findAll().join(' ') ?: row[idField]]
}

// Resolve a saved selection even when its name is outside the first page of matches.
def selected = scopedFind().condition(idField, term).limit(1).list()
if (selected) {
    ec.web.sendJsonResponse([option(selected[0])])
    return
}
def cf = ec.entity.conditionFactory
def matches = scopedFind()
term.tokenize().each { word ->
    def fieldsMatchingWord = fields.collect { field ->
        cf.makeCondition(field, EntityCondition.LIKE, '%' + word + '%').ignoreCase()
    }
    matches.condition(cf.makeCondition(fieldsMatchingWord, EntityCondition.OR))
}
def rows = matches.orderBy((nameFields + idField).join(',')).limit(25).list()
ec.web.sendJsonResponse(rows.collect(option))
