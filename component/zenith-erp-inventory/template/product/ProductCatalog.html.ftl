<#assign state = catalogData.params!{}>
<#assign catalogUrl = sri.buildUrl('.').url>
<#assign viewUrl = sri.buildUrl('../EditProduct').url>
<#assign activeFilterCount = 0>
<#list ['catalogCategoryId', 'catalogTaxCode', 'gstRates'] as field>
    <#if (state[field]!'')?has_content><#assign activeFilterCount += 1></#if>
</#list>
<#if (state.mrpMin!'')?has_content || (state.mrpMax!'')?has_content><#assign activeFilterCount += 1></#if>
<#assign activeRates = (state.gstRates!'')?split(',')>
<#assign currentSort = (state.orderByField!'')?split(',')[0]>
<#assign lastPage = [0, (catalogData.total / catalogData.pageSize)?ceiling - 1]?max>
<#assign pageSizes = [10, 20, 50, 100, 200]>
<#if !pageSizes?seq_contains(catalogData.pageSize)><#assign pageSizes = (pageSizes + [catalogData.pageSize])?sort></#if>
<#assign catalogQueryFields = ['catalogSearch','catalogMode','catalogProductId','catalogCategoryId','mrpMin','mrpMax',
    'catalogTaxCode','gstRates','orderByField','pageSize','pageIndex','renderMode','lastStandalone','productId']>
<#function catalogHref base params>
    <#local href = base>
    <#list catalogQueryFields as key>
        <#if (params[key]!'')?has_content>
            <#local href += (href?contains('?'))?then('&','?') + key + '=' + (params[key]?is_number)?then(params[key]?c, params[key]?string?url('UTF-8'))>
        </#if>
    </#list>
    <#return href>
</#function>
<#macro pageLink index label text>
    <#if index gte 0 && index lte lastPage>
        <a class="catalog-page<#if index == catalogData.pageIndex> is-current</#if>" href="${catalogHref(catalogUrl, state + {'pageIndex': index?c})?html}"
           data-catalog-page="${index?c}" aria-label="${label?html}"<#if index == catalogData.pageIndex> aria-current="page"</#if>>${text}</a>
    <#else>
        <button class="catalog-page" type="button" aria-label="${label?html}" disabled>${text}</button>
    </#if>
</#macro>

