// Run against a disposable Moqui runtime with its libraries and CRM_QA_PASSWORD.
import org.moqui.Moqui
import org.moqui.impl.context.ExecutionContextFactoryImpl

assert System.getProperty('crm.qa.disposable') == 'true'
System.setProperty('moqui.runtime', new File('runtime').absolutePath)
System.setProperty('moqui.conf', 'conf/MoquiDevConf.xml')
def ecf = new ExecutionContextFactoryImpl()
Moqui.dynamicInit(ecf)
try {
    def ec = ecf.executionContext
    assert ec.user.loginUser('john.doe', System.getenv('CRM_QA_PASSWORD'))
    ec.artifactExecution.disableAuthz()
    def began = ec.transaction.begin(null)
    try {
        def org = 'CRM_QA_SCHEDULER', other = 'CRM_QA_ALT'
        def create = { name, fields -> ec.entity.makeValue(name).setAll(fields).create() }
        [org, other].each { create('mantle.party.Party', [partyId:it, partyTypeEnumId:'PtyOrganization']) }
        def screens = 'component://zenith-erp-crm/screen/zenith/crm/Crm/'
        def screen = { name, inputs, inspect ->
            ec.context.push([crmOrganization:[activeOrgId:org]] + inputs)
            try {
                ecf.screen.getScreenDefinition(screens + name + '.xml').rootSection.actions.run(ec)
                inspect(ec.context)
            } finally { ec.context.pop() }
        }
        def picker = new File('runtime/component/zenith-erp-crm/script/RecordPicker.groovy')
        def search = { kind, term, scope = org ->
            def results
            def web = [parameters:[term:term], sendJsonResponse:{ results = it }]
            def bindings = [ec:[entity:ec.entity, web:web], crmPickerKind:kind, crmOrganization:[activeOrgId:scope]]
            new GroovyShell(new Binding(bindings)).evaluate(picker)
            results
        }
        for (int i = 1; i <= 32; i++) {
            def suffix = String.format('%02d', i)
            create('zenith.erp.crm.Lead', [organizationPartyId:org, leadId:'QA_L' + suffix, firstName:'Amber', lastName:'Smith ' + suffix])
        }
        create('zenith.erp.crm.Lead', [organizationPartyId:other, leadId:'QA_OUTSIDE', firstName:'Amber', lastName:'Smith'])
        assert search('lead', 'SMITH amber')*.value == (1..25).collect { String.format('QA_L%02d', it) }
        assert search('lead', 'QA_L32') == [[value:'QA_L32', label:'Amber Smith 32']]
        assert search('lead', 'QA_OUTSIDE') == [] && search('lead', 'Amber', '_NA_') == []
        create('mantle.sales.opportunity.SalesOpportunity', [organizationPartyId:org, salesOpportunityId:'QA_DEAL', opportunityName:'Spring Sale'])
        assert search('opportunity', 'spring') == [[value:'QA_DEAL', label:'Spring Sale']]
        create('zenith.erp.crm.LeadSource', [leadSourceId:'QA_Source', description:'QA Source', organizationPartyId:org])
        create('zenith.erp.crm.CrmCampaign', [organizationPartyId:org, campaignId:'QA_CAMP', campaignName:'Seasonal launch',
                campaignKey:'spring launch', leadSourceId:'QA_Source', medium:'social'])
        assert search('campaign', 'launch seasonal') == [[value:'QA_CAMP', label:'Seasonal launch']]
        screen('SourcesCampaigns', [trackingCampaignId:'QA_CAMP', destinationUrl:'https://example.org/shop?x=a%2Fb&%75tm_source=old&x=2&utm_content=old#item',
                utmTerm:'new size']) { ctx ->
            assert ctx.trackingUrl == 'https://example.org/shop?x=a%2Fb&x=2&utm_content=old&utm_source=qa_source&utm_medium=social&utm_campaign=spring+launch&utm_term=new+size&crm_campaign_id=QA_CAMP#item'
        }
        def time = ec.user.nowTimestamp
        for (int i = 1; i <= 4; i++) {
            create('zenith.erp.crm.CrmActivity', [organizationPartyId:org, activityId:'QA_T' + i, subject:'Task ' + i,
                    activityType:'Task', activityDate:time, dueDate:time, statusId:'Scheduled'])
        }
        create('zenith.erp.crm.CrmActivity', [organizationPartyId:org, activityId:'QA_LOG', subject:'Legacy note', activityDate:time])
        create('zenith.erp.crm.CrmActivity', [organizationPartyId:org, activityId:'QA_DONE', subject:'Done', statusId:'Completed'])
        create('zenith.erp.crm.CrmActivity', [organizationPartyId:org, activityId:'QA_UNDATED', subject:'Unclassified'])
        screen('Activities', [view:'completed', period:'all']) {
            assert it.activityList*.activityId.toSet() == ['QA_LOG','QA_DONE'].toSet()
        }
        [0, 1].each { index ->
            screen('Activities', [view:'agenda', period:'all', pageIndex:index, pageSize:2]) {
                assert it.activityListPageIndex == index && it.activityListPageMaxIndex == 1
                assert it.agendaDays[0].rows*.activityId == (index == 0 ? ['QA_T1','QA_T2'] : ['QA_T3','QA_T4'])
            }
        }
        println 'Passed scoped and bounded CRM pickers, campaign attribution, legacy completion and agenda pages.'
    } finally { ec.transaction.rollback(began, 'Discard CRM QA fixtures', null) }
} finally { ecf.destroy() }
System.exit(0)
