import org.moqui.entity.EntityCondition

// The search supplies only this organization's visible documents, including the mixed-vendor exclusion.
displayTotals = [:]
def active = salesRows.findAll { !(it.statusId in ['OrderCompleted','OrderRejected','OrderCancelled']) }
def currencyById = active.collectEntries { [(it.orderId):it.currencyUomId] }
currencyById.keySet().toList().collate(250).each { ids ->
    def billed = ec.entity.find('mantle.order.OrderItemBilling').condition('orderId',EntityCondition.IN,ids)
            .selectField('orderId').distinct(true).list()*.orderId.toSet()
    def openIds = ids.findAll { !billed.contains(it) }
    if (!openIds) return
    // Only a priced line can introduce the historical discount/tax discrepancy.
    def pricedIds = ec.entity.find('mantle.order.OrderItem').condition('orderId',EntityCondition.IN,openIds)
            .condition('taxableAmount',EntityCondition.NOT_EQUAL,null).selectField('orderId').distinct(true).list()*.orderId
    if (!pricedIds) return
    def lines = ec.entity.find('mantle.order.OrderItem').condition('orderId',EntityCondition.IN,pricedIds)
            .selectFields(['orderId','orderPartSeqId','quantity','selectedAmount','unitAmount','taxableAmount','totalTaxAmount','cgstAmount','sgstAmount','igstAmount']).list()
    lines.groupBy { it.orderId }.each { id, items ->
        displayTotals[id] = items.groupBy { it.orderPartSeqId }.values().sum { partLines ->
            def subtotal = partLines.sum { line ->
                ec.resource.script('component://zenith-erp-sales/script/SalesOrderLineAmount.groovy', null,
                        [line:line,currency:currencyById[id]]).total
            }
            ec.l10n.roundCurrency(subtotal,currencyById[id])
        }
    }
}
