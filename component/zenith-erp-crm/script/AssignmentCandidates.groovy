def members = ec.entity.find('mantle.party.PartyRelationship')
        .condition('toPartyId', organizationPartyId).condition('toRoleTypeId', 'OrgInternal')
        .condition('relationshipTypeEnumId', 'in', ['PrtEmployee','PrtAgent','PrtMember'])
        .conditionDate('fromDate','thruDate',ec.user.nowTimestamp)
        .selectField('fromPartyId').distinct(true).disableAuthz().list()*.fromPartyId
def routes = [Lead:['/Crm/Leads','/Crm/EditLead'], Activity:['/Crm/Activities','/Crm/ActivityDetail'],
              Opportunity:['/Crm/Pipeline','/Crm/EditOpportunity']][recordType]
if (!members || !routes) return []
def now = ec.user.nowTimestamp
def accounts = ec.entity.find('moqui.security.UserAccount').condition('partyId','in',members)
    .selectFields(['userId','userFullName','username','disabled','terminateDate'])
    .orderBy('userFullName').disableAuthz().list().findAll { it.disabled != 'Y' &&
        (!it.terminateDate || it.terminateDate > now) }
if (!accounts) return []
def memberships = ec.entity.find('moqui.security.UserGroupMember').condition('userId','in',accounts*.userId)
    .conditionDate('fromDate','thruDate',now).selectFields(['userId','userGroupId']).disableAuthz().list()
def groupIds = memberships*.userGroupId.unique()
if (!groupIds) return []
def eligibleGroups = ['ADMIN','ZENITH_ADMIN'] as Set
def grantedGroups = ec.entity.find('moqui.security.ArtifactAuthz').condition('artifactGroupId','Z_CRM')
    .condition('userGroupId','in',groupIds).condition('authzActionEnumId','AUTHZA_ALL')
    .condition('authzTypeEnumId','in',['AUTHZT_ALLOW','AUTHZT_ALWAYS']).selectField('userGroupId').disableAuthz().list()
eligibleGroups.addAll(grantedGroups*.userGroupId.findAll { !it.startsWith('ZENITH_ORG_') && it != 'ZENITH_ALL' })
def customIds = groupIds.findAll { it.startsWith('ZENITH_ORG_') }
if (customIds) {
    def roles = ec.entity.find('zenith.erp.base.OrganizationAccessRole').condition('organizationPartyId',organizationPartyId)
        .condition('userGroupId','in',customIds).selectFields(['userGroupId','selectionsJson']).disableAuthz().list()
    roles.each { role ->
        def selections = new groovy.json.JsonSlurper().parseText(role.selectionsJson)
        if (selections.crm?.any { it in routes }) eligibleGroups.add(role.userGroupId)
    }
}
def eligibleUsers = memberships.findAll { eligibleGroups.contains(it.userGroupId) }*.userId.toSet()
return accounts.findAll { eligibleUsers.contains(it.userId) }.collect {
    [userId:it.userId,userFullName:it.userFullName,username:it.username]
}
