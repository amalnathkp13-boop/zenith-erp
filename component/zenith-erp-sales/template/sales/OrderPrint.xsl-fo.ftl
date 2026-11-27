<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-family="Helvetica, sans-serif" font-size="9pt">
<#assign salesOrderLayout = order?? && (printType!'') != 'Proforma' && (printType!'') != 'Quotation' && order.statusId != 'OrderProposed'>
<#assign lineColor = salesOrderLayout?string("#d9d0e6", "black")>
<#assign cellPadding = salesOrderLayout?string("5pt", "3pt")>
<#assign accent = "#592d9e">
<#assign tint = "#f1ebf8">
<#assign dateFormat = dateFormat!"dd-MMM-yyyy">
<#macro encodeText textValue>${(Static["org.moqui.util.StringUtilities"].encodeForXmlAttribute(textValue!"", false))!""}</#macro>
<#macro formatINR amount>Rs. ${Static["com.zenith.Fmt"].regroup(ec.l10n.format(amount!0, "#,##0.00"))}</#macro>
<#macro sellerDetails>
    <fo:block font-weight="bold" font-size="11pt" <#if salesOrderLayout>color="#352255"</#if>><@encodeText (vendorParty.organizationName)!""/><@encodeText (vendorParty.firstName)!""/> <@encodeText (vendorParty.lastName)!""/></fo:block>
    <#if vendorContactInfo?? && vendorContactInfo.postalAddress?has_content>
        <fo:block><@encodeText (vendorContactInfo.postalAddress.address1)!""/></fo:block>
        <#if vendorContactInfo.postalAddress.address2?has_content><fo:block><@encodeText vendorContactInfo.postalAddress.address2/></fo:block></#if>
        <fo:block><@encodeText (vendorContactInfo.postalAddress.city!"")/>, ${(vendorContactInfo.postalAddressStateGeo.geoCodeAlpha2)!""} ${vendorContactInfo.postalAddress.postalCode!""}</fo:block>
    </#if>
    <fo:block margin-top="3pt" font-weight="bold">Vendor ID: <fo:inline font-weight="normal">${(vendorParty.partyId)!"N/A"}</fo:inline></fo:block>
    <#if vendorContactInfo?? && vendorContactInfo.emailAddress?has_content><fo:block font-weight="bold">Email: <fo:inline font-weight="normal">${vendorContactInfo.emailAddress}</fo:inline></fo:block></#if>
</#macro>
<#macro referenceCell label>
    <fo:table-cell padding="8pt">
        <fo:block font-size="8pt" color="#635a74">${label}</fo:block>
        <fo:block space-before="3pt"><#nested></fo:block>
    </fo:table-cell>
