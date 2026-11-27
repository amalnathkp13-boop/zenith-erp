<#assign standardMacroPath = ec.factory.runtimePath?replace('\\', '/')?remove_beginning('/')>
<#include ("file:///" + standardMacroPath + "/template/screen-macro/DefaultScreenMacros.qvt.ftl")>
<#assign standardProductForm = .namespace["form-single"]>
<#assign entryQuasar = true>
<#include "ProductEntry.shared.ftl">
