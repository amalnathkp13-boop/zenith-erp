import org.moqui.entity.EntityCondition

// The caller has authorized the sale and issuing shop. Count the whole shop across its counters.
def zone = java.time.ZoneId.of('Asia/Kolkata')
return ec.entity.find('zenith.erp.pos.KotTransactionDetailView')
    .condition([kotOrganizationPartyId:orgId,organizationPartyId:orgId,ztfSessionOrg:orgId,ztfTerminalOrg:orgId,facilityId:shopId])
    .condition('transactionNumber',EntityCondition.IS_NOT_NULL,null)
    .condition('completedDate',EntityCondition.GREATER_THAN_EQUAL_TO,java.sql.Timestamp.from(billDay.atStartOfDay(zone).toInstant()))
    .condition('completedDate',EntityCondition.LESS_THAN,java.sql.Timestamp.from(billDay.plusDays(1).atStartOfDay(zone).toInstant()))
    .useCache(false).disableAuthz()
