<form class="grn-card grn-editor" method="post" action="${sri.buildUrl('saveDraft').url?html}" v-pre>
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
        <details class="grn-bill-picker"<#if grn.invoiceId?has_content> open</#if>>
            <summary>Link an existing vendor bill</summary>
            <label>Vendor bill
                <select name="invoiceId">
                    <option value="">No linked bill</option>
                    <#list vendorBills as bill><option value="${bill.invoiceId?html}"<#if (grn.invoiceId!'') == bill.invoiceId> selected</#if>>${(bill.vendorInvoiceNumber!bill.invoiceId)?html}</option></#list>
                </select>
            </label>
        </details>
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
        <p>Stock updates when Inventory confirms receipt.</p>
        <div class="grn-actions">
            <button type="submit" name="draftAction" value="save">Save draft</button>
            <#if ['OrderApproved','OrderCompleted']?seq_contains(access.order.statusId)>
            <button class="grn-send" type="submit" name="draftAction" value="send">Send to Receiving <span aria-hidden="true">→</span></button>
            </#if>
        </div>
    </footer>
    </#if>
</form>
