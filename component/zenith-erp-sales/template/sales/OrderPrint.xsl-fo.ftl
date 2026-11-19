<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-family="Helvetica, sans-serif" font-size="9pt">
<#assign cellPadding = "3pt">
<#assign dateFormat = dateFormat!"dd-MMM-yyyy">
<#macro encodeText textValue>${(Static["org.moqui.util.StringUtilities"].encodeForXmlAttribute(textValue!"", false))!""}</#macro>
<#macro formatINR amount>Rs. ${Static["com.zenith.Fmt"].regroup(ec.l10n.format(amount!0, "#,##0.00"))}</#macro>
    <fo:layout-master-set>
        <fo:simple-page-master master-name="A4" page-width="210mm" page-height="297mm"
                               margin-top="10mm" margin-bottom="15mm" margin-left="10mm" margin-right="10mm">
            <fo:region-body margin-top="0mm" margin-bottom="10mm"/>
            <fo:region-after extent="10mm"/>
        </fo:simple-page-master>
    </fo:layout-master-set>

    <fo:page-sequence master-reference="A4" id="mainSequence">
        <fo:static-content flow-name="xsl-region-after">
            <fo:block text-align="center" font-size="8pt">Page <fo:page-number/> of <fo:page-number-citation-last ref-id="mainSequence"/></fo:block>
        </fo:static-content>

        <fo:flow flow-name="xsl-region-body">
            <#if order??>
            
            <#-- ORDER HEADER -->
            <fo:block text-align="center" font-size="14pt" font-weight="bold" margin-bottom="5mm">
                <#if printType?? && printType == 'Proforma'>PROFORMA INVOICE
                <#elseif (printType?? && printType == 'Quotation') || order.statusId == 'OrderProposed'>QUOTATION / ESTIMATE
                <#else>SALES ORDER</#if>
            </fo:block>

            <!-- MAIN OUTER BORDER -->
            <fo:block border="0.5pt solid black">
                
                <#-- TOP SECTION: VENDOR & ORDER DETAILS -->
                <fo:table table-layout="fixed" width="190mm" border-bottom="0.5pt solid black">
                    <fo:table-column column-width="95mm"/>
                    <fo:table-column column-width="95mm"/>
                    <fo:table-body>
                        <fo:table-row>
                            <#-- VENDOR INFO -->
                            <fo:table-cell padding="5pt" border-right="0.5pt solid black">
                                <fo:block font-weight="bold" font-size="11pt"><@encodeText (vendorParty.organizationName)!""/><@encodeText (vendorParty.firstName)!""/> <@encodeText (vendorParty.lastName)!""/></fo:block>
                                <#if vendorContactInfo?? && vendorContactInfo.postalAddress?has_content>
                                    <fo:block><@encodeText (vendorContactInfo.postalAddress.address1)!""/></fo:block>
                                    <#if vendorContactInfo.postalAddress.address2?has_content><fo:block><@encodeText vendorContactInfo.postalAddress.address2/></fo:block></#if>
                                    <fo:block><@encodeText (vendorContactInfo.postalAddress.city!"")/>, ${(vendorContactInfo.postalAddressStateGeo.geoCodeAlpha2)!""} ${vendorContactInfo.postalAddress.postalCode!""}</fo:block>
                                </#if>
                                <fo:block margin-top="3pt" font-weight="bold">Vendor ID: <fo:inline font-weight="normal">${(vendorParty.partyId)!"N/A"}</fo:inline></fo:block>
                                <#if vendorContactInfo?? && vendorContactInfo.emailAddress?has_content><fo:block font-weight="bold">Email: <fo:inline font-weight="normal">${vendorContactInfo.emailAddress}</fo:inline></fo:block></#if>
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

                <#-- CUSTOMER SECTION -->
                <fo:table table-layout="fixed" width="190mm" border-bottom="0.5pt solid black">
                    <fo:table-column column-width="95mm"/>
                    <fo:table-column column-width="95mm"/>
                    <fo:table-body>
                        <fo:table-row>
                            <fo:table-cell padding="5pt" border-right="0.5pt solid black">
                                <fo:block font-size="8pt" margin-bottom="2pt">Customer Info</fo:block>
                                <fo:block font-weight="bold" font-size="10pt"><@encodeText (customerParty.organizationName)!""/> <@encodeText (customerParty.firstName)!""/> <@encodeText (customerParty.lastName)!""/></fo:block>
                                <#if customerContactInfo?? && customerContactInfo.postalAddress?has_content>
                                    <fo:block><@encodeText (customerContactInfo.postalAddress.address1)!""/></fo:block>
                                    <#if customerContactInfo.postalAddress.address2?has_content><fo:block><@encodeText customerContactInfo.postalAddress.address2/></fo:block></#if>
                                    <fo:block><@encodeText (customerContactInfo.postalAddress.city!"")/>, ${(customerContactInfo.postalAddressStateGeo.geoCodeAlpha2)!""} ${customerContactInfo.postalAddress.postalCode!""}</fo:block>
                                </#if>
                                <fo:block margin-top="3pt" font-weight="bold">Customer ID: <fo:inline font-weight="normal">${(customerParty.partyId)!"N/A"}</fo:inline></fo:block>
                            </fo:table-cell>
                            <fo:table-cell padding="5pt">
                                <fo:block font-size="8pt" margin-bottom="2pt">Shipping Address</fo:block>
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
                <fo:table table-layout="fixed" width="190mm">
                    <fo:table-column column-width="15.2mm"/>
                    <fo:table-column column-width="56.0mm"/>
                    <fo:table-column column-width="20.0mm"/>
                    <fo:table-column column-width="18.0mm"/>
                    <fo:table-column column-width="20.0mm"/>
                    <fo:table-column column-width="25.0mm"/>
                    <fo:table-column column-width="35.8mm"/>
                    
                    <fo:table-header font-size="8pt" font-weight="bold" text-align="center">
                        <fo:table-row border-bottom="0.5pt solid black">
                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block>S.No.</fo:block></fo:table-cell>
                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block>Description of Goods</fo:block></fo:table-cell>
                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block>HSN/SAC</fo:block></fo:table-cell>
                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block>Qty</fo:block></fo:table-cell>
                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block>Unit Price</fo:block></fo:table-cell>
                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block>Est. GST</fo:block></fo:table-cell>
                            <fo:table-cell padding="3pt"><fo:block>Total</fo:block></fo:table-cell>
                        </fo:table-row>
                    </fo:table-header>
                    <fo:table-body>
                        <#list orderItems as orderItem>
                            <#assign amounts = orderLineAmounts[orderItem.orderItemSeqId]>
                            <fo:table-row keep-together.within-page="always" font-size="8pt" border-bottom="0.1pt solid gray">
                                <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block text-align="center">${orderItem_index+1}</fo:block></fo:table-cell>
                                <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block font-weight="bold"><@encodeText (orderItem.itemDescription)!""/></fo:block><#if (orderItem.discountPercent!0)?number != 0><fo:block font-size="6pt" color="#c0392b">Less ${orderItem.discountPercent}% discount (<@formatINR orderItem.discountAmount!0/>)</fo:block></#if></fo:table-cell>
                                <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block text-align="center">${orderItem.hsnSacCode!"-"}</fo:block></fo:table-cell>
                                <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block text-align="center">${orderItem.quantity!"1"}</fo:block></fo:table-cell>
                                <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block text-align="right"><@formatINR orderItem.unitAmount/></fo:block></fo:table-cell>
                                <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block text-align="right"><@formatINR amounts.tax/></fo:block></fo:table-cell>
                                <fo:table-cell padding="3pt"><fo:block text-align="right"><@formatINR amounts.total/></fo:block></fo:table-cell>
                            </fo:table-row>
                        </#list>
                        
                        <fo:table-row font-size="9pt" font-weight="bold" border-top="0.5pt solid black" border-bottom="0.5pt solid black">
                            <fo:table-cell padding="3pt" border-right="0.5pt solid black" number-columns-spanned="6" text-align="right"><fo:block>Estimated Grand Total (Inc. GST)</fo:block></fo:table-cell>
                            <fo:table-cell padding="3pt"><fo:block text-align="right"><@formatINR displayOrderTotal!0/></fo:block></fo:table-cell>
                        </fo:table-row>
                        <#if hasHistoricalDifference>
                            <fo:table-row><fo:table-cell number-columns-spanned="7" padding="3pt"><fo:block font-size="7pt">
                                Recorded header: <@formatINR order.grandTotal/>. Line total with tax and discounts: <@formatINR lineGrandTotal/>.
                            </fo:block></fo:table-cell></fo:table-row>
                        </#if>
                    </fo:table-body>
                </fo:table>

                <#-- TERMS AND CONDITIONS -->
                <fo:table table-layout="fixed" width="190mm">
                    <fo:table-column column-width="95mm"/>
                    <fo:table-column column-width="95mm"/>
                    <fo:table-body>
                        <fo:table-row>
                            <fo:table-cell padding="5pt" border-right="0.5pt solid black">
                                <fo:block font-weight="bold" text-decoration="underline" font-size="9pt" margin-bottom="4pt">Terms &amp; Conditions</fo:block>
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
