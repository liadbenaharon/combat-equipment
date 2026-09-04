(function(){
  'use strict';
  const APP=window.COMBAT_APP||{version:'unknown'};
  const nav={check:['✓','ציוד'],summary:['👥','סיכום'],history:['◷','היסטוריה'],attendance:['?','נוכחות']};
  let installPrompt=null,toastTimer=0;
  let undoTimer=0;

  function toast(message,type='info',duration=2600){
    let node=document.getElementById('appToast');if(!node){node=document.createElement('div');node.id='appToast';node.className='app-toast';node.setAttribute('role','status');node.setAttribute('aria-live','polite');document.body.appendChild(node)}
    clearTimeout(toastTimer);node.textContent=String(message);node.className=`app-toast ${type}`;requestAnimationFrame(()=>node.classList.add('show'));toastTimer=setTimeout(()=>node.classList.remove('show'),duration);
  }
  window.showCombatToast=toast;

  function offerUndo(previous){
    let bar=document.getElementById('undoBar');if(!bar){bar=document.createElement('div');bar.id='undoBar';bar.className='undo-bar';bar.setAttribute('role','status');bar.innerHTML='<span>השינוי נשמר</span><button type="button">ביטול</button>';document.body.appendChild(bar)}
    clearTimeout(undoTimer);bar.hidden=false;requestAnimationFrame(()=>bar.classList.add('show'));bar.querySelector('button').onclick=()=>{state=CombatData.normalizeState(previous,defaults);if(CombatData.writeJson(CombatData.KEYS.state,state)){renderAll();window.dispatchEvent(new CustomEvent('combat-state-restored'));toast('השינוי בוטל');bar.classList.remove('show');setTimeout(()=>bar.hidden=true,220)}};undoTimer=setTimeout(()=>{bar.classList.remove('show');setTimeout(()=>bar.hidden=true,220)},7000);
  }

  function decorateNav(){
    document.querySelectorAll('.tab[data-tab]').forEach(button=>{const meta=nav[button.dataset.tab];if(!meta)return;if(!button.dataset.nativeReady){button.dataset.nativeReady='1';button.innerHTML=`<span class="tab-icon" aria-hidden="true">${meta[0]}</span><span>${meta[1]}</span>`}button.setAttribute('role','tab');button.setAttribute('aria-controls',button.dataset.tab);const panel=document.getElementById(button.dataset.tab);if(panel){panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id||(button.id=`tab-${button.dataset.tab}`))}});
    document.querySelectorAll('.tab').forEach(button=>button.setAttribute('aria-selected',String(button.classList.contains('active'))));
  }
  function selectTab(id,focus=false){
    const button=document.querySelector(`.tab[data-tab="${id}"]`);if(!button)return false;button.click();decorateNav();document.body.dataset.activeTab=id;document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected',String(x===button)));history.replaceState(null,'',`#${id}`);if(focus)button.focus();window.scrollTo({top:0,behavior:'smooth'});return true;
  }
  function bindNavigation(){
    const tabs=document.querySelector('.tabs');tabs?.setAttribute('role','tablist');tabs?.addEventListener('click',event=>{const button=event.target.closest('.tab[data-tab]');if(!button)return;setTimeout(()=>{document.body.dataset.activeTab=button.dataset.tab;document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected',String(x===button)));history.replaceState(null,'',`#${button.dataset.tab}`)},0)});
    tabs?.addEventListener('keydown',event=>{if(!['ArrowRight','ArrowLeft'].includes(event.key))return;const buttons=[...tabs.querySelectorAll('.tab')],at=buttons.indexOf(document.activeElement),next=(at+(event.key==='ArrowLeft'?1:-1)+buttons.length)%buttons.length;event.preventDefault();selectTab(buttons[next].dataset.tab,true)});
    const requested=location.hash.slice(1);document.body.dataset.activeTab=document.querySelector('.tab.active')?.dataset.tab||'check';if(requested)setTimeout(()=>selectTab(requested),0);
  }
  function addHero(){
    const check=document.getElementById('check'),bar=check?.querySelector('.summaryBar');if(!bar||document.getElementById('workoutHero'))return;
    const hero=document.createElement('div');hero.id='workoutHero';hero.className='workout-hero';hero.innerHTML='<div><div class="workout-kicker">● אימון פעיל</div><div class="workout-title">מוכנים לצאת לאימון?</div></div><div class="workout-progress" id="workoutProgress"><span>0%</span></div>';check.insertBefore(hero,bar);
  }
  function updateHero(){
    const total=Number(document.getElementById('statTotal')?.textContent)||0,checked=Number(document.getElementById('statChecked')?.textContent)||0,pct=total?Math.round(checked/total*100):0,node=document.getElementById('workoutProgress');if(!node)return;node.style.setProperty('--progress',pct);node.querySelector('span').textContent=pct+'%';const title=document.querySelector('.workout-title');if(title)title.textContent=pct===100?'הציוד מוכן לאימון':checked?`עוד ${total-checked} יחידות לבדיקה`:'מוכנים לצאת לאימון?';
  }
  function addSearch(){
    const list=document.getElementById('equipmentList'),row=list?.previousElementSibling;if(!list||document.getElementById('equipmentSearch'))return;
    const wrap=document.createElement('div');wrap.className='equipment-search';wrap.innerHTML='<svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input id="equipmentSearch" class="input" type="search" placeholder="חיפוש ציוד" aria-label="חיפוש ציוד"><button type="button" class="equipment-search-clear" aria-label="נקה חיפוש" hidden>×</button>';row.after(wrap);const empty=document.createElement('div');empty.className='search-empty';empty.textContent='לא נמצא ציוד מתאים';list.after(empty);
    const filter=()=>{const q=wrap.querySelector('input').value.trim().toLocaleLowerCase('he');let visible=0;list.querySelectorAll(':scope > .card').forEach(card=>{const show=!q||card.textContent.toLocaleLowerCase('he').includes(q);card.hidden=!show;if(show)visible++});wrap.querySelector('button').hidden=!q;empty.classList.toggle('show',!!q&&!visible)};
    wrap.querySelector('input').addEventListener('input',filter);wrap.querySelector('button').onclick=()=>{wrap.querySelector('input').value='';filter();wrap.querySelector('input').focus()};new MutationObserver(filter).observe(list,{childList:true});
  }
  function decorateControls(){
    document.querySelectorAll('#equipmentList .unit').forEach(button=>{const card=button.closest('.card'),name=card?.querySelector('.name')?.textContent?.trim()||'ציוד',number=button.querySelector('.unit-number')?.textContent||button.textContent.trim(),person=button.querySelector('.unit-person')?.textContent?.trim();button.removeAttribute('aria-pressed');button.setAttribute('aria-label',person?`${name}, יחידה ${number}, משויכת ל־${person}. לחצו להסרת השיוך`:`${name}, יחידה ${number}. לחצו לשיוך למתאמן`)});
    updateHero();decorateNav();
  }
  function addAbout(){
    const summary=document.getElementById('summary'),tools=document.getElementById('dataTools');if(!summary||document.getElementById('aboutApp'))return;
    const card=document.createElement('section');card.id='aboutApp';card.className='card about-card';card.innerHTML=`<h2>האפליקציה שלי</h2><p class="mini">מותאמת לעבודה מהירה בשטח, בעברית וגם ללא אינטרנט.</p><div class="about-grid"><div class="about-metric"><span>גרסה מותקנת</span><strong dir="ltr">v${APP.version}</strong></div><div class="about-metric"><span>שמירת מידע</span><strong>במכשיר בלבד</strong></div></div><div class="release-note"><div><b>עדכון v${APP.version}</b><div class="mini">ביטול מהיר לטעויות, שמירה בטוחה וממשק Android חדש</div></div><span aria-hidden="true">✨</span></div><button id="installApp" class="btn primary install-app" hidden>התקנת האפליקציה במכשיר</button><button id="persistStorage" class="btn storage-persist">הגנה מוגברת על הנתונים</button>`;tools?summary.insertBefore(card,tools):summary.appendChild(card);
    document.getElementById('installApp').onclick=async()=>{if(!installPrompt)return;installPrompt.prompt();const result=await installPrompt.userChoice;if(result.outcome==='accepted')toast('האפליקציה הותקנה בהצלחה');installPrompt=null;document.getElementById('installApp').hidden=true};
    document.getElementById('persistStorage').onclick=async event=>{if(!navigator.storage?.persist){toast('הדפדפן הזה לא תומך בהגנה נוספת','error');return}const granted=await navigator.storage.persist();toast(granted?'הדפדפן אישר שמירה מוגנת':'הדפדפן מנהל את האחסון אוטומטית',granted?'info':'error');if(granted){event.currentTarget.textContent='✓ הנתונים מוגנים';event.currentTarget.disabled=true}};
    navigator.storage?.persisted?.().then(done=>{if(done){const b=document.getElementById('persistStorage');b.textContent='✓ הנתונים מוגנים';b.disabled=true}});
  }
  function bindInstall(){window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;const button=document.getElementById('installApp');if(button)button.hidden=false});window.addEventListener('appinstalled',()=>toast('האפליקציה הותקנה בהצלחה'))}
  function bindNativeFeedback(){document.addEventListener('click',event=>{if(event.target.closest('.unit,.return-check,[data-step]'))navigator.vibrate?.(12)});window.addEventListener('combat-state-saved',event=>offerUndo(event.detail.previous));window.addEventListener('error',()=>toast('משהו השתבש. הנתונים שלך נשמרו.','error',4200));window.addEventListener('unhandledrejection',()=>toast('לא הצלחנו להשלים את הפעולה. נסו שוב.','error',4200))}
  function start(){decorateNav();bindNavigation();addHero();addSearch();addAbout();bindInstall();bindNativeFeedback();decorateControls();const list=document.getElementById('equipmentList');if(list)new MutationObserver(decorateControls).observe(list,{childList:true,subtree:true,attributes:true,attributeFilter:['class']})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
