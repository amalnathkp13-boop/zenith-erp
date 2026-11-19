// Unpriced native rows use Mantle's extended line amount. Tax and promotional child rows are counted separately.
if (line.taxableAmount == null) {
    def gross = (line.quantity != null ? line.quantity : 1) * (line.selectedAmount ?: 1) * (line.unitAmount ?: 0)
    return [tax:BigDecimal.ZERO, total:(gross as BigDecimal).setScale(2,java.math.RoundingMode.HALF_UP)]
}
def tax = line.totalTaxAmount != null ? line.totalTaxAmount :
        (line.get('cgstAmount') ?: 0) + (line.get('sgstAmount') ?: 0) + (line.get('igstAmount') ?: 0)
return [tax:tax, total:ec.l10n.roundCurrency(line.taxableAmount + tax, currency)]
