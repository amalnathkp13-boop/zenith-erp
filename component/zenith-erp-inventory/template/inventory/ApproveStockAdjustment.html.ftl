<form id="ApproveCountsForm" class="sa-approval-form" method="post" action="${approvalPath}" v-pre>
    <input type="hidden" name="moquiSessionToken" value="${ec.web.sessionToken?html}"/>
    <input type="hidden" name="stockAdjustmentId" value="${stockAdjustmentId?html}"/>
    <#if decreaseCount gt 0>
        <p class="sa-decrease-summary"><strong>${decreaseCount?c} <#if decreaseCount == 1>count is<#else>counts are</#if> below recorded stock</strong></p>
        <label for="sa-shortage-reason">Reason for stock decrease</label>
        <select id="sa-shortage-reason" name="shortageReasonCode" required>
            <option value="">Choose a reason</option>
            <#list shortageReasonOptions as reason>
                <option value="${reason.code?html}">${reason.label?html}</option>
            </#list>
        </select>
        <label for="sa-shortage-note">Details <small>Required for Others</small></label>
        <textarea id="sa-shortage-note" name="shortageReasonNote" rows="2" maxlength="240" placeholder="Add a short explanation"></textarea>
    </#if>
    <div class="sa-approval-footer">
        <p>Stock updates when you apply the approved counts.</p>
        <button type="submit">Confirm approval</button>
    </div>
</form>
