// From a disposable seeded Moqui runtime, run with its libraries and the demo CRM_QA_PASSWORD.
// Supply -Dsales.qa.disposable=true and -Dsales.qa.source=<absolute path to the candidate repository>.
import groovy.xml.XmlSlurper
import org.moqui.Moqui
import org.moqui.impl.context.ExecutionContextFactoryImpl

assert Boolean.getBoolean('sales.qa.disposable')
System.setProperty('moqui.runtime',new File('runtime').absolutePath)
System.setProperty('moqui.conf','conf/MoquiDevConf.xml')
def ecf = new ExecutionContextFactoryImpl()
Moqui.dynamicInit(ecf)
def exitCode = 1
try {
    def ec = ecf.executionContext
    assert ec.user.loginUser('john.doe', System.getenv('CRM_QA_PASSWORD'))
    ec.artifactExecution.disableAuthz()
    def tx = ec.transaction.begin(120)
    try {
        def source = new File(System.getProperty('sales.qa.source'), 'component/zenith-erp-sales/screen/zenith/sales')
        def sections = { File file -> new XmlSlurper(false, false).parse(file).actions.script.collect { it.text() } }
        def compile = { String code -> new GroovyShell(this.class.classLoader).parse(code) }
        def dashboard = sections(new File(source,'SalesDashboard.xml'))
        def summary = compile(dashboard.find { it.contains('invoiceSummaryFor =') })
        def categories = compile(dashboard.find { it.contains('DashboardCategoryTotals') })
        def register = compile(sections(new File(source,'PosSalesRegister.xml')).find { it.contains('paymentsByTransaction') })
        def make = { entity, fields -> ec.entity.makeValue(entity).setAll(fields).create() }
        def org = 'SRQA_ORG', other = 'SRQA_OTHER', shop = 'SRQA_SHOP', shopB = 'SRQA_SHOP_B'
        for (id in [org, other]) make('mantle.party.Party',[partyId:id,partyTypeEnumId:'PtyOrganization'])
        def day = java.time.LocalDate.of(2026, 8, 10)
        def start = java.sql.Timestamp.from(day.atStartOfDay(ec.user.timeZone.toZoneId()).toInstant())
        def end = java.sql.Timestamp.from(day.plusDays(1).atStartOfDay(ec.user.timeZone.toZoneId()).toInstant())
        def last = java.sql.Timestamp.from(end.toInstant().minusMillis(1))
        def card = { id, seller, place, status, date, amount ->
            make('mantle.account.invoice.Invoice',[invoiceId:id, fromPartyId:seller, facilityId:place, invoiceTypeEnumId:'InvoiceSales',
                 statusId:status, invoiceDate:date, totalTaxableAmount:amount, totalTaxAmount:amount==10G ? 2G : null, roundOffAmount:0.1G])
        }
        card('SRQA_BASE',org,shop,'InvoiceFinalized',start,10G)
        card('SRQA_PAID',org,shop,'InvoicePmtRecvd',last,20G)
        card('SRQA_DRAFT',org,shop,'InvoiceInProcess',start,40G)
        card('SRQA_CANCEL',org,shop,'InvoiceCancelled',start,80G)
        card('SRQA_END',org,shop,'InvoiceFinalized',end,160G)
        card('SRQA_OTHER_SHOP',org,shopB,'InvoiceFinalized',start,320G)
        card('SRQA_OTHER_ORG',other,shop,'InvoiceFinalized',start,640G)
        // No split, native zero, positive fees, and negative round-off all use stored gross if present.
        for (details in [['SRQA_LEGACY', null, 35G, 0.5G], ['SRQA_ZERO', 7G, 0G, 0G], ['SRQA_FEE', 10G, 14G, -0.5G]]) {
            make('mantle.account.invoice.Invoice',[invoiceId:details[0], fromPartyId:org, facilityId:shop, invoiceTypeEnumId:'InvoiceSales',
                    statusId:'InvoiceFinalized', invoiceDate:start, totalTaxableAmount:details[1], invoiceTotal:details[2], roundOffAmount:details[3]])
        }
        make('mantle.account.invoice.Invoice',[invoiceId:'SRQA_USD', fromPartyId:org, facilityId:shop, currencyUomId:'USD',
                invoiceTypeEnumId:'InvoiceSales', statusId:'InvoicePmtRecvd', invoiceDate:start, invoiceTotal:60G])
        make('mantle.account.invoice.Invoice',[invoiceId:'SRQA_EUR', fromPartyId:org, facilityId:shopB, currencyUomId:'EUR',
                invoiceTypeEnumId:'InvoiceSales', statusId:'InvoiceFinalized', invoiceDate:start, invoiceTotal:70G])
        def bind = new Binding([ec:ec,orgId:org,_activeShop:shop,dayStart:start,dayEndExcl:end,
                _mixedOrders:[mixedOrderIds:[]],salesSpark:'[]',quotesSpark:'[]',custSpark:'[]',invSpark:'[]'])
        def selectCurrency = { requested ->
            def report = ec.resource.script('component://zenith-erp-sales/script/ReportingCurrency.groovy',null,
                    [reportOrgId:org, reportShopId:bind._activeShop, currencyUomId:requested])
            report.each { key, value -> bind.setVariable(key, value) }
            bind.invoiceCurrencyCondition = ec.resource.script('component://zenith-erp-sales/script/ReportingCurrencyCondition.groovy', null,
                    [currency:report.reportCurrency, includeUnspecified:report.reportCurrency == 'INR'])
            bind.forecastCurrencyCondition = ec.resource.script('component://zenith-erp-sales/script/ReportingCurrencyCondition.groovy', null,
                    [currency:report.reportCurrency, includeUnspecified:report.legacyForecastCurrency == report.reportCurrency])
            assert report.organizationCurrencies.toSet() == ['EUR','INR','USD'].toSet()
            assert report.legacyForecastCurrency == null
            report
        }
        def options = selectCurrency('EUR')
        assert options.reportCurrency == 'INR' && options.reportCurrencies.toSet() == ['INR','USD'].toSet()
        summary.binding=bind
        summary.run()
        assert bind.totalSalesAmount == 81.2G && bind.totalInvoices == 6 && bind.salesStatusJson == '[1,4]'
        assert bind.invoiceSummaryFor.call(end, end).revenue == 0G
        selectCurrency('USD')
        summary.run()
        assert bind.totalSalesAmount == 60G && bind.totalInvoices == 1 && bind.salesStatusJson == '[1,0]'
        bind._activeShop=null
        options = selectCurrency('INR')
        summary.run()
        assert options.reportCurrencies.toSet() == ['EUR','INR','USD'].toSet()
        assert bind.invoiceSummaryFor.call(start,end).revenue == 401.3G
        bind._activeShop=shop
        selectCurrency('INR')
        make('mantle.product.Product',[productId:'SRQA_PRODUCT'])
        make('mantle.product.category.ProductCategory',[productCategoryId:'SRQA_CATEGORY', categoryName:'Synthetic category'])
        make('mantle.product.category.ProductCategoryMember',[productCategoryId:'SRQA_CATEGORY', productId:'SRQA_PRODUCT',fromDate:start])
        make('mantle.product.category.ProductCategoryMember',[productCategoryId:'SRQA_CATEGORY', productId:'SRQA_PRODUCT',fromDate:new java.sql.Timestamp(start.time-86400000L),thruDate:start])
        make('mantle.product.category.ProductCategoryMember',[productCategoryId:'SRQA_CATEGORY', productId:'SRQA_PRODUCT',fromDate:end])
        for (id in ['SRQA_BASE','SRQA_PAID','SRQA_DRAFT','SRQA_CANCEL','SRQA_END','SRQA_OTHER_SHOP','SRQA_OTHER_ORG']) {
            make('mantle.account.invoice.InvoiceItem',[invoiceId:id, invoiceItemSeqId:'01', productId:'SRQA_PRODUCT', taxableAmount:10G, totalTaxAmount:1.5G])
        }
        make('mantle.account.invoice.InvoiceItem',[invoiceId:'SRQA_USD',invoiceItemSeqId:'01',productId:'SRQA_PRODUCT',taxableAmount:8G,totalTaxAmount:1G])
        def categoryLines=ec.entity.find('zenith.erp.sales.InvoiceCategorySalesView').condition('invoiceId','SRQA_BASE')
            .selectFields(['productCategoryId','taxableAmount']).list()
        assert categoryLines.size()==1 && categoryLines[0].productCategoryId=='SRQA_CATEGORY'
        categories.binding=bind
        categories.run()
        assert bind.catValsJson == '[23]' && bind.catNamesJson.contains('Synthetic category')
        selectCurrency('USD')
        categories.run()
        assert bind.catValsJson == '[9]' && bind.catNamesJson.contains('Synthetic category')
        def n = 5
        for (place in [shop,shopB]) {
            make('mantle.facility.Facility',[facilityId:place,ownerPartyId:org,facilityTypeEnumId:'FcTpRetailStore'])
            make('zenith.erp.pos.PosTerminal',[terminalId:place,organizationPartyId:org,facilityId:place])
            make('zenith.erp.pos.PosSession',[sessionId:place,terminalId:place,organizationPartyId:org])
        }
        def makeTxn = { id,seller,time,amount ->
            make('zenith.erp.pos.PosTransaction',[transactionId:id,organizationPartyId:seller,statusId:'PtCompleted',transactionType:'Sale',entryDate:time,
                    sessionId:id=='SRQA_OTHERSHOP' ? shopB : shop, grandTotal:20G, roundOff:0.5G, payableAmount:amount,transactionNumber:id])
        }
        for (int i=1; i<=n; i++) {
            def id = 'SRQA_BILL_'+i
            makeTxn(id,org,last, i==1 ? 0G : (i==2 ? null : 20G))
            for (method in ['Cash','Card']) {
                make('zenith.erp.pos.PosPayment',[paymentId:id+method,transactionId:id,paymentMethod:method,amount:10G,paymentDate:last])
            }
        }
        makeTxn('SRQA_TOMORROW',org,end,20G)
        makeTxn('SRQA_FOREIGN',other,last,20G)
        makeTxn('SRQA_OTHERSHOP',org,last,20G)
        def params = [entryDate_from:day.toString(),entryDate_thru:day.toString()]
        // The normal screen gets its parameters and formatting helper from the HTTP context.
        def registerEc = [entity:ec.entity, artifactExecution:ec.artifactExecution,user:ec.user,l10n:ec.l10n,message:ec.message,web:[parameters:params]]
        def registerBinding = new Binding([ec:registerEc, activeOrg:org, salesShopScope:[activeShopId:shop], zinr:[inr:{ value -> value }]])
        register.binding=registerBinding
        register.run()
        assert registerBinding.salesList.size()==n
        def first=registerBinding.salesList.find { it.transactionId=='SRQA_BILL_1' }
        assert first.amount==0 && first.payMethods=='Card, Cash' && first.saleClosed==last
        assert registerBinding.salesList.find { it.transactionId=='SRQA_BILL_2' }.amount==20.5G
        registerBinding.salesShopScope=[activeShopId:'__NONE__',shopAccessRestricted:true]
        register.run()
        assert registerBinding.salesList.isEmpty()
        registerBinding.salesShopScope=[activeShopId:shop,shopAccessRestricted:true]
        params.entryDate_thru='2026-13-50'
        register.run()
        assert registerBinding.salesList.isEmpty()
        println "SALES_REPORT_QA passed shop, seller, draft, paid, cancelled, midnight, category, split tender, zero bill and invalid date checks."
    } finally { if (tx) ec.transaction.rollback(true,'Disposable Sales report fixtures',null) }
    exitCode=0
} catch(Throwable error) { error.printStackTrace(System.out) } finally { Moqui.destroyActiveExecutionContextFactory(); System.exit(exitCode) }

