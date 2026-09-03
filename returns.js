// Equipment return mode: track returned units, warn about missing gear, and highlight absent assignees.
(function(){
  const RETURN_KEY='combatEquipmentReturnsV1';
  const ATTENDANCE_KEY='combatEquipmentAttendanceV2';
  const norm=s=>String(s||'').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'').trim().replace(/\s+/g,' ').toLocaleLowerCase('he');
  let returnMode=false;
  function data(){try{return JSON.parse(localStorage.getItem(RETURN_KEY)||'{}')}catch{return {}}}
  function write(d){localStorage.setItem(RETURN_KEY,JSON.stringify(d))}
  function key(eq,i){return `${eq.id}:${i}`}
  function isReturned(eq,i){return !!data()[key(eq,i)]}
  function toggle(eq,i){const d=data(),k=key(eq,i);d[k]=!d[k];write(d);renderReturns()}
  function total(){return state.equipment.reduce((n,e)=>n+e.qty,0)}
  function returned(){return state.equipment.reduce((n,e)=>n+Array.from({length:e.qty},(_,i)=>isReturned(e,i)).filter(Boolean).length,0)}
  function attendance(){try{return JSON.parse(localStorage.getItem(ATTENDANCE_KEY)||'{}').current||{absent:[]}}catch{return {absent:[]}}}
  function absent(name){return (attendance().absent||[]).some(x=>norm(x)===norm(name))}
  function holders(eq){return (eq.assignments||[]).map(a=>`${a.name}${absent(a.name)?' ⚠️ לא מגיע':''}`).join(', ')}
  function missing(){return state.equipment.map(eq=>{const nums=[];for(let i=0;i<eq.qty;i++)if(!isReturned(eq,i))nums.push(i+1);return {eq,nums}}).filter(x=>x.nums.length)}
  function ensureUI(){
    if(document.getElementById('returnPanel'))return;
    const check=document.getElementById('check');if(!check)return;
    const panel=document.createElement('div');panel.id='returnPanel';panel.innerHTML=`<div class="return-launch"><button id="returnModeBtn" class="btn">↩️ החזרת ציוד</button></div><div id="returnArea" hidden><div class="return-summary"><strong id="returnCount">0/0</strong><span>הוחזרו</span></div><div id="returnList"></div></div>`;check.insertBefore(panel,document.getElementById('equipmentList'));
    document.getElementById('returnModeBtn').onclick=()=>{returnMode=!returnMode;renderReturns()};
    const style=document.createElement('style');style.textContent=`.return-launch{margin:12px 0}.return-launch .btn{width:100%;border-color:#7da866}.return-summary{display:flex;justify-content:space-between;align-items:center;background:#182017;border:1px solid #526a48;border-radius:14px;padding:13px 15px;margin:10px 0}.return-summary strong{font-size:24px;color:#a8d58e}.return-summary span{font-weight:900}.return-card{padding:13px}.return-head{display:flex;justify-content:space-between;gap:10px;align-items:center}.return-units{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}.return-unit{width:42px;height:42px;border-radius:10px;border:1px solid #65705b;background:#151a13;color:#ddd;font-weight:900}.return-unit.back{background:#527a43;border-color:#78a867;color:#fff}.missing-note{font-size:12px;color:#ffb4ac;margin-top:8px}.absent-warning{border-color:#b45c35!important;box-shadow:inset 4px 0 #f07a22}.absent-label{display:inline-block;margin-top:6px;color:#ffb36e;font-size:12px;font-weight:900}`;document.head.appendChild(style);
  }
  function renderReturns(){
    ensureUI();const area=document.getElementById('returnArea'),btn=document.getElementById('returnModeBtn');if(!area)return;
    area.hidden=!returnMode;btn.textContent=returnMode?'✕ סגור מצב החזרה':'↩️ החזרת ציוד';
    document.getElementById('returnCount').textContent=`${returned()}/${total()}`;
    document.getElementById('returnList').innerHTML=state.equipment.map(eq=>{const r=Array.from({length:eq.qty},(_,i)=>isReturned(eq,i)).filter(Boolean).length;return `<div class="card return-card"><div class="return-head"><div><div class="name">${esc(eq.name)}</div><div class="sub">${r}/${eq.qty} הוחזרו</div></div><div class="count">${r}/${eq.qty}</div></div><div class="return-units">${Array.from({length:eq.qty},(_,i)=>`<button class="return-unit ${isReturned(eq,i)?'back':''}" data-return-eq="${esc(eq.id)}" data-return-i="${i}">${isReturned(eq,i)?'✓':i+1}</button>`).join('')}</div>${eq.assignments?.length?`<div class="missing-note">משויך: ${esc(holders(eq))}</div>`:''}</div>`}).join('');
    document.querySelectorAll('[data-return-eq]').forEach(b=>b.onclick=()=>{const eq=state.equipment.find(e=>e.id===b.dataset.returnEq);if(eq)toggle(eq,Number(b.dataset.returnI))});
    decorateAbsent();
  }
  function decorateAbsent(){
    document.querySelectorAll('.assignment').forEach(row=>{const p=row.querySelector('.person');if(!p)return;const isAbs=absent(p.textContent);row.classList.toggle('absent-warning',isAbs);let tag=row.querySelector('.absent-label');if(isAbs&&!tag){tag=document.createElement('div');tag.className='absent-label';tag.textContent='⚠️ מסומן כלא מגיע';p.parentElement.appendChild(tag)}else if(!isAbs&&tag)tag.remove()});
  }
  window.combatReturnMissing=missing;
  window.combatOpenReturnMode=()=>{returnMode=true;document.querySelector('[data-tab="check"]')?.click();renderReturns();document.getElementById('returnPanel')?.scrollIntoView({behavior:'smooth',block:'start'})};
  window.combatConfirmFinish=()=>{const m=missing();if(!m.length)return true;returnMode=true;renderReturns();const lines=m.map(x=>`${x.eq.name}: חסרות ${x.nums.length}${x.eq.assignments?.length?` · אצל ${holders(x.eq)}`:''}`);alert(`⚠️ עדיין חסר ציוד\n\n${lines.join('\n')}\n\nסמן את הציוד שחזר לפני סיום האימון.`);setTimeout(()=>document.getElementById('returnPanel')?.scrollIntoView({behavior:'smooth',block:'start'}),50);return false};
  window.combatResetReturns=()=>localStorage.removeItem(RETURN_KEY);
  const oldRender=window.renderAll;window.renderAll=function(){oldRender?.();renderReturns();setTimeout(decorateAbsent,0)};
  ensureUI();renderReturns();
  window.addEventListener('storage',()=>{renderReturns();decorateAbsent()});
  document.addEventListener('click',()=>setTimeout(decorateAbsent,0));
})();
