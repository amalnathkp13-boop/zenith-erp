<#macro warehouse field title placeholder>
    <label>${title}
        <select name="${field}" required>
            <option value="">${placeholder}</option>
            <#list facilityList as facility>
                <option value="${facility.facilityId?html}"<#if (ec.web.parameters[field]!'') == facility.facilityId> selected</#if>>${(facility.facilityName!facility.facilityId)?html}</option>
            </#list>
        </select>
    </label>
</#macro>
<form id="NewTransferForm" class="st-entry st-panel" method="post" action="${inventoryPath}NewStockTransfer/createTransfer" v-pre>
    <input type="hidden" name="moquiSessionToken" value="${ec.web.sessionToken?html}"/>
    <fieldset>
        <legend>Warehouse route</legend>
        <div class="st-input-pair">
            <@warehouse "fromFacilityId" "From warehouse" "Choose sending warehouse"/>
            <@warehouse "toFacilityId" "To warehouse" "Choose receiving warehouse"/>
        </div>
    </fieldset>
    <fieldset>
        <legend>Transfer details</legend>
        <div class="st-input-pair">
            <label>Transfer date
                <input name="transferDate" type="date" value="${(ec.web.parameters.transferDate!ec.l10n.format(transferDate,'yyyy-MM-dd'))?html}" required/>
            </label>
            <div class="st-bill-field">
                <label for="st-bill-choice">E-way bill</label>
                <select id="st-bill-choice" name="ewayBillChoice" required aria-describedby="st-bill-guidance">
                    <option value="">Select requirement</option>
                    <option value="Y"<#if (ewayBillChoice!'') == 'Y'> selected</#if>>Required</option>
                    <option value="N"<#if (ewayBillChoice!'') == 'N'> selected</#if>>Not required</option>
                </select>
                <small id="st-bill-guidance">The warehouse route or transfer value can still require a bill.</small>
            </div>
        </div>
        <label class="st-entry-notes"><span>Notes <small>Optional</small></span>
            <textarea name="remarks" rows="2" placeholder="Add handling or delivery instructions">${(remarks!'')?html}</textarea>
        </label>
    </fieldset>
    <footer class="st-entry-actions">
        <a href="${inventoryPath}StockTransfers">Cancel</a>
        <button type="submit">Create transfer</button>
    </footer>
</form>
