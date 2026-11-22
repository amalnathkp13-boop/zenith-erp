// Run with GroovyMain on a seeded disposable Moqui runtime and -Dsales.qa.disposable=true.
import java.sql.Timestamp
import org.moqui.Moqui
import org.moqui.impl.context.ExecutionContextFactoryImpl

assert Boolean.getBoolean('sales.qa.disposable')
System.setProperty('moqui.runtime', new File('runtime').absolutePath)
System.setProperty('moqui.conf', 'conf/MoquiDevConf.xml')
def factory = new ExecutionContextFactoryImpl()
Moqui.dynamicInit(factory)
try {
    def ec = factory.executionContext
    assert ec.user.loginUser('john.doe', System.getenv('SALES_QA_PASSWORD'))
    ec.artifactExecution.disableAuthz()
    def began = ec.transaction.begin(180)
    try {
        def create = { entity, fields -> ec.entity.makeValue(entity).setAll(fields).create() }
        def org = 'QA_FC_SELLER', buyer = 'QA_FC_BUYER'
        [org, buyer].each { create('mantle.party.Party', [partyId:it, partyTypeEnumId:'PtyOrganization']) }
        def zone = ec.user.timeZone.toZoneId()
        def today = ec.user.nowTimestamp.toInstant().atZone(zone).toLocalDate()
        def date = { daysAgo -> Timestamp.from(today.minusDays(daysAgo).atStartOfDay(zone).toInstant()) }
        def service = { name, params ->
            def result = ec.service.sync().name("zenith.sales.SalesForecastServices.${name}").parameters([organizationPartyId:org] + params).call()
            assert !ec.message.hasError() : ec.message.errorsString
            result
        }
        def groups = [[id:'QA_FC_TEA', name:'QA Tea', rate:10], [id:'QA_FC_ICE', name:'QA Tea Iced', rate:90]]
        groups.each { group ->
            create('mantle.product.category.ProductCategory', [productCategoryId:group.id, categoryName:group.name])
            create('mantle.product.Product', [productId:group.id, ownerPartyId:org, productTypeEnumId:'PtAsset'])
            create('mantle.product.category.ProductCategoryMember', [productCategoryId:group.id, productId:group.id, fromDate:date(40)])
        }
        def invoice = { group, day, tag, currency = 'INR' ->
            def id = "QA_FC_${tag}_${day}"
            create('mantle.account.invoice.Invoice', [invoiceId:id, fromPartyId:org, toPartyId:buyer,
                invoiceTypeEnumId:'InvoiceSales', statusId:'InvoiceFinalized', currencyUomId:currency,
                invoiceDate:date(day), totalTaxableAmount:group.rate, totalTaxAmount:0])
            create('mantle.account.invoice.InvoiceItem', [invoiceId:id, invoiceItemSeqId:'01', itemTypeEnumId:'ItemProduct',
                productId:group.id, quantity:1, amount:group.rate, taxableAmount:group.rate, totalTaxAmount:0])
            // POS sync writes its fee-inclusive gross after the invoice-item totals handler.
            def header = ec.entity.find('mantle.account.invoice.Invoice').condition('invoiceId',id).one()
            header.invoiceTotal = group.rate + 2.5G
            header.roundOffAmount = 0.5G
            header.update()
        }
        (1..14).each { day -> invoice(groups[0], day, 'T'); invoice(groups[1], day, 'I') }
        [-1, 0].each { day -> invoice(groups[0], day, 'X') }
        def categories = service('forecast#CategorySales', [:]).categories
        assert categories*.category == ['QA Tea Iced', 'QA Tea']
        assert categories*.recent30 == [1260, 140]
        assert categories*.projectedNext7 == [630, 70]
        assert service('forecast#Sales', [:]).projectedNext7 == 742
        def yesterday = java.sql.Date.valueOf(today.minusDays(1))
        create('zenith.erp.sales.SalesRevenueForecast', [forecastId:'QA_FC_LEGACY', organizationPartyId:org,
                dimension:'Category', dimensionValue:'QA Tea', periodDate:yesterday, predictedAmount:10])
        create('zenith.erp.sales.SalesRevenueForecast', [forecastId:'QA_FC_RENAMED', organizationPartyId:org,
                dimension:'Category', dimensionValue:'Previous name', productCategoryId:groups[1].id, periodDate:yesterday, predictedAmount:90])
        create('zenith.erp.sales.SalesRevenueForecast', [forecastId:'QA_FC_OVERALL', organizationPartyId:org,
                dimension:'Overall', dimensionValue:'ALL', periodDate:yesterday, predictedAmount:106])
        service('cycle#SalesForecast', [:])
        [QA_FC_LEGACY:10, QA_FC_RENAMED:90, QA_FC_OVERALL:106].each { id, actual ->
            assert ec.entity.find('zenith.erp.sales.SalesRevenueForecast').condition('forecastId',id).one().actualAmount == actual
        }
        assert ec.entity.find('zenith.erp.sales.SalesRevenueForecast').condition('organizationPartyId',org)
                .condition('productCategoryId',groups[0].id).count() == 14
        (1..14).each { day -> invoice(groups[0], day, 'USD', 'USD') }
        assert service('forecast#Sales', [currencyUomId:'USD']).projectedNext7 == 91
        def threeDays = service('forecast#Sales', [currencyUomId:'USD', horizonDays:3])
        assert threeDays.points.size() == 3 && threeDays.projectedHorizon == 39 && threeDays.projectedNext7 == 91
        assert service('forecast#Sales', [currencyUomId:'INR']).projectedNext7 == 742
        assert service('forecast#CategorySales', [currencyUomId:'USD']).categories*.recent30 == [140]
        create('zenith.erp.sales.SalesRevenueForecast', [forecastId:'QA_FC_UNKNOWN', organizationPartyId:org,
                dimension:'Overall', dimensionValue:'ALL', periodDate:yesterday, predictedAmount:119])
        service('cycle#SalesForecast', [currencyUomId:'USD'])
        def future = { code -> ec.entity.find('zenith.erp.sales.SalesRevenueForecast').condition('organizationPartyId',org)
                .condition('currencyUomId',code).condition('dimension','Overall').condition('periodDate',java.sql.Date.valueOf(today)).one() }
        assert future('USD').predictedAmount == 13 && future('INR').predictedAmount == 106
        assert ec.entity.find('zenith.erp.sales.SalesRevenueForecast').condition('forecastId','QA_FC_UNKNOWN').one().actualAmount == null
        // Retain two equally busy selling days with a gap of more than two weeks.
        ec.entity.find('mantle.account.invoice.Invoice').condition('fromPartyId', org).list().each { row ->
            if (row.invoiceDate < date(0)) { row.invoiceDate = row.invoiceDate < date(7) ? date(20) : date(1); row.update() }
        }
        def sparse = service('forecast#Sales', [productCategoryId:groups[0].id])
        assert sparse.historyDays == 2 && !sparse.points
        println 'PASS category IDs, completed-day totals, sparse history, mixed-currency forecasts and historical calibration'
    } finally {
        ec.transaction.rollback(began, 'Disposable forecast fixtures', null)
        ec.artifactExecution.enableAuthz()
    }
} finally { Moqui.destroyActiveExecutionContextFactory() }
System.exit(0)
