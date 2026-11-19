import org.moqui.context.ArtifactAuthorizationException

if (!crmCanExport) throw new ArtifactAuthorizationException('Your role does not include CRM bulk export.')

// The screen and dataset pair fixes both the query and the fields that may leave this module.
def columns = [
    Leads:[leadList:'leadId firstName lastName companyName email mobile sourceName campaignName assignedToUserId score estimatedAmount statusId createdDate firstTouchSourceId latestTouchSourceId utmSource utmMedium utmCampaign utmContent utmTerm'],
    Pipeline:[oppList:'salesOpportunityId opportunityName accountName currencyUomId estimatedAmount estimatedProbability expectedRevenue stageName estimatedCloseDate assignedToUserId leadSourceId'],
    Activities:[activityList:'activityId activityType subject activityDate dueDate statusId priority contactPartyId leadId salesOpportunityId outcome assignedToUserId durationMinutes nextFollowUpDate'],
    Contacts:[contacts:'partyId organizationName firstName lastName emailAddress phoneNumber partyTypeEnumId'],
    Segments:[segments:'segmentId segmentName segmentTypeEnumId description memberCount lastEvaluatedDate isActive'],
    SourcesCampaigns:[campaigns:'campaignId campaignName leadSourceId medium startDate endDate budgetAmount isActive'],
    Reports:[sourceRows:'sourceName leads qualified qualifiedPercent opportunities won wonValue',
             forecastRows:'stageName currency deals amount weighted']
]
def currentScreen = sri.screenUrlInfo.targetScreen
def names = columns[currentScreen.screenName]?.get(dataset)?.tokenize()
if (!names || !(format in ['csv','xlsx'])) throw new IllegalArgumentException('Choose an available CRM export.')

// Run the same actions as the current screen, retaining its ordinary role, tenant and filter checks.
ec.context.pageNoLimit = true
currentScreen.rootSection.actions.run(ec)
def records = ec.context[dataset]
def rows = records.collect { record ->
    names.collect { field ->
        def value = field == 'expectedRevenue' && dataset == 'oppList' ?
                (record.estimatedAmount ?: 0G) * (record.estimatedProbability ?: 0G) : record[field]
        // Spreadsheet applications may interpret user-provided text as a formula in a CSV.
        if (format == 'csv' && value instanceof CharSequence && value.toString() ==~ /(?s)^\s*[=+@-].*/) return "'" + value
        return value
    }
}
def headers = names.collect { it.replaceAll(/([a-z])([A-Z])/, '$1 $2').capitalize() }
def output = format == 'csv' ?
        ec.service.sync().name('zenith.contacts.ContactServices.build#ListCsv').parameters([headers:headers, rows:rows]).disableAuthz().call().csvText.getBytes('UTF-8') :
        ec.service.sync().name('zenith.contacts.ContactServices.build#ListXlsx').parameters([sheetName:currentScreen.screenName, headers:headers, rows:rows]).disableAuthz().call().xlsxBase64.decodeBase64()
def response = ec.web.response
response.setHeader('Cache-Control','private, no-store')
response.setHeader('Content-Disposition','attachment; filename="CRM-' + dataset + '.' + format + '"')
response.setContentType(format == 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
response.outputStream.write(output)
response.outputStream.flush()
