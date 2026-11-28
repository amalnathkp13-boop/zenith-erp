import groovy.json.JsonOutput
import groovy.json.JsonSlurper

def ef = ec.entity
def fail = { message -> [success:false,error:message] }
def org = ec.user.getPreference('ACTIVE_ORGANIZATION')
def permission = ec.service.sync().name('zenith.hr.WorkspaceServices.get#WorkspaceAccess').call()
if (!permission.allowed || !permission.canPay) return fail('HR payroll access is required.')
if (input.scopeKey != permission.scopeKey) return fail('The selected shop changed. Reload HR.')
if (!ef.find('mantle.party.Organization').condition('partyId',org).disableAuthz().forUpdate(true).one())
    return fail('Organization not found.')
def workspace = ec.resource.script('component://zenith-erp-hr/script/ReadWorkspace.groovy',null,
    [org:org,lockRows:false,permission:permission])
def employee = workspace.employees[input.employeeCode]
if (!employee) return fail('Employee not found in this shop.')
def account = ef.find('zenith.erp.hr.EmployeeBankAccount').condition('employeeId',employee.employeeId).disableAuthz().one()
if (input.action == 'bank') {
    def holder = input.holderName?.trim()
    def number = input.accountNumber?.trim()
    def ifsc = input.ifsc?.trim()?.toUpperCase(Locale.ROOT)
    if (!holder || holder.size() > 80 || holder ==~ /.*[\p{Cntrl}].*/ ||
            !(number ==~ /[0-9]{6,30}/) || number != input.confirmAccount?.trim() ||
            !(ifsc ==~ /[A-Z]{4}0[A-Z0-9]{6}/))
        return fail('Check the account holder name, matching account numbers, and IFSC.')
    if ((account?.accountVersion ?: '') != (input.accountVersion ?: ''))
        return fail('Bank details changed. Reload the employee before editing them.')
    def row = account ?: ef.makeValue('zenith.erp.hr.EmployeeBankAccount').set('employeeId',employee.employeeId)
    row.setAll([holderName:holder,accountNumber:number,ifsc:ifsc,accountVersion:UUID.randomUUID().toString(),
        updatedByUserId:ec.user.userId])
    if (account) row.update() else row.create()
    return [success:true]
}
if (!(input.salaryMonth ==~ /[0-9]{4}-(0[1-9]|1[0-2])/)) return fail('Choose a salary month.')
def salary = ef.find('zenith.erp.hr.SalaryRegister').condition('employeeId',employee.employeeId)
    .condition('salaryMonth',input.salaryMonth).disableAuthz().forUpdate(true).one()
if (!salary || salary.recordStatus != 'Finalized') return fail('Finalize the HR salary first.')
def config = ec.resource.script('component://zenith-erp-hr/script/PayoutConfig.groovy',null,[org:org])
if (!config) return fail('The organization has no payout connection configured.')
def testMode = config.mode == 'test' ? 'Y' : 'N'
def history = ef.find('zenith.erp.hr.SalaryPayout').condition('employeeId',employee.employeeId)
    .condition('salaryMonth',input.salaryMonth).disableAuthz().orderBy('-requestedAt,-payoutId').list()
def payout = history ? history[0] : null
def terminal = ['failed','rejected','cancelled','reversed']
if (input.action == 'start') {
    if (salary.paid == 'Y') return fail('This salary is already paid.')
    if (workspace.payrollPeriods.contains([input.employeeCode,input.salaryMonth]))
        return fail('A payroll run already owns this employee’s pay for the month.')
    if (payout && !(payout.providerStatus in terminal) &&
            !(payout.providerStatus == 'processed' && payout.testMode == 'Y' && testMode == 'N'))
        return fail('A transfer already exists. Check its status before starting another.')
    if (account?.accountVersion != input.accountVersion || !account)
        return fail('Save and review the employee’s current bank details first.')
    if (config.mode != input.paymentMode) return fail('The payout connection changed. Reload Salary & Payslips.')
    BigDecimal amount = (salary.basic ?: 0) + (salary.allowance ?: 0) - (salary.deduction ?: 0)
    if (amount < 1) return fail('A bank transfer requires at least ₹1.00.')
    def id = UUID.randomUUID().toString()
    def request = [account_number:config.accountNumber,amount:amount.movePointRight(2).longValueExact(),
        currency:'INR',mode:'NEFT',purpose:'salary',queue_if_low_balance:false,reference_id:id,
        fund_account:[account_type:'bank_account',
            bank_account:[name:account.holderName,ifsc:account.ifsc,account_number:account.accountNumber],
            contact:[name:account.holderName,type:'employee',reference_id:employee.employeeId]]]
    ef.makeValue('zenith.erp.hr.SalaryPayout').setAll([payoutId:id,employeeId:employee.employeeId,
        salaryMonth:salary.salaryMonth,amount:amount,providerAccount:config.identity,providerStatus:'submitted',
        requestJson:JsonOutput.toJson(request),testMode:testMode,requestedByUserId:ec.user.userId,
        requestedAt:ec.user.nowTimestamp]).create()
    return [success:true,payoutId:id]
}
if (input.action != 'refresh' || !payout || payout.payoutId != input.payoutId)
    return fail('The transfer changed. Reload Salary & Payslips.')
if (payout.providerAccount != config.identity) return fail('Restore the original payout connection to check this transfer.')
if (payout.providerStatus in terminal) return [success:true,status:payout.providerStatus]

// The request is stored before dispatch. A timeout can only replay the same body and key.
def connection
def response
try {
    def path = payout.providerPayoutId ? '/' + payout.providerPayoutId : ''
    connection = new URL(config.endpoint + path).openConnection()
    connection.instanceFollowRedirects = false
    connection.connectTimeout = 4000
    connection.readTimeout = 7000
    connection.setRequestProperty('Authorization','Basic ' + (config.keyId + ':' + config.keySecret).getBytes('UTF-8').encodeBase64())
    connection.setRequestProperty('Accept','application/json')
    if (!path) {
        connection.requestMethod = 'POST'
        connection.doOutput = true
        connection.setRequestProperty('Content-Type','application/json')
        connection.setRequestProperty('X-Payout-Idempotency',payout.payoutId)
        connection.outputStream.withCloseable { it.write(payout.requestJson.getBytes('UTF-8')) }
    }
    if (connection.responseCode in 200..299)
        response = connection.inputStream.withCloseable { new JsonSlurper().parse(it) }
} catch (IOException | groovy.json.JsonException ignored) {
    // The provider may have accepted the request even if the response was lost.
} finally {
    connection?.disconnect()
}
if (!(response instanceof Map) || !(response.id ==~ /pout_[A-Za-z0-9]+/) ||
        (payout.providerPayoutId && response.id != payout.providerPayoutId) ||
        response.reference_id != payout.payoutId || response.currency != 'INR' ||
        response.amount != payout.amount.movePointRight(2) ||
        !(response.status in terminal + ['queued','pending','processing','processed','scheduled','initiated'])) {
    return [success:true,status:payout.providerStatus,
        warning:'The bank result could not be verified. Check status to recover this same transfer.']
}
def wasProcessed = payout.providerStatus == 'processed'
payout.setAll([providerPayoutId:response.id,providerStatus:response.status,
    bankReference:(response.utr instanceof String ? response.utr.take(120) : null),requestJson:null]).update()
if (payout.testMode == 'N' && (response.status == 'processed' || (wasProcessed && response.status == 'reversed'))) {
    salary.paid = response.status == 'processed' ? 'Y' : 'N'
    salary.update()
}
return [success:true,status:response.status]
