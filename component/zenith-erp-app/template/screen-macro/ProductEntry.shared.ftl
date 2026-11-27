<#-- Native form widgets and their scoped product options remain the source of truth. -->
<#macro "form-single">
    <#local entryForm = sri.getFormInstance(.node["@name"]).getFormNode()>
    <#local productField = "">
    <#list entryForm["field"] as candidate>
        <#if candidate["@name"] == "productId"><#local productField = candidate></#if>
    </#list>
    <#local addAction = entryForm["@transition"]!""><#local picker = "">
    <#if productField?has_content && productField["default-field"]?has_content && productField["default-field"][0]["drop-down"]?has_content>
        <#local picker = productField["default-field"][0]["drop-down"][0]>
    </#if>
    <#if !addAction?matches("(?i)(add|create|setPriceItem|setVolumePricing|receiveDirectStock).*") || !picker?has_content || picker["dynamic-options"]?has_content || picker["@allow-multiple"]! == "true" || entryForm["@owner-form"]?has_content || entryForm["@skip-start"]! == "true" || entryForm["@skip-end"]! == "true">
        <@standardProductForm/><#return>
    </#if>
    <#assign formInstance = sri.getFormInstance(.node["@name"])>
    <#assign formNode = entryForm><#assign formSingleNode = entryForm>
    <#t>${sri.pushSingleFormMapContext(entryForm["@map"]!"fieldValues")}
    <#assign formId>${ec.resource.expandNoL10n(entryForm["@name"],"")}<#if sectionEntryIndex?has_content>_${sectionEntryIndex}</#if></#assign><#assign formSingleId = formId>
    <#assign ownerForm = ""><#assign fieldsJsName = ""><#assign fsFieldRow = false><#assign fsBigRow = false>
    <#assign urlInstance = sri.makeUrlByType(addAction,"transition",null,"true")>
    <#assign formDisabled = urlInstance.disableLink>
    <#local quasar = entryQuasar>
    <#local options = sri.getFieldOptions(picker)>
    <#local ids = options.keySet()?filter(id -> id?has_content)>
    <#local products = ec.resource.expression("[:]", "")>
    <#if ids?has_content>
        <#list ec.entity.find("mantle.product.Product").condition("productId","in",ids).list() as product>
            <#local ignored = products.put(product.productId,product)!>
        </#list>
    </#if>
    <#local currency = (order.currencyUomId)!(invoice.currencyUomId)!"INR">
    <#local entryFieldNames = entryForm["field"]?map(f -> f["@name"])>
    <#local salesPrice = urlInstance.path?contains("/sales/") && (entryForm["@name"] == "AddItemForm") && (entryForm["field"]?filter(f -> ["orderId","invoiceId"]?seq_contains(f["@name"]))?size > 0)>
    <#if quasar>
        <#assign fieldsJsName = "formProps.fields">
        <m-form id="${formId}" name="${formId}" action="${urlInstance.path}" v-slot:default="formProps" :fields-initial="${Static['org.moqui.util.WebUtilities'].fieldValuesEncodeHtmlJsSafe(sri.getFormFieldValues(entryForm))}">
    <#else>
        <form id="${formId}" name="${formId}" method="post" action="${urlInstance.url?html}">
        <input type="hidden" name="moquiSessionToken" value="${ec.web.sessionToken?html}">
        <input type="hidden" name="moquiFormName" value="${entryForm['@name']?html}">
    </#if>
    <fieldset class="zpe-form" data-sales-price="${salesPrice?c}" data-price-url="${urlInstance.path?keep_before_last('/')?html}/productPrice" data-currency="${currency?html}" data-order-id="${(entryFieldNames?seq_contains("orderId"))?then(orderId!"", "")?html}" data-invoice-id="${(entryFieldNames?seq_contains("invoiceId"))?then(invoiceId!"", "")?html}"<#if formDisabled> disabled</#if><#if quasar> @zpe-values="Object.assign(formProps.fields,$event.detail)"</#if>>
        <#list entryForm["field"] as field><#if field["default-field"]?has_content && field["default-field"][0]["hidden"]?has_content><@formSingleSubField field formId/></#if></#list>
        <section class="zpe-catalog" aria-label="Products">
            <label for="${formId}_productId">Find a product</label>
            <select id="${formId}_productId" name="productId" class="zpe-source"<#if quasar> v-model="formProps.fields.productId"</#if><#if picker['@allow-empty']! != 'true'> required</#if>>
                <option value="">Choose a product</option>
                <#list options.keySet() as id><#if id?has_content>
                    <#local product = products[id]!{}>
                    <option value="${id?html}" data-name="${(product.productName!options[id])?html}" data-code="${(product.pseudoId!'')?html}" data-tax-code="${(product.hsnCode!(product.sacCode!''))?html}"<#if product.mrpAmount??> data-mrp="${product.mrpAmount?c}"</#if><#if !quasar && sri.getFieldValuePlainString(productField,'') == id> selected</#if>>${options[id]?html}</option>
                </#if></#list>
            </select>
            <div class="zpe-picker" v-pre></div>
        </section>
        <section class="zpe-entry">
            <h3 data-selected-name v-pre>Select a product</h3>
            <p class="zpe-price-status" role="status" v-pre></p>
            <div class="zpe-fields">
            <#local extras = []><#local submits = []>
            <#list entryForm["field"] as field>
                <#local sub = field['default-field'][0]!{}><#local fieldName = field['@name']>
                <#if fieldName == 'productId' || sub['hidden']?has_content || sub['ignored']?has_content><#continue></#if>
                <#if sub['submit']?has_content><#local submits = submits + [field]>
                <#elseif ['description','itemDescription','hsnSacCode','productTaxCode','discountPercent','taxPercentage','mrpAmount','notes','wastePercent']?seq_contains(fieldName) && !formInstance.getFieldValidationClasses(sub)?contains('required')>
                    <#local extras = extras + [field]>
                <#else><@formSingleSubField field formId/></#if>
            </#list>
            <#if extras?has_content><details class="zpe-options"><summary>More options</summary><#list extras as field><@formSingleSubField field formId/></#list></details></#if>
            <#list submits as field><@formSingleSubField field formId/></#list>
            </div>
            <#if picker['@allow-empty']! == 'true'><button type="button" class="zpe-custom" data-custom-item v-pre>Custom item</button></#if>
        </section>
    </fieldset>
    <#if quasar></m-form><#else></form></#if>
    <#t>${sri.popContext()}
    <#assign ownerForm = ""><#assign fieldsJsName = ""><#assign formSingleId = ""><#assign formDisabled = false>
</#macro>
