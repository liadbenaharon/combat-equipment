(function(){
  'use strict';
  const app=window.COMBAT_APP||{version:'unknown'};
  function announce(message,type='info'){
    let node=document.getElementById('appStatus');
    if(!node){node=document.createElement('div');node.id='appStatus';node.className='app-status';node.setAttribute('role','status');node.setAttribute('aria-live','polite');document.body.appendChild(node)}
    node.dataset.type=type;node.textContent=message;node.hidden=false;
  }
  function setVersion(){
    const title=document.querySelector('.headline h1');if(!title)return;
    document.querySelectorAll('.app-version,.app-version-fixed').forEach(el=>el.remove());
    const version=document.createElement('span');version.className='app-version-fixed';version.dir='ltr';version.textContent=`v${app.version}`;title.append(' ',version);
  }
  function addDataTools(){
    const summary=document.getElementById('summary');if(!summary||document.getElementById('dataTools'))return;
    const card=document.createElement('section');card.id='dataTools';card.className='card data-tools';card.setAttribute('aria-labelledby','dataToolsTitle');
    card.innerHTML='<h2 id="dataToolsTitle">גיבוי ופרטיות</h2><p class="mini">המידע נשמר רק במכשיר הזה. מומלץ להוריד גיבוי מדי פעם.</p><div class="data-tool-actions"><button type="button" class="btn" id="exportData">הורדת גיבוי</button><label class="btn import-label">שחזור מגיבוי<input id="importData" type="file" accept="application/json,.json"></label></div><p><a href="./privacy.html">מדיניות פרטיות</a></p>';
    summary.appendChild(card);
    document.getElementById('exportData').onclick=()=>{
      try{const blob=new Blob([JSON.stringify(CombatData.exportBackup(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`combat-equipment-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),0);announce('הגיבוי הורד בהצלחה')}
      catch{announce('לא ניתן ליצור גיבוי. ייתכן שחלק מהנתונים פגומים.','error')}
    };
    document.getElementById('importData').onchange=async event=>{
      const input=event.currentTarget,file=input.files?.[0];if(!file)return;
      try{const payload=JSON.parse(await file.text());CombatData.validateBackup(payload);if(!confirm('השחזור יחליף נתונים קיימים שנמצאים בגיבוי. להמשיך?'))return;CombatData.importBackup(payload);announce('הגיבוי שוחזר. האפליקציה נטענת מחדש.');setTimeout(()=>location.reload(),500)}
      catch(error){announce(error?.message||'לא ניתן לשחזר את הגיבוי','error')}finally{input.value=''}
    };
  }
  function addUpdateButton(registration){
    let button=document.getElementById('appUpdate');if(button)return;
    button=document.createElement('button');button.id='appUpdate';button.className='app-update';button.textContent='יש עדכון חדש — לחצו לעדכון';button.onclick=()=>registration.waiting?.postMessage({type:'SKIP_WAITING'});document.body.appendChild(button);
  }
  function registerWorker(){
    if(!('serviceWorker' in navigator))return;
    let refreshing=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;refreshing=true;location.reload()});
    navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(registration=>{
      if(registration.waiting)addUpdateButton(registration);
      registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)addUpdateButton(registration)})});
    }).catch(()=>announce('האפליקציה פועלת, אך מצב לא־מקוון אינו זמין כרגע.','error'));
  }
  function updateNetwork(){document.documentElement.classList.toggle('is-offline',!navigator.onLine);announce(navigator.onLine?'החיבור חזר':'אין חיבור — עובדים מהמידע השמור',navigator.onLine?'info':'offline')}
  function improveDialogs(){
    document.querySelectorAll('.overlay').forEach(overlay=>{overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-hidden',String(!overlay.classList.contains('show')))});
    new MutationObserver(records=>records.forEach(record=>{const overlay=record.target;overlay.setAttribute('aria-hidden',String(!overlay.classList.contains('show')))})).observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});
    document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const open=document.querySelector('.overlay.show');if(open){open.classList.remove('show');open.querySelector('input,button')?.blur()}});
  }
  function addReleaseStyles(){
    const style=document.createElement('style');style.textContent=`
      :focus-visible{outline:3px solid #ffb36f;outline-offset:3px}
      button,.btn,input,select,textarea{min-height:44px}
      .app-status{position:fixed;z-index:120;inset:auto 12px calc(92px + env(safe-area-inset-bottom)) 12px;max-width:560px;margin:auto;padding:11px 16px;border-radius:12px;background:#26301f;border:1px solid #718360;box-shadow:0 8px 24px #0008;text-align:center;font-weight:800}
      .app-status[data-type="error"]{background:#4a211d;border-color:#d17669}.app-status[data-type="offline"]{background:#443819;border-color:#b89a43}
      .app-update{position:fixed;z-index:130;inset:12px 12px auto 12px;max-width:560px;margin:auto;padding:13px 18px;border:0;border-radius:14px;background:#f07a22;color:#17110d;font:inherit;font-weight:900;box-shadow:0 8px 28px #000a}
      .data-tools{margin-top:18px}.data-tools h2{margin-top:0}.data-tool-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.import-label{display:grid;place-items:center;cursor:pointer}.import-label input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
      .floating{padding-bottom:max(12px,env(safe-area-inset-bottom))}
      @media(max-width:420px){.data-tool-actions{grid-template-columns:1fr}.headline{align-items:flex-start}.headline h1{font-size:19px}.badge{font-size:11px}.floating{gap:7px}.floating .btn{font-size:13px;padding-inline:9px}}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
    `;document.head.appendChild(style);
  }
  function hardenDataLayer(){
    if(typeof state!=='undefined'&&typeof defaults!=='undefined')state=CombatData.normalizeState(state,defaults);
    if(typeof save==='function')save=function(){if(!CombatData.writeJson(CombatData.KEYS.state,state)){announce('השינוי לא נשמר. הורידו גיבוי ונסו לפנות מקום במכשיר.','error');return false}renderAll();return true};
    if(typeof histories==='function')histories=()=>CombatData.loadHistory();
    renderAll?.();
  }
  function start(){hardenDataLayer();setVersion();addDataTools();addReleaseStyles();improveDialogs();registerWorker();window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);if(!navigator.onLine)updateNetwork();window.addEventListener('combat-storage-error',()=>announce('השינוי לא נשמר. הורידו גיבוי ונסו לפנות מקום במכשיר.','error'))}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
