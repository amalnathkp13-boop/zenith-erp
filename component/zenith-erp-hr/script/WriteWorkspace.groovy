import groovy.json.JsonOutput
import java.sql.Date
import java.sql.Timestamp
import java.time.LocalDate
import java.time.LocalTime

def ef = ec.entity
def zone = ec.user.timeZone.toZoneId()
def previous = current.state
def cfg = next.settings
def byId = { rows -> rows.collectEntries { [(it.id):it] } }
def createRow = { name, fields -> ef.makeValue(name).setAll(fields).setSequencedIdPrimary().create() }
def storedDepartments = current.departments.values().collectEntries { [(it.departmentName):it] }
def storedDesignations = current.designations.values().collectEntries { [(it.designationName):it] }
def ensureName = { models, name, entity, field ->
    if (!name) return null
    if (!models[name]) models[name] = createRow('zenith.erp.hr.' + entity,[(field):name,organizationPartyId:org,isActive:'Y'])
    else if (models[name].organizationPartyId == org && models[name].isActive == 'N') {
        models[name].isActive = 'Y'
        models[name].update()
    }
    models[name].get(entity.toLowerCase() + 'Id')
}
def removedDepartments = previous.settings.departments - cfg.departments
def addedDepartments = cfg.departments - previous.settings.departments
if (removedDepartments.size() == 1 && addedDepartments.size() == 1 && !storedDepartments[addedDepartments[0]]) {
    def department = storedDepartments[removedDepartments[0]]
    if (department?.organizationPartyId == org) {
        department.departmentName = addedDepartments[0]; department.update()
        storedDepartments.remove(removedDepartments[0]); storedDepartments[addedDepartments[0]] = department
    }
}
cfg.departments.each { ensureName(storedDepartments,it,'Department','departmentName') }
cfg.designations.each { ensureName(storedDesignations,it,'Designation','designationName') }
removedDepartments.each { name ->
    def row = storedDepartments[name]
    if (row?.organizationPartyId == org) { row.isActive = 'N'; row.update() }
}
(previous.settings.designations - cfg.designations).each { name ->
    def row = storedDesignations[name]
    if (row?.organizationPartyId == org) { row.isActive = 'N'; row.update() }
}
def employeeRows = current.employees
def oldEmployees = byId(previous.employees)
def balanceFields = ['Casual leave':'casualLeaveBalance','Sick leave':'sickLeaveBalance','Earned leave':'earnedLeaveBalance']
def policy = cfg.leaveTypes.collectEntries { [(it.name):it.days] }
next.employees.each { e ->
    def old = oldEmployees[e.id]
    if (old == e) return
    def entity = employeeRows[e.id]
    if (!entity) {
        def name = e.name.trim().split(/\s+/,2)
        def party = createRow('mantle.party.Party',[partyTypeEnumId:'PtyPerson',ownerPartyId:org])
        ef.makeValue('mantle.party.Person').setAll([partyId:party.partyId,firstName:name[0],lastName:name.size()>1 ? name[1] : null]).create()
        ef.makeValue('mantle.party.PartyRole').setAll([partyId:party.partyId,roleTypeId:'Employee']).create()
        entity = ef.makeValue('zenith.erp.hr.Employee').setAll([organizationPartyId:org,partyId:party.partyId,employeeCode:e.id]).setSequencedIdPrimary()
        balanceFields.each { type, field -> entity.set(field,policy[type] ?: 0) }
        employeeRows[e.id] = entity
    }
    // Limit field writes: editing a phone number must not reset a legacy employee's notice period or CTC.
    if (old?.name != e.name) {
        // A shared person may also be an employee elsewhere. Only synchronize their native name
        // when this organization owns the party and it has a single employment.
        def party = old ? ef.find('mantle.party.Party').condition('partyId',entity.partyId).disableAuthz().one() : null
        if (party?.ownerPartyId == org && current.employmentsByParty[entity.partyId]?.size() == 1) {
            def person = ef.find('mantle.party.Person').condition('partyId',entity.partyId).disableAuthz().forUpdate(true).one()
            if (person) {
                def parts = e.name.trim().split(/\s+/,2)
                person.firstName = parts[0]; person.lastName = parts.size() > 1 ? parts[1] : null
                person.update()
            }
        }
        entity.hrDisplayName = e.name
    }
    if (old?.department != e.department) entity.departmentId = ensureName(storedDepartments,e.department,'Department','departmentName')
    if (old?.designation != e.designation) entity.designationId = ensureName(storedDesignations,e.designation,'Designation','designationName')
    if (old?.joined != e.joined) entity.joiningDate = Date.valueOf(e.joined)
    if (old?.type != e.type) entity.employmentType = e.type == 'Full-time' ? 'Permanent' : e.type
    if (old?.status != e.status) entity.statusId = ['Active':'EmpActive','On probation':'EmpProbation','Inactive':'EmpRelieved'][e.status]
    if (old?.leavingDate != e.leavingDate) entity.relievingDate = e.leavingDate ? Date.valueOf(e.leavingDate) : null
    if (old?.email != e.email) entity.workEmail = e.email
    if (old?.phone != e.phone) entity.workPhone = e.phone ?: ''
    if (old?.shopId != e.shopId) entity.workShopId = e.shopId ?: null
    if (old?.emergency != e.emergency) entity.emergencyContactName = e.emergency ?: null
    if (!old || old.salaryType != e.salaryType || old.salary != e.salary) {
        entity.agreedSalary = e.salary; entity.agreedSalaryType = e.salaryType
    }
    if (old) entity.update() else entity.create()
    def existingDocuments = new ArrayList(old?.documents ?: [])
    (e.documents ?: []).each { doc ->
        int found = existingDocuments.findIndexOf { it.name == doc.name && it.added == doc.added && it.size == doc.size }
        if (found >= 0) { existingDocuments.remove(found); return }
        createRow('zenith.erp.hr.EmployeeDocument',[employeeId:entity.employeeId,documentName:doc.name,fileSize:doc.size,
            uploadDate:Timestamp.from(LocalDate.parse(doc.added).atStartOfDay(zone).toInstant())])
    }
}
next.employees.findAll { (oldEmployees[it.id]?.manager ?: '') != (it.manager ?: '') }.each { e ->
    def emp = employeeRows[e.id]
    def manager = next.employees.find { it.id == e.manager } ?: next.employees.find { it.id != e.id && it.name == e.manager && it.status != 'Inactive' }
    emp.reportingToEmployeeId = manager ? employeeRows[manager.id].employeeId : null
    emp.update()
}

