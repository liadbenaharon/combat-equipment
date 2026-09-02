const CACHE='combat-equipment-v14';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./equipment-icons.js?v=7','./quantity-shortcut.js?v=2','./history-collapse.js?v=1'];
function enhanceHtml(html){
 html=html.replace(/<script src="\.\/equipment-icons\.js[^>]*><\/script>/g,'');
 html=html.replace(/<script src="\.\/quantity-shortcut\.js[^>]*><\/script>/g,'');
 html=html.replace(/<script src="\.\/history-collapse\.js[^>]*><\/script>/g,'');
 html=html.replace(/<span class="app-version-fixed"[^>]*>v[^<]*<\/span>/g,'');
 html=html.replace(/<div class="app-version"[^>]*>v[^<]*<\/div>/g,'');
 html=html.replace('</body>','<script src="./equipment-icons.js?v=7"></script><script src="./quantity-shortcut.js?v=2"></script><script src="./history-collapse.js?v=1"></script></body>');
 return html;
}
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 if(e.request.mode==='navigate'){
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(async r=>new Response(enhanceHtml(await r.text()),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})).catch(()=>caches.match('./index.html').then(async r=>new Response(enhanceHtml(await r.text()),{headers:{'Content-Type':'text/html; charset=utf-8'}}))));return;
 }
 e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match(e.request)));
});