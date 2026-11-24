def currenciesFor = { shopId ->
    if (!reportOrgId || reportOrgId == '_NA_') return []
    def invoices = ec.entity.find('mantle.account.invoice.Invoice')
            .condition('fromPartyId', reportOrgId).condition('invoiceTypeEnumId', 'InvoiceSales')
            .selectField('currencyUomId').distinct(true)
    if (shopId) invoices.condition('facilityId', shopId)
    invoices.list().collect { it.currencyUomId ?: 'INR' }.unique().sort()
}
def orgCurrencies = currenciesFor(null)
def available = (reportShopId ? currenciesFor(reportShopId) : orgCurrencies) ?: ['INR']
def selected = available.contains(currencyUomId) ? currencyUomId : (available.contains('INR') ? 'INR' : available.first())
def symbol
try {
    symbol = java.util.Currency.getInstance(selected).getSymbol(Locale.US)
} catch (IllegalArgumentException ignored) {
    symbol = selected ==~ /[A-Z0-9_-]+/ ? selected : '¤'
}
return [reportCurrency:selected, reportCurrencies:available, organizationCurrencies:orgCurrencies,
        legacyForecastCurrency:orgCurrencies.size() == 1 ? orgCurrencies.first() : null, currSymbol:symbol]
