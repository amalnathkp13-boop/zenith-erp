<#assign standardMacroPath = ec.factory.runtimePath?replace('\\', '/')?remove_beginning('/')>
<#include ("file:///" + standardMacroPath + "/template/screen-macro/DefaultScreenMacros.html.ftl")>
<#assign standardProductForm = .namespace["form-single"]>
<#assign entryQuasar = false>
<#include "ProductEntry.shared.ftl">
