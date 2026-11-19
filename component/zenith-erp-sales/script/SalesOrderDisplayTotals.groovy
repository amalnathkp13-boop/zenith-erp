// Reads only the already-authorized order and its lines. Opening a historical document never writes to it.
orderLineAmounts = orderItems.collectEntries { line ->
    [(line.orderItemSeqId):ec.resource.script('component://zenith-erp-sales/script/SalesOrderLineAmount.groovy',
            null, [line:line, currency:order.currencyUomId])]
}
lineGrandTotal = orderItems ? orderItems.groupBy { it.orderPartSeqId }.values().sum { lines ->
    ec.l10n.roundCurrency(lines.sum { orderLineAmounts[it.orderItemSeqId].total },order.currencyUomId)
} : order?.grandTotal
hasHistoricalDifference = lineGrandTotal != null && order?.grandTotal != null && lineGrandTotal != order.grandTotal
displayOrderTotal = lineGrandTotal
if (hasHistoricalDifference) {
    boolean closed = order.statusId in ['OrderCompleted','OrderRejected','OrderCancelled']
    if (closed || ec.entity.find('mantle.order.OrderItemBilling').condition('orderId',order.orderId).count()) {
        displayOrderTotal = order.grandTotal
    }
}
