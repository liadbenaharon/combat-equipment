// Workout attendance manager: choose an existing workout, paste attendance, and show only no-shows who have gear.
(function(){
  const ATTENDANCE_KEY='combatEquipmentAttendanceV2';
  const RETURN_KEY='combatEquipmentReturnsV1';
  const PHONE_KEY='combatEquipmentPhonesV1';
  const SELECTED_WORKOUT_KEY='combatEquipmentAttendanceWorkoutV1';
  const clean=s=>String(s||'').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'').replace(/[*.]/g,'').replace(/^\s*\d+[.)]?\s*/,'').replace(/^\s*[⁠•\-–—]+\s*/,'').trim();
  const norm=s=>clean(s).replace(/\s+/g,' ').toLocaleLowerCase('he');
  let selectedWorkout='current';
  function setSelectedWorkout(key){selectedWorkout=String(key||'current');localStorage.setItem(SELECTED_WORKOUT_KEY,selectedWorkout)}
  function historyItems(){try{return typeof histories==='function'?histories():JSON.parse(localStorage.getItem('combatEquipmentHistoryV1')||'[]')}catch{return []}}
  function latestWorkoutKey(){const latest=historyItems()[0];return latest?`history:${latest.id||0}`:'current'}
  selectedWorkout=latestWorkoutKey();
  function workoutOptions(){const h=historyItems();return [{key:'current',label:'האימון הנוכחי',equipment:Array.isArray(state?.equipment)?state.equipment:[]}].concat(h.map((x,i)=>({key:`history:${x.id||i}`,legacyKey:'history-'+i,label:(i===0?'האימון האחרון · ':'')+(x?.date||`אימון ${i+1}`),equipment:Array.isArray(x?.equipment)?x.equipment:[]})))}
  function selectedInfo(){const opts=workoutOptions();return opts.find(x=>x.key===selectedWorkout)||opts[0]||{key:'current',label:'האימון הנוכחי',equipment:[]}}
  function allData(){try{return JSON.parse(localStorage.getItem(ATTENDANCE_KEY)||'{}')}catch{return {}}}
  function getSelected(){const all=allData(),info=selectedInfo(),d=all[selectedWorkout]||all[info.legacyKey];return d&&Array.isArray(d.attending)&&Array.isArray(d.absent)?d:{attending:[],absent:[],raw:''}}
  function saveSelected(data){const all=allData(),info=selectedInfo(),previous=all[selectedWorkout]||all[info.legacyKey]||{},next={...data};if(next.asked===undefined&&previous.asked!==undefined)next.asked=previous.asked;if(next.transfers===undefined&&previous.transfers!==undefined)next.transfers=previous.transfers;all[selectedWorkout]=next;if(info.legacyKey)delete all[info.legacyKey];localStorage.setItem(ATTENDANCE_KEY,JSON.stringify(all));renderAttendance();checkAssignedNoShows()}
  function parseList(text){const lines=String(text||'').split(/\r?\n/);let mode='';const attending=[],absent=[];for(const raw of lines){const line=clean(raw);if(!line)continue;const n=norm(line);if(n.includes('נרשמו באפליקציה')){mode='attending';continue}if(n.includes('לא מגיעים')){mode='absent';continue}if(!mode)continue;const name=clean(line);if(!name||/^(מיקום|שעת|ציוד|אימון)/.test(name))continue;const arr=mode==='attending'?attending:absent;if(!arr.some(x=>norm(x)===norm(name)))arr.push(name)}return {attending,absent,raw:text}}
  function editDistance(a,b){
    const left=[...String(a)],right=[...String(b)],row=Array.from({length:right.length+1},(_,i)=>i);
    for(let i=1;i<=left.length;i++){
      let previous=row[0];row[0]=i;
      for(let j=1;j<=right.length;j++){
        const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(left[i-1]===right[j-1]?0:1));previous=old;
      }
    }
    return row[right.length];
  }
  function similarToken(a,b){
    if(a===b)return true;
    if(a.length<3||b.length<3||a[0]!==b[0])return false;
    if(a.startsWith(b)||b.startsWith(a))return Math.min(a.length,b.length)>=3;
    return editDistance(a,b)<=1;
  }
  function similarName(a,b){
    const left=norm(a),right=norm(b);if(!left||!right)return false;if(left===right)return true;
    const leftWords=left.split(' '),rightWords=right.split(' ');
    if(leftWords.length===rightWords.length)return leftWords.every((word,index)=>similarToken(word,rightWords[index]));
    const shorter=leftWords.length<rightWords.length?leftWords:rightWords,longer=leftWords.length<rightWords.length?rightWords:leftWords;
    if(longer.length-shorter.length!==1)return false;
    return shorter.every(word=>longer.some(candidate=>similarToken(word,candidate)));
  }
  function resolveAttendanceName(name){
    const d=getSelected(),matches=[...d.attending.map(value=>({value,status:'attending'})),...d.absent.map(value=>({value,status:'absent'}))].filter(item=>similarName(name,item.value));
    const unique=matches.filter((item,index)=>matches.findIndex(other=>norm(other.value)===norm(item.value))===index);
    return unique.length===1?unique[0]:{status:unique.length?'ambiguous':'unknown',matches:unique.map(item=>item.value)};
  }
  function statusOf(name){return resolveAttendanceName(name).status}
  window.combatAttendanceStatus=statusOf;
  function assignedGearByPerson(){const map={};const equipment=selectedInfo().equipment||[];equipment.forEach(eq=>(eq.assignments||[]).forEach(a=>{const name=clean(a.name);if(!name)return;const key=norm(name);if(!map[key])map[key]={name,gear:[]};const qty=Array.isArray(a.units)&&a.units.length?a.units.length:Number(a.qty||0);const existing=map[key].gear.find(g=>g.key===(eq.id||eq.name));if(existing)existing.qty+=qty;else map[key].gear.push({key:eq.id||eq.name,name:eq.name,qty})}));return map}
  function analyzeNoShowsWithGear(){
    const d=getSelected(),people=Object.values(assignedGearByPerson()),flagged=[],ambiguities=[],seenPeople=new Set(),seenAmbiguities=new Set();
    for(const absentName of d.absent){
      const candidates=people.filter(person=>similarName(person.name,absentName));
      const safe=candidates.filter(person=>{const resolved=resolveAttendanceName(person.name);return resolved.status==='absent'&&norm(resolved.value)===norm(absentName)});
      if(candidates.length===1&&safe.length===1){const key=norm(safe[0].name);if(!seenPeople.has(key)){seenPeople.add(key);flagged.push(safe[0])}continue}
      if(candidates.length>1){
        const names=[...new Set(candidates.map(person=>person.name))],key=names.map(norm).sort().join('|');
        if(!seenAmbiguities.has(key)){seenAmbiguities.add(key);ambiguities.push({attendanceName:absentName,names,people:candidates})}
      }else if(candidates.length===1){
        const resolved=resolveAttendanceName(candidates[0].name),names=resolved.matches||[];
        if(names.length>1){const key=norm(candidates[0].name)+'|'+names.map(norm).sort().join('|');if(!seenAmbiguities.has(key)){seenAmbiguities.add(key);ambiguities.push({attendanceName:absentName,names,people:candidates})}}
      }
    }
    return {people:flagged,ambiguities};
  }
  function noShowsWithGear(){return analyzeNoShowsWithGear().people}
  function askedKey(name){return norm(name)}
  function wasAsked(name){return Boolean(getSelected().asked?.[askedKey(name)])}
  function setAsked(name,checked){const d=getSelected(),asked={...(d.asked||{})};if(checked)asked[askedKey(name)]=true;else delete asked[askedKey(name)];saveSelected({...d,asked})}
  function recordTransfer(fromName,toName,gear){const d=getSelected(),asked={...(d.asked||{}),[askedKey(fromName)]:true},transfers={...(d.transfers||{}),[askedKey(fromName)]:{from:fromName,to:toName,gear:Array.isArray(gear)?gear:[]}};saveSelected({...d,asked,transfers})}
  function assignmentRows(eq){
    const inferred=(eq.assignments||[]).reduce((sum,a)=>sum+Math.max(0,Number(a.qty||0)),0),highest=(eq.assignments||[]).flatMap(a=>Array.isArray(a.units)?a.units:[]).reduce((max,i)=>Math.max(max,Number(i)+1),0),total=Math.max(0,Number(eq.qty||0),inferred,highest),used=new Set(),rows=[];
    for(const assignment of eq.assignments||[]){
      let slots=[];
      if(Array.isArray(assignment.units)&&assignment.units.length){
        slots=assignment.units.map(Number).filter(i=>Number.isInteger(i)&&i>=0&&i<total&&!used.has(i));
      }else{
        const wanted=Math.max(0,Number(assignment.qty||0));
        for(let i=0;i<total&&slots.length<wanted;i++)if(!used.has(i))slots.push(i);
      }
      slots.forEach(i=>used.add(i));rows.push({assignment,slots});
    }
    return rows;
  }
  function historicalReturnData(historyItem,historyIndex){
    try{const all=JSON.parse(localStorage.getItem(RETURN_KEY)||'{}'),key=`history:${historyItem?.id||historyIndex}`;return all[key]||all[`history-${historyIndex}`]||{}}catch{return {}}
  }
  function syncCarriedTransfer(historyItem,moves,fromName,toName){
    if(!historyItem||!Array.isArray(state?.equipment)||!moves.length)return false;let changed=false;
    for(const move of moves){
      const eq=state.equipment.find(item=>String(item.id)===String(move.eqId));if(!eq)continue;const movedSet=new Set(move.slots),next=[];
      for(const assignment of eq.assignments||[]){
        const sameOrigin=String(assignment.carriedFromWorkoutId||'')===String(historyItem.id||''),samePerson=norm(assignment.name)===norm(fromName),units=Array.isArray(assignment.units)?assignment.units:[];
        if(!sameOrigin||!samePerson){next.push(assignment);continue}
        const transferred=units.filter(i=>movedSet.has(i)),remaining=units.filter(i=>!movedSet.has(i));
        if(remaining.length)next.push({...assignment,qty:remaining.length,units:remaining});
        if(transferred.length){next.push({...assignment,name:toName,qty:transferred.length,units:transferred});changed=true}
      }
      eq.assignments=next;
    }
    if(changed){if(typeof rememberTrainee==='function')rememberTrainee(toName);if(typeof pruneTraineeIfUnused==='function')pruneTraineeIfUnused(fromName);if(typeof save==='function')save()}
    return changed;
  }
  function transferEquipment(fromName,toName){
    fromName=clean(fromName);toName=clean(toName);if(!fromName||!toName||norm(fromName)===norm(toName))return false;
    const history=selectedWorkout==='current'?null:historyItems(),historyIndex=history?.findIndex((x,i)=>`history:${x.id||i}`===selectedWorkout)??-1,historyItem=historyIndex>=0?history[historyIndex]:null,equipment=selectedWorkout==='current'?(state.equipment||[]):(historyItem?.equipment||[]),returnData=historyItem?historicalReturnData(historyItem,historyIndex):{},gearBefore=[],movedHistorical=[];let changed=false;
    equipment.forEach(eq=>{
      const assignments=eq.assignments||[],sources=assignments.filter(a=>norm(a.name)===norm(fromName));if(!sources.length)return;
      if(!historyItem){
        const moved=sources.reduce((sum,a)=>sum+Number(a.qty||0),0);if(!moved)return;gearBefore.push({name:eq.name,qty:moved});
        let target=assignments.find(a=>norm(a.name)===norm(toName)&&norm(a.name)!==norm(fromName));
        if(target){for(const source of sources){if(Array.isArray(source.units)||Array.isArray(target.units)){target.units=[...new Set([...(target.units||[]),...(source.units||[])])].sort((a,b)=>a-b);target.qty=target.units.length}else target.qty=Number(target.qty||0)+Number(source.qty||0)}eq.assignments=assignments.filter(a=>!sources.includes(a))}else sources.forEach(a=>a.name=toName);
        changed=true;return;
      }
      const next=[],movedSlots=[];
      for(const row of assignmentRows(eq)){
        const base={...row.assignment,qty:row.slots.length,units:[...row.slots]};
        if(norm(row.assignment.name)!==norm(fromName)){if(base.qty)next.push(base);continue}
        const returnedSlots=row.slots.filter(i=>returnData[`${eq.id}:${i}`]),openSlots=row.slots.filter(i=>!returnData[`${eq.id}:${i}`]);
        if(returnedSlots.length)next.push({...base,name:fromName,qty:returnedSlots.length,units:returnedSlots});
        movedSlots.push(...openSlots);
      }
      if(!movedSlots.length)return;
      let target=next.find(a=>norm(a.name)===norm(toName));
      if(target){target.units=[...new Set([...(target.units||[]),...movedSlots])].sort((a,b)=>a-b);target.qty=target.units.length}else next.push({name:toName,qty:movedSlots.length,units:[...movedSlots].sort((a,b)=>a-b)});
      eq.assignments=next;gearBefore.push({name:eq.name,qty:movedSlots.length});movedHistorical.push({eqId:eq.id,slots:movedSlots});changed=true;
    });
    if(!changed)return false;
    if(selectedWorkout==='current'){
      if(typeof rememberTrainee==='function')rememberTrainee(toName);
      if(typeof pruneTraineeIfUnused==='function')pruneTraineeIfUnused(fromName);
      if(typeof save==='function')save();
      if(typeof renderAll==='function')renderAll();
    }else{
      if(historyItem){const people={};equipment.forEach(eq=>(eq.assignments||[]).forEach(a=>{(people[a.name]??=[]).push({name:eq.name,qty:Number(a.qty||0)})}));historyItem.people=Object.entries(people).map(([name,items])=>({name,items}));localStorage.setItem('combatEquipmentHistoryV1',JSON.stringify(history));syncCarriedTransfer(historyItem,movedHistorical,fromName,toName);if(typeof renderHistory==='function')renderHistory();window.renderCombatReturns?.()}
    }
    recordTransfer(fromName,toName,gearBefore);renderAttendance();return true;
  }
  let transferFrom='';
  function transferCandidates(from){return Object.values(assignedGearByPerson()).map(person=>person.name).filter(name=>norm(name)!==norm(from)).sort((a,b)=>a.localeCompare(b,'he'))}
  function updateTransferMode(){const existing=document.getElementById('transferExisting'),fresh=document.getElementById('transferNewName'),mode=document.querySelector('input[name="transferMode"]:checked')?.value||'existing';if(existing)existing.hidden=mode!=='existing';if(fresh){fresh.hidden=mode!=='new';if(mode==='new')fresh.focus()}}
  function openTransfer(encoded){
    try{transferFrom=decodeURIComponent(encoded)}catch{transferFrom=encoded}
    const modal=document.getElementById('transferModal'),select=document.getElementById('transferExisting'),fresh=document.getElementById('transferNewName'),names=transferCandidates(transferFrom);if(!modal||!select||!fresh)return;
    document.getElementById('transferTitle').textContent=`העברת הציוד של ${transferFrom}`;select.innerHTML=names.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');fresh.value='';
    const mode=names.length?'existing':'new';document.querySelectorAll('input[name="transferMode"]').forEach(input=>input.checked=input.value===mode);updateTransferMode();modal.classList.add('show');
  }
  function closeTransfer(){document.getElementById('transferModal')?.classList.remove('show');transferFrom=''}
  function confirmTransfer(){const mode=document.querySelector('input[name="transferMode"]:checked')?.value||'existing',to=mode==='existing'?document.getElementById('transferExisting')?.value:document.getElementById('transferNewName')?.value;if(!clean(to))return alert(mode==='existing'?'אין אדם נוסף בסיכום. בחר "מישהו חדש".':'יש לכתוב את שם האדם החדש');if(!transferEquipment(transferFrom,to))return alert('לא הצלחתי להעביר את הציוד');closeTransfer();alert(`הציוד הועבר אל ${clean(to)} והסיכום עודכן`)}
  function buildTransferModal(){
    if(document.getElementById('transferModal'))return;const modal=document.createElement('div');modal.id='transferModal';modal.className='overlay';modal.innerHTML=`<div class="modal transfer-modal" role="dialog" aria-modal="true" aria-labelledby="transferTitle"><h2 id="transferTitle">העברת ציוד</h2><div class="transfer-options"><label class="transfer-option"><input type="radio" name="transferMode" value="existing" checked><span><b>מישהו שכבר בסיכום</b><small>בחירה מרשימת האנשים שכבר מחזיקים ציוד</small></span></label><select id="transferExisting" class="input"></select><label class="transfer-option"><input type="radio" name="transferMode" value="new"><span><b>מישהו חדש</b><small>כתיבת שם חדש שיופיע בסיכום</small></span></label><input id="transferNewName" class="input" placeholder="שם האדם החדש" autocomplete="off" hidden></div><div class="modalBtns"><button id="cancelTransfer" class="btn" type="button">ביטול</button><button id="confirmTransfer" class="btn primary" type="button">העבר ועדכן סיכום</button></div></div>`;document.body.appendChild(modal);modal.addEventListener('click',e=>{if(e.target===modal)closeTransfer()});modal.querySelectorAll('input[name="transferMode"]').forEach(input=>input.addEventListener('change',updateTransferMode));document.getElementById('cancelTransfer').onclick=closeTransfer;document.getElementById('confirmTransfer').onclick=confirmTransfer;document.getElementById('transferNewName').addEventListener('keydown',e=>{if(e.key==='Enter')confirmTransfer()})
  }
  function renderWorkoutSelect(){const select=document.getElementById('attendanceWorkout');if(!select)return;const opts=workoutOptions();if(!opts.some(x=>x.key===selectedWorkout))setSelectedWorkout('current');const wanted=opts.map(x=>`${x.key}|${x.label}`).join('\n');if(select.dataset.options!==wanted){select.innerHTML=opts.map(x=>`<option value="${esc(x.key)}">${esc(x.label)}</option>`).join('');select.dataset.options=wanted}if(select.value!==selectedWorkout)select.value=selectedWorkout}
  function buildUI(){const tabs=document.querySelector('.tabs'),main=document.querySelector('main');if(!tabs||!main||document.getElementById('attendance'))return;tabs.style.gridTemplateColumns='repeat(4,1fr)';const btn=document.createElement('button');btn.className='tab';btn.dataset.tab='attendance';btn.textContent='נוכחות';tabs.appendChild(btn);const sec=document.createElement('section');sec.id='attendance';sec.className='section';sec.innerHTML=`<div class="titleRow"><h2>נוכחות לאימון</h2><span class="hint">בחר אימון קיים</span></div><div class="card attendance-card"><div class="field"><label for="attendanceWorkout">בחר אימון</label><select id="attendanceWorkout" class="input attendance-workout"></select></div><label class="hint" for="attendancePaste">רשימת נוכחות מלאה</label><textarea id="attendancePaste" class="input attendance-text" placeholder="הדבק כאן את הרשימה המלאה של האימון..."></textarea><div class="attendance-actions"><button id="parseAttendance" class="btn primary">קלוט רשימה</button><button id="clearAttendance" class="btn danger">נקה לאימון הזה</button></div><div id="attendanceResults"></div></div><div id="noShowWarnings"></div>`;main.appendChild(sec);renderWorkoutSelect();const sel=document.getElementById('attendanceWorkout');sel.onchange=()=>{setSelectedWorkout(sel.value||'current');const ta=document.getElementById('attendancePaste');if(ta)ta.value='';renderAttendance();decorateTraineeChoices()};btn.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.section').forEach(x=>x.classList.remove('active'));btn.classList.add('active');sec.classList.add('active');renderWorkoutSelect();renderAttendance()};document.getElementById('parseAttendance').onclick=()=>{const text=document.getElementById('attendancePaste').value.trim();if(!text)return alert('יש להדביק קודם את רשימת האימון');const d=parseList(text);if(!d.attending.length&&!d.absent.length)return alert('לא הצלחתי לזהות את הרשימות. ודא שיש כותרת "נרשמו באפליקציה" ו-"לא מגיעים".');saveSelected(d)};document.getElementById('clearAttendance').onclick=()=>{const info=selectedInfo();if(!confirm(`לנקות את רשימת הנוכחות של ${info.label}?`))return;const all=allData();delete all[selectedWorkout];if(info.legacyKey)delete all[info.legacyKey];localStorage.setItem(ATTENDANCE_KEY,JSON.stringify(all));document.getElementById('attendancePaste').value='';renderAttendance()}}
  function renderAttendance(){const root=document.getElementById('attendanceResults');if(!root)return;renderWorkoutSelect();const d=getSelected(),ta=document.getElementById('attendancePaste');if(ta&&!ta.value&&d.raw)ta.value=d.raw;if(!d.attending.length&&!d.absent.length){root.innerHTML='<div class="empty">עדיין לא נקלטה רשימת נוכחות לאימון שנבחר</div>';checkAssignedNoShows();return}const analysis=analyzeNoShowsWithGear();root.innerHTML=`<div class="attendance-stats"><div><strong>${analysis.people.length}</strong><span>לא מגיעים עם ציוד</span></div><div><strong>${analysis.ambiguities.length}</strong><span>שמות שצריך לבדוק</span></div></div>${analysis.people.length||analysis.ambiguities.length?'':'<div class="empty">אין באימון הזה אנשים שמסומנים כלא מגיעים ויש אצלם ציוד</div>'}`;checkAssignedNoShows()}
  // Contacts stay separate from equipment/history and are included only in a user-requested local backup export.
  const CONTACTS_KEY='combatEquipmentContactsV1';
  const contactName=s=>String(s||'').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'').trim().replace(/\s+/g,' ');
  let editingContact=null;
  const selectedContacts=new Set();
  function normalizePhone(phone){
    let p=String(phone||'').trim();
    if(!/^\+?[\d\s().-]+$/.test(p))return '';
    p=p.replace(/[\s().-]/g,'').replace(/^\+|^00/,'');
    if(/^0\d{8,9}$/.test(p))p='972'+p.slice(1);
    return /^[1-9]\d{7,14}$/.test(p)?p:'';
  }
  function makeContact(name,phone,aliases=[]){
    name=contactName(name);phone=normalizePhone(phone);
    if(!name||!norm(name))throw Error('יש להזין שם איש קשר');
    if(!phone)throw Error(`מספר הטלפון של ${name} אינו תקין`);
    if(!Array.isArray(aliases))throw Error('שמות חלופיים חייבים להיות רשימה');
    const seen=new Set([norm(name)]);
    aliases=aliases.map(contactName).filter(a=>{const key=norm(a);if(!key||seen.has(key))return false;seen.add(key);return true});
    return {name,phone,aliases};
  }
  function readContacts(){
    const raw=localStorage.getItem(CONTACTS_KEY);
    if(raw!==null){
      const list=JSON.parse(raw);
      if(!Array.isArray(list))throw Error('רשימת אנשי הקשר השמורה אינה תקינה');
      return list.map(c=>makeContact(c.name,c.phone,c.aliases));
    }
    // Read existing v1.3.6 numbers until the first successful contact edit/import.
    const legacy=JSON.parse(localStorage.getItem(PHONE_KEY)||'{}');
    if(!legacy||typeof legacy!=='object'||Array.isArray(legacy))throw Error('רשימת הטלפונים השמורה אינה תקינה');
    return Object.entries(legacy).filter(([name,phone])=>norm(name)&&normalizePhone(phone)).map(([name,phone])=>makeContact(name,phone));
  }
  function validateContacts(list){
    const names=new Map();
    for(const c of list)for(const name of [c.name,...c.aliases]){
      const key=norm(name);
      if(names.has(key))throw Error(`השם או הכינוי "${name}" כבר שייך ל־${names.get(key)}. יש להשתמש בשם ייחודי.`);
      names.set(key,c.name);
    }
    return list;
  }
  function writeContacts(list){
    validateContacts(list);
    try{localStorage.setItem(CONTACTS_KEY,JSON.stringify(list))}catch{throw Error('לא ניתן לשמור בדפדפן. בדוק שיש מקום פנוי וששמירה מקומית מותרת.')}
    // Remove the superseded legacy map so deleted numbers cannot reappear.
    try{localStorage.removeItem(PHONE_KEY)}catch{}
  }
  function contactPhone(name){
    try{
      const matches=readContacts().filter(c=>[c.name,...c.aliases].some(a=>norm(a)===norm(name)));
      return matches.length===1?matches[0].phone:'';
    }catch{return ''}
  }
  function contactPhoneEquivalent(name){
    try{
      const contacts=readContacts();
      const matches=contacts.filter(c=>[c.name,...c.aliases].some(a=>similarName(name,a)));
      return matches.length===1?matches[0].phone:'';
    }catch{return ''}
  }
  function splitContactRow(line){
    const delimiter=line.includes('\t')?'\t':line.includes(';')?';':',';
    const cells=[];let cell='',quoted=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'&&(quoted||!cell.trim())){
        if(quoted&&line[i+1]==='"'){cell+='"';i++}else quoted=!quoted;
      }else if(ch===delimiter&&!quoted){cells.push(cell.trim());cell=''}else cell+=ch;
    }
    if(quoted)throw Error('מרכאות לא סגורות');
    cells.push(cell.trim());return cells;
  }
  function parseContacts(text){
    const result=[];
    String(text).split(/\r?\n/).forEach((line,i)=>{
      if(!line.trim())return;
      try{
        const cells=splitContactRow(line);
        if(!result.length&&/^(שם|name)$/i.test(cells[0])&&/^(מספר|טלפון|מספר טלפון|phone)$/i.test(cells[1]))return;
        if(cells.length<2)throw Error('יש להפריד בין שם למספר באמצעות פסיק, נקודה־פסיק או Tab');
        result.push(makeContact(cells[0],cells[1],cells.slice(2).flatMap(s=>s.split('|'))));
      }catch(e){throw Error(`שורה ${i+1}: ${e.message}`)}
    });
    if(!result.length)throw Error('יש להדביק לפחות איש קשר אחד');
    return validateContacts(result);
  }
  function contactNotice(message,error=false){
    const el=document.getElementById('contactNotice');el.textContent=message;el.style.color=error?'#ffb4ac':'';
  }
  function resetContactForm(){
    editingContact=null;document.getElementById('contactForm').reset();
    document.getElementById('saveContact').textContent='הוסף איש קשר';
    document.getElementById('cancelContactEdit').hidden=true;
  }
  function updateContactSelection(){
    const count=selectedContacts.size;
    const button=document.getElementById('deleteSelectedContacts');
    if(button){button.disabled=!count;button.textContent=count?`מחק נבחרים (${count})`:'מחק נבחרים'}
    const clear=document.getElementById('clearContactSelection');if(clear)clear.disabled=!count;
    const status=document.getElementById('contactSelectionCount');if(status)status.textContent=`${count} נבחרו`;
  }
  function clearContactSelection(){
    selectedContacts.clear();
    document.querySelectorAll('[data-contact-select]').forEach(input=>{input.checked=false});
    updateContactSelection();
  }
  function deleteSelectedContacts(){
    if(!selectedContacts.size)return;
    try{
      const list=readContacts(),chosen=list.filter(c=>selectedContacts.has(norm(c.name)));
      if(!chosen.length){clearContactSelection();return}
      if(!confirm(`למחוק ${chosen.length} אנשי קשר נבחרים מהמכשיר?\n\n${chosen.map(c=>c.name).join('\n')}\n\nשיוכי הציוד והנוכחות לא יימחקו.`))return;
      writeContacts(list.filter(c=>!selectedContacts.has(norm(c.name))));
      resetContactForm();renderContacts();checkAssignedNoShows();
      contactNotice(`${chosen.length} אנשי קשר נמחקו מהמכשיר`);
    }catch(e){contactNotice(e.message,true)}
  }
  function renderContacts(){
    selectedContacts.clear();updateContactSelection();
    const root=document.getElementById('contactsList');if(!root)return;
    try{
      const contacts=readContacts();
      root.innerHTML=contacts.length?contacts.map(c=>`<div class="contact-row"><div class="contact-selection-info"><label class="contact-select"><input type="checkbox" data-contact-select="${esc(norm(c.name))}" aria-label="בחר את ${esc(c.name)} למחיקה"><strong>${esc(c.name)}</strong></label><div dir="ltr">+${esc(c.phone)}</div><div class="mini">${c.aliases.length?'שמות חלופיים: '+esc(c.aliases.join(' · ')):''}</div></div><div class="contact-row-actions"><button type="button" class="btn small" data-contact-edit="${esc(norm(c.name))}">עריכה</button><button type="button" class="btn small danger" data-contact-delete="${esc(norm(c.name))}">מחיקה</button></div></div>`).join(''):'<div class="empty">עדיין לא נשמרו אנשי קשר במכשיר הזה</div>';
    }catch{root.textContent='לא ניתן לקרוא את אנשי הקשר השמורים. הנתונים הקיימים לא שונו.'}
  }
  function buildContactsUI(){
    const panel=document.createElement('details');panel.className='card contacts-card';
    panel.innerHTML=`<summary>אנשי קשר ל־WhatsApp</summary><p class="hint">נשמרים רק בדפדפן במכשיר הזה. אינם מסונכרנים או נשלחים לשרת. בפתיחת WhatsApp, המספר וההודעה מועברים ל־WhatsApp. מחיקת נתוני הדפדפן תמחק גם אותם.</p><form id="contactForm"><div class="field"><label for="contactName">שם כפי שמופיע בשיוך הציוד</label><input id="contactName" class="input" required autocomplete="off"></div><div class="field"><label for="contactPhone">מספר טלפון</label><input id="contactPhone" class="input" type="tel" dir="ltr" placeholder="05X-XXXXXXX או מספר בינלאומי עם קידומת" required autocomplete="off"></div><div class="field"><label for="contactAliases">שמות חלופיים / כינויים (מופרדים ב־|)</label><input id="contactAliases" class="input" autocomplete="off"></div><div class="attendance-actions"><button id="saveContact" class="btn primary" type="submit">הוסף איש קשר</button><button id="cancelContactEdit" class="btn" type="button" hidden>ביטול עריכה</button></div></form><details class="contacts-import"><summary>ייבוא רשימת אנשי קשר</summary><label for="contactsPaste" class="hint">איש קשר בכל שורה: שם,מספר,כינוי ראשון|כינוי שני. ניתן גם להדביק עמודות מגיליון או להפריד בנקודה־פסיק. כינויים הם רשות. מספר מקומי מומר לקידומת ישראל; למספר מחו״ל יש להזין קידומת מדינה. הייבוא מוסיף שמות חדשים ומעדכן מספר וכינויים של שם ראשי זהה.</label><textarea id="contactsPaste" class="input" rows="5" placeholder="שם,מספר,שמות חלופיים" spellcheck="false"></textarea><button id="importContacts" type="button" class="btn">ייבא ושמור במכשיר</button></details><p id="contactNotice" class="hint" role="status" aria-live="polite"></p><div id="contactsList"></div>`;
    document.getElementById('attendance').insertBefore(panel,document.getElementById('noShowWarnings'));
    const selectionBar=document.createElement('div');selectionBar.className='contact-selection-bar';
    selectionBar.innerHTML='<p class="hint">למחיקה משותפת, סמן את אנשי הקשר הרצויים ברשימה.</p><div class="attendance-actions"><button type="button" id="deleteSelectedContacts" class="btn danger" disabled>מחק נבחרים</button><button type="button" id="clearContactSelection" class="btn" disabled>בטל בחירה</button></div><p id="contactSelectionCount" class="hint" role="status" aria-live="polite">0 נבחרו</p>';
    document.getElementById('contactsList').before(selectionBar);
    document.getElementById('deleteSelectedContacts').onclick=deleteSelectedContacts;
    document.getElementById('clearContactSelection').onclick=clearContactSelection;
    document.getElementById('contactsList').onchange=e=>{
      const input=e.target;if(!input.matches('[data-contact-select]'))return;
      if(input.checked)selectedContacts.add(input.dataset.contactSelect);else selectedContacts.delete(input.dataset.contactSelect);
      updateContactSelection();
    };
    document.getElementById('contactForm').onsubmit=e=>{
      e.preventDefault();
      try{
        const c=makeContact(document.getElementById('contactName').value,document.getElementById('contactPhone').value,document.getElementById('contactAliases').value.split('|'));
        const list=readContacts();
        if(editingContact!==null){const index=list.findIndex(x=>norm(x.name)===editingContact);if(index<0)throw Error('איש הקשר השתנה. יש לבטל עריכה ולבחור אותו שוב.');list[index]=c}else list.push(c);
        writeContacts(list);resetContactForm();renderContacts();checkAssignedNoShows();contactNotice('איש הקשר נשמר במכשיר');
      }catch(e){contactNotice(e.message,true)}
    };
    document.getElementById('cancelContactEdit').onclick=()=>{resetContactForm();contactNotice('')};
    document.getElementById('importContacts').onclick=()=>{
      try{
        const incoming=parseContacts(document.getElementById('contactsPaste').value),list=readContacts();
        for(const c of incoming){const index=list.findIndex(x=>norm(x.name)===norm(c.name));if(index<0)list.push(c);else list[index]=c}
        writeContacts(list);resetContactForm();renderContacts();checkAssignedNoShows();document.getElementById('contactsPaste').value='';contactNotice(`${incoming.length} אנשי קשר נקלטו ונשמרו במכשיר`);
      }catch(e){contactNotice(e.message,true)}
    };
    document.getElementById('contactsList').onclick=e=>{
      const button=e.target.closest('button');if(!button)return;
      try{
        const list=readContacts(),key=button.dataset.contactEdit??button.dataset.contactDelete,c=list.find(x=>norm(x.name)===key);if(!c)return;
        if(button.hasAttribute('data-contact-edit')){
          editingContact=key;document.getElementById('contactName').value=c.name;document.getElementById('contactPhone').value='+'+c.phone;document.getElementById('contactAliases').value=c.aliases.join('|');document.getElementById('saveContact').textContent='שמור שינויים';document.getElementById('cancelContactEdit').hidden=false;document.getElementById('contactName').focus();
        }else if(confirm(`למחוק את איש הקשר ${c.name} מהמכשיר?`)){
          writeContacts(list.filter(x=>norm(x.name)!==key));resetContactForm();renderContacts();checkAssignedNoShows();contactNotice('איש הקשר נמחק מהמכשיר');
        }
      }catch(e){contactNotice(e.message,true)}
    };
    window.addEventListener('storage',e=>{if(e.key===CONTACTS_KEY||e.key===PHONE_KEY||e.key===null){resetContactForm();renderContacts();checkAssignedNoShows()}});
    renderContacts();
  }

  function gearText(person){return (person?.gear||[]).map(g=>`${Number(g.qty||0)} × ${g.name}`).join(' · ')}
  function messageFor(person){return `היי ${person.name}, ראיתי שאתה מסומן כלא מגיע לאימון הקרוב אבל כרגע משויך אליך ${gearText(person)}. תוכל לעדכן אותי לגביהם?`}
  function findPerson(encoded){let name='';try{name=decodeURIComponent(encoded)}catch{name=encoded}return noShowsWithGear().find(p=>norm(p.name)===norm(name))}
  function openWhatsApp(encoded){const person=findPerson(encoded);if(!person)return alert('לא מצאתי את השיוך של המתאמן');const phone=contactPhoneEquivalent(person.name);const text=encodeURIComponent(messageFor(person));const url=phone?`https://wa.me/${phone}?text=${text}`:`https://wa.me/?text=${text}`;window.location.href=url}
  async function copyMessage(encoded){const person=findPerson(encoded);if(!person)return alert('לא מצאתי את השיוך של המתאמן');const msg=messageFor(person);try{await navigator.clipboard.writeText(msg);alert('ההודעה הועתקה')}catch{prompt('העתק את ההודעה:',msg)}}
  window.openNoShowWhatsApp=openWhatsApp;
  window.copyNoShowMessage=copyMessage;
  function personActions(name){return `<label class="asked-check"><input type="checkbox" data-asked="${esc(name)}" ${wasAsked(name)?'checked':''}><span>שאלתי אותו</span></label><button class="btn small transfer-btn" data-transfer="${esc(name)}">העבר ציוד למישהו אחר</button>`}
  function transferRecords(){return Object.values(getSelected().transfers||{}).filter(item=>item&&item.from&&item.to)}
  function checkAssignedNoShows(){const box=document.getElementById('noShowWarnings');if(!box)return;const analysis=analyzeNoShowsWithGear(),people=analysis.people,transfers=transferRecords(),hasResults=people.length||analysis.ambiguities.length||transfers.length;const html=hasResults?`<div class="titleRow"><h2>⚠️ טיפול לפני האימון</h2><span class="hint">${esc(selectedInfo().label)}</span></div>${transfers.map(item=>`<div class="card transfer-complete-card"><div class="transfer-complete-icon">✓</div><div><strong>${esc(item.from)}</strong><div class="asked-complete">שאלתי אותו — הציוד הועבר ל־<b>${esc(item.to)}</b></div><div class="mini">${(item.gear||[]).map(g=>`${Number(g.qty||0)} × ${esc(g.name)}`).join(' · ')}</div></div></div>`).join('')}${people.map(p=>`<div class="card no-show-card"><div class="no-show-info"><strong>${esc(p.name)}</strong><div class="mini">${p.gear.map(g=>`${g.qty} × ${esc(g.name)}`).join(' · ')}</div>${personActions(p.name)}</div><div class="no-show-actions"><span class="mini">${contactPhoneEquivalent(p.name)?'פתיחת צ׳אט ישיר':'בחירת איש קשר ב־WhatsApp'}</span><button class="btn small whatsapp-btn" data-whatsapp="${esc(p.name)}">WhatsApp</button><button class="btn small copy-btn" data-copy-message="${esc(p.name)}">העתק הודעה</button></div></div>`).join('')}${analysis.ambiguities.map(item=>`<div class="card name-ambiguity-card" role="alert"><div class="name-ambiguity-icon" aria-hidden="true">?</div><div class="ambiguity-content"><strong>נמצאו ${item.names.length} התאמות אפשריות ל־${esc(item.attendanceName)}</strong><p>צריך לבדוק מולם מי מחזיק בציוד:</p>${item.people.map(person=>`<div class="ambiguity-person"><b>${esc(person.name)}</b>${personActions(person.name)}</div>`).join('')}</div></div>`).join('')}`:'';if(box.innerHTML!==html)box.innerHTML=html}
  function decorateTraineeChoices(){document.querySelectorAll('.trainee-chip').forEach(b=>{let name='';try{name=decodeURIComponent(b.dataset.name||'')}catch{name=b.textContent||''}const absent=statusOf(name)==='absent';const marked=b.classList.contains('trainee-absent');if(absent&&!marked){b.classList.add('trainee-absent');b.title='מסומן כלא מגיע באימון שנבחר';const s=document.createElement('span');s.className='absent-mark';s.textContent=' · לא מגיע';b.appendChild(s)}else if(!absent&&marked){b.classList.remove('trainee-absent');b.title='';b.querySelector('.absent-mark')?.remove()}})}
  let observerBusy=false;const observer=new MutationObserver(()=>{if(observerBusy)return;observerBusy=true;requestAnimationFrame(()=>{decorateTraineeChoices();observerBusy=false})});observer.observe(document.body,{childList:true,subtree:true});
  const saveBtn=document.getElementById('saveAssignment');if(saveBtn){saveBtn.addEventListener('click',e=>{if(selectedWorkout!=='current')return;if(saveBtn.dataset.attendanceConfirmed==='1'){delete saveBtn.dataset.attendanceConfirmed;return}const name=document.getElementById('personName')?.value.trim();if(name&&statusOf(name)==='absent'){e.preventDefault();e.stopImmediatePropagation();if(confirm(`${name} מסומן כלא מגיע לאימון הנוכחי. בכל זאת לשייך לו ציוד?`)){saveBtn.dataset.attendanceConfirmed='1';saveBtn.click()}}},true)}
  const style=document.createElement('style');style.textContent='.name-ambiguity-card{display:flex;align-items:flex-start;gap:12px;padding:14px;border-color:#9a7537;background:#302714}.name-ambiguity-card p{margin:7px 0 0;color:#ffe1a6;font-size:13px;line-height:1.45}.name-ambiguity-icon{display:grid;place-items:center;flex:0 0 34px;height:34px;border-radius:50%;background:#d99a2b;color:#201506;font-size:20px;font-weight:950}.contact-select{display:flex;align-items:center;gap:10px;cursor:pointer;min-height:44px}.contact-select input{width:22px;height:22px;flex-shrink:0;accent-color:#f07a22}.contact-selection-info{flex:1;min-width:0}.contact-selection-bar{border-top:1px solid #46513f;margin-top:12px}.contact-selection-bar .btn:disabled{opacity:.45;cursor:default}.contacts-card{padding:14px}.contacts-card summary{cursor:pointer;font-weight:800;min-height:40px;padding:8px 0}.contacts-card p,.contacts-import label{line-height:1.6}.contacts-import{margin-top:18px;border-top:1px solid #46513f;padding-top:8px}.contacts-import textarea{margin:10px 0;font:inherit;resize:vertical}.contact-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #46513f;overflow-wrap:anywhere}.contact-row>div:first-child{min-width:0}.contact-row-actions{display:flex;gap:6px;flex-shrink:0}.contacts-card [hidden]{display:none!important}@media(max-width:380px){.contact-row{align-items:stretch;flex-direction:column}}.attendance-card{padding:14px}.attendance-workout{appearance:auto}.attendance-text{min-height:180px;resize:vertical;line-height:1.55}.attendance-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.attendance-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.attendance-stats.single{grid-template-columns:1fr}.attendance-stats>div{text-align:center;border:1px solid #46513f;border-radius:12px;padding:10px;background:#151a13}.attendance-stats strong{display:block;font-size:22px}.attendance-stats span{font-size:11px;color:#b8baaf}.no-show-card{padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px;border-color:#74423d}.no-show-info{min-width:0;flex:1}.no-show-actions{display:flex;flex-direction:column;gap:6px;min-width:112px}.whatsapp-btn{background:#183d28;border-color:#2c7a4b;color:#d9ffe7}.copy-btn{background:#242b22;border-color:#56604f;color:#f4f2e8}.trainee-chip.trainee-absent{border-color:#a35249;color:#ffd3ce;background:#321d1b}.absent-mark{font-size:10px;color:#ff9f95}.app-version-fixed{font-size:11px;font-weight:800;color:#aeb3a8;vertical-align:middle;margin-right:6px;white-space:nowrap}@media(max-width:520px){.tabs{gap:5px}.tab{font-size:12px;padding:6px}.attendance-actions{grid-template-columns:1fr}.no-show-card{align-items:stretch;flex-direction:column}.no-show-actions{width:100%;display:grid;grid-template-columns:1fr}.no-show-actions .btn{width:100%}}';document.head.appendChild(style);
  const transferStyle=document.createElement('style');transferStyle.textContent='.ambiguity-content{flex:1;min-width:0}.ambiguity-person{border-top:1px solid #6e572f;padding:10px 0}.asked-check{display:flex;align-items:center;gap:8px;margin-top:10px;min-height:38px;font-size:14px;font-weight:800;cursor:pointer}.asked-check input{width:21px;height:21px;accent-color:#f07a22}.transfer-btn{margin-top:6px;background:#2b3027;border-color:#697260}.transfer-complete-card{display:flex;align-items:flex-start;gap:11px;padding:14px;border-color:#47734c;background:#17271a}.transfer-complete-icon{display:grid;place-items:center;flex:0 0 32px;height:32px;border-radius:50%;background:#3f7546;color:#fff;font-size:19px;font-weight:950}.asked-complete{margin:5px 0;color:#c8ebca;font-size:14px}.transfer-modal{max-height:88vh;overflow:auto}.transfer-options{display:grid;gap:9px}.transfer-option{display:flex;align-items:flex-start;gap:11px;padding:12px;border:1px solid #535d4a;border-radius:13px;background:#171c14;cursor:pointer}.transfer-option:has(input:checked){border-color:#f07a22;background:#2c2117}.transfer-option input{width:21px;height:21px;margin-top:2px;accent-color:#f07a22}.transfer-option span{display:grid;gap:3px}.transfer-option small{color:#aeb3a8;line-height:1.4}.transfer-options [hidden]{display:none!important}';document.head.appendChild(transferStyle);
  buildUI();buildContactsUI();buildTransferModal();
  window.combatOpenHistoryTransfer=(historyKey,name)=>{
    const key=String(historyKey||'');if(!workoutOptions().some(option=>option.key===key))return false;
    setSelectedWorkout(key);renderAttendance();openTransfer(encodeURIComponent(clean(name)));return true;
  };
  document.getElementById('noShowWarnings')?.addEventListener('click',e=>{
    const button=e.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-whatsapp'))openWhatsApp(encodeURIComponent(button.dataset.whatsapp));
    if(button.hasAttribute('data-copy-message'))copyMessage(encodeURIComponent(button.dataset.copyMessage));
    if(button.hasAttribute('data-transfer'))openTransfer(encodeURIComponent(button.dataset.transfer));
  });
  document.getElementById('noShowWarnings')?.addEventListener('change',e=>{const input=e.target.closest('input[data-asked]');if(input)setAsked(input.dataset.asked,input.checked)});
  renderAttendance();decorateTraineeChoices();document.querySelectorAll('.app-version,.app-version-fixed').forEach(el=>el.remove());const appTitle=document.querySelector('.headline h1');if(appTitle){const version=document.createElement('span');version.className='app-version-fixed';version.dir='ltr';version.textContent='v'+(window.COMBAT_APP?.version||'2.4.7');appTitle.append(' ',version)}
})();

