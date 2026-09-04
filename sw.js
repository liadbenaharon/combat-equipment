importScripts('./app-config.js?v=1');
const CACHE=self.COMBAT_APP.cache;
const ASSETS=[
  './','./index.html','./manifest.webmanifest','./privacy.html',
  './icon-192.png','./icon-512.png','./app-config.js?v=1','./data-safety.js?v=1',
  './equipment-icons.js?v=7','./quantity-shortcut.js?v=2','./history-collapse.js?v=1',
  './attendance.js?v=8','./contacts-count.js?v=2','./returns.js?v=2','./app-lifecycle.js?v=1'
];

self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('combat-equipment-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting()});

async function navigation(request){
  try{const response=await fetch(request);if(response?.ok){const cache=await caches.open(CACHE);cache.put('./index.html',response.clone())}return response}
  catch{return(await caches.match('./index.html'))||(await caches.match('./'))||Response.error()}
}
async function asset(request){
  const cached=await caches.match(request);if(cached)return cached;
  try{const response=await fetch(request);if(response?.ok){const cache=await caches.open(CACHE);cache.put(request,response.clone())}return response}catch{return Response.error()}
}
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;event.respondWith(event.request.mode==='navigate'?navigation(event.request):asset(event.request))});
