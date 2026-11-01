// Render the actual saved-role link with the same unset URL-encoding defaults as Moqui.
import groovy.xml.XmlSlurper
import freemarker.template.Configuration
import freemarker.template.Template
import freemarker.template.TemplateExceptionHandler

def root = new File(args ? args[0] : '.')
def users = new XmlSlurper(false, false).parse(new File(root,
    'component/zenith-erp-settings/screen/zenith/settings/Settings/Users.xml'))
def markup = users.depthFirst().find { it.name() == 'text' && it.text().contains('class="z-users-role-library"') }.text()
assert markup
def cfg = new Configuration(Configuration.VERSION_2_3_31)
cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER)
cfg.setLogTemplateExceptions(false)
def writer = new StringWriter()
new Template('saved-role-library', markup, cfg).process([allRolesList:[
    [userGroupId:'ZENITH_ORG_QA',description:'<Synthetic role>',custom:true],
    [userGroupId:'ZENITH_ALL',description:'Built-in',custom:false]]],writer)
def rendered = writer.toString()
assert rendered.contains('RoleEditor?userGroupId=ZENITH_ORG_QA')
assert rendered.contains('&lt;Synthetic role&gt;')
assert !rendered.contains('Built-in') && !rendered.contains('FTL stack trace')
println 'PASS: saved custom-role link renders with explicit URL charset and escaped role name'
