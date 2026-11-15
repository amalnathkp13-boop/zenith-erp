import org.moqui.entity.EntityCondition

// Read-only. Both print entry points check access to the transaction before calling this script.
def issuedNumber = null
if (receiptOptions.showInvoiceNumber) {
    def invoice = txn.linkedInvoiceId ? ec.entity.find('mantle.account.invoice.Invoice')
        .condition([invoiceId:txn.linkedInvoiceId,fromPartyId:txn.organizationPartyId]).disableAuthz().one() : null
    issuedNumber = invoice?.gstInvoiceNumber ?: invoice?.customInvoiceNumber
    if (!issuedNumber && txn.transactionNumber && !(txn.transactionNumber ==~ /POS\/\d{8}\/\d+/))
        issuedNumber = txn.transactionNumber
}
def dailyNumber = null
if (receiptOptions.showDailyBillNumber) {
    dailyNumber = ticket?.dailyBillNumber
    if (dailyNumber == null && ticket?.orderReceiptJson && terminal?.facilityId && txn.completedDate && txn.transactionNumber) {
        // Rank legacy bills by original completion time. New numbered bills and unissued drafts never affect it.
        def day = txn.completedDate.toInstant().atZone(java.time.ZoneId.of('Asia/Kolkata')).toLocalDate()
        def cf = ec.entity.conditionFactory
        def older = cf.makeCondition('completedDate',EntityCondition.LESS_THAN,txn.completedDate)
        def sameTime = cf.makeCondition([
            cf.makeCondition([completedDate:txn.completedDate]),
            cf.makeCondition('transactionId',EntityCondition.LESS_THAN_EQUAL_TO,txn.transactionId)
        ],EntityCondition.AND)
        def issued = ec.resource.script('component://zenith-erp-pos/script/KotIssuedBills.groovy',null,
            [orgId:txn.organizationPartyId,shopId:terminal.facilityId,billDay:day])
        dailyNumber = issued.condition('dailyBillNumber',null).condition(cf.makeCondition([older,sameTime],EntityCondition.OR))
            .selectField('transactionId').distinct(true).count() ?: null
    }
}
return [invoice:issuedNumber,daily:dailyNumber]
