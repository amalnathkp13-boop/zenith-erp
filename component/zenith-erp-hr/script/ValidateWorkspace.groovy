import java.time.LocalDate
import java.time.YearMonth

def require = { boolean ok, String message -> if (!ok) throw new IllegalArgumentException(message) }
def goodText = { v, int limit -> v instanceof String && v.trim() && v.length() <= limit }
def validDate = { v ->
    if (!(v instanceof String) || !(v ==~ /\d{4}-\d{2}-\d{2}/)) return false
    try { LocalDate.parse(v); return true } catch (java.time.DateTimeException ignored) { return false }
}
def amount = { v -> v instanceof Number && v >= 0 && v <= 100000000 && v.toBigDecimal().stripTrailingZeros().scale() <= 2 }
def wholeHalf = { v -> v instanceof Number && (v * 2).toBigDecimal().stripTrailingZeros().scale() <= 0 }
def index = { rows, label ->
    require(rows instanceof List, "Invalid ${label} list.")
    def result = [:]
    rows.each { r ->
        require(r instanceof Map && goodText(r.id,100) && !result.containsKey(r.id), "Each ${label} needs its own ID.")
        result[r.id] = r
    }
    result
}
require(next instanceof Map && next.version == 2 && next.settings instanceof Map, 'Invalid HR workspace.')
def original = [:], updated = [:]
for (section in ['employees','attendance','leaves','salaries']) {
    original[section] = index(previous[section],section)
    updated[section] = index(next[section],section)
    if (section != 'attendance') require(updated[section].keySet().containsAll(original[section].keySet()), 'Existing HR records cannot be removed.')
}
def cfg = next.settings
def oldCfg = previous.settings
def uniqueNames = { list, max ->
    list instanceof List && list.every { goodText(it,max) } && list.collect { it.toLowerCase(Locale.ROOT) }.unique().size() == list.size()
}
require(cfg.keySet().every { it in ['company','location','email','departments','designations','leaveTypes','workdays','holidays'] },'Invalid HR settings.')
require(goodText(cfg.company,160) && cfg.location instanceof String && cfg.location.length() <= 250 &&
    cfg.email instanceof String && cfg.email.length() <= 160,'Check the organization name, location and email.')
if (cfg.email) require(cfg.email ==~ /[^\s@]+@[^\s@]+\.[^\s@]+/,'Enter a valid HR email.')
require(uniqueNames(cfg.departments,80) && uniqueNames(cfg.designations,80),'Department and designation names must be unique.')
require(cfg.workdays instanceof List && cfg.workdays && cfg.workdays.every { it in 0..6 } && cfg.workdays.toSet().size() == cfg.workdays.size(),'Select the working days.')
require(cfg.holidays instanceof List && cfg.holidays.every { it instanceof Map && validDate(it.date) && goodText(it.name,80) } &&
    cfg.holidays*.date.toSet().size() == cfg.holidays.size(),'Each holiday needs a unique date and a name.')
require(cfg.leaveTypes instanceof List && cfg.leaveTypes.every { it instanceof Map && goodText(it.name,60) && wholeHalf(it.days) && it.days >= 0 && it.days <= 366 } &&
    uniqueNames(cfg.leaveTypes*.name,60) && cfg.leaveTypes.any { it.name == 'Unpaid leave' && it.days == 0 },'Check the leave policy names and allocations.')

