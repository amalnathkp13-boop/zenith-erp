import org.moqui.entity.EntityCondition

def orderQuery = { entityName ->
    def query = ec.entity.find(entityName).condition('vendorPartyId', vendorId)
        .condition('statusId', EntityCondition.IN, ['OrderCompleted','OrderApproved'])
    if (customerId) query.condition('customerPartyId', customerId)
    query
}

def metrics = [:]
def fields = ['customerPartyId','orderCount','partTotal']
if (customerId) fields.add('entryDate')
orderQuery('mantle.order.OrderHeaderAndPartSummary')
    .selectFields(fields).list().each { row ->
        def total = metrics.computeIfAbsent(row.customerPartyId) { [orderCount:0, partTotal:0G, lastOrderDate:null] }
        // The Mantle count alias inherits the orderId field type on some runtimes.
        total.orderCount += row.orderCount.toString().toInteger()
        total.partTotal += row.partTotal ?: 0G
        if (customerId && row.entryDate && (!total.lastOrderDate || row.entryDate > total.lastOrderDate))
            total.lastOrderDate = row.entryDate
    }

// Some imported orders only have a header amount. It belongs to this customer
// only when every part was sold by the same vendor to the same customer.
orderQuery('mantle.order.OrderHeaderAndPart').condition('partTotal', null)
    .selectFields(['orderId','customerPartyId','grandTotal']).distinct(true).list().each { order ->
        if (order.grandTotal == null) return
        def ownedParts = ec.entity.find('mantle.order.OrderPart').condition('orderId', order.orderId)
            .condition('vendorPartyId', vendorId).condition('customerPartyId', order.customerPartyId)
            .selectField('partTotal').list()
        // Count all parts so a user-level entity filter cannot make a shared order look exclusive.
        def partCount = ec.entity.find('mantle.order.OrderPart').condition('orderId', order.orderId).disableAuthz().count()
        if (ownedParts.size() == partCount) {
            def knownAmount = ownedParts.sum { it.partTotal ?: 0G } ?: 0G
            metrics[order.customerPartyId].partTotal += order.grandTotal - knownAmount
        }
    }
return metrics
