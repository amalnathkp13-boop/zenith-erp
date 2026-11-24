import java.sql.Timestamp
import org.moqui.entity.EntityCondition

// Rank completed trading days using one aggregate row per category.
def zone = ec.user.timeZone.toZoneId()
def today = ec.user.nowTimestamp.toInstant().atZone(zone).toLocalDate()
def currencyFilter = ec.resource.script('component://zenith-erp-sales/script/ReportingCurrencyCondition.groovy', null,
        [currency:currencyUomId, includeUnspecified:currencyUomId == 'INR'])
def rows = ec.entity.find('zenith.erp.sales.DashboardCategoryTotals')
        .condition(currencyFilter)
        .condition('fromPartyId', organizationPartyId).condition('invoiceTypeEnumId', 'InvoiceSales')
        .condition('statusId', 'in', ['InvoiceFinalized', 'InvoicePmtRecvd'])
        .condition('invoiceDate', EntityCondition.GREATER_THAN_EQUAL_TO, Timestamp.from(today.minusDays(30).atStartOfDay(zone).toInstant()))
        .condition('invoiceDate', EntityCondition.LESS_THAN, Timestamp.from(today.atStartOfDay(zone).toInstant()))
        .selectFields(['productCategoryId', 'taxableSum', 'taxSum']).list()
def top = rows.collect { [id: it.productCategoryId, revenue: (it.taxableSum ?: 0.0G) + (it.taxSum ?: 0.0G)] }
        .sort { a, b -> (b.revenue <=> a.revenue) ?: (a.id <=> b.id) }.take(topN)
if (top) {
    def names = ec.entity.find('mantle.product.category.ProductCategory').condition('productCategoryId', 'in', top*.id)
            .selectFields(['productCategoryId', 'categoryName']).list().collectEntries { [(it.productCategoryId): it.categoryName] }
    top.each { it.name = names[it.id] ?: it.id }
}
return top
