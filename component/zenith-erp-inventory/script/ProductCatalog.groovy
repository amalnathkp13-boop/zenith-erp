import org.moqui.entity.EntityCondition

def request = ec.web?.parameters ?: [:]
def export = context.get('catalogExport') == Boolean.TRUE
def includeFilters = context.get('catalogIncludeFilters') == Boolean.TRUE
def trim = { value -> value instanceof CharSequence ? value.toString().trim() : '' }
def commaValues = { value ->
    def values = value instanceof Collection || value?.class?.array ? value.toList() : [value]
    return values.collectMany { trim(it).split(',').toList() }.collect { it.trim() }.findAll { it }
}
def positiveInt = { value, int fallback ->
    def raw = trim(value)
    return raw.isInteger() && raw.toInteger() >= 0 ? raw.toInteger() : fallback
}
def params = [
    catalogSearch: trim(request.catalogSearch),
    catalogMode: trim(request.catalogMode),
    catalogProductId: trim(request.catalogProductId),
    catalogCategoryId: trim(request.catalogCategoryId ?: request.productCategoryId),
    mrpMin: trim(request.mrpMin ?: request.mrpAmount_from ?: request.mrpAmount),
    mrpMax: trim(request.mrpMax ?: request.mrpAmount_thru ?: request.mrpAmount),
    catalogTaxCode: trim(request.catalogTaxCode),
    pageIndex: 0,
    pageSize: positiveInt(request.pageSize, 20)
]
def rates = commaValues(request.gstRates ?: request.gstRate)
params.gstRates = rates.join(',')
if (!(params.catalogMode in ['live', 'scan', 'product'])) params.catalogMode = 'live'
if (params.pageSize < 1 || params.pageSize > 200) params.pageSize = 20
def columns = ['productId', 'pseudoId', 'productName', 'gstRate', 'uqcEnumId', 'mrpAmount', 'catalogTaxCode']
def requestedOrder = commaValues(request.orderByField)
def sortField = { it.replaceFirst('^-', '') }
if (requestedOrder.size() > columns.size() || !requestedOrder.every { sortField(it) in columns }) requestedOrder = []
requestedOrder = requestedOrder.unique { sortField(it) }
params.orderByField = requestedOrder.join(',')

catalogData = [rows: [], total: 0, pageIndex: params.pageIndex, pageSize: params.pageSize,
               suggestions: [], filters: [categories: [], taxCodes: [], gstRates: []],
               params: params, error: null, barcodeMiss: false]
catalogReadError = null
catalogOrgId = '__NO_ORGANIZATION__'
def navigation = ec.service.sync().name('zenith.base.SecurityServices.get#ModuleNavigation').disableAuthz().call()
if (navigation?.roleRestricted != false && !navigation?.moduleIds?.contains('inventory')) {
    catalogReadError = 'Your role does not include access to Inventory.'
    return
}
// This service verifies the signed-in user's own organization even for an Inventory-only role.
def authorizedOrg = ec.service.sync().name('zenith.barcode.BarcodeServices.get#AuthorizedActiveOrganization')
    .disableAuthz().call().activeOrgId
if (!authorizedOrg) return
catalogOrgId = authorizedOrg

// Standalone rendering can skip the shared shell's plan and route checks.
if ((export || request.lastStandalone == 'true') && !ec.user.isInGroup('ADMIN')) {
    if (ec.user.userGroupIdSet.any { it.startsWith('ZENITH_ORG_') } &&
            ec.service.sync().name('zenith.base.RoleAccessServices.check#RoleRouteAccess').disableAuthz().call()?.allowed != true) {
        catalogReadError = 'Your role does not include access to Product Catalog.'
        return
    }
    def plan = ec.service.sync().name('zenith.saas.SaasGateServices.check#ModuleAccess')
        .parameter('moduleId', 'inventory').disableAuthz().call()
    if (plan?.allowed != true) {
        catalogReadError = 'Your plan does not include access to Inventory.'
        return
    }
}

