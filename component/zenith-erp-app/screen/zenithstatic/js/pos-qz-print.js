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

  // JavaFX WebKit in QZ Tray can detach Indic vowel signs even with the right font.
  // Shape each word in the browser and let the existing receipt HTML wrap the images.
  function shapeIndicItemNames(html) {
    const indic = /[\u0900-\u0dff]/u;
    if (!indic.test(html)) return html;
    const receipt = new DOMParser().parseFromString(html, 'text/html');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const fontSize = 44;
    let changed = false;
    for (const item of receipt.querySelectorAll('.item-name')) {
      const weight = item.closest('[data-item-font-weight]')?.dataset.itemFontWeight || '600';
      const font = weight + ' ' + fontSize + 'px "Nirmala UI","Noto Sans Tamil","Noto Sans Telugu","Noto Sans Malayalam","Noto Sans Devanagari",sans-serif';
      const color = item.closest('[style*="color:"]')?.style.color || '#000';
      for (const node of Array.from(item.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE || !indic.test(node.textContent)) continue;
        const words = receipt.createDocumentFragment();
        for (const word of node.textContent.split(/(\s+)/u)) {
          if (!indic.test(word)) {
            words.append(word);
            continue;
          }
          context.font = font;
          const metrics = context.measureText(word);
          const x = Math.ceil(Math.max(0, metrics.actualBoundingBoxLeft)) + 1;
          const baseline = Math.ceil(metrics.actualBoundingBoxAscent) + 1;
          canvas.width = x + Math.ceil(Math.max(metrics.width, metrics.actualBoundingBoxRight)) + 1;
          canvas.height = baseline + Math.ceil(Math.max(0, metrics.actualBoundingBoxDescent)) + 1;
          context.font = font;
          context.fillStyle = color;
          context.fillText(word, x, baseline);
          const image = receipt.createElement('img');
          image.src = canvas.toDataURL('image/png');
          image.alt = word;
          image.style.cssText = 'display:inline;margin:0;max-width:100%;max-height:none;height:auto;width:' +
            (canvas.width / fontSize) + 'em;vertical-align:' + ((baseline - canvas.height) / fontSize) + 'em';
          words.append(image);
        }
        node.replaceWith(words);
        changed = true;
      }
    }
    return changed ? '<!doctype html>' + receipt.documentElement.outerHTML : html;
  }

  async function printHtml(printer,html) {
    const client=await connect();
    const width=/data-paper-width="58"/.test(html)?58:80;
    const config=client.configs.create(printer,{
      size:{width},units:'mm',colorType:'grayscale',
      margins:{top:0,right:0,bottom:0,left:0},scaleContent:false
    });
    await client.print(config,[{type:'pixel',format:'html',flavor:'plain',data:shapeIndicItemNames(html),
      options:{pageWidth:width,pageHeight:null}}]);
  }
  window.PosQzPrint={connect,printHtml};
})();
