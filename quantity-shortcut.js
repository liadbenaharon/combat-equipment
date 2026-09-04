// Quantity wheel: tap the 0/4 counter to choose equipment quantity with a scroll wheel.
(function(){
  let wheelEquipmentId=null;
  let selectedQty=1;

  function ensureWheel(){
    if(document.getElementById('qtyWheelOverlay'))return;
    const overlay=document.createElement('div');
    overlay.id='qtyWheelOverlay';
    overlay.className='qty-wheel-overlay';
    overlay.innerHTML=`<div class="qty-wheel-sheet" role="dialog" aria-modal="true" aria-labelledby="qtyWheelTitle">
      <div class="qty-wheel-handle"></div>
      <h2 id="qtyWheelTitle">שינוי כמות</h2>
      <div id="qtyWheelSubtitle" class="qty-wheel-subtitle"></div>
      <div class="qty-wheel-wrap">
        <div class="qty-wheel-highlight"></div>
        <div id="qtyWheel" class="qty-wheel"></div>
      </div>
      <div class="qty-wheel-actions"><button id="qtyWheelCancel" class="btn">ביטול</button><button id="qtyWheelSave" class="btn primary">שמור</button></div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click',e=>{if(e.target===overlay)closeWheel()});
    document.getElementById('qtyWheelCancel').onclick=closeWheel;
    document.getElementById('qtyWheelSave').onclick=saveWheel;
    const wheel=document.getElementById('qtyWheel');
    wheel.innerHTML='<div class="qty-wheel-spacer"></div>'+Array.from({length:100},(_,i)=>`<button type="button" class="qty-wheel-item" data-value="${i+1}">${i+1}</button>`).join('')+'<div class="qty-wheel-spacer"></div>';
    wheel.querySelectorAll('.qty-wheel-item').forEach(item=>item.onclick=()=>{selectedQty=Number(item.dataset.value);scrollToQty(selectedQty,true)});
    let timer;
    wheel.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(updateSelectedFromScroll,70)},{passive:true});
  }

  function scrollToQty(qty,smooth=false){
    const wheel=document.getElementById('qtyWheel');
    const item=wheel.querySelector(`[data-value="${qty}"]`);
    if(!item)return;
    const top=item.offsetTop-(wheel.clientHeight-item.offsetHeight)/2;
    wheel.scrollTo({top,behavior:smooth?'smooth':'auto'});
    updateItemState(qty);
  }

  function updateSelectedFromScroll(){
    const wheel=document.getElementById('qtyWheel');
    const center=wheel.scrollTop+wheel.clientHeight/2;
    let best=null,bestDist=Infinity;
    wheel.querySelectorAll('.qty-wheel-item').forEach(item=>{const c=item.offsetTop+item.offsetHeight/2,d=Math.abs(c-center);if(d<bestDist){bestDist=d;best=item}});
    if(best){selectedQty=Number(best.dataset.value);updateItemState(selectedQty)}
  }

  function updateItemState(qty){
    document.querySelectorAll('.qty-wheel-item').forEach(item=>item.classList.toggle('selected',Number(item.dataset.value)===qty));
  }

  function openWheel(id){
    ensureWheel();
    const eq=state.equipment.find(e=>e.id===id);if(!eq)return;
    wheelEquipmentId=id;selectedQty=eq.qty;
    document.getElementById('qtyWheelSubtitle').textContent=`${eq.name} · כמות נוכחית ${eq.qty}`;
    document.getElementById('qtyWheelOverlay').classList.add('show');
    requestAnimationFrame(()=>requestAnimationFrame(()=>scrollToQty(eq.qty,false)));
  }

  function closeWheel(){document.getElementById('qtyWheelOverlay')?.classList.remove('show');wheelEquipmentId=null}

  function saveWheel(){
    const eq=state.equipment.find(e=>e.id===wheelEquipmentId);if(!eq)return closeWheel();
    const assignedQty=assigned(eq);
    if(selectedQty<assignedQty)return alert(`לא ניתן להקטין מתחת ל-${assignedQty}, כי יש ${assignedQty} יחידות משויכות`);
    const highestUsed=(eq.assignments||[]).flatMap(a=>Array.isArray(a.units)?a.units:[]).reduce((m,n)=>Math.max(m,n),-1)+1;
    if(selectedQty<highestUsed)return alert(`לא ניתן להקטין מתחת ל-${highestUsed}, כי יחידה מספר ${highestUsed} משויכת`);
    eq.qty=selectedQty;
    eq.checked=[...eq.checked.slice(0,selectedQty),...Array(Math.max(0,selectedQty-eq.checked.length)).fill(false)];
    closeWheel();save();
  }

  const originalRenderEquipment=renderEquipment;
  renderEquipment=function(){
    originalRenderEquipment();
    document.querySelectorAll('#equipmentList .card').forEach((card,index)=>{
      const eq=state.equipment[index],count=card.querySelector('.count');if(!eq||!count)return;
      count.setAttribute('role','button');count.setAttribute('tabindex','0');count.setAttribute('aria-label','בחירת כמות '+eq.name);count.title='לחץ לבחירת כמות';
      count.onclick=()=>openWheel(eq.id);
      count.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openWheel(eq.id)}};
    });
  };

  const s=document.createElement('style');
  s.textContent=`.count{cursor:pointer}.count:active{transform:scale(.97)}
  .qty-wheel-overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:90;display:none;align-items:flex-end;padding:12px}.qty-wheel-overlay.show{display:flex}
  .qty-wheel-sheet{width:min(720px,100%);margin:0 auto;background:#20261c;border:1px solid #535d4a;border-radius:22px 22px 14px 14px;padding:12px 16px 18px}.qty-wheel-handle{width:42px;height:5px;border-radius:999px;background:#697262;margin:0 auto 12px}.qty-wheel-sheet h2{margin:0;text-align:center;font-size:22px}.qty-wheel-subtitle{text-align:center;color:#b8baaf;font-size:13px;margin:6px 0 12px}
  .qty-wheel-wrap{position:relative;height:210px;overflow:hidden;border-top:1px solid #394234;border-bottom:1px solid #394234}.qty-wheel{height:210px;overflow-y:auto;scroll-snap-type:y mandatory;overscroll-behavior:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch}.qty-wheel::-webkit-scrollbar{display:none}.qty-wheel-spacer{height:78px}.qty-wheel-item{display:block;width:100%;height:54px;border:0;background:transparent;color:#858b81;font-size:24px;font-weight:800;scroll-snap-align:center}.qty-wheel-item.selected{color:#fff;font-size:32px}.qty-wheel-highlight{position:absolute;z-index:2;pointer-events:none;left:12px;right:12px;top:78px;height:54px;border-top:1px solid #f07a22;border-bottom:1px solid #f07a22;background:rgba(240,122,34,.08);border-radius:8px}.qty-wheel-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.header-app-image{width:26px;height:26px;object-fit:contain;display:block}`;
  document.head.appendChild(s);

  const installButton=document.getElementById('installBtn');
  if(installButton)installButton.remove();
  const badge=document.querySelector('.headline .badge');
  if(badge){
    badge.innerHTML='<img class="header-app-image" src="./icon-192.png" width="26" height="26" alt="ציוד אימון"><span>ציוד אימון</span>';
    badge.style.display='flex';badge.style.alignItems='center';badge.style.gap='7px';
  }

  document.querySelectorAll('.app-version,.app-version-fixed').forEach(el=>el.remove());
  const appTitle=document.querySelector('.headline h1');if(appTitle){const version=document.createElement('span');version.className='app-version-fixed';version.dir='ltr';version.textContent='v'+(window.COMBAT_APP?.version||'2.1.0');appTitle.append(' ',version)}
  renderEquipment();
})();