def emails = [:]
next.employees.each { e ->
    def before = original.employees[e.id]
    if (e.email) {
        require(e.email instanceof String,'Invalid employee email.')
        def duplicate = emails.put(e.email.toLowerCase(Locale.ROOT),e.id)
        require(!duplicate || (before?.email == e.email && original.employees[duplicate]?.email?.equalsIgnoreCase(e.email)),'An employee with this email already exists.')
    }
    if (e == before) return
    require((before && before.name == e.name || goodText(e.name,80)) &&
        (before && before.email == e.email || goodText(e.email,160) && e.email ==~ /[^\s@]+@[^\s@]+\.[^\s@]+/),'Enter a name and valid work email.')
    require((before && before.department == e.department || goodText(e.department,80) && cfg.departments.contains(e.department)) &&
        (before && before.designation == e.designation || goodText(e.designation,80)),'Choose a department and designation.')
    require((before && before.joined == e.joined || validDate(e.joined)) && e.status in ['Active','On probation','Inactive'] && e.type in ['Full-time','Part-time','Contract'],'Check the employment dates, status and type.')
    require(e.status != 'Inactive' || (validDate(e.leavingDate) && e.leavingDate >= e.joined),'Check the leaving date.')
    require(e.salaryType in ['monthly','daily'] && amount(e.salary),'Enter a valid agreed salary.')
    require(!e.phone || goodText(e.phone,24),'Check the phone number.')
    require(!e.emergency || goodText(e.emergency,250),'Check the emergency contact.')
    def manager = updated.employees[e.manager]
    require(!e.manager || before?.manager == e.manager || (manager ? manager.id != e.id && manager.status != 'Inactive' :
        next.employees.count { it.id != e.id && it.name == e.manager && it.status != 'Inactive' } == 1),
        'Choose a manager with an unambiguous active employee record.')
    def sameDoc = { a,b -> a.name == b.name && a.added == b.added && a.size == b.size }
    require(e.documents instanceof List && e.documents.every { doc -> doc instanceof Map && goodText(doc.name,255) && doc.size instanceof Number && doc.size >= 0 &&
        doc.size <= Integer.MAX_VALUE && (validDate(doc.added) || before?.documents?.any { sameDoc(it,doc) }) },'Check the document details.')
    def remaining = new ArrayList(e.documents)
    (before?.documents ?: []).each { doc ->
        int i = remaining.findIndexOf { sameDoc(it,doc) }
        require(i >= 0, 'Existing document records cannot be removed.')
        remaining.remove(i)
    }
}
(oldCfg.departments - cfg.departments).each { d -> require(!next.employees.any { it.department == d },'This department is still assigned to an employee.') }
(oldCfg.designations - cfg.designations).each { d -> require(!next.employees.any { it.designation == d },'This designation is still assigned to an employee.') }

def calendarChanged = cfg.workdays != oldCfg.workdays || cfg.holidays*.date.toSet() != oldCfg.holidays*.date.toSet()
def holidays = cfg.holidays*.date.toSet()
def working = { LocalDate day -> cfg.workdays.contains(day.dayOfWeek.value % 7) && !holidays.contains(day.toString()) }
def employed = { e,date -> (!e.joined || date >= e.joined) && (!e.leavingDate || date <= e.leavingDate) && (e.status != 'Inactive' || e.leavingDate) }
def allocations = cfg.leaveTypes.collectEntries { [(it.name):it.days] }
def activeLeaves = next.leaves.findAll { it.status in ['Pending','Approved'] }.groupBy { it.employeeId }
def approvedDays = [:].withDefault { 0 }
next.leaves.each { l ->
    def e = updated.employees[l.employeeId], old = original.leaves[l.id]
    require(e != null,'Unknown employee on leave request.')
    boolean changed = l != old
    boolean leaveActive = l.status in ['Pending','Approved']
    if (changed) {
        require(l.status in ['Pending','Approved','Cancelled','Rejected'] && l.status in ((old == null) ? ['Pending'] :
            ['Pending':['Pending','Approved','Rejected','Cancelled'],'Approved':['Approved','Cancelled'],'Rejected':['Rejected'],'Cancelled':['Cancelled']][old.status]),
            'Invalid leave status change.')
        require(!old || (l.employeeId == old.employeeId && l.from == old.from && l.to == old.to && l.days == old.days &&
            l.reason == old.reason && l.applied == old.applied && !!l.halfDay == !!old.halfDay),'Submitted request details cannot be overwritten.')
        if (old && old.type != l.type) require(!allocations.containsKey(old.type) && allocations.containsKey(l.type),'The original leave type must be preserved unless its policy is renamed.')
        require(old || (l.applied == today && l.from instanceof String && l.from.take(4) == today.take(4) && l.to instanceof String && l.to.take(4) == today.take(4)),'Choose dates in the current leave year.')
        require(allocations.containsKey(l.type) || old?.type == l.type,'Choose a configured leave type.')
        require(goodText(l.reason,500) && (l.status != 'Rejected' || goodText(l.reviewNote,240)),'Add a reason for this leave decision.')
        require(validDate(l.from) && validDate(l.to) && l.from <= l.to && (!l.halfDay || l.from == l.to),'Check the leave date range.')
        if (leaveActive) {
            require(employed(e,l.from) && employed(e,l.to),'Leave dates fall outside employment.')
            require(!activeLeaves[l.employeeId].any { other -> other.id != l.id && other.from <= l.to && other.to >= l.from },'Another active request overlaps these dates.')
        }
    }
    if (leaveActive && (changed || calendarChanged)) {
        def day = LocalDate.parse(l.from), end = LocalDate.parse(l.to)
        require(!end.isAfter(day.plusYears(1)),'Leave must be within one year.')
        int count = 0
        for (; !day.isAfter(end); day = day.plusDays(1)) if (working(day)) count++
        require(count > 0 && l.days == (l.halfDay ? 0.5 : count),'The calendar must preserve the working days on active leave requests.')
    }
    if (l.status == 'Approved' && l.from?.startsWith(today.take(4))) approvedDays[[l.employeeId,l.type]] += l.days
}
approvedDays.each { key, used ->
    if (key[1] != 'Unpaid leave' && allocations.containsKey(key[1]) && (next.leaves != previous.leaves || cfg.leaveTypes != oldCfg.leaveTypes))
        require(used <= allocations[key[1]],'The approved leave exceeds the annual allocation.')
}
(next.leaves.findAll { !original.leaves.containsKey(it.id) && it.type != 'Unpaid leave' }).each { l ->
    require(l.days <= allocations[l.type] - approvedDays[[l.employeeId,l.type]],'The request exceeds the remaining leave balance.')
}

