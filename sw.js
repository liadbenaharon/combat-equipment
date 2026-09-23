importScripts('./app-config.js?v=18');
const CACHE=self.COMBAT_APP.cache;
const ASSETS=[
  './','./index.html','./manifest.webmanifest','./privacy.html','./delete-account.html',
  './icon-192.png','./icon-512.png','./app-theme.css?v=6','./app-config.js?v=18','./cloud-config.js?v=2','./cloud-bundle.js?v=5','./data-safety.js?v=3',
  './equipment-icons.js?v=8','./quantity-shortcut.js?v=2','./history-collapse.js?v=3',
  './attendance.js?v=20','./contacts-count.js?v=6','./returns.js?v=7','./app-lifecycle.js?v=10','./assignment-transfer.js?v=3','./native-ui.js?v=5','./native-app.js?v=1'
];

self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('combat-equipment-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting()});

// Only the app shell may be stored as ./index.html; other pages (privacy, delete-account) are cached under their own URL.
function isAppShell(url){
  const scope=new URL(self.registration?.scope||'./',self.location.href||(self.location.origin+'/')).pathname;
  return url.pathname===scope||url.pathname===scope+'index.html';
}
async function navigation(request){
  const url=new URL(request.url),shell=isAppShell(url);
  try{
    const response=await fetch(request);
    if(response?.ok&&response.type!=='opaqueredirect'){const cache=await caches.open(CACHE);await cache.put(shell?'./index.html':url.pathname,response.clone())}
    return response;
  }
  catch{return(!shell&&await caches.match(url.pathname))||(await caches.match('./index.html'))||(await caches.match('./'))||Response.error()}
}
async function asset(request){
  const cached=await caches.match(request);if(cached)return cached;
  try{const response=await fetch(request);if(response?.ok){const cache=await caches.open(CACHE);cache.put(request,response.clone())}return response}catch{return Response.error()}
}
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;event.respondWith(event.request.mode==='navigate'?navigation(event.request):asset(event.request))});
