// Run from the disposable Moqui runtime with its libraries and CRM_QA_PASSWORD.
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
        def create = { name, fields -> ec.entity.makeValue(name).setAll(fields).create() }
        def service = { name, fields ->
            def result = ec.service.sync().name('zenith.crm.CrmServices.' + name).parameters(fields).call()
            assert !ec.message.hasError() : ec.message.errorsString
            result
        }
        def org = 'CRM_QA_VENDOR', otherOrg = 'CRM_QA_OTHER_VENDOR', buyer = 'CRM_QA_PURCHASER'
        [org,otherOrg,buyer].each { id ->
            create('mantle.party.Party', [partyId:id, partyTypeEnumId:'PtyOrganization', ownerPartyId:id == buyer ? org : null])
        }
        create('mantle.party.PartyRole', [partyId:buyer, roleTypeId:'Customer'])
        ec.user.setPreference('ACTIVE_ORGANIZATION', org)
        def time = ec.user.nowTimestamp
        def order = { id, status, amounts, headerTotal, date ->
            create('mantle.order.OrderHeader', [orderId:id, statusId:status, entryDate:date, grandTotal:headerTotal])
            amounts.eachWithIndex { part, i ->
                create('mantle.order.OrderPart', [orderId:id, orderPartSeqId:i.toString(), customerPartyId:buyer,
                        vendorPartyId:part.vendor, partTotal:part.amount])
            }
        }
        def earlier = new java.sql.Timestamp(time.time - 86400000L)
        order('CRM_QA_MULTI', 'OrderCompleted', [[vendor:org,amount:20G],[vendor:org,amount:30G],[vendor:otherOrg,amount:200G]], 250G, earlier)
        order('CRM_QA_SINGLE', 'OrderApproved', [[vendor:org,amount:10G]], 10G, earlier)
        order('CRM_QA_OPEN', 'OrderOpen', [[vendor:org,amount:500G]], 500G, time)
        order('CRM_QA_LEGACY', 'OrderApproved', [[vendor:org,amount:null]], 40G, time)
        order('CRM_QA_SHARED', 'OrderApproved', [[vendor:org,amount:5G],[vendor:org,amount:null],[vendor:otherOrg,amount:null]], 50G, time)
        def summary = service('get#CustomerAnalytics', [partyId:buyer])
        assert summary.totalOrders == 4 && summary.totalSpend == 105G && summary.avgOrderValue == 26.25G : summary
        assert summary.lastOrderDate == time
        def segmentId = 'CRM_QA_PURCHASE_RULE'
        create('zenith.erp.crm.CustomerSegment', [segmentId:segmentId, segmentName:'Purchase rule', organizationPartyId:org])
        create('zenith.erp.crm.SegmentCriteria', [criteriaId:'CRM_QA_COUNT', segmentId:segmentId, criteriaTypeEnumId:'SctOrderCount',
                operator:'lte', fieldValue:'4', sequenceNum:1])
        create('zenith.erp.crm.SegmentCriteria', [criteriaId:'CRM_QA_SPEND', segmentId:segmentId, criteriaTypeEnumId:'SctTotalSpend',
                operator:'lte', fieldValue:'105', sequenceNum:2, joinOperator:'AND'])
        create('zenith.erp.crm.SegmentCriteria', [criteriaId:'CRM_QA_COUNT_MIN', segmentId:segmentId, criteriaTypeEnumId:'SctOrderCount',
                operator:'gte', fieldValue:'4', sequenceNum:3, joinOperator:'AND'])
        create('zenith.erp.crm.SegmentCriteria', [criteriaId:'CRM_QA_SPEND_MIN', segmentId:segmentId, criteriaTypeEnumId:'SctTotalSpend',
                operator:'gte', fieldValue:'105', sequenceNum:4, joinOperator:'AND'])
        service('evaluate#Segment', [segmentId:segmentId])
        assert ec.entity.find('zenith.erp.crm.SegmentMember').condition([segmentId:segmentId, partyId:buyer]).one()
        println 'Passed customer totals and segment membership for multipart and mixed-vendor orders.'
    } finally {
        ec.transaction.rollback(began, 'Discard disposable QA data', null)
        ec.artifactExecution.enableAuthz()
    }
} finally {
    Moqui.destroyActiveExecutionContextFactory()
}
System.exit(0)
