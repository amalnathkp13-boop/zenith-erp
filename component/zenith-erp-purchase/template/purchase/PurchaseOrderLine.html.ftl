<form id="AddItemForm" method="post" action="${poPath}/addItem" data-quote-url="${poPath}/quoteLinePrice" v-pre>
    <input type="hidden" name="moquiSessionToken" value="${ec.web.sessionToken?html}"/>
    <input type="hidden" name="orderId" value="${orderId?html}"/>
    <input type="hidden" name="useCatalogPrice" value="true"/>
    <fieldset class="zpe-form" data-currency="${(order.currencyUomId!'INR')?html}">
        <section class="zpe-catalog">
            <label for="po-product-picker">Find a product</label>
            <select name="productId" id="po-product-picker" class="zpe-source" required>
                <option value="">Choose a product</option>
                <#list poProducts as product>
                    <option value="${product.productId?html}" data-name="${(product.productName!product.productId)?html}" data-code="${(product.pseudoId!'')?html}">${(product.productName!product.productId)?html}<#if product.pseudoId?has_content> · ${product.pseudoId?html}</#if></option>
                </#list>
            </select>
            <div class="zpe-picker"></div>
        </section>
        <section class="zpe-entry">
            <h3 data-selected-name>Select a product</h3>
            <div class="zpe-fields">
                <label>Quantity<input name="quantity" type="number" min="0.000001" step="0.000001" value="1" required/></label>
                <label>Unit price<#if poCurrencyLabel?has_content> (${poCurrencyLabel?html})</#if><input name="unitAmount" type="number" min="0" step="any" aria-describedby="po-price-status"/></label>
                <p id="po-price-status" class="zpe-price-status" role="status">Unit price fills automatically.</p>
                <details class="zpe-options">
                    <summary>More options</summary>
                    <label>Custom description <input name="itemDescription"/></label>
                    <label>Expected date <input name="requiredByDate" type="date"/></label>
                </details>
                <button class="btn btn-primary" type="submit">Add to order</button>
            </div>
        </section>
    </fieldset>
</form>
