// CRM and recurring-customer-subscription workflows. Synthetic loopback memory DB only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {chromium}=require('playwright');
const base='http://127.0.0.1:18083',root=process.env.AUDIT_QA_RUNTIME,java=process.env.AUDIT_QA_JAVA,out=process.env.AUDIT_QA_OUT;
assert(root&&java&&out,'Disposable runtime/JDK/output required');
fs.mkdirSync(out,{recursive:true});const classes=path.join(out,'classes');fs.mkdirSync(classes,{recursive:true});
cp.execFileSync(path.join(path.dirname(java),'javac.exe'),['-d',classes,path.join(__dirname,'../sales-runtime/SalesDbProbe.java')],{windowsHide:true});
const q=sql=>{assert.match(sql,/^SELECT /i);return JSON.parse(cp.execFileSync(java,['-cp',classes+path.delimiter+path.join(root,'WEB-INF/lib/h2-2.4.240.jar'),'SalesDbProbe'],{input:sql,encoding:'utf8',windowsHide:true,env:{...process.env,SALES_QA_DB_URL:'jdbc:h2:tcp://127.0.0.1:19095/mem:sales-qa-sop;IFEXISTS=TRUE'}}));};
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const count=(table,where)=>Number(q(`SELECT count(*) AS n FROM ${table==='subscription'?'zenith_subscription':table} WHERE ${where}`)[0].n);
const checks=[];let mode=process.env.AUDIT_QA_MODE||'baseline';
function check(name,passed,evidence={}){checks.push({name,passed:!!passed,evidence});console.log((passed?'PASS ':'FAIL ')+name);}
async function scenario(name,fn){try{await fn();}catch(error){check(name,false,{error:error.message});}}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const contexts=[];
 try{
  const helper='/apps/zenith/Crm/AllModulesQa';
  async function actor(username){
   const ctx=await browser.newContext({viewport:{width:1366,height:900}});contexts.push(ctx);
   const r=await ctx.request.get(base+helper,{headers:{Authorization:'Basic '+Buffer.from(username+':moqui').toString('base64')}});
   const token=(await r.text()).match(/name="moquiSessionToken"[^>]*value="([^"]+)"/)?.[1];assert(token,username+' authenticated helper token, HTTP '+r.status());
   const post=(route,form,csrf=true)=>ctx.request.post(base+'/apps/zenith/'+route,{form:{...(csrf?{moquiSessionToken:token}:{}),...form},maxRedirects:0});
   const invoke=async(op,input={})=>{const response=await post('Crm/AllModulesQa/invoke',{op,input:JSON.stringify(input)});try{return {httpStatus:response.status(),...await response.json()};}catch{return {httpStatus:response.status(),errors:['Non-JSON response']};}};
   const scope=org=>post('Crm/AllModulesQa/scope',{organizationPartyId:org});
   return{ctx,token,post,invoke,scope};
  }
  const admin=await actor('john.doe');
  if(!count('party',"party_id='AUDIT_QA_A'")){
   const initialized=await admin.post('Crm/AllModulesQa/initialize',{});assert((await initialized.json()).initialized,'Fresh fixture initialized');
  }
  const a=await actor('audit.qa'),b=await actor('audit.b.qa');
  const foreignPlanBefore=q("SELECT * FROM subscription_plan WHERE plan_id='AUDIT_QA_PLAN_B'");
  const legalBefore=q('SELECT invoice_id,invoice_total,status_id FROM invoice ORDER BY invoice_id');
  await scenario('Zero tax calculator',async()=>{
   const r=await a.invoke('subscription.tax',{organizationPartyId:'AUDIT_QA_A',customerPartyId:'AUDIT_QA_CUST_A',taxableAmount:'100',gstRate:'0'});
   check('Subscriptions: explicitly configured zero GST remains zero',!r.errors?.length&&Number(r.result?.taxAmount)===0&&Number(r.result?.totalAmount)===100,{result:r.result,httpStatus:r.httpStatus});
  });
  const taxed=await a.invoke('subscription.tax',{organizationPartyId:'AUDIT_QA_A',customerPartyId:'AUDIT_QA_CUST_A',taxableAmount:'100',gstRate:'18'});
  check('Subscriptions: positive tax arithmetic remains 100 + 18',!taxed.errors?.length&&Number(taxed.result?.taxAmount)===18&&Number(taxed.result?.totalAmount)===118);
  let subscriptionId;
  await scenario('Subscription creation',async()=>{
   const r=await a.invoke('subscription.create',{customerPartyId:'AUDIT_QA_CUST_A',planId:'AUDIT_QA_PLAN_ZERO'});subscriptionId=r.result?.subscriptionId;
   const stored=subscriptionId?q(`SELECT * FROM zenith_subscription WHERE subscription_id=${quote(subscriptionId)}`)[0]:null;
   check('Subscriptions: create persists own customer, plan and currency',stored?.organization_party_id==='AUDIT_QA_A'&&stored?.customer_party_id==='AUDIT_QA_CUST_A'&&stored?.currency_uom_id==='INR',{errors:r.errors,httpStatus:r.httpStatus});
   check('Subscriptions: zero-tax plan has exact untaxed total',stored&&Number(stored.gst_amount)===0&&Number(stored.total_amount)===100,{gst:stored?.gst_amount,total:stored?.total_amount});
   if(subscriptionId){
    const invoice=await a.invoke('subscription.invoice',{subscriptionId});const id=invoice.result?.subInvoiceId;
    const row=id?q(`SELECT * FROM subscription_invoice WHERE sub_invoice_id=${quote(id)}`)[0]:null;
    check('Subscriptions: generated zero-tax draft retains exact total',row&&Number(row.total_tax_amount)===0&&Number(row.total_amount)===100,{errors:invoice.errors,tax:row?.total_tax_amount,total:row?.total_amount});
    const invoiceCount=count('subscription_invoice',`subscription_id=${quote(subscriptionId)}`);
    const repeated=await a.invoke('subscription.invoice',{subscriptionId});
    check('Subscriptions: repeated billing of the same period returns the existing invoice',repeated.result?.subInvoiceId===id&&count('subscription_invoice',`subscription_id=${quote(subscriptionId)}`)===invoiceCount);
    const immutable=JSON.stringify(row);
    await a.post('subscriptions/Invoices/updateInvoice',{subInvoiceId:id,totalAmount:'999',organizationPartyId:'AUDIT_QA_B'});
    check('Subscriptions: invoice amount and owner cannot be overwritten by status form',JSON.stringify(q(`SELECT * FROM subscription_invoice WHERE sub_invoice_id=${quote(id)}`)[0])===immutable);
    for(const [label,newPlanId] of [['foreign','AUDIT_QA_PLAN_B'],['inactive','AUDIT_QA_PLAN_OFF']]){
     const before=JSON.stringify(q(`SELECT * FROM zenith_subscription WHERE subscription_id=${quote(subscriptionId)}`));
     await a.post('subscriptions/EditSubscription/changePlan',{subscriptionId,newPlanId});
     check('Subscriptions: '+label+' plan change rejected without altering subscription',JSON.stringify(q(`SELECT * FROM zenith_subscription WHERE subscription_id=${quote(subscriptionId)}`))===before);
     await a.post('subscriptions/EditSubscription/changePlan',{subscriptionId,newPlanId:'AUDIT_QA_PLAN_ZERO'});
    }
   }
  });
  for(const [name,input]of [
   ['inactive plan',{planId:'AUDIT_QA_PLAN_OFF'}],['foreign plan',{planId:'AUDIT_QA_PLAN_B'}],
   ['foreign customer',{customerPartyId:'AUDIT_QA_CUST_B'}],['unknown discount',{discountCode:'AUDIT-NOT-A-COUPON'}]
  ])await scenario('Subscription rejects '+name,async()=>{
   const before=count('subscription',"organization_party_id='AUDIT_QA_A'");
   const r=await a.invoke('subscription.create',{customerPartyId:'AUDIT_QA_CUST_A',planId:'AUDIT_QA_PLAN_A',...input});
   check('Subscriptions: '+name+' rejected without a new subscription',r.errors?.length>0&&count('subscription',"organization_party_id='AUDIT_QA_A'")===before,{httpStatus:r.httpStatus,errors:r.errors});
  });
  await a.post('subscriptions/Plans/updatePlan',{planId:'AUDIT_QA_PLAN_B',billingAmount:'999'});
  check('Subscriptions: editing a plan cannot change a foreign plan',JSON.stringify(q("SELECT * FROM subscription_plan WHERE plan_id='AUDIT_QA_PLAN_B'"))===JSON.stringify(foreignPlanBefore));
  await a.post('subscriptions/Plans/createPlan',{planName:'Disposable invalid negative plan',planCode:'AUDITNEGATIVE',billingFrequency:'BfMonthly',billingAmount:'-1',trialDays:'0',taxRate:'0'});
  check('Subscriptions: negative plan amount rejected',count('subscription_plan',"plan_code='AUDITNEGATIVE'")===0);
  const foreignCoupon=JSON.stringify(q("SELECT * FROM subscription_discount WHERE discount_id='AUDIT_QA_DISCOUNT_B'"));
  await a.post('subscriptions/Discounts/updateDiscount',{discountId:'AUDIT_QA_DISCOUNT_B',discountValue:'999'});
  check('Subscriptions: foreign coupon remains unchanged',JSON.stringify(q("SELECT * FROM subscription_discount WHERE discount_id='AUDIT_QA_DISCOUNT_B'"))===foreignCoupon);
  await a.post('subscriptions/Discounts/createDiscount',{discountCode:'AUDITINVALID',discountName:'Disposable invalid coupon',discountType:'DtPercentage',discountValue:'101'});
  check('Subscriptions: percentage coupon over 100 rejected',count('subscription_discount',"discount_code='AUDITINVALID'")===0);
  await a.post('subscriptions/Plans/createPlan',{planName:'Disposable valid plan',planCode:'AUDITVALID',billingFrequency:'BfMonthly',billingAmount:'12.50',taxRate:'0',trialDays:'0',currencyUomId:'INR'});
  const ownPlan=q("SELECT * FROM subscription_plan WHERE plan_code='AUDITVALID' AND organization_party_id='AUDIT_QA_A'")[0];
  check('Subscriptions: valid plan form persists exact amount and zero tax',ownPlan&&Number(ownPlan.billing_amount)===12.5&&Number(ownPlan.tax_rate)===0);
  if(ownPlan){
   await a.post('subscriptions/Plans/updatePlan',{planId:ownPlan.plan_id,billingAmount:'13.50',isActive:'Y'});
   check('Subscriptions: own plan partial update preserves name and currency',q(`SELECT * FROM subscription_plan WHERE plan_id=${quote(ownPlan.plan_id)}`)[0]?.plan_name==='Disposable valid plan'&&Number(q(`SELECT * FROM subscription_plan WHERE plan_id=${quote(ownPlan.plan_id)}`)[0]?.billing_amount)===13.5);
  }
  if(subscriptionId)await scenario('Subscription lifecycle',async()=>{
   await a.invoke('subscription.pause',{subscriptionId,reason:'Disposable pause'});check('Subscriptions: Active → Paused persists',q(`SELECT status_id FROM zenith_subscription WHERE subscription_id=${quote(subscriptionId)}`)[0].status_id==='SubPaused');
   await a.invoke('subscription.resume',{subscriptionId});check('Subscriptions: Paused → Active persists',q(`SELECT status_id FROM zenith_subscription WHERE subscription_id=${quote(subscriptionId)}`)[0].status_id==='SubActive');
   await a.invoke('subscription.cancel',{subscriptionId,cancelReason:'Disposable cancellation'});check('Subscriptions: cancellation persists',q(`SELECT status_id FROM zenith_subscription WHERE subscription_id=${quote(subscriptionId)}`)[0].status_id==='SubCancelled');
   const before=count('subscription_invoice',`subscription_id=${quote(subscriptionId)}`);const r=await a.invoke('subscription.invoice',{subscriptionId});
   check('Subscriptions: cancelled subscription cannot generate a new invoice',r.errors?.length>0&&count('subscription_invoice',`subscription_id=${quote(subscriptionId)}`)===before);
  });
  let leadId;
  await scenario('CRM lead lifecycle',async()=>{
   const r=await a.invoke('lead.create',{organizationPartyId:'AUDIT_QA_B',firstName:'Disposable lead A',email:'LEAD.A@EXAMPLE.COM',estimatedAmount:'100',rating:'Warm',leadSourceId:'Instagram',sourceDetail:'Disposable campaign link',utmSource:'instagram',utmMedium:'social',externalSubmissionId:'audit-lead-a'});leadId=r.result?.leadId;
   const row=leadId?q(`SELECT * FROM lead WHERE lead_id=${quote(leadId)}`)[0]:null;
   check('CRM: create ignores foreign owner input and normalizes email',row?.organization_party_id==='AUDIT_QA_A'&&row?.email==='lead.a@example.com',{errors:r.errors,httpStatus:r.httpStatus});
   if(!leadId)return;
   check('CRM: original source and UTM are stored',row.lead_source_id==='Instagram'&&row.first_touch_source_id==='Instagram'&&row.utm_source==='instagram'&&row.utm_medium==='social');
   const retry=await a.invoke('lead.create',{firstName:'Disposable lead A',leadSourceId:'Instagram',externalSubmissionId:'audit-lead-a'});
   check('CRM: intake retry returns the original lead',retry.result?.leadId===leadId&&count('lead_submission',"organization_party_id='AUDIT_QA_A' AND external_submission_id='audit-lead-a'")===1);
   await a.invoke('lead.touch',{leadId,touchId:'audit-touch-1',leadSourceId:'YouTube',utmSource:'youtube'});
   await a.invoke('lead.touch',{leadId,touchId:'audit-touch-1',leadSourceId:'YouTube',utmSource:'youtube'});
   const touched=q(`SELECT first_touch_source_id,latest_touch_source_id FROM lead WHERE lead_id=${quote(leadId)}`)[0];
   check('CRM: later touch preserves original source and retry does not duplicate',touched.first_touch_source_id==='Instagram'&&touched.latest_touch_source_id==='YouTube'&&count('lead_touch',`lead_id=${quote(leadId)}`)===1);
   await a.invoke('lead.update',{leadId,firstName:'Disposable updated lead'});
   check('CRM: partial lead update persists',q(`SELECT first_name FROM lead WHERE lead_id=${quote(leadId)}`)[0]?.first_name==='Disposable updated lead');
   const before=count('crm_activity',"organization_party_id='AUDIT_QA_A'");
   await a.invoke('activity.log',{leadId,activityType:'Call',subject:'Disposable call',durationMinutes:'5'});
   check('CRM: valid activity persists and advances New → Contacted',count('crm_activity',"organization_party_id='AUDIT_QA_A'")===before+1&&q(`SELECT status_id FROM lead WHERE lead_id=${quote(leadId)}`)[0]?.status_id==='LeadContacted');
   const dueDate=new Date(Date.now()+86400000).toISOString();
   const scheduled=await a.invoke('activity.schedule',{leadId,activityType:'Task',subject:'Disposable follow-up',dueDate,externalSubmissionId:'audit-activity-a'});
   const activityId=scheduled.result?.activityId;
   await a.invoke('activity.schedule',{leadId,activityType:'Task',subject:'Disposable follow-up',dueDate,externalSubmissionId:'audit-activity-a'});
   check('CRM: scheduled activity retry creates one task',!!activityId&&count('activity_submission',"organization_party_id='AUDIT_QA_A' AND external_submission_id='audit-activity-a'")===1&&count('crm_activity',`activity_id=${quote(activityId)}`)===1,{errors:scheduled.errors});
   if(activityId){
    const completed=await a.invoke('activity.complete',{activityId,outcome:'Connected',description:'Discussed next steps'});
    check('CRM: completed activity keeps outcome and timestamp',!completed.errors?.length&&q(`SELECT status_id,outcome,completed_date FROM crm_activity WHERE activity_id=${quote(activityId)}`)[0]?.status_id==='Completed'&&!!q(`SELECT completed_date FROM crm_activity WHERE activity_id=${quote(activityId)}`)[0]?.completed_date,{errors:completed.errors});
   }
   await a.invoke('lead.update',{leadId,statusId:'LeadQualified'});
   const converted=await a.invoke('lead.convert',{leadId,createOpportunity:'Y'});
   check('CRM: qualified lead converts to one owned contact and opportunity',!!converted.result?.partyId&&!!converted.result?.salesOpportunityId&&q(`SELECT status_id FROM lead WHERE lead_id=${quote(leadId)}`)[0]?.status_id==='LeadConverted',{errors:converted.errors,httpStatus:converted.httpStatus});
   const contacts=count('party',"owner_party_id='AUDIT_QA_A'");await a.invoke('lead.convert',{leadId,createOpportunity:'Y'});
   check('CRM: repeated conversion creates no duplicate contact',count('party',"owner_party_id='AUDIT_QA_A'")===contacts);
  });
  for(const [name,input]of [['unknown activity type',{activityType:'NotARealActivity',subject:'Disposable invalid type'}],['negative duration',{activityType:'Call',subject:'Disposable negative duration',durationMinutes:'-1'}],['blank subject',{activityType:'Call',subject:'   '}]]){
   const before=count('crm_activity',"organization_party_id='AUDIT_QA_A'");const r=await a.invoke('activity.log',input);
   check('CRM: '+name+' rejected without a row',r.errors?.length>0&&count('crm_activity',"organization_party_id='AUDIT_QA_A'")===before,{httpStatus:r.httpStatus,errors:r.errors});
  }
  await scenario('CRM pipeline workflow',async()=>{
   const created=await a.invoke('opportunity.create',{opportunityName:'Disposable pipeline opportunity',opportunityStageId:'SoProspecting',accountPartyId:'AUDIT_QA_CUST_A',estimatedAmount:'100'});
   const id=created.result?.salesOpportunityId;
   check('CRM: owned opportunity persists in pipeline',!!id&&q(`SELECT organization_party_id FROM sales_opportunity WHERE sales_opportunity_id=${quote(id)}`)[0]?.organization_party_id==='AUDIT_QA_A');
   if(id){
    const rule = {opportunityStageId:'SoQualification',taskSubject:'Disposable qualification follow-up',daysUntilDue:'2',isActive:'Y'};
    await a.post('Crm/Workflows/saveWorkflow',rule);
    const taskFilter = `sales_opportunity_id=${quote(id)} AND subject=${quote(rule.taskSubject)}`;
    const move = {salesOpportunityId:id,opportunityStageId:rule.opportunityStageId};
    await a.post('Crm/Pipeline/advanceStage',move);
    await a.invoke('opportunity.advance',{...move,opportunityStageId:'SoProspecting'});
    await a.invoke('opportunity.advance',move);
    const tasks = q(`SELECT organization_party_id, activity_type, status_id, due_date FROM crm_activity WHERE ${taskFilter}`);
    check('CRM: stage workflow schedules one owned task across retries and re-entry',
     tasks.length===1&&tasks[0].organization_party_id==='AUDIT_QA_A'&&
     tasks[0].activity_type==='Task'&&tasks[0].status_id==='Scheduled'&&!!tasks[0].due_date);
    await a.post('Crm/EditOpportunity/addNote',{salesOpportunityId:id,subject:'Disposable pipeline note',description:'Disposable note body'});
    check('CRM: opportunity note is stored on the deal',
     count('crm_activity',`sales_opportunity_id=${quote(id)} AND organization_party_id='AUDIT_QA_A' AND activity_type='Note' AND description='Disposable note body'`)===1);
    await a.invoke('opportunity.advance',{salesOpportunityId:id,opportunityStageId:'SoClosedWon',confirmOutcome:'Y'});
    const won=q(`SELECT * FROM sales_opportunity WHERE sales_opportunity_id=${quote(id)}`)[0];
    check('CRM: won stage records full expected revenue',won.opportunity_stage_id==='SoClosedWon'&&Number(won.expected_revenue)===100);
    const rejected=await a.invoke('opportunity.advance',{salesOpportunityId:id,opportunityStageId:'SoClosedLost'});
    check('CRM: closed pipeline opportunity cannot silently move to lost',rejected.errors?.length>0&&q(`SELECT opportunity_stage_id FROM sales_opportunity WHERE sales_opportunity_id=${quote(id)}`)[0]?.opportunity_stage_id==='SoClosedWon');
   }
  });
  await scenario('CRM segment workflow',async()=>{
   const created=await a.invoke('segment.create',{segmentName:'Disposable manual segment',segmentTypeEnumId:'CstStatic'});const id=created.result?.segmentId;
   check('CRM: own manual segment persists',!!id&&q(`SELECT organization_party_id FROM customer_segment WHERE segment_id=${quote(id)}`)[0]?.organization_party_id==='AUDIT_QA_A');
   if(id){
    await a.post('Crm/EditSegment/addMember',{segmentId:id,partyId:'AUDIT_QA_CUST_A'});
    check('CRM: manual segment membership and count persist together',count('segment_member',`segment_id=${quote(id)} AND party_id='AUDIT_QA_CUST_A'`)===1&&Number(q(`SELECT member_count FROM customer_segment WHERE segment_id=${quote(id)}`)[0]?.member_count)===1);
    await a.post('Crm/EditSegment/addMember',{segmentId:id,partyId:'AUDIT_QA_CUST_B'});
    check('CRM: foreign customer cannot join segment',count('segment_member',`segment_id=${quote(id)} AND party_id='AUDIT_QA_CUST_B'`)===0);
    await a.post('Crm/EditSegment/removeMember',{segmentId:id,partyId:'AUDIT_QA_CUST_A'});
    check('CRM: manual membership removal updates count',count('segment_member',`segment_id=${quote(id)}`)===0&&Number(q(`SELECT member_count FROM customer_segment WHERE segment_id=${quote(id)}`)[0]?.member_count)===0);
   }
  });
  await scenario('CRM dynamic source segment',async()=>{
   const contactId=leadId?q(`SELECT converted_party_id FROM lead WHERE lead_id=${quote(leadId)}`)[0]?.converted_party_id:null;
   if(!contactId){check('CRM: dynamic source segment has a converted contact',false);return;}
   const created=await a.invoke('segment.create',{segmentName:'Disposable Instagram customers',segmentTypeEnumId:'CstDynamic'});
   const segmentId=created.result?.segmentId;
   if(!segmentId){check('CRM: dynamic source segment created',false,{errors:created.errors});return;}
   const rule=await a.invoke('segment.addRule',{segmentId,criteriaTypeEnumId:'SctLeadSource',operator:'eq',fieldValue:'Instagram'});
   const member=q(`SELECT * FROM segment_member WHERE segment_id=${quote(segmentId)} AND party_id=${quote(contactId)}`)[0];
   check('CRM: dynamic segment matches original source after a later YouTube touch',!rule.errors?.length&&!!member&&Number(q(`SELECT member_count FROM customer_segment WHERE segment_id=${quote(segmentId)}`)[0]?.member_count)===1,{errors:rule.errors});
  });
  const foreignLead=q("SELECT * FROM lead WHERE lead_id='AUDIT_QA_LEAD_B'");
  const denied=await a.invoke('lead.update',{leadId:'AUDIT_QA_LEAD_B',firstName:'Rejected A update'});
  check('CRM: foreign lead write rejected',denied.errors?.length>0&&JSON.stringify(q("SELECT * FROM lead WHERE lead_id='AUDIT_QA_LEAD_B'"))===JSON.stringify(foreignLead));
  const noCsrfBefore=count('lead',"organization_party_id='AUDIT_QA_A'");await a.post('Crm/Leads/createLead',{organizationPartyId:'AUDIT_QA_A',firstName:'Disposable missing CSRF'},false);
  check('CRM: missing CSRF cannot create a lead',count('lead',"organization_party_id='AUDIT_QA_A'")===noCsrfBefore);
  await a.scope('AUDIT_QA_B');
  const unauthorized=await a.invoke('lead.update',{leadId:'AUDIT_QA_LEAD_B',firstName:'Rejected preference update',testActiveOrg:'AUDIT_QA_B'});
  check('CRM: non-member active preference cannot authorize foreign lead write',unauthorized.errors?.length>0&&JSON.stringify(q("SELECT * FROM lead WHERE lead_id='AUDIT_QA_LEAD_B'"))===JSON.stringify(foreignLead));
  await a.scope('AUDIT_QA_A');
  check('Audit leaves existing financial invoices unchanged',JSON.stringify(q('SELECT invoice_id,invoice_total,status_id FROM invoice ORDER BY invoice_id'))===JSON.stringify(legalBefore));
 }finally{
  for(const ctx of contexts)await ctx.close();await browser.close();fs.writeFileSync(path.join(out,'workflows-'+mode+'.json'),JSON.stringify({productionAccess:false,checks,failures:checks.filter(c=>!c.passed)},null,2));
 }
 console.log(JSON.stringify({checks:checks.length,failures:checks.filter(c=>!c.passed).length}));if(checks.some(c=>!c.passed))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
