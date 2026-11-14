// Older KOTs can carry the order type in the notes prefix instead of a snapshot.
if (ticket.notes?.startsWith('[Take Away]')) return 'Take Away'
if (ticket.notes?.startsWith('[Dine In]')) return 'Dine In'
if (ticket.orderReceiptJson) {
    try {
        def snapshot = new groovy.json.JsonSlurper().parseText(ticket.orderReceiptJson)
        if (snapshot instanceof Map && snapshot.bill instanceof Map && snapshot.bill.orderType in ['Take Away', 'Dine In'])
            return snapshot.bill.orderType
    } catch (groovy.json.JsonException ignored) {
        // A damaged historical snapshot can still have a table number.
    }
}
return ticket.tableNumber ? 'Dine In' : null
