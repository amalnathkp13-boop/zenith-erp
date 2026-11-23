<form id="AddItemForm" method="post" action="${poPath}/addItem" data-quote-url="${poPath}/quoteLinePrice" v-pre>
    <input type="hidden" name="moquiSessionToken" value="${ec.web.sessionToken?html}"/>
    <input type="hidden" name="orderId" value="${orderId?html}"/>
    <input type="hidden" name="useCatalogPrice" value="true"/>
    <div class="po-entry-fields">
        <label>Product
            <select name="productId">
                <option value="">Choose a product</option>
                <#list poProducts as product>
                    <option value="${product.productId?html}">${(product.productName!product.productId)?html}<#if product.pseudoId?has_content> · ${product.pseudoId?html}</#if></option>
                </#list>
            </select>
        </label>
        <label>Quantity
            <input name="quantity" type="number" min="0.000001" step="0.000001" value="1" required/>
        </label>
        <label>Unit price<#if poCurrencyLabel?has_content> (${poCurrencyLabel?html})</#if>
            <input name="unitAmount" type="number" min="0" step="any" aria-describedby="po-price-status"/>
        </label>
        <button class="btn btn-primary" type="submit">Add to order</button>
    </div>
    <p id="po-price-status" role="status">Unit price fills automatically.</p>
    <details>
        <summary>More options</summary>
        <div class="po-entry-extra">
            <label>Custom description <input name="itemDescription"/></label>
            <label>Expected date <input name="requiredByDate" type="date"/></label>
        </div>
    </details>
</form>
