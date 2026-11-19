// Use the accepted price and rate. Only the Indian GST jurisdiction may change at billing.
def registrationState = { gstin ->
    String value = gstin?.toString()?.trim()?.toUpperCase()
    value ==~ /[0-9]{2}[A-Z0-9]{13}/ ? value.substring(0,2) : null
}
def stateCode = { registration, documentState, documentGstin ->
    String region = (documentState ?: registrationState(documentGstin) ?: registration?.regionGeoId)?.toString()?.trim()?.toUpperCase()
    if (region ==~ /[0-9]{2}/) return region
    if (region && ec.entity.isEntityDefined('zenith.erp.india.IndiaState')) {
        def name = ec.entity.find('moqui.basic.Geo').condition('geoId',region).useCache(true).one()?.geoName
        def state = name ? ec.entity.find('zenith.erp.india.IndiaState').condition('stateName',name).useCache(true).list().find() : null
        if (state?.gstStateCode) return state.gstStateCode
    }
    return documentState ? region : (registrationState(registration?.registrationNumber) ?: region)
}
def sellerState = stateCode(sellerTaxReg, sourceOrder.supplierStateCode, sourceOrder.supplierGstin)
def buyerState = stateCode(buyerTaxReg, sourceOrder.placeOfSupplyStateCode, sourceOrder.buyerGstin)
def crossState = (isExport == 'Y' || isSezSupply == 'Y') ? true :
        (sellerState && buyerState ? sellerState != buyerState : null)
def zeroRated = isReverseCharge == 'Y' || ((isExport == 'Y' || isSezSupply == 'Y') && isWithPayment != 'Y')
def gstCodes = ['CGST','SGST','IGST']
def taxedItems = []
for (row in sourceItems) {
    def details
    if (row.salesTaxDetailsJson) {
        details = new groovy.json.JsonSlurper().parseText(row.salesTaxDetailsJson)
    } else {
        // Legacy quotations store their rounded components directly on the line.
        details = gstCodes.findResults { name ->
            def key = name.toLowerCase(), rate = row.get(key+'Rate') ?: 0, amount = row.get(key+'Amount') ?: 0
            (rate || amount) ? [taxName:name,taxRate:rate,taxableAmount:row.taxableAmount,taxAmount:amount,
                    countryGeoId:'IND',isIncludedInPrice:row.isTaxInclusive ?: 'N'] : null
        }
    }
    def total = details.sum { it.taxAmount ?: 0 } ?: BigDecimal.ZERO
    if (row.totalTaxAmount != null && total != row.totalTaxAmount) {
        ec.message.addError('The saved order tax components do not match its line total. Review the order before invoicing.'); return
    }
    def gst = details.findAll { it.taxName in gstCodes }
    if (zeroRated && gst.any { it.taxAmount }) {
        ec.message.addError('The saved order includes GST on a zero-rated or reverse-charge supply. Revise the quotation before invoicing.'); return
    }
    if (!zeroRated && crossState != null && gst.any { crossState ? it.taxName != 'IGST' : it.taxName == 'IGST' }) {
        def agreedRate = gst.sum { it.taxRate ?: 0 } as BigDecimal
        def agreedTax = gst.sum { it.taxAmount ?: 0 } as BigDecimal
        def rate = crossState ? agreedRate : agreedRate / 2
        def amount = (row.taxableAmount * rate / 100).setScale(2,java.math.RoundingMode.HALF_UP)
        if ((crossState ? amount : amount * 2) != agreedTax) {
            ec.message.addError('GST for the current place of supply rounds to a different amount on line ' +
                    row.orderItemSeqId + '. Revise the quotation before invoicing.'); return
        }
        details = details.findAll { !(it.taxName in gstCodes) }
        for (code in (crossState ? ['IGST'] : ['CGST','SGST'])) {
            def authority = code == 'SGST' ? 'IND_'+sellerState : 'IND_CENTRAL'
            def authorityId = ec.entity.find('zenith.erp.tax.TaxAuthority').condition('taxAuthorityId',authority).useCache(true).one()?.taxAuthorityId
            details.add([taxName:code,taxAuthorityId:authorityId,taxRate:rate,taxableAmount:row.taxableAmount,taxAmount:amount,
                    countryGeoId:'IND',regionGeoId:crossState ? null : sellerState,isIncludedInPrice:row.isTaxInclusive ?: 'N'])
        }
    }
    taxedItems.add([taxableAmount:row.taxableAmount,totalTaxAmount:total,taxBreakdowns:details])
}
taxResult = [taxedItems:taxedItems]
