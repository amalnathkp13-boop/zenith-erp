import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.security.MessageDigest
import java.time.LocalDate

def ef = ec.entity
def zone = ec.user.timeZone.toZoneId()
def today = ec.user.nowTimestamp.toInstant().atZone(zone).toLocalDate().toString()
def readJson = { value, fallback -> value ? new JsonSlurper().parseText(value) : fallback }
def scoped = { entity, field, ids, order ->
    ids ? new ArrayList(ef.find(entity).condition(field,'in',ids as List).orderBy(order).disableAuthz().forUpdate(lockRows).list()) : []
}
def organization = ef.find('mantle.party.Organization').condition('partyId',org).disableAuthz().one()
def config = ef.find('zenith.erp.hr.WorkspaceSettings').condition('organizationPartyId',org).disableAuthz().one()
def roster = scoped('zenith.erp.hr.Employee','organizationPartyId',[org],'employeeId')
def partyIds = roster*.partyId.findAll()
def empIds = roster*.employeeId
def departments = scoped('zenith.erp.hr.Department','organizationPartyId',[org],'departmentName')
// Older installations also use shared system departments and designations.
def departmentById = scoped('zenith.erp.hr.Department','departmentId',roster*.departmentId.findAll(),'departmentId')
    .findAll { !it.organizationPartyId || it.organizationPartyId == org }.collectEntries { [(it.departmentId):it] }
departments.each { departmentById[it.departmentId] = it }
def designations = scoped('zenith.erp.hr.Designation','designationId',roster*.designationId.findAll(),'designationId')
    .findAll { !it.organizationPartyId || it.organizationPartyId == org }.collectEntries { [(it.designationId):it] }
scoped('zenith.erp.hr.Designation','organizationPartyId',[org],'designationName').each { designations[it.designationId] = it }
def settings = readJson(config?.settingsJson, [company:organization?.organizationName ?: org,email:'',location:'',
    departments:[],designations:[],leaveTypes:[[name:'Casual leave',days:12],[name:'Sick leave',days:8],[name:'Unpaid leave',days:0]],
    workdays:[1,2,3,4,5],holidays:[]])
settings.departments = (settings.departments + departmentById.values().findAll { it.isActive != 'N' || roster*.departmentId.contains(it.departmentId) }*.departmentName).findAll().unique()
settings.designations = (settings.designations + designations.values().findAll { it.isActive != 'N' }*.designationName).findAll().unique()

def people = scoped('mantle.party.Person','partyId',partyIds,'partyId').collectEntries { [(it.partyId):it] }
def contacts = partyIds ? ef.find('mantle.party.contact.PartyContactMech').condition('partyId','in',partyIds)
    .condition('contactMechPurposeId','in',['PhonePrimary','EmailPrimary']).conditionDate('fromDate','thruDate',ec.user.nowTimestamp)
    .orderBy('-fromDate').disableAuthz().list() : []
