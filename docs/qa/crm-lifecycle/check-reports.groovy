// Run with Groovy 5, passing the Reports.xml file as the first argument.
import javax.xml.parsers.DocumentBuilderFactory
import java.sql.Timestamp
import java.text.DecimalFormat

def xml = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(new File(args[0]))
def script = xml.getElementsByTagName('script').item(0).textContent
def now = Timestamp.valueOf('2026-11-19 12:00:00')
def old = Timestamp.valueOf('2026-11-05 12:00:00')
def recent = Timestamp.valueOf('2026-11-18 12:00:00')
def deal = [opportunityStageId:'Qualify', estimatedAmount:100.5G, estimatedProbability:0.5G,
            estimatedCloseDate:java.sql.Date.valueOf('2026-11-28'), lastUpdatedStamp:old, leadSourceId:'Web']
def deals = [deal + [salesOpportunityId:'D1', currencyUomId:'INR', assignedToUserId:'Seller-A'],
             deal + [salesOpportunityId:'D2', currencyUomId:'USD'],
             deal + [salesOpportunityId:'D3', currencyUomId:'INR', opportunityStageId:'NoAlert'],
             deal + [salesOpportunityId:'D4', currencyUomId:'INR', opportunityStageId:'SoClosedLost', lostDate:recent],
             deal + [salesOpportunityId:'D5', currencyUomId:'CAD', estimatedCloseDate:java.sql.Date.valueOf('2026-12-03')],
             deal + [salesOpportunityId:'D6', currencyUomId:'EUR', leadSourceId:'Referral']]
def activities = [[salesOpportunityId:'D2', statusId:'Completed', completedDate:recent, activityDate:recent],
                  [salesOpportunityId:'D1', statusId:'Scheduled', dueDate:Timestamp.valueOf('2026-11-25 12:00:00')],
                  [salesOpportunityId:'D6', statusId:'Scheduled', dueDate:old],
                  [activityId:'A4', leadId:'PriorLead', statusId:'Scheduled', dueDate:old, assignedToUserId:'Seller-A'],
                  [activityId:'A5', leadId:'PriorLead', statusId:'Cancelled', dueDate:old, assignedToUserId:'Seller-A']]
def leads = [[leadId:'RecentLead', firstTouchSourceId:'Web', statusId:'LeadNew', createdDate:recent, assignedToUserId:'Seller-A'],
             [leadId:'PriorLead', firstTouchSourceId:'Web', statusId:'LeadNew', createdDate:Timestamp.valueOf('2026-10-15 11:00:00')],
             [leadId:'LostLead', firstTouchSourceId:'Web', statusId:'LeadLost', createdDate:recent]]
def input = [period:'month', sourceId:'Web', campaignId:'', allLeads:leads, allActivities:activities,
             leadStatuses:[[statusId:'LeadNew',description:'New'],[statusId:'LeadLost',description:'Lost']],
             allOpportunities:deals, sourceCatalogue:[[leadSourceId:'Web', description:'Website']], campaigns:[],
             stages:[[opportunityStageId:'Qualify',description:'Qualification'], [opportunityStageId:'NoAlert',description:'Negotiation']],
             stageSettings:[[opportunityStageId:'Qualify',displayName:'Qualified',staleAfterDays:14],
                            [opportunityStageId:'NoAlert',staleAfterDays:0]],
             ec:[user:[nowTimestamp:now], l10n:[format:{ n, fmt -> new DecimalFormat(fmt).format(n) }]]]
def binding = new Binding(input)
new GroovyShell(binding).evaluate(script)
assert binding.forecastRows.findAll { it.stageName == 'Qualified' }*.currency == ['INR','USD']
assert binding.forecastRows.every { it.weighted == 50.25G && it.amount == 100.50G }
assert binding.weightedTotal.contains('INR 100.50') && binding.weightedTotal.contains('USD 50.25')
assert binding.staleRows*.salesOpportunityId == ['D1']
assert binding.staleRows[0].idleDays == 14
assert binding.overdueActivities == 1 && binding.filteredActivities.size() == 4
assert binding.overdueRows*.activityId == ['A4']
assert binding.leadStatusRows == [[statusName:'New', leads:1],[statusName:'Lost', leads:1]]
assert binding.workloadRows == [[ownerName:'Unassigned', openLeads:0, openDeals:2, scheduledCount:1, overdueCount:0],
                                [ownerName:'Seller-A', openLeads:1, openDeals:1, scheduledCount:1, overdueCount:1]]
// A second cohort exercises category assignments and actual outcome dates independently of the weighted model.
deals.addAll([deal + [salesOpportunityId:'W1', currencyUomId:'USD', opportunityStageId:'SoClosedWon', wonDate:recent],
              deal + [salesOpportunityId:'W0', currencyUomId:'USD', opportunityStageId:'SoClosedWon', wonDate:Timestamp.valueOf('2026-10-31 08:00:00')],
              deal + [salesOpportunityId:'O1', currencyUomId:'INR', opportunityStageId:'Exclude'],
              deal + [salesOpportunityId:'P1', currencyUomId:'INR', opportunityStageId:'Legacy']])
input.stageSettings.find { it.opportunityStageId == 'Qualify' }.forecastCategory = 'Best Case'
input.stageSettings.find { it.opportunityStageId == 'NoAlert' }.forecastCategory = 'Commit'
input.stageSettings.add([opportunityStageId:'Exclude', forecastCategory:'Omitted'])
new GroovyShell(binding).evaluate(script)
assert binding.categoryRows == [[currency:'INR', pipeline:100.5G, bestCase:100.5G, commitValue:100.5G, closed:0G, omitted:201G],
                                [currency:'USD', pipeline:0G, bestCase:100.5G, commitValue:0G, closed:100.5G, omitted:0G]]
println 'Single-category forecasts, period boundaries and legacy stage defaults passed.'
println 'Scoped forecasts, currency totals, inactivity thresholds and status, workload and overdue follow-up reconciliation passed.'