</#macro>
    <fo:layout-master-set>
        <fo:simple-page-master master-name="A4" page-width="210mm" page-height="297mm"
                               margin-top="10mm" margin-bottom="15mm" margin-left="10mm" margin-right="10mm">
            <fo:region-body margin-top="0mm" margin-bottom="10mm"/>
            <fo:region-after extent="10mm"/>
        </fo:simple-page-master>
    </fo:layout-master-set>

    <fo:page-sequence master-reference="A4" id="mainSequence">
        <fo:static-content flow-name="xsl-region-after">
            <fo:block font-size="8pt" <#if salesOrderLayout>text-align="right" border-top="0.5pt solid ${lineColor}" padding-top="5pt" color="#635a74"<#else>text-align="center"</#if>>Page <fo:page-number/> of <fo:page-number-citation-last ref-id="mainSequence"/></fo:block>
        </fo:static-content>

        <fo:flow flow-name="xsl-region-body">
            <#if order??>
            
            <#if salesOrderLayout>
                <fo:table table-layout="fixed" width="190mm" border-bottom="1pt solid ${accent}" space-after="9pt">
                    <fo:table-column column-width="120mm"/>
                    <fo:table-column column-width="70mm"/>
                    <fo:table-body>
                        <fo:table-row keep-together.within-page="always">
                            <fo:table-cell padding-bottom="10pt">
                                <fo:block font-size="22pt" font-weight="bold" color="${accent}" space-after="6pt">SALES ORDER</fo:block>
                                <@sellerDetails/>
                            </fo:table-cell>
                            <fo:table-cell text-align="right" padding-top="3pt" padding-bottom="10pt">
                                <fo:block color="#635a74" font-weight="bold">Order number</fo:block>
                                <fo:block font-weight="bold" font-size="14pt" color="${accent}" space-before="3pt">${(order.zenithDocNumber)!orderId}</fo:block>
                                <fo:block space-before="4pt">${ec.l10n.format(order.entryDate, dateFormat)}</fo:block>
                                <#if (order.originatingQuoteNumber)?has_content>
                                    <fo:block space-before="4pt">Ref. Quote No. <@encodeText order.originatingQuoteNumber/></fo:block>
                                </#if>
                            </fo:table-cell>
                        </fo:table-row>
                    </fo:table-body>
                </fo:table>
                <fo:table table-layout="fixed" width="190mm" background-color="${tint}" space-after="10pt">
                    <fo:table-column column-width="47.5mm" number-columns-repeated="4"/>
                    <fo:table-body>
                        <fo:table-row keep-together.within-page="always" font-weight="bold">
                            <@referenceCell "Valid thru"><#if orderPart?? && orderPart.validThruDate??>${ec.l10n.format(orderPart.validThruDate, dateFormat)}<#else>N/A</#if></@referenceCell>
                            <@referenceCell "Revision">${order.orderRevision!"1"}</@referenceCell>
                            <@referenceCell "Currency"><@encodeText order.currencyUomId!"INR"/></@referenceCell>
                            <@referenceCell "Sales channel"><@encodeText order.salesChannelEnumId!"-"/></@referenceCell>
                        </fo:table-row>
                    </fo:table-body>
                </fo:table>
            <#else>
                <fo:block text-align="center" font-size="14pt" font-weight="bold" margin-bottom="5mm">
                    <#if (printType!'') == 'Proforma'>PROFORMA INVOICE
                    <#else>QUOTATION / ESTIMATE</#if>
                </fo:block>
            </#if>
            <fo:block <#if !salesOrderLayout>border="0.5pt solid black"</#if>>
                <#if !salesOrderLayout>
                <#-- TOP SECTION: VENDOR & ORDER DETAILS -->
                <fo:table table-layout="fixed" width="190mm" border-bottom="0.5pt solid black">
                    <fo:table-column column-width="95mm"/>
                    <fo:table-column column-width="95mm"/>
                    <fo:table-body>
                        <fo:table-row>
                            <#-- VENDOR INFO -->
                            <fo:table-cell padding="5pt" border-right="0.5pt solid black">
                                <@sellerDetails/>
                            </fo:table-cell>

                            <#-- ORDER DETAILS -->
                            <fo:table-cell padding="0pt">
                                <fo:table table-layout="fixed" width="95mm">
                                    <fo:table-column column-width="47.5mm"/>
                                    <fo:table-column column-width="47.5mm"/>
                                    <fo:table-body>
                                        <fo:table-row border-bottom="0.5pt solid black">
                                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block font-weight="bold">Document No.</fo:block><fo:block font-weight="bold" font-size="10pt">${(order.zenithDocNumber)!orderId}</fo:block></fo:table-cell>
                                            <fo:table-cell padding="3pt"><fo:block font-weight="bold">Date</fo:block><fo:block font-weight="bold" font-size="10pt">${ec.l10n.format(order.entryDate, dateFormat)}</fo:block></fo:table-cell>
                                        </fo:table-row>
                                        <fo:table-row border-bottom="0.5pt solid black">
                                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block font-weight="bold">Valid Thru</fo:block><fo:block><#if orderPart?? && orderPart.validThruDate??>${ec.l10n.format(orderPart.validThruDate, dateFormat)}<#else>N/A</#if></fo:block></fo:table-cell>
                                            <fo:table-cell padding="3pt"><fo:block font-weight="bold">Revision</fo:block><fo:block>${order.orderRevision!"1"}</fo:block></fo:table-cell>
                                        </fo:table-row>
                                        <fo:table-row border-bottom="0.5pt solid black">
                                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block font-weight="bold">Currency</fo:block><fo:block><@encodeText order.currencyUomId!"INR"/></fo:block></fo:table-cell>
                                            <fo:table-cell padding="3pt"><fo:block font-weight="bold">Sales Channel</fo:block><fo:block><@encodeText order.salesChannelEnumId!""/></fo:block></fo:table-cell>
                                        </fo:table-row>
                                        <#-- ZE-SALES-0308 f/u: a sales order converted from a quote carries the original QTN number for traceability -->
                                        <#if (order.originatingQuoteNumber)?? && order.originatingQuoteNumber?has_content>
                                        <fo:table-row border-bottom="0.5pt solid black">
                                            <fo:table-cell padding="3pt" number-columns-spanned="2"><fo:block font-weight="bold">Ref. Quote No. <fo:inline font-weight="normal"><@encodeText order.originatingQuoteNumber/></fo:inline></fo:block></fo:table-cell>
                                        </fo:table-row>
                                        </#if>
                                    </fo:table-body>
                                </fo:table>
                            </fo:table-cell>
                        </fo:table-row>
                    </fo:table-body>
                </fo:table>

                </#if>

                <#-- CUSTOMER SECTION -->
                <fo:table table-layout="fixed" width="190mm" <#if salesOrderLayout>border-collapse="separate" space-after="14pt"<#else>border-bottom="0.5pt solid black"</#if>>
                    <fo:table-column column-width="${salesOrderLayout?string('93mm', '95mm')}"/>
                    <#if salesOrderLayout><fo:table-column column-width="4mm"/></#if>
                    <fo:table-column column-width="${salesOrderLayout?string('93mm', '95mm')}"/>
                    <fo:table-body>
                        <fo:table-row>
                            <fo:table-cell <#if salesOrderLayout>padding="8pt" border="0.5pt solid ${lineColor}"<#else>padding="5pt" border-right="0.5pt solid black"</#if>>
                                <fo:block font-size="8pt" <#if salesOrderLayout>space-after="4pt" font-weight="bold" color="${accent}"<#else>margin-bottom="2pt"</#if>>${salesOrderLayout?string("Bill to", "Customer Info")}</fo:block>
                                <fo:block font-weight="bold" font-size="10pt"><@encodeText (customerParty.organizationName)!""/> <@encodeText (customerParty.firstName)!""/> <@encodeText (customerParty.lastName)!""/></fo:block>
                                <#if customerContactInfo?? && customerContactInfo.postalAddress?has_content>
                                    <fo:block><@encodeText (customerContactInfo.postalAddress.address1)!""/></fo:block>
                                    <#if customerContactInfo.postalAddress.address2?has_content><fo:block><@encodeText customerContactInfo.postalAddress.address2/></fo:block></#if>
                                    <fo:block><@encodeText (customerContactInfo.postalAddress.city!"")/>, ${(customerContactInfo.postalAddressStateGeo.geoCodeAlpha2)!""} ${customerContactInfo.postalAddress.postalCode!""}</fo:block>
                                </#if>
                                <fo:block margin-top="3pt" font-weight="bold">Customer ID: <fo:inline font-weight="normal">${(customerParty.partyId)!"N/A"}</fo:inline></fo:block>
                            </fo:table-cell>
                            <#if salesOrderLayout><fo:table-cell><fo:block/></fo:table-cell></#if>
                            <fo:table-cell <#if salesOrderLayout>padding="8pt" border="0.5pt solid ${lineColor}"<#else>padding="5pt"</#if>>
                                <fo:block font-size="8pt" <#if salesOrderLayout>space-after="4pt" font-weight="bold" color="${accent}"<#else>margin-bottom="2pt"</#if>>${salesOrderLayout?string("Ship to", "Shipping Address")}</fo:block>
                                <fo:block font-weight="bold" font-size="10pt"><@encodeText (customerParty.organizationName)!""/> <@encodeText (customerParty.firstName)!""/> <@encodeText (customerParty.lastName)!""/></fo:block>
                                <#if customerContactInfo?? && customerContactInfo.postalAddress?has_content>
                                    <fo:block><@encodeText (customerContactInfo.postalAddress.address1)!""/></fo:block>
                                    <#if customerContactInfo.postalAddress.address2?has_content><fo:block><@encodeText customerContactInfo.postalAddress.address2/></fo:block></#if>
                                    <fo:block><@encodeText (customerContactInfo.postalAddress.city!"")/>, ${(customerContactInfo.postalAddressStateGeo.geoCodeAlpha2)!""} ${customerContactInfo.postalAddress.postalCode!""}</fo:block>
                                </#if>
                            </fo:table-cell>
                        </fo:table-row>
                    </fo:table-body>
                </fo:table>

                <#-- LINE ITEMS HEADER -->
                <#if salesOrderLayout><fo:block font-size="10pt" font-weight="bold" space-after="4pt" keep-with-next.within-page="always">Line items</fo:block></#if>
                <fo:table table-layout="fixed" width="190mm" <#if salesOrderLayout>space-after="10pt"</#if>>
                    <fo:table-column column-width="15.2mm"/>
                    <fo:table-column column-width="56.0mm"/>
                    <fo:table-column column-width="20.0mm"/>
                    <fo:table-column column-width="18.0mm"/>
                    <fo:table-column column-width="20.0mm"/>
                    <fo:table-column column-width="25.0mm"/>
                    <fo:table-column column-width="35.8mm"/>
                    
                    <fo:table-header font-size="8pt" font-weight="bold" <#if salesOrderLayout>background-color="${tint}" color="#352255"<#else>text-align="center"</#if>>
                        <fo:table-row border-bottom="0.5pt solid ${lineColor}">
                            <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>><fo:block text-align="center">S.No.</fo:block></fo:table-cell>
                            <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>><fo:block>Description of Goods</fo:block></fo:table-cell>
                            <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>><fo:block text-align="center">HSN/SAC</fo:block></fo:table-cell>
                            <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>><fo:block <#if salesOrderLayout>text-align="right"</#if>>Qty</fo:block></fo:table-cell>
                            <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>><fo:block <#if salesOrderLayout>text-align="right"</#if>>Unit Price</fo:block></fo:table-cell>
                            <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>><fo:block <#if salesOrderLayout>text-align="right"</#if>>Est. GST</fo:block></fo:table-cell>
                            <fo:table-cell padding="${cellPadding}"><fo:block <#if salesOrderLayout>text-align="right"</#if>>Total</fo:block></fo:table-cell>
                        </fo:table-row>
                    </fo:table-header>
                    <fo:table-body>
                        <#if salesOrderLayout && !orderItems?has_content>
                            <fo:table-row><fo:table-cell number-columns-spanned="7" padding="5pt"><fo:block>No items added.</fo:block></fo:table-cell></fo:table-row>
                        </#if>
                        <#list orderItems as orderItem>
                            <#assign amounts = orderLineAmounts[orderItem.orderItemSeqId]>
                            <fo:table-row keep-together.within-page="always" font-size="8pt" border-bottom="<#if salesOrderLayout>0.5pt solid ${lineColor}<#else>0.1pt solid gray</#if>">
                                <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>><fo:block text-align="center">${orderItem_index+1}</fo:block></fo:table-cell>
                                <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>><fo:block font-weight="bold"><@encodeText (orderItem.itemDescription)!""/></fo:block><#if (orderItem.discountPercent!0)?number != 0><fo:block font-size="6pt" color="#c0392b">Less ${orderItem.discountPercent}% discount (<@formatINR orderItem.discountAmount!0/>)</fo:block></#if></fo:table-cell>
                                <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>><fo:block text-align="center">${orderItem.hsnSacCode!"-"}</fo:block></fo:table-cell>
                                <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>><fo:block text-align="${salesOrderLayout?string('right', 'center')}">${orderItem.quantity!"1"}</fo:block></fo:table-cell>
                                <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>><fo:block text-align="right"><@formatINR orderItem.unitAmount/></fo:block></fo:table-cell>
                                <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>><fo:block text-align="right"><@formatINR amounts.tax/></fo:block></fo:table-cell>
                                <fo:table-cell padding="${cellPadding}"><fo:block text-align="right" <#if salesOrderLayout>font-weight="bold"</#if>><@formatINR amounts.total/></fo:block></fo:table-cell>
                            </fo:table-row>
                        </#list>
                        
                        <#if !salesOrderLayout>
                            <fo:table-row font-size="9pt" font-weight="bold" border-top="0.5pt solid black" border-bottom="0.5pt solid ${lineColor}">
                                <fo:table-cell padding="${cellPadding}" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if> number-columns-spanned="6" text-align="right"><fo:block>Estimated Grand Total (Inc. GST)</fo:block></fo:table-cell>
                                <fo:table-cell padding="${cellPadding}"><fo:block text-align="right"><@formatINR displayOrderTotal!0/></fo:block></fo:table-cell>
                            </fo:table-row>
                            <#if hasHistoricalDifference>
                                <fo:table-row><fo:table-cell number-columns-spanned="7" padding="${cellPadding}"><fo:block font-size="7pt">
                                    Recorded header: <@formatINR order.grandTotal/>. Line total with tax and discounts: <@formatINR lineGrandTotal/>.
                                </fo:block></fo:table-cell></fo:table-row>
                            </#if>
                        </#if>
                    </fo:table-body>
                </fo:table>

                <#if salesOrderLayout>
                    <fo:table table-layout="fixed" width="190mm" space-after="10pt">
                        <fo:table-column column-width="102mm"/>
                        <fo:table-column column-width="52mm"/>
                        <fo:table-column column-width="36mm"/>
                        <fo:table-body>
                            <fo:table-row keep-together.within-page="always">
                                <fo:table-cell padding="5pt" color="#635a74">
                                    <#if hasHistoricalDifference>
                                        <fo:block>Recorded header: <@formatINR order.grandTotal/></fo:block>
                                        <fo:block space-before="3pt">Line total with tax and discounts: <@formatINR lineGrandTotal/></fo:block>
                                    <#else><fo:block/></#if>
                                </fo:table-cell>
                                <fo:table-cell background-color="${tint}" padding="8pt" display-align="center">
                                    <fo:block font-weight="bold" color="${accent}">Est. total incl. GST</fo:block>
                                </fo:table-cell>
                                <fo:table-cell background-color="${tint}" padding="8pt" display-align="center">
                                    <fo:block text-align="right" font-size="11pt" font-weight="bold" color="${accent}"><@formatINR displayOrderTotal!0/></fo:block>
                                </fo:table-cell>
                            </fo:table-row>
                        </fo:table-body>
                    </fo:table>
                </#if>

                <#-- TERMS AND CONDITIONS -->
                <fo:table table-layout="fixed" width="190mm" <#if salesOrderLayout>border-top="0.5pt solid ${lineColor}"</#if>>
                    <fo:table-column column-width="95mm"/>
                    <fo:table-column column-width="95mm"/>
                    <fo:table-body>
                        <fo:table-row>
                            <fo:table-cell padding="5pt" <#if !salesOrderLayout>border-right="0.5pt solid black"</#if>>
                                <fo:block font-weight="bold" <#if !salesOrderLayout>text-decoration="underline"</#if> font-size="9pt" margin-bottom="4pt">Terms &amp; Conditions</fo:block>
                                <fo:block font-size="8pt" margin-bottom="2pt"><fo:inline font-weight="bold">Validity:</fo:inline> <#if orderPart?? && orderPart.validThruDate??>Valid until ${ec.l10n.format(orderPart.validThruDate, dateFormat)}<#else>Subject to confirmation</#if></fo:block>
                                <#if orderPart?? && orderPart.tradeTermEnumId??>
                                    <#assign tradeTerm = ec.entity.find("moqui.basic.Enumeration").condition("enumId", orderPart.tradeTermEnumId).one()!>
                                    <fo:block font-size="8pt" margin-bottom="2pt"><fo:inline font-weight="bold">Freight Terms:</fo:inline> ${(tradeTerm.description)!orderPart.tradeTermEnumId}</fo:block>
                                </#if>
                                <#if orderPart?? && orderPart.settlementTermId??>
                                    <#assign settlementTerm = ec.entity.find("mantle.account.invoice.SettlementTerm").condition("settlementTermId", orderPart.settlementTermId).one()!>
                                    <fo:block font-size="8pt" margin-bottom="2pt"><fo:inline font-weight="bold">Payment Terms:</fo:inline> ${(settlementTerm.description)!orderPart.settlementTermId}</fo:block>
                                </#if>
                                <fo:block font-size="8pt" margin-top="4pt">1. This is a computer generated document.</fo:block>
                                <fo:block font-size="8pt">2. Final tax liability is calculated upon final invoice.</fo:block>
                            </fo:table-cell>
                            <fo:table-cell padding="5pt">
                                <fo:block text-align="right" font-weight="bold">for <@encodeText (vendorParty.organizationName)!""/></fo:block>
                                <fo:block margin-top="40pt" text-align="right">Authorized Signatory</fo:block>
                            </fo:table-cell>
                        </fo:table-row>
                    </fo:table-body>
                </fo:table>

            </fo:block>
            <#else>
            <fo:block font-size="14pt" font-weight="bold" text-align="center" margin-top="60mm" color="#b00020">This document is not available or you do not have permission to view it.</fo:block>
            </#if>
        </fo:flow>
    </fo:page-sequence>
</fo:root>
