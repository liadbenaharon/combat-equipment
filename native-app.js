// Runs only inside the Google Play app (the Android shell injects window.CombatAndroid).
// Makes the web UI behave like a native app instead of a website.
(function(){
  'use strict';
  if(!window.CombatAndroid)return;
  const root=document.documentElement;
  root.classList.add('android-app');

  // The app is packaged inside the APK; drop any service worker and caches left from the website version.
  if('serviceWorker' in navigator)navigator.serviceWorker.getRegistrations().then(list=>list.forEach(r=>r.unregister())).catch(()=>{});
  if(window.caches)caches.keys().then(keys=>keys.filter(k=>k.startsWith('combat-equipment-')).forEach(k=>caches.delete(k))).catch(()=>{});

  const style=document.createElement('style');
  style.textContent=`
    html.android-app{-webkit-tap-highlight-color:transparent;overscroll-behavior:none;-webkit-text-size-adjust:100%}
    html.android-app body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;overscroll-behavior:none}
    html.android-app input,html.android-app textarea,html.android-app select,html.android-app [contenteditable="true"]{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}
    html.android-app img{-webkit-user-drag:none}
    html.android-app .app-update,html.android-app #installApp,html.android-app .install-app{display:none!important}
  `;
  document.head.appendChild(style);

  // Links that point at the website itself (privacy policy, account deletion) stay inside the app.
  document.addEventListener('click',event=>{const link=event.target.closest?.('a[target="_blank"]');if(link&&link.href.startsWith(location.origin+'/combat-equipment/'))link.removeAttribute('target')},true);

  // Called by the Android back gesture. Returns true when the app handled it.
  window.combatNativeBack=function(){
    const open=[...document.querySelectorAll('.overlay.show')].pop();
    if(open){open.classList.remove('show');return true}
    const first=document.querySelector('.tab[data-tab]'),active=document.querySelector('.tab.active');
    if(first&&active&&active!==first){first.click();window.scrollTo({top:0});return true}
    if(window.scrollY>200){window.scrollTo({top:0,behavior:'smooth'});return true}
    return false;
  };
})();