<div class="catalog-content" data-product-catalog v-pre
     data-catalog-url="${catalogUrl?html}" data-query-url="${sri.buildUrl('catalogQuery').url?html}"
     data-view-url="${viewUrl?html}" data-currency="${(catalogCurrencySymbol!'₹')?html}">
    <form id="CatalogSearchForm" class="catalog-toolbar" action="${catalogUrl?html}" method="get">
        <input type="hidden" name="catalogMode" value="${(state.catalogMode!'live')?html}"/>
        <input type="hidden" name="catalogProductId" value="${(state.catalogProductId!'')?html}"/>
        <input type="hidden" name="orderByField" value="${(state.orderByField!'')?html}"/>
        <div class="catalog-search">
            <button type="submit" class="catalog-search-submit" formnovalidate aria-label="Search products">
                <span class="material-icons" aria-hidden="true">search</span>
            </button>
            <input id="catalogSearch" name="catalogSearch" value="${(state.catalogSearch!'')?html}" type="search"
                   placeholder="Search item code, product name or barcode…" autocomplete="off" maxlength="2048"
                   aria-label="Search products by item code, product name or barcode"
                   role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="catalog-suggestions"/>
            <ul id="catalog-suggestions" class="catalog-suggestions" role="listbox" aria-label="Product suggestions" hidden></ul>
        </div>
        <details id="catalogFilters" class="catalog-filters">
            <summary class="catalog-button">
                <span class="material-icons" aria-hidden="true">filter_list</span> Filter
                <span class="catalog-filter-count" data-filter-count<#if activeFilterCount == 0> hidden</#if>>${activeFilterCount}</span>
            </summary>
            <div class="catalog-filter-panel" role="group" aria-labelledby="catalogFilterTitle">
                <header>
                    <h2 id="catalogFilterTitle">Filter products</h2>
                    <button type="button" class="catalog-icon-button" data-close-filters aria-label="Close filters" hidden>
                        <span class="material-icons" aria-hidden="true">close</span>
                    </button>
                </header>
                <label for="catalogCategory">Catalog</label>
                <select id="catalogCategory" name="catalogCategoryId">
                    <option value="">Any catalog</option>
                    <#list catalogData.filters.categories![] as category>
                        <option value="${category.value?html}"<#if category.value == (state.catalogCategoryId!'')> selected</#if>>${category.label?html}</option>
                    </#list>
                </select>
                <fieldset class="catalog-mrp-filter">
                    <legend>MRP (${(catalogCurrencySymbol!'₹')?html})</legend>
                    <div>
                        <label for="catalogMrpMin">Minimum</label>
                        <input id="catalogMrpMin" type="number" min="0" step="0.01" name="mrpMin" placeholder="Any" value="${(state.mrpMin!'')?html}"/>
                    </div>
                    <div>
                        <label for="catalogMrpMax">Maximum</label>
                        <input id="catalogMrpMax" type="number" min="0" step="0.01" name="mrpMax" placeholder="Any" value="${(state.mrpMax!'')?html}"/>
                    </div>
                </fieldset>
                <label for="catalogTaxCode">Tax code</label>
                <input id="catalogTaxCode" name="catalogTaxCode" value="${(state.catalogTaxCode!'')?html}"
                       placeholder="Any tax code" autocomplete="off" maxlength="20" list="catalogTaxCodes"/>
                <datalist id="catalogTaxCodes">
                    <#list catalogData.filters.taxCodes![] as code><option value="${code?html}"></option></#list>
                </datalist>
                <fieldset class="catalog-gst-filter">
                    <legend>GST percentage</legend>
                    <div class="catalog-rate-options">
                        <#list catalogData.filters.gstRates![] as rate>
                            <#assign rateValue = rate?c>
                            <label><input type="checkbox" name="gstRates" value="${rateValue}"<#if activeRates?seq_contains(rateValue)> checked</#if>/> ${rateValue}%</label>
                        <#else>
                            <span>There are no GST rates in this catalog.</span>
                        </#list>
                    </div>
                </fieldset>
                <p class="catalog-filter-error" data-filter-error role="alert" hidden></p>
                <footer>
                    <a class="catalog-button" data-clear-filters href="${catalogHref(catalogUrl, state + {'catalogCategoryId':'','catalogTaxCode':'','gstRates':'','mrpMin':'','mrpMax':'','pageIndex':'0'})?html}">Clear filters</a>
                    <button class="catalog-button catalog-primary" type="submit" data-apply-filters>Apply Filters</button>
                </footer>
            </div>
        </details>
        <a class="catalog-button catalog-export" download="product-catalog.csv" href="${catalogHref(catalogUrl, state + {'renderMode':'csv','lastStandalone':'true'})?html}">
            <span class="material-icons" aria-hidden="true">file_download</span> Export CSV
        </a>
    </form>

    <div class="catalog-feedback" data-catalog-feedback<#if !(catalogData.error!'')?has_content && !catalogData.barcodeMiss> hidden</#if>>
        <span id="catalogStatus" role="status" aria-live="polite"><#if (catalogData.error!'')?has_content>${catalogData.error?html}<#elseif catalogData.barcodeMiss>No product found for this barcode.</#if></span>
        <button class="catalog-button" type="button" data-catalog-retry hidden>Retry</button>
    </div>
    <div class="catalog-table-scroll" role="region" aria-label="Product catalog table" tabindex="0">
        <table id="FindProductList_table">
            <thead>
                <tr>
                    <#list [['pseudoId','Catalog Item Code'], ['productName','Product Name'], ['gstRate','GST'],
                            ['uqcEnumId','Unit'], ['mrpAmount','MRP (' + (catalogCurrencySymbol!'₹') + ')'],
                            ['catalogTaxCode','Tax Code']] as column>
                        <#assign field = column[0]>
                        <#assign direction = (currentSort == field)?then('-' + field, field)>
                        <th scope="col" data-catalog-column="${field}" aria-sort="${(currentSort == field)?then('ascending',(currentSort == ('-' + field))?then('descending','none'))}">
                            <a href="${catalogHref(catalogUrl, state + {'orderByField': direction,'pageIndex':'0'})?html}" data-catalog-sort="${field}">
                                ${column[1]?html}<span class="material-icons" aria-hidden="true">${(currentSort == field)?then('arrow_upward',(currentSort == ('-' + field))?then('arrow_downward','unfold_more'))}</span>
                            </a>
                        </th>
                    </#list>
                    <th scope="col" aria-label="Product actions"></th>
                </tr>
            </thead>
            <tbody>
                <#list catalogData.rows as row>
                    <tr>
                        <td class="catalog-item-code">${((row.pseudoId!'')?has_content)?then(row.pseudoId?html,row.productId?html)}</td>
                        <td class="catalog-item-name"><span title="${(row.productName!'')?html}">${(row.productName!'—')?html}</span></td>
                        <td><#if row.gstRate??>${row.gstRate?c}%<#else>—</#if></td>
                        <td>${((row.uqcEnumId!'')?has_content)?then(row.uqcEnumId?html,'—')}</td>
                        <td class="catalog-amount"><#if row.mrpAmount??><#assign amount = ec.l10n.format(row.mrpAmount,'#,##0.00')><#if zinr?? && (catalogCurrencySymbol!'₹') == '₹'>${zinr.inr(amount)}<#else>${amount}</#if><#else>—</#if></td>
                        <td>${((row.catalogTaxCode!'')?has_content)?then(row.catalogTaxCode?html,'—')}</td>
                        <td class="catalog-view-cell">
                            <a class="catalog-view" href="${catalogHref(viewUrl, {'productId':row.productId})?html}" aria-label="View ${(row.productName!row.productId)?html}">
                                <span class="material-icons" aria-hidden="true">visibility</span> View
                            </a>
                        </td>
                    </tr>
                <#else>
                    <tr><td class="catalog-empty" colspan="7">No matching products.</td></tr>
                </#list>
            </tbody>
        </table>
    </div>
    <footer class="catalog-footer">
        <span data-catalog-count><#if catalogData.total gt 0>Showing ${catalogData.pageIndex * catalogData.pageSize + 1}–${[catalogData.total, (catalogData.pageIndex + 1) * catalogData.pageSize]?min} of ${catalogData.total}<#else>0 products</#if></span>
        <label class="catalog-page-size">Rows per page
            <select name="pageSize" form="CatalogSearchForm">
                <#list pageSizes as size>
                    <option value="${size?c}"<#if size == catalogData.pageSize> selected</#if>>${size?c}</option>
                </#list>
            </select>
        </label>
        <nav class="catalog-pagination" aria-label="Product catalog pages">
            <@pageLink index=(catalogData.pageIndex - 1) label='Previous page' text='«'/>
            <#assign startPage = [0,[catalogData.pageIndex - 2, lastPage - 4]?min]?max>
            <#list startPage..([lastPage, startPage + 4]?min) as page>
                <@pageLink index=page label=('Page ' + (page + 1)?c) text=(page + 1)?c/>
            </#list>
            <@pageLink index=(catalogData.pageIndex + 1) label='Next page' text='»'/>
        </nav>
    </footer>
</div>
