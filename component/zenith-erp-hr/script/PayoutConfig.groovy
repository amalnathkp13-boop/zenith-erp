import groovy.json.JsonSlurper
import java.security.MessageDigest

// Each organization has its own RazorpayX credentials and debit account.
def raw = System.getenv('ZENITH_HR_PAYOUT_CONFIG')
if (!raw) return null
def config
try { config = new JsonSlurper().parseText(raw)?.get(org) }
catch (Exception ignored) { return null }
if (!(config instanceof Map) || !(config.keyId ==~ /rzp_(test|live)_[A-Za-z0-9]+/) ||
        !(config.keySecret instanceof String) || !config.keySecret || !(config.accountNumber ==~ /[0-9]{6,30}/)) return null
def mode = config.keyId.startsWith('rzp_test_') ? 'test' : 'live'
def endpoint = 'https://api.razorpay.com/v1/payouts'
// A loopback provider is available for disposable tests with test keys only.
if (config.testEndpoint) {
    if (mode != 'test' || !(config.testEndpoint ==~ /http:\/\/127\.0\.0\.1:[0-9]{1,5}\/v1\/payouts/)) return null
    endpoint = config.testEndpoint
}
def identity = MessageDigest.getInstance('SHA-256')
    .digest([mode,endpoint,config.accountNumber].join('|').getBytes('UTF-8')).encodeHex().toString()
return [mode:mode,keyId:config.keyId,keySecret:config.keySecret,accountNumber:config.accountNumber,endpoint:endpoint,identity:identity]
