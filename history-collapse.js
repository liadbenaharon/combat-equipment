// Collapsible workout history + delete one saved workout safely.
(function(){
  const HISTORY_KEY='combatEquipmentHistoryV1';
  const ATTENDANCE_KEY='combatEquipmentAttendanceV2';
  function deleteOne(index){
    const h=typeof histories==='function'?histories():JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
    const item=h[index];if(!item)return;
    if(!confirm(`למחוק רק את האימון מ־${item.date||'ההיסטוריה'}?`))return;
    h.splice(index,1);localStorage.setItem(HISTORY_KEY,JSON.stringify(h));
    try{
      const all=JSON.parse(localStorage.getItem(ATTENDANCE_KEY)||'{}'),next={};
      Object.entries(all).forEach(([k,v])=>{
        const m=k.match(/^history-(\d+)$/);if(!m){next[k]=v;return}
        const i=Number(m[1]);if(i===index)return;next[`history-${i>index?i-1:i}`]=v;
      });
      localStorage.setItem(ATTENDANCE_KEY,JSON.stringify(next));
    }catch{}
    if(typeof renderHistory==='function')renderHistory();
  }
  function enhanceHistory(){
    const list=document.getElementById('historyList');if(!list)return;
    list.querySelectorAll('.historyItem').forEach((item,index)=>{
      const top=item.querySelector('.historyTop');if(!top)return;
      let actions=top.querySelector('.history-actions');
      if(!actions){actions=document.createElement('div');actions.className='history-actions';const del=document.createElement('button');del.className='history-delete-one';del.type='button';del.textContent='🗑️';del.title='מחק את האימון הזה';del.setAttribute('aria-label','מחק את האימון הזה');del.onclick=e=>{e.stopPropagation();deleteOne(index)};actions.appendChild(del);top.appendChild(actions)}else{const del=actions.querySelector('.history-delete-one');if(del)del.onclick=e=>{e.stopPropagation();deleteOne(index)}}
      if(item.dataset.collapsibleReady==='1')return;
      item.dataset.collapsibleReady='1';
      const detailNodes=[...item.children].filter(el=>el!==top);detailNodes.forEach(el=>el.classList.add('history-collapsible-detail'));
      item.classList.remove('history-expanded');top.setAttribute('role','button');top.setAttribute('tabindex','0');top.setAttribute('aria-expanded','false');
      const toggle=e=>{if(e?.target?.closest('.history-actions'))return;const open=item.classList.toggle('history-expanded');top.setAttribute('aria-expanded',String(open))};
      top.onclick=toggle;top.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&!e.target.closest('.history-actions')){e.preventDefault();toggle(e)}};
    });
  }
  const originalRenderHistory=window.renderHistory;if(typeof originalRenderHistory==='function'){window.renderHistory=function(){originalRenderHistory();enhanceHistory()}}
  const observer=new MutationObserver(enhanceHistory),list=document.getElementById('historyList');if(list)observer.observe(list,{childList:true,subtree:true});
  const style=document.createElement('style');style.textContent='.history-collapsible-detail{display:none}.historyItem.history-expanded .history-collapsible-detail{display:block}.historyTop{cursor:pointer;padding:2px 0;gap:8px}.historyTop:after{content:"⌄";font-size:22px;color:#b8baaf;margin-right:4px;transition:transform .18s ease}.historyItem.history-expanded .historyTop:after{transform:rotate(180deg)}.history-actions{margin-right:auto;display:flex;align-items:center}.history-delete-one{width:36px;height:36px;border-radius:10px;border:1px solid #74423d;background:#39211f;color:#ffd3ce;display:grid;place-items:center;font-size:15px;cursor:pointer}.history-delete-one:active{transform:scale(.96)}';document.head.appendChild(style);
  document.querySelectorAll('.app-version,.app-version-fixed').forEach(el=>el.remove());const appTitle=document.querySelector('.headline h1');if(appTitle){const version=document.createElement('span');version.className='app-version-fixed';version.dir='ltr';version.textContent='v1.4.0';appTitle.append(' ',version)}enhanceHistory();
})();