<#assign assetDir="component://zenith-erp-app/screen/zenithstatic/js/">
<#assign bundleVersions=[]>
<#list ["hr-workspace", "hr-people", "hr-payroll-settings"] as asset>
    <#assign bundleVersions=bundleVersions+[ec.resource.getLocationReference(assetDir+asset+".js").getLastModified()?c]>
</#list>
<div id="zc-hr-workspace" data-page="${hrPage?html}"
     data-read="${sri.buildUrl('readWorkspace').url?html}"
     data-save="${sri.buildUrl('saveWorkspace').url?html}"
     data-token="${(ec.web.sessionToken!'')?html}"
     data-css="/zenithstatic/css/hr-workspace.css?v=${ec.resource.getLocationReference('component://zenith-erp-app/screen/zenithstatic/css/hr-workspace.css').getLastModified()?c}">
    <span role="status">Loading HR workspace…</span>
    <img hidden alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
         onload="import('/zenithstatic/js/hr-workspace.js?v=${bundleVersions?join('-')}').then(m => m.openWorkspace(this.parentElement)).catch(() => {this.parentElement.querySelector('span').textContent = 'Unable to load the HR workspace. Refresh this page to retry.'})"/>
</div>
