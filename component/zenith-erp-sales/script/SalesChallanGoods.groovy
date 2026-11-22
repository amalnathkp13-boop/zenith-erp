// Resolve goods once for the authorized document. Old service-created rows may carry only a unit price.
def productIds = challanItems.findAll { !it.description && !it.remarks }*.productId.findAll().unique()
def products = productIds ? ec.entity.find('mantle.product.Product')
        .condition('ownerPartyId', challan.organizationPartyId).condition('productId', 'in', productIds)
        .selectFields(['productId','productName']).list().collectEntries { [(it.productId):it.productName] } : [:]
def unitIds = challanItems*.uomId.findAll().unique()
def units = unitIds ? ec.entity.find('moqui.basic.Uom').condition('uomId','in',unitIds)
        .selectFields(['uomId','description']).list().collectEntries { [(it.uomId):it.description] } : [:]
challanItems = challanItems.collect { item ->
    def row = new LinkedHashMap(item)
    row.description = item.description ?: item.remarks ?: products[item.productId] ?: item.productId
    row.unitDescription = units[item.uomId] ?: item.uomId
    row.estimatedValue = item.estimatedValue != null ? item.estimatedValue : (item.unitPrice ?: 0) * (item.quantity ?: 0)
    return row
}
