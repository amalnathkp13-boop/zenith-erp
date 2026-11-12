(function () {
  'use strict';
  if(window.PosQzPrint)return;

  const QZ_CERT = "-----BEGIN CERTIFICATE-----\nMIIDQzCCAiugAwIBAgIUZkbpbAL3gGfcBrr5rxN1X7YE1s0wDQYJKoZIhvcNAQEL\nBQAwMTEUMBIGA1UEAwwLWmV0YUVSUCBQT1MxGTAXBgNVBAoMEFpldGFFUlAgUGxh\ndGZvcm0wHhcNMjYxMDMxMTYwNDE2WhcNMzYxMDI4MTYwNDE2WjAxMRQwEgYDVQQD\nDAtaZXRhRVJQIFBPUzEZMBcGA1UECgwQWmV0YUVSUCBQbGF0Zm9ybTCCASIwDQYJ\nKoZIhvcNAQEBBQADggEPADCCAQoCggEBALngd59q7TFHGEwWXSa6lX8RMf7FJfyk\nNe5LRUgQkzvDrFrwHsmWT6xHPZv4LiEl2hfTvr3cQAu+zqadGFMoNk5ZISNHclXl\nwzDOYwZ/vtV4hmGWd2U80bpJb1jA1GDh4MbnQrFwnTn+YjW5g87HzAc61rH1qevC\njr11aD5PeclGgAFlSxYgKWg9JH6WyoF7AJBTGKiKT0Q+RqRuaeSsEif/fBmQkhLE\npj/R/Oewg53ghd0zxE8yz/errgS0iHc6ryY52uHxhFT23eiiO5Rnc+25fAqSJNX6\n2Pw+OJ0QKnSF4aOOmSpnP5c5aW3UwdaNWdUZjYK6Y/eELChB7PnwNQ8CAwEAAaNT\nMFEwHQYDVR0OBBYEFOLJawO9QyRTntz0Q3Icj2806j1FMB8GA1UdIwQYMBaAFOLJ\nawO9QyRTntz0Q3Icj2806j1FMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEL\nBQADggEBAJsomo0uSqFqg42WgA+E7bTifHdLfjUogqszxFjtawDAN6MXaoDL/x1R\n50GICuqGCMy9Gw6EZ/6M9mNp305+PVySZT27Nvvayj4/uCBENL2/CIZtHPPAgyLA\n41B1Lbsz+WcYz8s2yo5fxKXNdzNyzOo1B6A8VJbE6SFBFz8P26Q/iFHbIz0s7AkX\np9QvCSwGcwdyhcZe4RLWyoWWVwplFKghrm5obv2m33Cz3qaM+oUvZF6g5LmHRfPb\nkWVRze3558Z6MB2IicvDqlT9KqFXw3t8/L/RYnhRHvh1N41EOSauLNWy5sKQzMaS\nhDdKy72Sct97bx4uhhwKtrGm0jHfWBM=\n-----END CERTIFICATE-----";
  let securedClient, connecting, loading;

  function loadClient() {
    if(window.qz)return Promise.resolve(window.qz);
    if(!loading) {
      loading=new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        const failed=()=>{
          script.remove();
          reject(Error('QZ Tray client could not be loaded.'));
        };
        const timer=setTimeout(failed,8000);
        script.src='https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';
        script.onload=()=>{
          clearTimeout(timer);
          if(window.qz)resolve(window.qz);
          else failed();
        };
        script.onerror=()=>{ clearTimeout(timer);failed(); };
        document.head.appendChild(script);
      }).finally(()=>{loading=null;});
    }
    return loading;
  }

  async function connect() {
    const client=await loadClient();
    if(client.security&&securedClient!==client) {
      client.security.setSignatureAlgorithm('SHA1'); // The existing ERP signing endpoint uses SHA1withRSA.
      client.security.setCertificatePromise(resolve=>resolve(QZ_CERT));
      client.security.setSignaturePromise(message=>(resolve,reject)=>{
        fetch('/apps/qzSign?message='+encodeURIComponent(message),{credentials:'same-origin',cache:'no-store'})
          .then(async response=>{
            if(!response.ok||response.redirected)throw Error('QZ signing request failed.');
            const signature=(await response.text()).trim();
            if(!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))throw Error('QZ signing returned an invalid signature.');
            return signature;
          }).then(resolve,reject);
      });
      securedClient=client;
    }
    if(!connecting&&client.websocket.isActive())return client;
    if(!connecting) {
      connecting=Promise.resolve().then(()=>client.websocket.connect({retries:0,delay:0}))
        .finally(()=>{connecting=null;});
    }
    let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('QZ connection timed out.')),30000);});
    try { await Promise.race([connecting,deadline]);return client; }
    finally { clearTimeout(timer); }
  }

  async function printHtml(printer,html) {
    const client=await connect();
    const width=/data-paper-width="58"/.test(html)?58:80;
    const config=client.configs.create(printer,{
      size:{width},units:'mm',colorType:'grayscale',
      margins:{top:0,right:0,bottom:0,left:0},scaleContent:false
    });
    await client.print(config,[{type:'pixel',format:'html',flavor:'plain',data:html,
      options:{pageWidth:width,pageHeight:null}}]);
  }
  window.PosQzPrint={connect,printHtml};
})();
