<form id="CreateProductForm" class="pe-create" method="post" action="${sri.buildUrl('createProduct').url?html}" data-pe-save="create">
    <input type="hidden" name="moquiSessionToken" value="${(ec.web.sessionToken!'')?html}"/>
    <section aria-labelledby="pe-create-basic">
        <h3 id="pe-create-basic">Basic Info</h3>
        <div class="pe-create-fields">
            <label>Product Name <b>*</b><input id="CreateProductForm_productName" name="productName" maxlength="255" required/></label>
            <label>Unit <b>*</b><select id="CreateProductForm_uqcEnumId" name="uqcEnumId" required>
                <option value="">Choose a unit</option><option value="NOS">Numbers (Nos)</option>
                <option value="KGS">Kilograms (Kg)</option><option value="MTR">Metres (M)</option>
                <option value="PCS">Pieces (Pcs)</option><option value="LTR">Litres (L)</option>
            </select></label>
            <div>
                <label for="CreateProductForm_pseudoId">Item Code</label>
                <input id="CreateProductForm_pseudoId" name="pseudoId" maxlength="100" autocomplete="off" aria-describedby="pe-create-code-help"/>
                <small id="pe-create-code-help">Leave blank to generate a code on save.</small>
            </div>
            <label>Barcode<input value="Generated on save" readonly/></label>
            <label>Print Name<input id="CreateProductForm_printName" name="printName" maxlength="255"/>
                <small>Defaults to Product Name. Used on printed bills.</small></label>
            <label>Tax Rate<select id="CreateProductForm_gstSlabId" name="gstSlabId">
                <option value="">Not set</option><#list gstSlabs as slab><option value="${slab.gstSlabId?html}">${slab.slabName?html} (${slab.gstRate?c}%)</option></#list>
            </select></label>
            <label>MRP (${catalogCurrencySymbol?html})<input id="CreateProductForm_mrpAmount" name="mrpAmount" type="number" min="0" step="0.01" inputmode="decimal"/>
                <small>Default price for all sales modes. Leave blank to set prices by mode later.</small></label>
            <label>Opening Stock<input id="CreateProductForm_openingStock" name="openingStock" type="number" min="0" step="any" inputmode="decimal"/></label>
            <label>Stock Alert<input id="CreateProductForm_reorderPoint" name="reorderPoint" type="number" min="0" step="any" inputmode="decimal"/></label>
        </div>
    </section>
    <section aria-labelledby="pe-create-prices">
        <h3 id="pe-create-prices">Sales Mode Pricing</h3>
        <#include "ProductModePrices.html.ftl">
    </section>
    <details>
        <summary>Additional Info</summary>
        <div class="pe-create-fields">
            <label>POS Category<select id="CreateProductForm_productCategoryId" name="productCategoryId">
                <option value="">No category</option><#list productCategoryList as category><option value="${category.productCategoryId?html}">${category.categoryName?html}</option></#list>
            </select></label>
            <label>Type<select id="CreateProductForm_productTypeEnumId" name="productTypeEnumId">
                <option value="PtAsset">Physical product (stock &amp; count)</option><option value="PtService">Service</option><option value="PtDigitalAsset">Digital product</option>
            </select></label>
            <label>Tax Code (HSN / SAC)<input name="hsnSacCode" maxlength="20"/></label>
            <label>Tax-free Item?<select name="isGstExempt"><option value="N">No (Taxable)</option><option value="Y">Yes (Exempt)</option></select></label>
            <label>Enable Batch Tracking<select name="enableBatchTracking"><option value="N">No</option><option value="Y">Yes</option></select></label>
            <label>Expiry Date<input name="expiryDate" type="date"/></label>
            <label class="pe-create-wide">Description<textarea name="description" rows="2" maxlength="500"></textarea></label>
        </div>
    </details>
    <footer><p role="status" data-pe-status></p><button type="submit" id="CreateProductForm_submitButton">Create Product</button></footer>
</form>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="" hidden onload="if(!document.getElementById('productEditorCss')){var l=document.createElement('link');l.id='productEditorCss';l.rel='stylesheet';l.href='/zenithstatic/css/product-editor.css?v=2';document.head.appendChild(l)}if(!window.initProductCreation){var j=document.createElement('script');j.src='/zenithstatic/js/product-editor.js?v=${ec.resource.getLocationReference('component://zenith-erp-app/screen/zenithstatic/js/product-editor.js').getLastModified()?c}';document.head.appendChild(j)}else{window.initProductCreation()}"/>
