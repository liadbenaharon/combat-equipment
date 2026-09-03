const CACHE='combat-equipment-v28-pwa';
const APP_SHELL=[
  '/combat-equipment/',
  '/combat-equipment/index.html',
  '/combat-equipment/manifest.webmanifest',
  '/combat-equipment/icon.svg',
  '/combat-equipment/icon-192.png',
  '/combat-equipment/icon-512.png',
  '/combat-equipment/equipment-icons.js?v=7',
  '/combat-equipment/quantity-shortcut.js?v=2',
  '/combat-equipment/history-collapse.js?v=1',
  '/combat-equipment/attendance.js?v=8',
  '/combat-equipment/contacts-count.js?v=1'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  event.respondWith(
    fetch(event.request).then(response=>{
      if(response&&response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
      }
      return response;
    }).catch(async()=>{
      const cached=await caches.match(event.request);
      if(cached)return cached;
      if(event.request.mode==='navigate')return caches.match('/combat-equipment/index.html');
      return Response.error();
    })
  );
});