def ef = ec.entity
def view = 'zenith.erp.inventory.ProductCatalogStockView'
def cf = ef.conditionFactory
def condition = { field, operator, value -> cf.makeCondition(field, operator, value) }
def and = { conditions -> cf.makeCondition(conditions, EntityCondition.AND) }
def or = { conditions -> cf.makeCondition(conditions, EntityCondition.OR) }
// Exclude products removed from the active catalogue (salesDiscontinuationDate reached), matching the POS/sales paths.
def catalog = { ef.find(view).condition('ownerPartyId', catalogOrgId).conditionDate('salesIntroductionDate', 'salesDiscontinuationDate', ec.user.nowTimestamp) }
def categories = { ef.find('mantle.product.category.ProductCategory').condition('ownerPartyId', catalogOrgId) }
if (includeFilters) {
    catalogData.filters = [
        categories: categories().selectFields(['productCategoryId', 'categoryName'])
            .orderBy('categoryName,productCategoryId').list().collect { [value: it.productCategoryId, label: it.categoryName] },
        taxCodes: catalog().selectField('catalogTaxCode').distinct(true)
            .orderBy('catalogTaxCode').list()*.catalogTaxCode.findAll { it?.trim() },
        gstRates: catalog().selectField('gstRate').distinct(true)
            .orderBy('gstRate').list()*.gstRate.findAll { it != null }
    ]
}

if (params.catalogSearch.length() > 2048 || params.catalogSearch.indexOf(0) >= 0 ||
    params.catalogProductId.length() > 100 || params.catalogCategoryId.length() > 100 ||
    params.catalogTaxCode.length() > 100) {
    catalogData.error = 'The search or filter value is too long.'
    return
}
if ([params.mrpMin, params.mrpMax].any { it && !(it ==~ /[0-9]{1,12}(?:\.[0-9]{1,2})?/) }) {
    catalogData.error = 'Enter a non-negative MRP with up to two decimal places.'
    return
}
def min = params.mrpMin ? new BigDecimal(params.mrpMin) : null
def max = params.mrpMax ? new BigDecimal(params.mrpMax) : null
if (min != null && max != null && min > max) {
    catalogData.error = 'Minimum MRP must be less than or equal to maximum MRP.'
    return
}
if (rates.size() > 30 || rates.any { !(it ==~ /[0-9]{1,3}(?:\.[0-9]{1,8})?/) }) {
    catalogData.error = 'Choose valid GST percentages.'
    return
}
def gst = rates.collect { new BigDecimal(it).stripTrailingZeros() }.unique()
params.gstRates = gst.collect { it.toPlainString() }.join(',')

def filters = []
if (min != null) filters.add(condition('mrpAmount', EntityCondition.GREATER_THAN_EQUAL_TO, min))
if (max != null) filters.add(condition('mrpAmount', EntityCondition.LESS_THAN_EQUAL_TO, max))
if (params.catalogTaxCode) filters.add(condition('catalogTaxCode', EntityCondition.EQUALS, params.catalogTaxCode).ignoreCase())
if (gst) filters.add(condition('gstRate', EntityCondition.IN, gst))
if (params.catalogCategoryId) {
    def categoryId = params.catalogCategoryId
    if (!categories().condition('productCategoryId', categoryId).count()) return
    def ids = ef.find('mantle.product.category.ProductCategoryMember')
        .condition('productCategoryId', categoryId).conditionDate('fromDate', 'thruDate', ec.user.nowTimestamp)
        .selectField('productId').distinct(true).list()*.productId
    if (!ids) return
    filters.add(condition('productId', EntityCondition.IN, ids))
}
if (params.catalogMode == 'product') {
    if (!params.catalogProductId) return
    filters.add(condition('productId', EntityCondition.EQUALS, params.catalogProductId))
}

def query = { match ->
    def find = catalog()
    filters.each { find.condition(it) }
    if (match != null) find.condition(match)
    return find
}
def defaultOrder = ['productName', 'pseudoId', 'productId']
def explicitOrder = requestedOrder ? requestedOrder + (defaultOrder - requestedOrder.collect(sortField)) : []
def fields = export ? columns + ['description', 'isGstExempt', 'totalQoh', 'reorderPoint', 'enableBatchTracking', 'productTypeEnumId'] : columns
def readRows = { match, order, int offset, Integer limit ->
    def find = query(match).selectFields(fields).orderBy(order)
    if (limit != null) find.offset(offset).limit(limit)
    return find.list().collect { row -> fields.collectEntries { name -> [(name): row.get(name)] } }
}

