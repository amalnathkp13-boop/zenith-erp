<form class="grn-card grn-editor" method="post" action="${purchasePath}GoodsReceiptDetail/saveDraft" v-pre>
    <input type="hidden" name="moquiSessionToken" value="${ec.web.sessionToken?html}"/>
    <input type="hidden" name="grnId" value="${grn.grnId?html}"/>
    <input type="hidden" name="draftVersion" value="${grn.lastUpdatedStamp.time?c}"/>
    <section aria-labelledby="grn-delivery-heading">
        <h2 id="grn-delivery-heading" class="grn-heading">Delivery details</h2>
        <div class="grn-input-pair">
            <label>Receiving location
                <select name="facilityId" required>
                    <#if !grn.facilityId?has_content && locations?size != 1><option value="">Choose a location</option></#if>
                    <#list locations as location><option value="${location.facilityId?html}"<#if (grn.facilityId!'') == location.facilityId> selected</#if>>${(location.facilityName!location.facilityId)?html}</option></#list>
                </select>
            </label>
            <label>Supplier invoice number <small>Optional</small>
                <input name="vendorInvoiceNumber" value="${(grn.vendorInvoiceNumber!'')?html}" maxlength="50" placeholder="Enter invoice number"/>
            </label>
        </div>
        <#if vendorBills?has_content || grn.invoiceId?has_content>
        <div class="grn-bill-picker">
            <label>Vendor bill <small>Optional</small>
                <select name="invoiceId">
                    <option value="">No linked bill</option>
                    <#list vendorBills as bill><option value="${bill.invoiceId?html}"<#if (grn.invoiceId!'') == bill.invoiceId> selected</#if>>${(bill.vendorInvoiceNumber!bill.invoiceId)?html}</option></#list>
                </select>
            </label>
        </div>
        </#if>
    </section>
    <section class="grn-editor-products" aria-labelledby="grn-products-heading">
        <div class="grn-product-head">
            <h2 id="grn-products-heading" class="grn-heading">Delivery products</h2>
            <span>${draftProducts?size} <#if draftProducts?size == 1>product<#else>products</#if></span>
        </div>
        <#if draftProducts?has_content>
        <p class="grn-note">Quantities and prices come from the purchase order. Adjust what the supplier is sending. Use 0 to leave a product out.</p>
        <div class="grn-entry-scroll">
            <table class="grn-entry-table">
                <thead><tr><th scope="col">Product</th><th scope="col">Open on PO</th><th scope="col">Delivery qty</th><th scope="col">Unit cost <small>${grnCurrency?html}</small></th></tr></thead>
                <tbody><#list draftProducts as item>
                    <tr>
                        <th scope="row">${item.label?html}<#if item.code?has_content><small>${item.code?html}</small></#if></th>
                        <td>${item.available?c}</td>
                        <td>
                            <input type="hidden" name="version_${item.seq?html}" value="${item.version?html}"/>
                            <input type="number" name="qty_${item.seq?html}" aria-label="Delivery quantity for ${item.label?html}" value="${item.qty?c}" step="0.000001" min="0" required/>
                        </td>
                        <td><input type="number" name="cost_${item.seq?html}" aria-label="Unit cost ${grnCurrency?html} for ${item.label?html}" value="<#if item.cost??>${item.cost?c}</#if>" step="0.000001" min="0"/></td>
                    </tr>
                </#list></tbody>
            </table>
        </div>
        <#else><p class="grn-note">Add products to the purchase order to prepare a delivery.</p></#if>
    </section>
    <#if draftProducts?has_content>
    <footer class="grn-editor-footer">
        <p><#if access.canSend!false>Stock updates when Inventory confirms receipt.<#else>After the PO is approved, send this delivery to Receiving.</#if></p>
        <div class="grn-actions">
            <button type="submit" name="draftAction" value="save">Save draft</button>
            <#if access.canSend!false>
            <button class="grn-send" type="submit" name="draftAction" value="send">Send to Receiving <span aria-hidden="true">→</span></button>
            <#elseif access.approvalAction?has_content>
            <button class="grn-send" type="submit" name="draftAction" value="${access.approvalAction?html}"><#if access.approvalAction == 'placePo'>Save &amp; place purchase order<#else>Save &amp; approve purchase order</#if></button>
            <#else>
            <a class="grn-open" href="${purchasePath}EditPurchaseOrder?orderId=${grn.purchaseOrderId?url('UTF-8')}">Review purchase order</a>
            </#if>
        </div>
    </footer>
    </#if>
</form>
