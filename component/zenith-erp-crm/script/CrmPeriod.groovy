// Dashboard periods run through the end of the user's current day. A regular
// pipeline forecast also includes upcoming closes later in the selected period.
def labels = [today:'Today', week:'This week', month:'This month', all:'All time']
period = labels.containsKey(period) ? period : defaultPeriod
periodLabel = labels[period]
def zone = ec.user.timeZone.toZoneId()
def now = ec.user.nowTimestamp
crmToday = now.toInstant().atZone(zone).toLocalDate()
def startDay = [today:crmToday, week:crmToday.minusDays(crmToday.dayOfWeek.value - 1),
                month:crmToday.withDayOfMonth(1)][period]
def endDay = crmToday.plusDays(1)
if (!throughToday && period == 'week') endDay = startDay.plusWeeks(1)
if (!throughToday && period == 'month') endDay = startDay.plusMonths(1)
periodStart = startDay ? java.sql.Timestamp.from(startDay.atStartOfDay(zone).toInstant()) : null
periodEnd = java.sql.Timestamp.from(endDay.atStartOfDay(zone).toInstant())
dateRangeLabel = startDay ? ec.l10n.format(periodStart, 'dd MMM yyyy') + ' – ' +
        ec.l10n.format(java.sql.Timestamp.from(endDay.minusDays(1).atStartOfDay(zone).toInstant()), 'dd MMM yyyy') : 'All dates'
