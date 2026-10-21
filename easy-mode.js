// Easy mode: quick assignment by trainee, folding of completed equipment, and a jump to the next unchecked unit.
(function(root){
  'use strict';
  const norm=s=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('he');

  // Gives unit i of eq to target, or takes it back when target already holds it.
  // Returns 'assigned', 'removed', 'moved' or '' (nothing changed). ask(holderName) decides whether to move a unit held by someone else.
  function applyQuickTap(eq,i,target,ask=()=>false){
    target=String(target||'').trim();
    if(!eq||!target||!Number.isInteger(i)||i<0||i>=eq.qty)return '';
    eq.assignments=Array.isArray(eq.assignments)?eq.assignments:[];
    const holder=eq.assignments.find(a=>Array.isArray(a.units)&&a.units.includes(i));
    const mine=holder&&norm(holder.name)===norm(target);
    if(holder&&!mine&&!ask(holder.name))return '';
    if(holder){
      holder.units=holder.units.filter(n=>n!==i);holder.qty=holder.units.length;
      if(holder.qty<1)eq.assignments.splice(eq.assignments.indexOf(holder),1);
    }
    if(mine){eq.checked[i]=false;return 'removed'}
    const own=eq.assignments.find(a=>norm(a.name)===norm(target)&&Array.isArray(a.units)&&a.carriedFromWorkoutId===undefined);
    if(own){own.units=[...own.units,i].sort((a,b)=>a-b);own.qty=own.units.length}
    else eq.assignments.push({name:target,qty:1,units:[i]});
    eq.checked[i]=true;
    return holder?'moved':'assigned';
  }
  root.CombatEasy={applyQuickTap};

  const list=root.document?.getElementById('equipmentList');
  if(!list||typeof state==='undefined'||typeof renderEquipment!=='function')return;

  const ATTENDANCE_KEY='combatEquipmentAttendanceV2',HISTORY_KEY='combatEquipmentHistoryV1';
  const escHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let quick=false,target='';
  const expanded=new Set();

  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
  // Current holders first, then today's attendance, then people from the last three workouts.
  function knownNames(){
    const out=[],seen=new Set(),add=name=>{name=String(name||'').trim();const key=norm(name);if(name&&!seen.has(key)){seen.add(key);out.push(name)}};
    state.equipment.forEach(eq=>(eq.assignments||[]).forEach(a=>add(a.name)));
    const today=readJson(ATTENDANCE_KEY,{})?.current;(Array.isArray(today?.attending)?today.attending:[]).forEach(add);
    const history=readJson(HISTORY_KEY,[]);(Array.isArray(history)?history.slice(0,3):[]).forEach(w=>(w?.people||[]).forEach(p=>add(p?.name)));
    if(target)add(target);
    return out;
  }
  function carriedBy(name){
    const items=[];state.equipment.forEach(eq=>{const n=(eq.assignments||[]).filter(a=>norm(a.name)===norm(name)).reduce((s,a)=>s+Number(a.qty||0),0);if(n)items.push(`${n} ${eq.name}`)});
    return items;
  }

  // UI
  const bar=document.createElement('div');bar.id='quickAssign';bar.className='quick-assign';
  bar.innerHTML=`<button type="button" class="btn quick-toggle" id="quickToggle"><span aria-hidden="true">⚡</span> שיוך מהיר לפי מתאמן</button>
  <div class="quick-panel" id="quickPanel" hidden>
    <div class="quick-head"><b>למי מחלקים עכשיו?</b><button type="button" class="btn small" id="quickDone">סיום</button></div>
    <div class="quick-names" id="quickNames" role="listbox" aria-label="בחירת מתאמן"></div>
    <form class="quick-new" id="quickNew"><input class="input" id="quickNewName" placeholder="שם חדש…" autocomplete="off" enterkeyhint="done"><button class="btn small" type="submit">הוסף</button></form>
    <div class="quick-hint" id="quickHint" aria-live="polite"></div>
  </div>`;
  list.parentNode.insertBefore(bar,list);
  const panel=bar.querySelector('#quickPanel'),namesBox=bar.querySelector('#quickNames'),hint=bar.querySelector('#quickHint');

  function renderQuick(){
    bar.querySelector('#quickToggle').hidden=quick;panel.hidden=!quick;document.body.classList.toggle('quick-mode',quick);
    if(!quick)return;
    const names=knownNames();
    namesBox.innerHTML=names.length?names.map(n=>`<button type="button" class="quick-name ${norm(n)===norm(target)?'selected':''}" role="option" aria-selected="${norm(n)===norm(target)}" data-name="${encodeURIComponent(n)}">${escHtml(n)}</button>`).join(''):'<span class="quick-empty">אין עדיין שמות — הוסיפו שם חדש</span>';
    namesBox.querySelectorAll('.quick-name').forEach(b=>b.onclick=()=>{target=decodeURIComponent(b.dataset.name);renderEquipment();renderQuick()});
    if(!target){hint.textContent='בחרו מתאמן, ואז לחצו על מספרי הציוד שהוא לוקח.';return}
    const items=carriedBy(target);
    hint.innerHTML=`<b>${escHtml(target)}</b> · ${items.length?'אצלו: '+escHtml(items.join(', ')):'עוד לא לקח ציוד'}<span class="quick-sub">לחיצה על מספר נותנת לו אותו · לחיצה נוספת מחזירה</span>`;
  }
  bar.querySelector('#quickToggle').onclick=()=>{quick=true;renderEquipment();renderQuick();bar.scrollIntoView({behavior:'smooth',block:'start'})};
  bar.querySelector('#quickDone').onclick=()=>{quick=false;target='';renderEquipment();renderQuick()};
  bar.querySelector('#quickNew').onsubmit=event=>{
    event.preventDefault();const input=bar.querySelector('#quickNewName'),name=input.value.trim();if(!name)return;
    target=knownNames().find(n=>norm(n)===norm(name))||name;input.value='';input.blur();renderEquipment();renderQuick();
  };

  const baseToggle=root.toggleUnit;
  root.toggleUnit=(id,i)=>{
    if(!quick||!target)return baseToggle(id,i);
    const eq=state.equipment.find(x=>x.id===id);
    const result=applyQuickTap(eq,i,target,holder=>confirm(`${eq.name} מספר ${i+1} אצל ${holder}. להעביר ל־${target}?`));
    if(!result)return;
    if(typeof rememberTrainee==='function')rememberTrainee(target);
    save();renderQuick();
    root.navigator?.vibrate?.(result==='removed'?[12,40,12]:15);
  };

  // Next unchecked unit
  function nextIndex(){return state.equipment.findIndex(eq=>eq.checked.some(v=>!v))}
  function ensureNextButton(){
    let btn=document.getElementById('nextUnitBtn');if(btn)return btn;
    const hero=document.querySelector('#workoutHero > div:first-child');if(!hero)return null;
    btn=document.createElement('button');btn.type='button';btn.id='nextUnitBtn';btn.className='next-unit-btn';btn.innerHTML='<span aria-hidden="true">⬇</span> לציוד הבא';
    btn.onclick=jumpToNext;hero.appendChild(btn);return btn;
  }
  function jumpToNext(){
    const index=nextIndex();if(index<0)return;
    let card=list.querySelectorAll(':scope > .card')[index];
    if(card&&card.offsetParent===null){const search=document.querySelector('.equipment-search input');if(search&&search.value){search.value='';search.dispatchEvent(new Event('input',{bubbles:true}))}card=list.querySelectorAll(':scope > .card')[index]}
    if(!card)return;
    card.scrollIntoView({behavior:'smooth',block:'center'});
    const unit=card.querySelectorAll('.units .unit')[state.equipment[index].checked.indexOf(false)];
    if(unit){unit.classList.remove('next-pulse');void unit.offsetWidth;unit.classList.add('next-pulse');setTimeout(()=>unit.classList.remove('next-pulse'),1900)}
  }

  // Folding completed equipment
  const baseRender=renderEquipment;
  renderEquipment=function(){
    baseRender();
    list.querySelectorAll(':scope > .card').forEach((card,index)=>{
      const eq=state.equipment[index];if(!eq)return;
      const done=eq.qty>0&&eq.checked.every(Boolean),head=card.querySelector('.head');
      card.classList.toggle('is-complete',done);card.classList.toggle('is-folded',done&&!expanded.has(eq.id));
      if(done&&head){
        head.insertAdjacentHTML('beforeend','<span class="fold-mark" aria-hidden="true">✓</span>');
        head.setAttribute('role','button');head.setAttribute('aria-expanded',String(expanded.has(eq.id)));
        head.onclick=event=>{if(event.target.closest('.count'))return;if(expanded.has(eq.id))expanded.delete(eq.id);else expanded.add(eq.id);renderEquipment()};
      }
      if(quick&&target)card.querySelectorAll('.units .unit').forEach((b,i)=>{const h=(eq.assignments||[]).find(a=>Array.isArray(a.units)&&a.units.includes(i));b.classList.toggle('quick-mine',!!h&&norm(h.name)===norm(target))});
    });
    const btn=ensureNextButton();if(btn)btn.hidden=nextIndex()<0;
  };

  const style=document.createElement('style');style.textContent=`
  .quick-assign{margin:0 0 10px}.quick-toggle{width:100%;min-height:50px}
  .quick-panel{position:sticky;top:calc(6px + env(safe-area-inset-top));z-index:30;padding:12px;border-radius:18px;border:1px solid rgba(255,148,67,.5);background:rgba(14,20,16,.97);box-shadow:0 14px 36px rgba(0,0,0,.6),0 0 0 3px rgba(255,122,26,.08);backdrop-filter:blur(16px)}
  .quick-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.quick-head b{font-size:16px}
  .quick-names{display:flex;gap:7px;overflow-x:auto;padding:2px 2px 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch}.quick-names::-webkit-scrollbar{display:none}
  .quick-name{flex:0 0 auto;min-height:42px;padding:8px 15px;border-radius:999px;border:1px solid #3a5244;background:#121a15;color:#eef3ef;font:inherit;font-weight:800;white-space:nowrap}
  .quick-name.selected{background:linear-gradient(160deg,#ff9443,#f05f00);border-color:#ffb27a;color:#1b0d03;box-shadow:0 6px 18px rgba(255,110,10,.35)}
  .quick-empty{color:#93a198;font-size:13px;padding:10px 2px}
  .quick-new{display:grid;grid-template-columns:1fr auto;gap:7px;margin-top:2px}.quick-new .input{padding:10px 12px;min-height:42px}
  .quick-hint{margin-top:9px;font-size:13px;color:#dfe7e1}.quick-hint b{color:#ffb27a}.quick-sub{display:block;color:#93a198;font-size:11px;margin-top:3px}
  body.quick-mode #equipmentList .actions,body.quick-mode #equipmentList .assigns{display:none}
  .unit.quick-mine{outline:3px solid #fff;outline-offset:2px}
  .card.is-folded>:not(.head){display:none!important}
  .card.is-complete .head{cursor:pointer}.card.is-folded{opacity:.82}.card.is-folded .head{padding-block:10px}
  .fold-mark{display:grid;place-items:center;width:30px;height:30px;flex:0 0 auto;border-radius:50%;background:rgba(94,224,138,.16);border:1px solid rgba(94,224,138,.5);color:#8ff0ad;font-weight:900;margin-inline-start:6px}
  .next-unit-btn{margin-top:8px;min-height:36px;padding:6px 13px;border-radius:999px;border:1px solid rgba(255,148,67,.55);background:rgba(255,122,26,.12);color:#ffb27a;font:inherit;font-size:13px;font-weight:800}
  .next-unit-btn[hidden]{display:none}
  .unit.next-pulse{animation:ce-next 0.6s ease-in-out 3}
  @keyframes ce-next{50%{transform:scale(1.15);box-shadow:0 0 0 4px rgba(255,122,26,.55),0 0 22px rgba(255,122,26,.7)}}
  @media(prefers-reduced-motion:reduce){.unit.next-pulse{animation:none;outline:3px solid #ff9443}}
  `;document.head.appendChild(style);

  renderEquipment();renderQuick();
  // The hero is added by native-ui once the page settles; place the button as soon as it exists.
  const placeNext=()=>{const btn=ensureNextButton();if(btn)btn.hidden=nextIndex()<0};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',placeNext,{once:true});else requestAnimationFrame(placeNext);
})(typeof window!=='undefined'?window:globalThis);
