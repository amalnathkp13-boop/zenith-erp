<#assign dateFormat = dateFormat!"dd/MM/yyyy">
<#macro encodeText textValue>${(Static["org.moqui.util.StringUtilities"].encodeForXmlAttribute(textValue!"", false))!""}</#macro>
<#macro formatINR amount>${Static["com.zenith.Fmt"].regroup(ec.l10n.format(amount!0, "#,##0.00"))}</#macro>

<#assign amountWords = (amountInWords)!"">

<#assign colorBg = "#f1ebf8">
<#assign accent = "#592d9e">
<#assign lineColor = "#d9d0e6">
<#macro invoiceDetail label>
    <fo:table-cell padding="6pt">
        <fo:block font-size="7pt" color="#635a74">${label}</fo:block>
        <fo:block font-size="9pt" space-before="2pt"><#nested></fo:block>
    </fo:table-cell>
</#macro>

<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-family="Helvetica, sans-serif" font-size="8pt" color="#231b34">
    <fo:layout-master-set>
        <fo:simple-page-master master-name="A4" page-width="210mm" page-height="297mm"
                               margin-top="10mm" margin-bottom="10mm" margin-left="10mm" margin-right="10mm">
            <fo:region-body margin-top="0mm" margin-bottom="15mm"/>
            <fo:region-after extent="15mm"/>
        </fo:simple-page-master>
    </fo:layout-master-set>

    <fo:page-sequence master-reference="A4" id="mainSequence">
        
        <#-- FOOTER -->
        <fo:static-content flow-name="xsl-region-after">
            <fo:block border-top="0.5pt solid ${lineColor}" padding-top="4pt" text-align="center" font-size="7pt" font-weight="bold">
                <#if supplier??><@encodeText (supplier.organizationName)!(((supplier.firstName)!"") + " " + ((supplier.lastName)!""))/></#if>
                <#if invoice?? && (invoice.supplierGstin)??> • GSTIN: ${invoice.supplierGstin}</#if>
            </fo:block>
            <fo:block text-align="center" font-size="7pt" margin-top="4pt">
                <fo:page-number/> / <fo:page-number-citation-last ref-id="mainSequence"/>
            </fo:block>
        </fo:static-content>

        <fo:flow flow-name="xsl-region-body">
            <#if invoice??>
            
            <fo:table table-layout="fixed" width="190mm" border-bottom="1pt solid ${accent}" space-after="9pt">
                <fo:table-column column-width="150mm"/>
                <fo:table-column column-width="40mm"/>
                <fo:table-body>
                    <fo:table-row keep-together.within-page="always">
                        <fo:table-cell padding-bottom="10pt">
                            <fo:block font-size="22pt" font-weight="bold" color="${accent}">
                                <#if invoice.documentType??><@encodeText invoice.documentType?upper_case/><#else>TAX INVOICE</#if>
                            </fo:block>
                            <fo:block font-size="8pt" color="#635a74" space-after="6pt">Original for Recipient</fo:block>
                            <fo:block font-size="11pt" font-weight="bold" color="${accent}" space-after="4pt">
                                <@encodeText (supplier.organizationName)!(((supplier.firstName)!"") + " " + ((supplier.lastName)!""))/>
                            </fo:block>
                            <#if supplierContactInfo?? && supplierContactInfo.postalAddress?has_content>
                                <#if (supplierContactInfo.postalAddress.address1)?has_content><fo:block font-size="7pt" margin-bottom="1pt"><@encodeText supplierContactInfo.postalAddress.address1/></fo:block></#if>
                                <#if (supplierContactInfo.postalAddress.address2)?has_content><fo:block font-size="7pt" margin-bottom="1pt"><@encodeText supplierContactInfo.postalAddress.address2/></fo:block></#if>
                                <fo:block font-size="7pt" margin-bottom="1pt"><@encodeText (supplierContactInfo.postalAddress.city)!""/><#if (supplierContactInfo.postalAddressStateGeo.geoName)?has_content>, ${supplierContactInfo.postalAddressStateGeo.geoName}</#if><#if (supplierContactInfo.postalAddress.postalCode)?has_content> - ${supplierContactInfo.postalAddress.postalCode}</#if></fo:block>
                            </#if>
                            <#if supplierContactInfo?? && (supplierContactInfo.telecomNumber.contactNumber)?has_content><fo:block font-size="7pt" margin-bottom="1pt">Phone: ${supplierContactInfo.telecomNumber.contactNumber}</fo:block></#if>
                            <#if supplierContactInfo?? && (supplierContactInfo.emailAddress)?has_content><fo:block font-size="7pt" margin-bottom="1pt">Email: ${supplierContactInfo.emailAddress}</fo:block></#if>
                            <#if (supplier.panNumber)?has_content><fo:block font-size="7pt" margin-top="2pt">PAN: <fo:inline font-weight="bold">${supplier.panNumber}</fo:inline></fo:block></#if>
                            <fo:block font-size="7pt" margin-top="2pt">GSTIN: <fo:inline font-weight="bold">${(invoice.supplierGstin)!"Unregistered"}</fo:inline></fo:block>
                            <#if invoice.einvoiceId?has_content>
                                <fo:block font-size="7pt" space-before="3pt">IRN No: <@encodeText invoice.einvoiceId/></fo:block>
                            </#if>
                        </fo:table-cell>
                        <fo:table-cell padding-bottom="10pt" text-align="right">
                            <#-- The invoice-number QR is intentionally distinct from a government-signed e-invoice QR. -->
                            <#assign bcMsg = (invoice.gstInvoiceNumber)!((invoice.customInvoiceNumber)!'')>
                            <#if bcMsg?has_content && invoiceQrMatrix??>
                                <fo:block text-align="right">
                                    <fo:instream-foreign-object>
                                        <svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="20mm" height="20mm"
                                                 viewBox="0 0 ${invoiceQrMatrix.width} ${invoiceQrMatrix.height}">
                                            <svg:rect width="100%" height="100%" fill="#fff"/>
                                            <#list 0..(invoiceQrMatrix.height - 1) as y>
                                                <#list 0..(invoiceQrMatrix.width - 1) as x>
                                                    <#if invoiceQrMatrix.get(x, y)>
                                                        <svg:rect x="${x}" y="${y}" width="1" height="1" fill="#000"/>
                                                    </#if>
                                                </#list>
                                            </#list>
                                        </svg:svg>
                                    </fo:instream-foreign-object>
                                </fo:block>
                                <fo:block font-size="6pt" color="#666" text-align="right" space-before="3pt">Scan: <@encodeText bcMsg/></fo:block>
                            <#else>
                                <fo:block/>
                            </#if>
                        </fo:table-cell>
                    </fo:table-row>
                </fo:table-body>
            </fo:table>

            <fo:table table-layout="fixed" width="190mm" background-color="${colorBg}" space-after="10pt">
                <fo:table-column column-width="60mm"/>
                <fo:table-column column-width="40mm"/>
                <fo:table-column column-width="44mm"/>
                <fo:table-column column-width="46mm"/>
                <fo:table-body>
                    <fo:table-row keep-together.within-page="always" font-weight="bold">
                        <@invoiceDetail "Invoice number"><@encodeText (invoice.gstInvoiceNumber)!invoice.invoiceId/></@invoiceDetail>
                        <@invoiceDetail "Invoice date"><#if invoice.invoiceDate??>${ec.l10n.format(invoice.invoiceDate, dateFormat)}<#else>N/A</#if></@invoiceDetail>
                        <@invoiceDetail "Reference"><@encodeText invoice.invoiceId/></@invoiceDetail>
                        <@invoiceDetail "Status"><@encodeText statusLabel!"-"/></@invoiceDetail>
                    </fo:table-row>
                </fo:table-body>
            </fo:table>

            <fo:table table-layout="fixed" width="190mm" border-collapse="separate" space-after="6pt">
                <fo:table-column column-width="93mm"/>
                <fo:table-column column-width="4mm"/>
                <fo:table-column column-width="93mm"/>
                <fo:table-body>
                    <fo:table-row keep-together.within-page="always">
                        <#-- CUSTOMER (BILLED TO) -->
                        <fo:table-cell border="0.5pt solid ${lineColor}" padding="8pt">
                            <fo:block color="${accent}" font-weight="bold" space-after="4pt">
                                Bill to
                            </fo:block>
                            <fo:block font-weight="bold" font-size="10pt" margin-bottom="4pt">
                                <#if (customer.organizationName)?has_content><@encodeText customer.organizationName/>
                                <#elseif (customer.firstName)?has_content><@encodeText customer.firstName/> <@encodeText customer.lastName!"" />
                                <#else>[Not Provided]</#if>
                            </fo:block>
                            <fo:block font-size="7pt" margin-bottom="1pt">Place of Supply: ${placeOfSupplyDisplay!((invoice.placeOfSupplyStateCode)!"-")}</fo:block>
                            <#if (placeOfSupplyIsFallback)!false><fo:block font-size="6pt" color="#7a5c00" margin-bottom="1pt">Buyer unregistered — place of supply defaults to supplier's state (intra-state GST).</fo:block></#if>
                            <fo:block font-size="7pt" margin-top="4pt">GSTIN: ${(invoice.buyerGstin)!"Unregistered"}</fo:block>
                        </fo:table-cell>
                        
                        <fo:table-cell><fo:block/></fo:table-cell>

                        <#-- SHIPPING ADDRESS -->
                        <fo:table-cell border="0.5pt solid ${lineColor}" padding="8pt">
                            <fo:block color="${accent}" font-weight="bold" space-after="4pt">
                                Ship to
                            </fo:block>
                            <fo:block font-weight="bold" font-size="10pt" margin-bottom="4pt">
                                <#if (customer.organizationName)?has_content><@encodeText customer.organizationName/>
                                <#elseif (customer.firstName)?has_content><@encodeText customer.firstName/> <@encodeText customer.lastName!"" />
                                <#else>[Not Provided]</#if>
                            </fo:block>
                            <fo:block font-size="7pt" margin-bottom="1pt">Place of Supply: ${placeOfSupplyDisplay!((invoice.placeOfSupplyStateCode)!"-")}</fo:block>
                        </fo:table-cell>
                    </fo:table-row>
                </fo:table-body>
            </fo:table>

            <fo:table table-layout="fixed" width="190mm" space-after="10pt" color="#635a74">
                <fo:table-column column-width="47.5mm" number-columns-repeated="4"/>
                <fo:table-body>
                    <fo:table-row keep-together.within-page="always">
                        <@invoiceDetail "E-Way Bill"><@encodeText invoice.ewayBillId!"-"/></@invoiceDetail>
                        <@invoiceDetail "Vehicle no."><@encodeText invoice.vehicleNumber!"-"/></@invoiceDetail>
                        <@invoiceDetail "LR / Docket"><@encodeText invoice.lrNumber!"-"/></@invoiceDetail>
                        <@invoiceDetail "Reverse charge">${(((invoice.isReverseCharge)!'N') == 'Y')?string('Yes', 'No')}</@invoiceDetail>
                    </fo:table-row>
                </fo:table-body>
            </fo:table>

            <#-- ITEMS TABLE -->
            <fo:block font-size="10pt" font-weight="bold" space-after="4pt" keep-with-next.within-page="always">Line items</fo:block>
            <fo:table table-layout="fixed" width="190mm" space-after="6pt">
                <fo:table-column column-width="8mm"/>  <#-- SN -->
                <fo:table-column column-width="40mm"/> <#-- Desc -->
                <fo:table-column column-width="15mm"/> <#-- HSN -->
                <fo:table-column column-width="18mm"/> <#-- Rate -->
                <fo:table-column column-width="10mm"/> <#-- Qty -->
                <fo:table-column column-width="20mm"/> <#-- Taxable -->
                <fo:table-column column-width="20mm"/> <#-- CGST -->
                <fo:table-column column-width="20mm"/> <#-- SGST -->
                <fo:table-column column-width="20mm"/> <#-- IGST -->
                <fo:table-column column-width="19mm"/> <#-- Total -->
                
                <fo:table-header background-color="${colorBg}" font-weight="bold">
                    <fo:table-row>
                        <fo:table-cell padding="4pt"><fo:block text-align="center">#</fo:block></fo:table-cell>
                        <fo:table-cell padding="4pt"><fo:block>Description</fo:block></fo:table-cell>
                        <fo:table-cell padding="4pt"><fo:block text-align="center">HSN</fo:block></fo:table-cell>
                        <fo:table-cell padding="4pt"><fo:block text-align="right">Rate</fo:block></fo:table-cell>
                        <fo:table-cell padding="4pt"><fo:block text-align="right">Qty</fo:block></fo:table-cell>
                        <fo:table-cell padding="4pt"><fo:block text-align="right">Taxable</fo:block></fo:table-cell>
                        <fo:table-cell padding="4pt"><fo:block text-align="right">CGST</fo:block></fo:table-cell>
                        <fo:table-cell padding="4pt"><fo:block text-align="right">SGST</fo:block></fo:table-cell>
                        <fo:table-cell padding="4pt"><fo:block text-align="right">IGST</fo:block></fo:table-cell>
                        <fo:table-cell padding="4pt"><fo:block text-align="right">Total</fo:block></fo:table-cell>
                    </fo:table-row>
                </fo:table-header>
                
                <fo:table-body>
                    <#if invoiceItems?has_content>
                        <#list invoiceItems as item>
                            <#assign taxable = (item.taxableAmount)!(((item.quantity)!1) * ((item.amount)!0))>
                            <#assign totalItem = taxable + (item.cgstAmount!0) + (item.sgstAmount!0) + (item.igstAmount!0)>
                            <fo:table-row keep-together.within-page="always" font-size="7.5pt" border-bottom="0.5pt solid ${lineColor}">
                                <fo:table-cell padding="4pt"><fo:block text-align="center">${item_index+1}</fo:block></fo:table-cell>
                                <fo:table-cell padding="4pt"><fo:block><@encodeText (item.description)!""/></fo:block><#if (item.discountPercent!0)?number != 0><fo:block font-size="6pt" color="#c0392b">Less ${item.discountPercent}% discount (Rs. <@formatINR item.discountAmount!0/>)</fo:block></#if></fo:table-cell>
                                <fo:table-cell padding="4pt"><fo:block text-align="center">${item.hsnSacCode!"-"}</fo:block></fo:table-cell>
                                <fo:table-cell padding="4pt"><fo:block text-align="right">Rs. <@formatINR item.amount!0/></fo:block></fo:table-cell>
                                <fo:table-cell padding="4pt"><fo:block text-align="right">${item.quantity!"1.00"}</fo:block></fo:table-cell>
                                <fo:table-cell padding="4pt"><fo:block text-align="right">Rs. <@formatINR taxable/></fo:block></fo:table-cell>
                                
                                <fo:table-cell padding="4pt"><fo:block text-align="right">
                                    <#if item.cgstAmount??>Rs. <@formatINR item.cgstAmount/><fo:block font-size="6pt">(${item.cgstRate!0}%)</fo:block><#else>-</#if>
                                </fo:block></fo:table-cell>
                                
                                <fo:table-cell padding="4pt"><fo:block text-align="right">
                                    <#if item.sgstAmount??>Rs. <@formatINR item.sgstAmount/><fo:block font-size="6pt">(${item.sgstRate!0}%)</fo:block><#else>-</#if>
                                </fo:block></fo:table-cell>
                                
                                <fo:table-cell padding="4pt"><fo:block text-align="right">
                                    <#if item.igstAmount??>Rs. <@formatINR item.igstAmount/><fo:block font-size="6pt">(${item.igstRate!0}%)</fo:block><#else>-</#if>
                                </fo:block></fo:table-cell>
                                <fo:table-cell padding="4pt"><fo:block text-align="right" font-weight="bold">Rs. <@formatINR totalItem/></fo:block></fo:table-cell>
                            </fo:table-row>
                        </#list>
                    <#else>
                        <fo:table-row>
                            <fo:table-cell padding="10pt" number-columns-spanned="10" text-align="center">
                                <fo:block font-style="italic">No items added.</fo:block>
                            </fo:table-cell>
                        </fo:table-row>
                    </#if>
                </fo:table-body>
            </fo:table>

            <#-- BOTTOM SECTION: Words, Terms on Left | Subtotals on Right -->
            <fo:table table-layout="fixed" width="190mm">
                <fo:table-column column-width="105mm"/>
                <fo:table-column column-width="10mm"/> <#-- Spacer -->
                <fo:table-column column-width="75mm"/>
                <fo:table-body>
                    <fo:table-row keep-together.within-page="always">
                        <#-- LEFT SIDE: Amount in words and payment details -->
                        <fo:table-cell>
                            <fo:block font-weight="bold" color="${accent}" space-after="3pt">Amount in Words</fo:block>
                            <fo:block font-weight="bold" space-after="5pt"><@encodeText amountWords/></fo:block>
                            <fo:block font-weight="bold" font-size="8pt" margin-bottom="2pt">Payment terms: <fo:inline font-weight="normal">Immediate Payment</fo:inline></fo:block>
                            <fo:block font-weight="bold" font-size="8pt" margin-bottom="8pt">Whether tax is payable under reverse charge: <fo:inline font-weight="normal">${(((invoice.isReverseCharge)!'N') == 'Y')?string('Yes', 'No')}</fo:inline></fo:block>
                            
                        </fo:table-cell>

                        <fo:table-cell><fo:block/></fo:table-cell>

                        <#-- RIGHT SIDE: Subtotal / Taxes / Total -->
                        <fo:table-cell>
                            <fo:table table-layout="fixed" width="100%" background-color="${colorBg}">
                                <fo:table-column column-width="34mm"/>
                                <fo:table-column column-width="41mm"/>
                                <fo:table-body>
                                    <fo:table-row>
                                        <fo:table-cell padding="4pt"><fo:block font-weight="bold">Subtotal</fo:block></fo:table-cell>
                                        <fo:table-cell padding="4pt" text-align="right"><fo:block>Rs. <@formatINR invoice.totalTaxableAmount!0/></fo:block></fo:table-cell>
                                    </fo:table-row>
                                    <#assign totalTaxes = (invoice.totalCgst!0) + (invoice.totalSgst!0) + (invoice.totalIgst!0)>
                                    <fo:table-row>
                                        <fo:table-cell padding="4pt"><fo:block font-weight="bold">Taxes</fo:block></fo:table-cell>
                                        <fo:table-cell padding="4pt" text-align="right"><fo:block>Rs. <@formatINR totalTaxes/></fo:block></fo:table-cell>
                                    </fo:table-row>
                                    <#if (invoice.roundOffAmount!0)?number != 0>
                                    <fo:table-row>
                                        <fo:table-cell padding="4pt"><fo:block font-weight="bold">Round-off</fo:block></fo:table-cell>
                                        <fo:table-cell padding="4pt" text-align="right"><fo:block>Rs. <@formatINR invoice.roundOffAmount/></fo:block></fo:table-cell>
                                    </fo:table-row>
                                    </#if>
                                    <fo:table-row border-top="0.5pt solid ${lineColor}" font-size="10pt" color="${accent}">
                                        <fo:table-cell padding="6pt"><fo:block font-weight="bold">Total</fo:block></fo:table-cell>
                                        <fo:table-cell padding="6pt" text-align="right"><fo:block font-weight="bold">Rs. <@formatINR invoice.invoiceTotal!0/></fo:block></fo:table-cell>
                                    </fo:table-row>
                                </fo:table-body>
                            </fo:table>
                        </fo:table-cell>
                        
                    </fo:table-row>
                </fo:table-body>
            </fo:table>

            <fo:block margin-top="12pt" border-top="0.5pt solid ${lineColor}" padding-top="8pt" keep-together.within-page="always">
                <fo:block font-weight="bold" font-size="8pt" margin-bottom="2pt">Terms &amp; Conditions</fo:block>
                <fo:block font-size="7pt" margin-bottom="1pt">01) Notify us within 2 days of delivery in case of issues.</fo:block>
                <fo:block font-size="7pt" margin-bottom="1pt">02) Warranty claims result in product replacement only.</fo:block>
                <fo:block font-size="7pt" margin-bottom="1pt">03) GST Compliance: Ensure active GST number for input tax credit.</fo:block>

                <fo:block font-weight="bold" font-size="8pt" text-align="center" margin-top="15pt">This is a computer generated Invoice.</fo:block>
                <fo:block font-weight="bold" font-size="8pt" text-align="center" margin-top="4pt">Subject to Jurisdiction</fo:block>
            </fo:block>

            <#else>
            <fo:block font-size="14pt" font-weight="bold" text-align="center" margin-top="60mm" color="#b00020">This document is not available or you do not have permission to view it.</fo:block>
            </#if>
        </fo:flow>
    </fo:page-sequence>
</fo:root>