def contactIds = contacts*.contactMechId
def emailValues = scoped('mantle.party.contact.ContactMech','contactMechId',contactIds,'contactMechId').collectEntries { [(it.contactMechId):it.infoString] }
def phoneValues = scoped('mantle.party.contact.TelecomNumber','contactMechId',contactIds,'contactMechId').collectEntries { [(it.contactMechId):it.contactNumber] }
def employeeCode = [:], employeesByCode = [:]
def usedCodes = roster.groupBy { it.employeeCode }
roster.each { e ->
    def code = e.employeeCode && usedCodes[e.employeeCode].size() == 1 ? e.employeeCode : "ID-" + e.employeeId
    // Never collapse two legacy employees with the same display code.
    while (employeesByCode.containsKey(code)) code = "ID-" + code
    employeeCode[e.employeeId] = code; employeesByCode[code] = e
}
def documents = scoped('zenith.erp.hr.EmployeeDocument','employeeId',empIds,'documentId').groupBy { it.employeeId }
def recordedAt = readJson(config?.recordedAtJson,[:])
def stamp = { area, rows ->
    def latest = rows*.lastUpdatedStamp.findAll().max()?.toInstant()
    if (latest && (!recordedAt[area] || latest > java.time.Instant.parse(recordedAt[area]))) recordedAt[area] = latest.toString()
}
def names = roster.collectEntries { e ->
    def person = people[e.partyId]
    [(e.employeeId):e.hrDisplayName ?: ([person?.firstName,person?.lastName].findAll().join(' ') ?: employeeCode[e.employeeId])]
}
def contactByParty = contacts.groupBy { it.partyId }
def avatarColors = ['purple','teal','blue','orange','pink']
def employees = roster.collect { e ->
    def links = contactByParty[e.partyId] ?: []
    def email = links.find { it.contactMechPurposeId == 'EmailPrimary' }
    def phone = links.find { it.contactMechPurposeId == 'PhonePrimary' }
    [id:employeeCode[e.employeeId],name:names[e.employeeId],department:departmentById[e.departmentId]?.departmentName ?: '',
     designation:designations[e.designationId]?.designationName ?: '',joined:e.joiningDate?.toString() ?: '',
     manager:employeeCode[e.reportingToEmployeeId] ?: '',type:e.employmentType == 'Contract' ? 'Contract' : e.employmentType == 'Part-time' ? 'Part-time' : 'Full-time',
     status:e.statusId == 'EmpProbation' ? 'On probation' : e.statusId in ['EmpRelieved','EmpTerminated','EmpAbsconding'] ? 'Inactive' : 'Active',
     salaryType:e.agreedSalaryType ?: 'monthly',salary:e.agreedSalary != null ? e.agreedSalary : ((e.ctcAnnual ?: 0) / 12).toBigDecimal().setScale(2,java.math.RoundingMode.HALF_UP),
     color:avatarColors[Math.floorMod(e.employeeId.hashCode(),avatarColors.size())],email:e.workEmail != null ? e.workEmail : emailValues[email?.contactMechId] ?: '',
     phone:e.workPhone != null ? e.workPhone : phoneValues[phone?.contactMechId] ?: '',emergency:e.emergencyContactName ?: '',
     leavingDate:(e.relievingDate ?: e.lastWorkingDate)?.toString() ?: '',
     documents:(documents[e.employeeId] ?: []).collect { [id:it.documentId,name:it.documentName ?: '',size:it.fileSize ?: 0,
         added:it.uploadDate?.toInstant()?.atZone(zone)?.toLocalDate()?.toString() ?: '',available:!!it.contentBase64] }]
}
def leaveRows = scoped('zenith.erp.hr.LeaveApplication','employeeId',empIds,'-leaveApplicationId')
def leaveNames = [CL:'Casual leave',SL:'Sick leave',LWP:'Unpaid leave',EL:'Earned leave']
def leaves = leaveRows.collect { r ->
    [id:r.leaveApplicationId,employeeId:employeeCode[r.employeeId],type:leaveNames.get(r.leaveType) ?: r.leaveType,from:r.fromDate?.toString(),
     to:r.toDate?.toString(),days:r.totalDays ?: 0,reason:r.reason ?: '',status:[LvPending:'Pending',LvApproved:'Approved',LvRejected:'Rejected',LvCancelled:'Cancelled'][r.statusId] ?: 'Pending',
     applied:(r.appliedDate ?: r.fromDate)?.toString(),halfDay:r.halfDay == 'Y' || r.totalDays == 0.5,reviewNote:r.rejectionReason ?: '']
}
// Legacy time-clock records are party-based. They are attributable only when employment is unambiguous.
def employmentsByParty = scoped('zenith.erp.hr.Employee','partyId',partyIds,'employeeId').groupBy { it.partyId }
def timeRows = scoped('zenith.erp.attendance.AttendanceRecord','employeePartyId',partyIds,'recordId').findAll {
    it.hrEmployeeId ? employeeCode.containsKey(it.hrEmployeeId) : employmentsByParty[it.employeePartyId]?.size() == 1
}
def clockTime = { ts -> ts?.toInstant()?.atZone(zone)?.format(java.time.format.DateTimeFormatter.ofPattern('HH:mm')) ?: '' }
def statuses = [AttSt_PRESENT:'Present',AttSt_HALFDAY:'Half-day',AttSt_ABSENT:'Absent',AttSt_ONLEAVE:'On leave',AttSt_HOLIDAY:'Holiday',
    AttSt_WEEKOFF:'Weekly off',AttSt_WFH:'Present',AttSt_ONDUTY:'Present',AttSt_COMPOFF:'On leave']
