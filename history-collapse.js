// Collapsible workout history: show details only after tapping a saved workout.
(function(){
  function enhanceHistory(){
    const list=document.getElementById('historyList');
    if(!list)return;
    list.querySelectorAll('.historyItem').forEach((item,index)=>{
      if(item.dataset.collapsibleReady==='1')return;
      item.dataset.collapsibleReady='1';
      const top=item.querySelector('.historyTop');
      if(!top)return;
      const detailNodes=[...item.children].filter(el=>el!==top);
      detailNodes.forEach(el=>el.classList.add('history-collapsible-detail'));
      item.classList.remove('history-expanded');
      top.setAttribute('role','button');
      top.setAttribute('tabindex','0');
      top.setAttribute('aria-expanded','false');
      const toggle=()=>{
        const open=item.classList.toggle('history-expanded');
        top.setAttribute('aria-expanded',String(open));
      };
      top.onclick=toggle;
      top.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}};
    });
  }
  const originalRenderHistory=window.renderHistory;
  if(typeof originalRenderHistory==='function'){
    window.renderHistory=function(){originalRenderHistory();enhanceHistory()};
  }
  const observer=new MutationObserver(enhanceHistory);
  const list=document.getElementById('historyList');
  if(list)observer.observe(list,{childList:true,subtree:true});
  const style=document.createElement('style');
  style.textContent='.history-collapsible-detail{display:none}.historyItem.history-expanded .history-collapsible-detail{display:block}.historyTop{cursor:pointer;padding:2px 0}.historyTop:after{content:"⌄";font-size:22px;color:#b8baaf;margin-right:8px;transition:transform .18s ease}.historyItem.history-expanded .historyTop:after{transform:rotate(180deg)}';
  document.head.appendChild(style);
  document.querySelectorAll('.app-version,.app-version-fixed').forEach(el=>el.remove());
  const appTitle=document.querySelector('.headline h1');
  if(appTitle){const version=document.createElement('span');version.className='app-version-fixed';version.dir='ltr';version.textContent='v1.2.6';appTitle.append(' ',version)}
  enhanceHistory();
})();