def search = params.catalogSearch
def matches = null
def bands = []
if (search && params.catalogMode != 'product') {
    def aliases = ec.service.sync().name('zenith.barcode.BarcodeServices.get#ScanAliases').parameter('code', search).disableAuthz().call().aliases ?: [search]
    def barcodes = ef.find('zenith.erp.barcode.ProductBarcode')
        .condition('organizationPartyId', catalogOrgId).condition('barcodeValue', EntityCondition.IN, aliases)
        .selectFields(['productId', 'isActive']).disableAuthz().list()
    // Match the barcode screen's legacy code fallback without collapsing ambiguous results.
    def disabled = barcodes.findAll { it.isActive == 'N' }*.productId as Set
    def barcodeIds = barcodes.findAll { it.isActive == 'Y' }*.productId as Set
    barcodeIds.addAll(ef.find('mantle.product.Product').condition('ownerPartyId', catalogOrgId)
        .condition('pseudoId', EntityCondition.IN, aliases).selectField('productId').list()
        .findAll { !disabled.contains(it.productId) }*.productId)
    def barcode = barcodeIds ? condition('productId', EntityCondition.IN, barcodeIds) : null
    if (params.catalogMode == 'scan' && barcode != null && query(barcode).count()) {
        matches = barcode
        bands = [barcode]
    } else {
        catalogData.barcodeMiss = params.catalogMode == 'scan'
        def escaped = search.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        def textFields = ['productName', 'pseudoId']
        def codeFields = ['pseudoId', 'productId']
        def nullCode = condition('pseudoId', EntityCondition.EQUALS, null)
        def noCode = or([nullCode, condition('pseudoId', EntityCondition.EQUALS, '')])
        def hasCode = and([condition('pseudoId', EntityCondition.NOT_EQUAL, null),
                           condition('pseudoId', EntityCondition.NOT_EQUAL, '')])
        def like = { field, value -> condition(field, EntityCondition.LIKE, value).ignoreCase() }
        def codeOrName = { value ->
            or(textFields.collect { like(it, value) } + [and([noCode, like('productId', value)])])
        }
        def notText = { names, op, value -> and(names.collect {
            or([condition(it, op, value).ignoreCase(), condition(it, EntityCondition.EQUALS, null)])
        }) }
        def exactCode = or(codeFields.collect { condition(it, EntityCondition.EQUALS, search).ignoreCase() })
        def prefix = codeOrName(escaped+'%')
        def broad = codeOrName('%'+escaped+'%')
        matches = or((barcode == null ? [] : [barcode]) + [exactCode, broad])

        def earlier = []
        if (barcode != null) {
            bands.add(barcode)
            earlier.add(condition('productId', EntityCondition.NOT_IN, barcodeIds))
        }
        bands.add(and(earlier + [exactCode]))
        earlier.add(notText(codeFields, EntityCondition.NOT_EQUAL, search))
        bands.add(and(earlier + [prefix]))
        earlier.add(and([notText(textFields, EntityCondition.NOT_LIKE, escaped+'%'),
                         or([hasCode, notText(['productId'], EntityCondition.NOT_LIKE, escaped+'%')])]))
        bands.add(and(earlier + [broad]))
    }
}

catalogData.total = query(matches).count()
def lastPage = Math.max(0L, (catalogData.total - 1).intdiv(params.pageSize) as long)
params.pageIndex = Math.min(positiveInt(request.pageIndex, 0) as long, lastPage) as int
catalogData.pageIndex = params.pageIndex
def rankedRows = { int offset, Integer limit ->
    if (!bands) return readRows(matches, defaultOrder, offset, limit)
    def rows = []
    for (def band in bands) {
        if (offset > 0) {
            def count = query(band).count()
            if (offset >= count) {
                offset -= count as int
                continue
            }
        }
        rows.addAll(readRows(band, defaultOrder, offset, limit == null ? null : limit - rows.size()))
        offset = 0
        if (limit != null && rows.size() >= limit) break
    }
    return rows
}
int offset = export ? 0 : params.pageIndex * params.pageSize
Integer limit = export ? null : params.pageSize as Integer
catalogData.rows = explicitOrder ? readRows(matches, explicitOrder, offset, limit) : rankedRows(offset, limit)
if (export) {
    // Keep formula-leading strings inert when the CSV is opened in a spreadsheet.
    def csvTextFields = ['productId', 'pseudoId', 'productName', 'description', 'catalogTaxCode', 'uqcEnumId']
    catalogData.rows.each { row ->
        csvTextFields.each { field ->
            def value = row[field]
            if (value && (value =~ /^(?:[\t\r\n]|[\s\p{Z}\uFEFF]*[=+@＝＋－＠-])/).find()) row[field] = "'" + value
        }
    }
}
if (!export && search && params.catalogMode == 'live') {
    catalogData.suggestions = !explicitOrder && offset == 0 && params.pageSize >= 8 ?
        catalogData.rows.take(8) : rankedRows(0, 8)
}