def oldLeaves = byId(previous.leaves)
def approver = employeeRows.values().find { it.partyId == ec.user.userAccount?.partyId }
next.leaves.each { l ->
    def old = oldLeaves[l.id]
    if (old == l) return
    def employee = employeeRows[l.employeeId]
    def status = [Pending:'LvPending',Approved:'LvApproved',Rejected:'LvRejected',Cancelled:'LvCancelled'][l.status]
    def type = ['Casual leave':'CL','Sick leave':'SL','Earned leave':'EL','Unpaid leave':'LWP'][l.type] ?: l.type
    def row = current.leaves[l.id]
    if (row) {
        if (old.type != l.type) row.leaveType = type
        if (old.status != l.status) {
            row.statusId = status
            if (l.status in ['Approved','Rejected']) {
                row.approvedByEmployeeId = approver?.employeeId; row.approvalDate = ec.user.nowTimestamp
            }
            if (l.status == 'Rejected') row.rejectionReason = l.reviewNote
        }
        row.update()
    } else {
        createRow('zenith.erp.hr.LeaveApplication',[employeeId:employee.employeeId,leaveType:type,fromDate:Date.valueOf(l.from),toDate:Date.valueOf(l.to),
            totalDays:l.days,reason:l.reason,appliedDate:Date.valueOf(l.applied),halfDay:l.halfDay ? 'Y' : 'N',statusId:status])
    }
    def field = balanceFields[l.type]
    def change = (old?.status == 'Approved' ? l.days : 0) - (l.status == 'Approved' ? l.days : 0)
    if (field && change) { employee.set(field,(employee.get(field) ?: 0) + change); employee.update() }
}

def oldAttendance = byId(previous.attendance)
def kept = next.attendance*.id.toSet()
oldAttendance.keySet().findAll { !kept.contains(it) }.each { current.attendance[it].delete() }
next.attendance.each { r ->
    if (oldAttendance[r.id] == r) return
    def date = LocalDate.parse(r.date)
    def time = { value -> value ? Timestamp.from(date.atTime(LocalTime.parse(value)).atZone(zone).toInstant()) : null }
    def start = time(r.checkIn), end = time(r.checkOut)
    def employee = employeeRows[r.employeeId]
    def fields = [hrEmployeeId:employee.employeeId,employeePartyId:employee.partyId,attendanceDate:Timestamp.from(date.atStartOfDay(zone).toInstant()),
        attendanceStatus:[Present:'AttSt_PRESENT',Absent:'AttSt_ABSENT','Half-day':'AttSt_HALFDAY'][r.status],
        clockIn:start,clockOut:end,totalHours:(start && end ? ((end.time-start.time)/3600000G).setScale(2,java.math.RoundingMode.HALF_UP) : null),
        source:'AttSrc_MANUAL',notes:r.note ?: '']
    def row = current.attendance[r.id]
    if (row) row.setAll(fields).update() else createRow('zenith.erp.attendance.AttendanceRecord',fields)
}
def oldSalaries = byId(previous.salaries)
next.salaries.each { p ->
    if (oldSalaries[p.id] == p) return
    def row = ef.makeValue('zenith.erp.hr.SalaryRegister').setAll([employeeId:employeeRows[p.employeeId].employeeId,
        salaryMonth:p.month,salaryType:p.salaryType,dailyRate:p.dailyRate,paidDays:p.paidDays,basic:p.basic,
        allowance:p.allowance,deduction:p.deduction,recordStatus:p.status,paid:p.paid ? 'Y' : 'N'])
    if (oldSalaries.containsKey(p.id)) row.update() else row.create()
}

def at = ec.user.nowTimestamp.toInstant().toString()
def recordedAt = new LinkedHashMap(current.allRecordedAt)
['employees':'employees','attendance':'attendance','leaves':'leave','salaries':'payroll','settings':'settings'].each { name,area ->
    if (previous[name] != next[name]) {
        recordedAt[area] = at
        if (area == 'leave') recordedAt.attendance = at
    }
}
def entry = [message:description,time:at,userId:ec.user.userId,shopId:previous.shopId]
def stored = current.config ?: ef.makeValue('zenith.erp.hr.WorkspaceSettings').set('organizationPartyId',org)
stored.setAll([settingsJson:JsonOutput.toJson(cfg),recordedAtJson:JsonOutput.toJson(recordedAt),
    auditJson:JsonOutput.toJson(([entry]+current.allAudit).take(100))])
if (current.config) stored.update() else stored.create()
