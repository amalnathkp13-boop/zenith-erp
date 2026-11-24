<form id="CreateGrnForm" class="grn-create" method="post" action="${grnCreatePath}" v-pre>
    <input type="hidden" name="moquiSessionToken" value="${ec.web.sessionToken?html}"/>
    <#if receiptOrders?has_content>
    <div class="grn-create-fields">
        <label>Purchase order
            <select name="purchaseOrderId" required>
                <option value="">Choose a purchase order</option>
                <#list receiptOrders as order>
                <option value="${order.orderId?html}">#${order.orderId?html}<#if (receiptSupplierNames[order.vendorPartyId]!'')?has_content> · ${receiptSupplierNames[order.vendorPartyId]?html}</#if></option>
                </#list>
            </select>
        </label>
        <label>Receipt date
            <input name="receiptDate" type="date" value="${defaultReceiptDate?html}" required/>
        </label>
    </div>
    <details class="grn-disclosure">
        <summary>Advanced charges <small>Optional</small></summary>
        <div class="grn-charge-fields">
            <label>Freight <input name="freightAmount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"/></label>
            <label>Insurance <input name="insuranceAmount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"/></label>
            <label>Customs duty <input name="customsDutyAmount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"/></label>
            <label>Other landed charges <input name="otherChargesAmount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"/></label>
        </div>
    </details>
    <div class="grn-create-footer">
        <button class="grn-send" type="submit">Create GRN</button>
    </div>
    <#else>
    <p class="grn-note">Create a purchase order to record a delivery.</p>
    </#if>
</form>