def attendance = timeRows.findAll { it.attendanceDate }.collect { r ->
    [id:r.recordId,employeeId:employeeCode[r.hrEmployeeId ?: employmentsByParty[r.employeePartyId][0].employeeId],
     date:r.attendanceDate.toInstant().atZone(zone).toLocalDate().toString(),status:statuses[r.attendanceStatus] ?: 'Present',
     checkIn:clockTime(r.clockIn),checkOut:clockTime(r.clockOut),note:r.notes ?: '',timeClock:r.source != 'AttSrc_MANUAL']
}
def salaryRows = scoped('zenith.erp.hr.SalaryRegister','employeeId',empIds,'employeeId,salaryMonth')
def salaries = salaryRows.collect { r ->
    def row = [id:'HR-' + r.employeeId + '-' + r.salaryMonth,employeeId:employeeCode[r.employeeId],month:r.salaryMonth,salaryType:r.salaryType,
        basic:r.basic,allowance:r.allowance,deduction:r.deduction,status:r.recordStatus,paid:r.paid == 'Y']
    if (r.salaryType == 'daily') { row.dailyRate = r.dailyRate; row.paidDays = r.paidDays }
    row
}
def payslips = ef.isEntityDefined('zenith.erp.payroll.Payslip') ? scoped('zenith.erp.payroll.Payslip','organizationPartyId',[org],'payslipId') : []
def payrollPeriods = [] as Set
payslips.findAll { employeeCode[it.employeeId] && it.periodYear && it.periodMonth }.each { p ->
    def month = String.format('%04d-%02d',p.periodYear as int,p.periodMonth as int)
    payrollPeriods.add([employeeCode[p.employeeId],month])
    if (!includePayroll) return
    salaries.add([id:'PS-' + p.payslipId,employeeId:employeeCode[p.employeeId],month:month,
        salaryType:'monthly',basic:p.basicPay ?: 0,allowance:(p.grossEarnings ?: p.basicPay ?: 0) - (p.basicPay ?: 0),deduction:p.totalDeductions ?: 0,
        status:p.statusId in ['PsApproved','PsPaid'] ? 'Finalized' : 'Draft',paid:p.statusId == 'PsPaid',managedByPayroll:true])
}
stamp('employees',roster); stamp('attendance',timeRows); stamp('leave',leaveRows); stamp('payroll',salaryRows + (includePayroll ? payslips : []))
def state = [version:2,employees:employees,attendance:attendance,leaves:leaves,salaries:salaries,settings:settings,
    recordedAt:recordedAt,audit:readJson(config?.auditJson,[])]
def digest = MessageDigest.getInstance('SHA-256').digest(JsonOutput.toJson([org,state]).getBytes('UTF-8')).encodeHex().toString()
return [state:state,revision:digest,today:today,employees:employeesByCode,employmentsByParty:employmentsByParty,departments:departmentById,designations:designations,
    leaves:leaveRows.collectEntries { [(it.leaveApplicationId):it] },attendance:timeRows.collectEntries { [(it.recordId):it] },payrollPeriods:payrollPeriods,config:config]
