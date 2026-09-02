// Extra shortcut: tap the 0/4 counter to change equipment quantity.
(function(){
  const originalRenderEquipment=renderEquipment;
  renderEquipment=function(){
    originalRenderEquipment();
    document.querySelectorAll('#equipmentList .card').forEach((card,index)=>{
      const eq=state.equipment[index];
      const count=card.querySelector('.count');
      if(!eq||!count)return;
      count.setAttribute('role','button');
      count.setAttribute('tabindex','0');
      count.setAttribute('aria-label','שינוי כמות '+eq.name);
      count.title='לחץ לשינוי כמות';
      count.onclick=()=>changeQty(eq.id);
      count.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();changeQty(eq.id)}};
    });
  };
  const s=document.createElement('style');
  s.textContent='.count{cursor:pointer}.count:active{transform:scale(.97)}';
  document.head.appendChild(s);
  document.querySelectorAll('.app-version,.app-version-fixed').forEach(el=>el.remove());
  const appTitle=document.querySelector('.headline h1');
  if(appTitle){const version=document.createElement('span');version.className='app-version-fixed';version.dir='ltr';version.textContent='v1.2.4';appTitle.append(' ',version)}
  renderEquipment();
})();