def changedAttendance = (original.attendance + updated.attendance).keySet().findAll { original.attendance[it] != updated.attendance[it] }
def attendanceByDate = next.attendance.groupBy { [it.employeeId,it.date] }
changedAttendance.each { id ->
    def old = original.attendance[id], row = updated.attendance[id], r = row ?: old
    require(!old?.timeClock && !row?.timeClock,'Time-clock records must be corrected in Attendance.')
    require(!old || !row || (old.employeeId == row.employeeId && old.date == row.date),'The employee and date on attendance cannot change.')
    def e = updated.employees[r.employeeId]
    require(e && validDate(r.date) && r.date <= today && employed(e,r.date) && working(LocalDate.parse(r.date)), 'Choose a working day inside the employment period.')
    require(!activeLeaves[r.employeeId]?.any { it.status == 'Approved' && it.from <= r.date && it.to >= r.date },'Attendance is locked for approved leave.')
    if (row) {
        require(attendanceByDate[[row.employeeId,row.date]].size() == 1,'Attendance already exists for this date.')
        require(row.status in ['Present','Absent','Half-day'], 'Choose a valid attendance status.')
        require([row.checkIn,row.checkOut].every { !it || (it instanceof String && it ==~ /([01]\d|2[0-3]):[0-5]\d/) } &&
            (!row.checkOut || (row.checkIn && row.checkOut > row.checkIn)) && (row.status != 'Absent' || (!row.checkIn && !row.checkOut)),
            'Check-out must follow check-in on the same day.')
        require(!row.note || goodText(row.note,255),'The attendance note is too long.')
    }
}

def salaryGroups = next.salaries.groupBy { [it.employeeId,it.month] }
next.salaries.each { p ->
    def old = original.salaries[p.id]
    if (old == p) return
    require(!p.managedByPayroll && !old?.managedByPayroll,'Manage payroll-run payslips in Payroll.')
    require(!payrollPeriods.contains([p.employeeId,p.month]),'A payroll-run payslip already exists for this period.')
    require(p.month instanceof String && p.month ==~ /\d{4}-(0[1-9]|1[0-2])/ && updated.employees.containsKey(p.employeeId),'Check the salary employee and month.')
    require(salaryGroups[[p.employeeId,p.month]].size() == 1,'A salary record already exists for this month.')
    require(!old || (p.employeeId == old.employeeId && p.month == old.month),'The salary month and employee cannot change.')
    require(p.status in ['Draft','Finalized'] && p.paid instanceof Boolean && (!p.paid || p.status == 'Finalized'),'Only finalized salaries can be marked paid.')
    require(old || (!p.paid && p.status == 'Draft'),'Create the salary draft first.')
    require(!p.paid || old?.status == 'Finalized','Finalize the salary before marking it paid.')
    if (old?.status == 'Finalized') require(p.paid && (p - [paid:p.paid]) == (old - [paid:old.paid]),'Finalized salaries cannot be changed.')
    require([p.basic,p.allowance,p.deduction].every { amount(it) } && p.deduction <= p.basic + p.allowance,'Deductions cannot exceed earnings.')
    require(p.salaryType in ['daily','monthly'],'Choose a valid salary basis.')
    if (p.salaryType == 'daily') {
        require(amount(p.dailyRate) && (p.paidDays == null ? p.status == 'Draft' && p.basic == 0 :
            wholeHalf(p.paidDays) && p.paidDays >= 0 && p.paidDays <= YearMonth.parse(p.month).lengthOfMonth() &&
                p.basic == (p.dailyRate * p.paidDays).toBigDecimal().setScale(2,java.math.RoundingMode.HALF_UP)), 'Check the daily rate, paid days and earnings.')
    }
}
