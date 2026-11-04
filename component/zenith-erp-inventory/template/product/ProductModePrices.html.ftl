<input type="hidden" name="modePricesJson" value="{}"/>
<div class="pe-mode-prices" data-pe-mode-prices>
    <p>Blank prices follow the MRP. Enter a price to override it for that mode.</p>
    <#list (productModePricing.modes)![] as mode>
    <label class="pe-mode-row">
        <span>${mode.modeName?html}</span>
        <input type="number" min="0" max="999999999999.99" step="0.01" inputmode="decimal"
               data-pe-mode-id="${mode.salesModeId?html}" value="${(mode.priceOverride?c)!''}"
               placeholder="${(mode.effectivePrice?c)!''}"/>
        <small data-pe-mode-status><#if mode.priceOverride??>Override<#elseif mode.effectivePrice??>Uses MRP<#else>No price set</#if></small>
    </label>
    <#else>
    <p>No active sales modes. You can configure them in POS → Sales Mode.</p>
    </#list>
</div>
