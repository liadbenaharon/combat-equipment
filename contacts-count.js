// Keeps the WhatsApp contacts heading in sync with the locally saved contact count.
(function(){
  const CONTACTS_KEY='combatEquipmentContactsV1';
  const PHONE_KEY='combatEquipmentPhonesV1';

  function savedContactCount(){
    try{
      const raw=localStorage.getItem(CONTACTS_KEY);
      if(raw!==null){
        const contacts=JSON.parse(raw);
        return Array.isArray(contacts)?contacts.length:0;
      }
      const legacy=JSON.parse(localStorage.getItem(PHONE_KEY)||'{}');
      return legacy&&typeof legacy==='object'&&!Array.isArray(legacy)?Object.keys(legacy).length:0;
    }catch{return 0}
  }

  function updateCount(){
    const summary=document.querySelector('.contacts-card > summary');
    if(summary)summary.textContent=`אנשי קשר ל־WhatsApp (${savedContactCount()})`;
    const version=document.querySelector('.app-version-fixed');
    if(version)version.textContent='v1.3.9';
  }

  function attachObserver(){
    updateCount();
    const list=document.getElementById('contactsList');
    if(list){
      const observer=new MutationObserver(updateCount);
      observer.observe(list,{childList:true,subtree:true});
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attachObserver,{once:true});
  else attachObserver();
  window.addEventListener('storage',e=>{if(e.key===CONTACTS_KEY||e.key===PHONE_KEY||e.key===null)updateCount()});
})();
