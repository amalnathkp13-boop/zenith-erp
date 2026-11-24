<#-- Delivery Challan Template for Moqui (GST Rule 55 Compliant) -->
<#assign dateFormat = dateFormat!"dd-MMM-yyyy">
<#macro encodeText textValue>${(Static["org.moqui.util.StringUtilities"].encodeForXmlAttribute(textValue!"", false))!""}</#macro>
<#macro formatINR amount>Rs. ${Static["com.zenith.Fmt"].regroup(ec.l10n.format(amount!0, "#,##0.00"))}</#macro>

<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" font-family="Helvetica, sans-serif" font-size="9pt">
    <fo:layout-master-set>
        <fo:simple-page-master master-name="A4" page-width="210mm" page-height="297mm"
                               margin-top="10mm" margin-bottom="15mm" margin-left="10mm" margin-right="10mm">
            <fo:region-body margin-top="0mm" margin-bottom="15mm"/>
            <fo:region-after extent="10mm"/>
        </fo:simple-page-master>
    </fo:layout-master-set>

    <fo:page-sequence master-reference="A4" id="mainSequence">
        <fo:static-content flow-name="xsl-region-after">
            <fo:block text-align="center" font-size="8pt">Page <fo:page-number/> of <fo:page-number-citation-last ref-id="mainSequence"/></fo:block>
        </fo:static-content>

        <fo:flow flow-name="xsl-region-body">
            
            <#-- HEADER -->
            <fo:block text-align="center" font-size="14pt" font-weight="bold" margin-bottom="5mm">
                DELIVERY CHALLAN
            </fo:block>
            <fo:block text-align="center" font-size="8pt" margin-bottom="3mm">
                (Issued under Rule 55 of the CGST Rules)
            </fo:block>

            <fo:block border="0.5pt solid black">
                
                <#-- TOP SECTION: SENDER & CHALLAN DETAILS -->
                <fo:table table-layout="fixed" width="190mm" border-bottom="0.5pt solid black">
                    <fo:table-column column-width="95mm"/>
                    <fo:table-column column-width="95mm"/>
                    <fo:table-body>
                        <fo:table-row>
                            <#-- SENDER INFO -->
                            <fo:table-cell padding="5pt" border-right="0.5pt solid black">
                                <fo:block font-size="8pt" color="gray" margin-bottom="2pt">SENDER (From)</fo:block>
                                <fo:block font-weight="bold" font-size="11pt"><@encodeText (fromParty.organizationName)!""/><@encodeText (fromParty.firstName)!""/> <@encodeText (fromParty.lastName)!""/></fo:block>
                                <fo:block margin-top="3pt" font-weight="bold">Sender ID: <fo:inline font-weight="normal">${(fromParty.partyId)!"N/A"}</fo:inline></fo:block>
                            </fo:table-cell>

                            <#-- CHALLAN DETAILS -->
                            <fo:table-cell padding="0pt">
                                <fo:table table-layout="fixed" width="95mm">
                                    <fo:table-column column-width="47.5mm"/>
                                    <fo:table-column column-width="47.5mm"/>
                                    <fo:table-body>
                                        <fo:table-row border-bottom="0.5pt solid black">
                                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block font-weight="bold">Challan No.</fo:block><fo:block font-weight="bold" font-size="10pt">${(challan.challanNumber)!(challan.challanId)}</fo:block></fo:table-cell>
                                            <fo:table-cell padding="3pt"><fo:block font-weight="bold">Date</fo:block><fo:block font-weight="bold" font-size="10pt"><#if challan.challanDate??>${ec.l10n.format(challan.challanDate, dateFormat)}<#else>N/A</#if></fo:block></fo:table-cell>
                                        </fo:table-row>
                                        <fo:table-row>
                                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block font-weight="bold">Challan Type</fo:block><fo:block><@encodeText challan.challanType!"Job Work"/></fo:block></fo:table-cell>
                                            <fo:table-cell padding="3pt"><fo:block font-weight="bold">Status</fo:block><fo:block><@encodeText challan.statusId!""/></fo:block></fo:table-cell>
                                        </fo:table-row>
                                    </fo:table-body>
                                </fo:table>
                            </fo:table-cell>
                        </fo:table-row>
                    </fo:table-body>
                </fo:table>

                <#-- RECEIVER AND TRANSPORT SECTION -->
                <fo:table table-layout="fixed" width="190mm" border-bottom="0.5pt solid black">
                    <fo:table-column column-width="95mm"/>
                    <fo:table-column column-width="95mm"/>
                    <fo:table-body>
                        <fo:table-row>
                            <#-- RECEIVER INFO -->
                            <fo:table-cell padding="5pt" border-right="0.5pt solid black">
                                <fo:block font-size="8pt" color="gray" margin-bottom="2pt">RECEIVER (To)</fo:block>
                                <fo:block font-weight="bold" font-size="10pt"><@encodeText (toParty.organizationName)!""/> <@encodeText (toParty.firstName)!""/> <@encodeText (toParty.lastName)!""/></fo:block>
                                <fo:block margin-top="3pt" font-weight="bold">Receiver ID: <fo:inline font-weight="normal">${(toParty.partyId)!"N/A"}</fo:inline></fo:block>
                            </fo:table-cell>

                            <#-- TRANSPORT DETAILS -->
                            <fo:table-cell padding="5pt">
                                <fo:block font-size="8pt" color="gray" margin-bottom="2pt">TRANSPORT &amp; E-WAY BILL</fo:block>
                                <fo:block font-weight="bold">E-Way Bill No: <fo:inline font-weight="normal">${(challan.ewayBillId)!"-"}</fo:inline></fo:block>
                                <fo:block font-weight="bold" margin-top="2pt">Vehicle No: <fo:inline font-weight="normal">${(challan.vehicleNumber)!"-"}</fo:inline></fo:block>
                                <#if challan.transporterId??>
                                    <#assign transporter = ec.entity.find("mantle.party.PartyDetail").condition("partyId", challan.transporterId).one()!>
                                    <fo:block font-weight="bold" margin-top="2pt">Transporter: <fo:inline font-weight="normal">${(transporter.organizationName)!"-"}</fo:inline></fo:block>
                                </#if>
                            </fo:table-cell>
                        </fo:table-row>
                    </fo:table-body>
                </fo:table>

                <#-- ITEMS TABLE -->
                <fo:table table-layout="fixed" width="190mm">
                    <fo:table-column column-width="15.0mm"/>
                    <fo:table-column column-width="75.0mm"/>
                    <fo:table-column column-width="25.0mm"/>
                    <fo:table-column column-width="25.0mm"/>
                    <fo:table-column column-width="50.0mm"/>
                    
                    <fo:table-header font-size="8pt" font-weight="bold" text-align="center">
                        <fo:table-row border-bottom="0.5pt solid black">
                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block>S.No.</fo:block></fo:table-cell>
                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block>Description of Goods</fo:block></fo:table-cell>
                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block>HSN/SAC</fo:block></fo:table-cell>
                            <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block>Quantity</fo:block></fo:table-cell>
                            <fo:table-cell padding="3pt"><fo:block>Estimated Taxable Value</fo:block></fo:table-cell>
                        </fo:table-row>
                    </fo:table-header>
                    <fo:table-body>
                        <#assign totalEstValue = 0>
                        <#list challanItems as item>
                            <#assign itemEst = item.estimatedValue!0>
                            <#assign totalEstValue = totalEstValue + itemEst>
                            <fo:table-row font-size="8pt" border-bottom="0.1pt solid gray">
                                <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block text-align="center">${item_index+1}</fo:block></fo:table-cell>
                                <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block font-weight="bold"><@encodeText (item.description)!""/></fo:block></fo:table-cell>
                                <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block text-align="center">${item.hsnSacCode!"-"}</fo:block></fo:table-cell>
                                <fo:table-cell padding="3pt" border-right="0.5pt solid black"><fo:block text-align="center">${item.quantity!"1"} <@encodeText (item.unitDescription)!""/></fo:block></fo:table-cell>
                                <fo:table-cell padding="3pt"><fo:block text-align="right"><@formatINR itemEst/></fo:block></fo:table-cell>
                            </fo:table-row>
                        </#list>
                        
                        <fo:table-row font-size="9pt" font-weight="bold" border-top="0.5pt solid black" border-bottom="0.5pt solid black">
                            <fo:table-cell padding="3pt" border-right="0.5pt solid black" number-columns-spanned="4" text-align="right"><fo:block>Total Estimated Value</fo:block></fo:table-cell>
                            <fo:table-cell padding="3pt"><fo:block text-align="right"><@formatINR totalEstValue/></fo:block></fo:table-cell>
                        </fo:table-row>
                    </fo:table-body>
                </fo:table>

                <#-- DECLARATION -->
                <fo:table table-layout="fixed" width="190mm">
                    <fo:table-column column-width="95mm"/>
                    <fo:table-column column-width="95mm"/>
                    <fo:table-body>
                        <fo:table-row>
                            <fo:table-cell padding="5pt" border-right="0.5pt solid black">
                                <fo:block font-weight="bold" font-size="9pt" margin-bottom="4pt">Declaration</fo:block>
                                <fo:block font-size="8pt">1. The goods described above are transported without issue of invoice, under Rule 55 of the CGST Rules.</fo:block>
                                <fo:block font-size="8pt">2. This is not a tax invoice. No tax is payable on this dispatch.</fo:block>
                            </fo:table-cell>
                            <fo:table-cell padding="5pt">
                                <fo:block text-align="right" font-weight="bold">for <@encodeText (fromParty.organizationName)!""/></fo:block>
                                <fo:block margin-top="40pt" text-align="right">Authorized Signatory</fo:block>
                            </fo:table-cell>
                        </fo:table-row>
                    </fo:table-body>
                </fo:table>

            </fo:block>
        </fo:flow>
    </fo:page-sequence>
</fo:root>
