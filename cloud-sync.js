import {createClient} from '@supabase/supabase-js';

const config=window.COMBAT_CLOUD||{};
const APP_KEYS=()=>Object.values(window.CombatData?.KEYS||{});
const WORKSPACE_KEY='combatCloudWorkspaceV1';
const DEMO_KEY='combatReviewDemoV1';
const DIRTY_KEY='combatCloudDirtyV1';
const SYNCED_KEY='combatCloudSyncedV1';
const SAFETY_KEY='combatCloudSafetyCopyV1';
const READY=typeof config.url==='string'&&config.url.startsWith('https://')&&
  typeof config.publishableKey==='string'&&!config.publishableKey.startsWith('REPLACE_');

let client=null,user=null,profile=null,activeOwner=null,revision=0;
let suppressWrites=false,pendingMigration=false,saveTimer=0,saveInFlight=false,saveAgain=false;
let changeSeq=0,connecting=false,waitingForNetwork=false;
// What the cloud holds at a known revision, as raw stored text per key, so a save can send only the keys that changed.
let synced=null,patchSupported=true;

const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const displayName=item=>item?.display_name?.trim()||item?.email||'מאמן ללא שם';
const snapshot=()=>window.CombatData?.exportBackup()?.data||{};
const snapshotText=data=>JSON.stringify(data||{});
const hasLocalData=()=>APP_KEYS().some(key=>localStorage.getItem(key)!==null);
const readRaws=()=>new Map(APP_KEYS().map(key=>[key,localStorage.getItem(key)]));
const dataFromRaws=raws=>{const data={};raws.forEach((raw,key)=>{if(raw!==null)data[key]=JSON.parse(raw)});return data};
const isMissingFunction=error=>error?.code==='PGRST202'||/could not find the function/i.test(String(error?.message||''));

// Network failures surface from fetch as "Failed to fetch" / "Load failed" and from auth-js as AuthRetryableFetchError.
function isNetworkError(error){
  if(!error)return false;
  const message=String(error.message||error);
  return error.name==='AuthRetryableFetchError'||error.status===0||/Failed to fetch|NetworkError|Load failed|network request failed|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(message);
}
function friendlyError(error){
  if(isNetworkError(error))return 'אין חיבור לשרת הסנכרון. הנתונים שמורים במכשיר ויסונכרנו כשהחיבור יחזור.';
  return error?.message||String(error||'שגיאה לא ידועה');
}

// Tracks local changes that were not confirmed by the cloud yet, so a reload/offline period never lets older cloud data overwrite them.
function readDirty(){
  try{const value=JSON.parse(localStorage.getItem(DIRTY_KEY));return value&&typeof value.owner==='string'&&Number.isFinite(value.base)?value:null}catch{return null}
}
function writeDirty(owner,base){localStorage.setItem(DIRTY_KEY,JSON.stringify({owner,base}))}
function clearDirty(){localStorage.removeItem(DIRTY_KEY)}
// Fingerprint of the device data the cloud last confirmed. Device data that no longer matches it was changed while
// signed out, offline or while the server was unavailable, and must never be replaced by the cloud copy silently.
function fingerprint(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)+':'+text.length}
function readSynced(){
  try{const value=JSON.parse(localStorage.getItem(SYNCED_KEY));return value&&typeof value.owner==='string'&&typeof value.hash==='string'&&Number.isFinite(value.revision)?value:null}catch{return null}
}
function recordSynced(owner,rev,text=snapshotText(snapshot())){try{localStorage.setItem(SYNCED_KEY,JSON.stringify({owner,revision:rev,hash:fingerprint(text)}))}catch{}}
function localMatchesSynced(owner){const value=readSynced();return Boolean(value&&value.owner===owner&&value.hash===fingerprint(snapshotText(snapshot())))}

// The last copy of data this device was about to discard, restorable from the account screen.
function readSafetyCopy(){try{const value=JSON.parse(localStorage.getItem(SAFETY_KEY));return value&&value.data&&typeof value.data==='object'?value:null}catch{return null}}
function keepSafetyCopy(data,source){
  if(!data||!Object.keys(data).length)return true;
  try{localStorage.setItem(SAFETY_KEY,JSON.stringify({savedAt:new Date().toISOString(),source,data}));return true}
  catch{return false}
}
function renderSafety(){
  const body=$('cloudAccountBody');if(!body)return;
  const old=$('cloudSafety');if(old?.parentNode)old.parentNode.removeChild(old);
  const copy=readSafetyCopy();if(!copy)return;
  const when=new Intl.DateTimeFormat('he-IL',{dateStyle:'medium',timeStyle:'short'}).format(new Date(copy.savedAt));
  const history=Array.isArray(copy.data.combatEquipmentHistoryV1)?copy.data.combatEquipmentHistoryV1.length:0;
  const panel=document.createElement('div');panel.id='cloudSafety';panel.className='cloud-panel';
  panel.innerHTML=`<h3>עותק ביטחון</h3><p class="mini">${copy.source==='cloud'?'הנתונים שהיו בענן':'הנתונים שהיו במכשיר'} לפני שהוחלפו · ${escapeHtml(when)} · ${history} אימונים בהיסטוריה</p><div class="cloud-actions"><button id="restoreSafety" class="btn primary" type="button">שחזור עותק הביטחון</button><button id="dropSafety" class="btn" type="button">מחיקת העותק</button></div>`;
  body.appendChild(panel);
  $('restoreSafety').onclick=()=>{
    if(!confirm('לשחזר את עותק הביטחון? הנתונים הנוכחיים במכשיר יוחלפו בו'+(activeOwner?' וגם יישמרו בענן.':'.')))return;
    try{const current=snapshot();window.CombatData.clearAll();window.CombatData.importBackup({app:'combat-equipment',data:copy.data});keepSafetyCopy(current,'device');refreshAppFromLocal();renderSafety();announce('עותק הביטחון שוחזר')}
    catch(error){announce('לא ניתן לשחזר: '+error.message,'error')}
  };
  $('dropSafety').onclick=()=>{if(confirm('למחוק את עותק הביטחון מהמכשיר?')){localStorage.removeItem(SAFETY_KEY);renderSafety()}};
}

function markDirty(){
  if(!activeOwner||pendingMigration||suppressWrites)return;
  changeSeq++;
  const dirty=readDirty();
  if(!dirty||dirty.owner!==activeOwner)writeDirty(activeOwner,revision);
}

function announce(message,type='info'){
  const node=$('cloudNotice');if(node){node.textContent=message;node.dataset.type=type;node.hidden=false}
  window.dispatchEvent(new CustomEvent('combat-cloud-status',{detail:{message,type}}));
}

function addUi(){
  if($('cloudAccountButton'))return;
  const button=document.createElement('button');button.id='cloudAccountButton';button.className='cloud-account';button.type='button';button.textContent='כניסה';button.setAttribute('aria-label','חשבון וסנכרון');
  document.querySelector('.headline')?.appendChild(button);
  const overlay=document.createElement('div');overlay.id='cloudAccountModal';overlay.className='overlay cloud-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','cloudAccountTitle');
  overlay.innerHTML=`<div class="modal cloud-modal"><div class="cloud-title"><h2 id="cloudAccountTitle">חשבון וסנכרון</h2><button type="button" class="cloud-close" aria-label="סגירה">×</button></div><div id="cloudNotice" class="cloud-notice" hidden></div><div id="cloudAccountBody"><p class="mini">טוען…</p></div></div>`;
  document.body.appendChild(overlay);
  button.onclick=()=>overlay.classList.add('show');
  overlay.querySelector('.cloud-close').onclick=()=>overlay.classList.remove('show');
  overlay.addEventListener('click',event=>{if(event.target===overlay)overlay.classList.remove('show')});
  const style=document.createElement('style');style.textContent=`
    .headline{flex-wrap:wrap}.cloud-backup-warning{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;margin-top:10px;padding:10px 13px;border:1px solid #a4652f;border-radius:14px;background:#3a2414;color:#ffd9b8;font:inherit;text-align:right}.cloud-backup-warning[hidden]{display:none}.cloud-backup-warning b{font-size:14px}.cloud-backup-warning span{font-size:12px;color:#f3b98a}
    .cloud-account{order:3;width:100%;min-height:42px;border:1px solid #52634a;border-radius:12px;background:#182017;color:#f4f2e8;font:inherit;font-weight:900;padding:8px 12px}
    .cloud-account[data-online="true"]{color:#c9ffd0;border-color:#53745a}.cloud-modal{max-height:min(82vh,720px);overflow:auto}.cloud-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.cloud-title h2{margin:0}.cloud-close{width:44px;min-height:44px;border:1px solid #56624e;border-radius:12px;background:#171c15;color:#fff;font-size:28px}.cloud-notice{margin:12px 0;padding:10px 12px;border-radius:11px;background:#293221}.cloud-notice[data-type="error"]{background:#4a211d;color:#ffd5d0}.cloud-panel{border:1px solid #43513d;border-radius:14px;padding:13px;margin-top:12px}.cloud-actions{display:grid;gap:8px;margin-top:12px}.cloud-user{font-weight:900;font-size:17px}.cloud-status{color:#b8baaf;font-size:13px;margin-top:4px}.coach-list{display:grid;gap:8px;margin-top:10px}.coach-choice{text-align:right;border:1px solid #4c5843;border-radius:12px;background:#161c14;color:#fff;padding:11px}.coach-choice.active{border-color:#f07a22;background:#322317}.coach-choice span{display:block;color:#b8baaf;font-size:12px;margin-top:3px}
  `;document.head.appendChild(style);
}

// A visible reminder on the main screen while device data is not backed up to any account.
function backupWarning(show){
  let bar=$('cloudBackupWarning');
  if(!show){if(bar)bar.hidden=true;return}
  if(!bar){
    bar=document.createElement('button');bar.type='button';bar.id='cloudBackupWarning';bar.className='cloud-backup-warning';
    bar.innerHTML='<b>⚠️ הנתונים שמורים רק בטלפון הזה</b><span>לחצו כדי להתחבר ולגבות אותם בענן</span>';
    bar.onclick=()=>$('cloudAccountModal')?.classList.add('show');
    document.querySelector('.top')?.appendChild(bar);
  }
  bar.hidden=false;
}

function signedOutUi(){
  backupWarning(hasLocalData());
  $('cloudAccountButton').textContent='כניסה עם Google';$('cloudAccountButton').dataset.online='false';
  $('cloudAccountBody').innerHTML=`<div class="cloud-panel"><h3>שמירה מאובטחת בענן</h3><p class="mini">הנתונים במכשיר לא יועלו בלי אישור מפורש. לאחר הכניסה כל מאמן רואה רק את הנתונים שלו.</p><div class="cloud-actions"><button id="googleSignIn" class="btn primary" type="button">כניסה עם Google</button><button id="startDemo" class="btn" type="button">כניסה למצב הדגמה</button></div><p class="mini">מצב ההדגמה מאפשר לבדוק את כל כלי ניהול הציוד במכשיר ללא חשבון וללא העלאת נתונים לענן.</p></div>`;
  $('googleSignIn').onclick=signIn;
  $('startDemo').onclick=startDemo;
  renderSafety();
}

function demoUi(){
  backupWarning(false);
  $('cloudAccountButton').textContent='מצב הדגמה';$('cloudAccountButton').dataset.online='false';
  $('cloudAccountBody').innerHTML='<div class="cloud-panel"><div class="cloud-user">מצב הדגמה פעיל</div><div class="cloud-status">הציוד, השיוכים, ההחזרות, הנוכחות וההיסטוריה זמינים לבדיקה ללא התחברות. הנתונים נשמרים במכשיר בלבד ואינם נשלחים לענן.</div><div class="cloud-actions"><button id="exitDemo" class="btn" type="button">יציאה ממצב הדגמה</button><button id="demoGoogleSignIn" class="btn primary" type="button">כניסה עם Google לסנכרון</button></div></div>';
  $('exitDemo').onclick=()=>{sessionStorage.removeItem(DEMO_KEY);signedOutUi()};
  $('demoGoogleSignIn').onclick=()=>{sessionStorage.removeItem(DEMO_KEY);signIn()};
  renderSafety();
}

function startDemo(){
  sessionStorage.setItem(DEMO_KEY,'1');
  demoUi();
  $('cloudAccountModal')?.classList.remove('show');
  announce('מצב הדגמה פעיל — כל הנתונים נשמרים במכשיר בלבד');
}

function unavailableUi(){
  $('cloudAccountButton').textContent='ענן בהכנה';
  $('cloudAccountBody').innerHTML='<div class="cloud-panel"><h3>החיבור כמעט מוכן</h3><p class="mini">חסר מפתח הפרסום הציבורי של פרויקט Supabase. השמירה המקומית ממשיכה לעבוד כרגיל.</p></div>';
  renderSafety();
}

function offlineUi(){
  $('cloudAccountButton').textContent='אין חיבור לענן';$('cloudAccountButton').dataset.online='false';
  $('cloudAccountBody').innerHTML='<div class="cloud-panel"><h3>אין חיבור לשרת הסנכרון</h3><p class="mini">החשבון לא נותק. אפשר להמשיך לעבוד — הנתונים נשמרים במכשיר ויסונכרנו אוטומטית כשהחיבור יחזור.</p><div class="cloud-actions"><button id="cloudRetry" class="btn primary" type="button">ניסיון חוזר</button></div></div>';
  $('cloudRetry').onclick=()=>connect();
  announce(friendlyError({message:'Failed to fetch'}),'error');
  renderSafety();
}

async function signedInUi(){
  backupWarning(false);
  $('cloudAccountButton').textContent=profile?.role==='admin'?'אדמין · '+displayName(profile):displayName(profile);
  $('cloudAccountButton').dataset.online='true';
  $('cloudAccountBody').innerHTML=`<div class="cloud-panel"><div class="cloud-user">${escapeHtml(displayName(profile))}</div><div class="cloud-status">${escapeHtml(user.email||'')} · ${profile?.role==='admin'?'מנהל מערכת':'מאמן'}</div><div class="cloud-actions">${pendingMigration?'<button id="approveMigration" class="btn primary" type="button">אישור העברת נתוני המכשיר לענן</button>':'<button id="syncNow" class="btn" type="button">סנכרון עכשיו</button>'}<button id="signOut" class="btn danger" type="button">יציאה מהחשבון</button><a class="btn" href="./delete-account.html">בקשת מחיקת חשבון ונתונים</a></div></div>${profile?.role==='admin'?'<div class="cloud-panel"><h3>ניהול מאמנים</h3><p class="mini">בחירת מאמן פותחת את סביבת העבודה שלו. כל שינוי נשמר בחשבונו ונרשם ביומן הבקרה.</p><div id="coachList" class="coach-list"><span class="mini">טוען מאמנים…</span></div></div>':''}`;
  $('approveMigration')?.addEventListener('click',approveMigration);
  if($('syncNow'))$('syncNow').onclick=()=>queueSave(true);
  $('signOut').onclick=()=>client.auth.signOut();
  if(profile?.role==='admin')await loadCoaches();
  renderSafety();
}

async function signIn(){
  const redirectTo=location.origin+location.pathname;
  const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo}});
  if(error)announce('לא ניתן לפתוח כניסה עם Google: '+friendlyError(error),'error');
}

async function loadProfile(){
  const {data,error}=await client.from('profiles').select('id,email,display_name,role,disabled_at').eq('id',user.id).single();
  if(error)throw error;if(data.disabled_at)throw new Error('החשבון הושבת');profile=data;
}

async function getState(ownerId){
  const {data,error}=await client.from('coach_states').select('owner_id,data,revision,updated_at').eq('owner_id',ownerId).single();
  if(error)throw error;return data;
}

// Returns true when a safety copy of unsynced device data was kept.
function replaceLocal(data,ownerId,remoteRevision){
  const current=snapshot(),localOwner=localStorage.getItem(WORKSPACE_KEY)||ownerId;
  const needCopy=hasLocalData()&&snapshotText(current)!==snapshotText(data||{})&&!localMatchesSynced(localOwner);
  const kept=!needCopy||keepSafetyCopy(current,'device');
  if(!kept&&!confirm('אין מספיק מקום לשמור עותק ביטחון של הנתונים במכשיר. להחליף אותם בכל זאת?'))throw new Error('הנתונים במכשיר נשמרו ולא הוחלפו');
  suppressWrites=true;
  try{window.CombatData.clearAll();if(data&&Object.keys(data).length)window.CombatData.importBackup({app:'combat-equipment',data});localStorage.setItem(WORKSPACE_KEY,ownerId)}
  finally{suppressWrites=false}
  clearDirty();activeOwner=ownerId;revision=remoteRevision;recordSynced(ownerId,remoteRevision);
  return needCopy;
}

function refreshAppFromLocal(){
  try{
    if(typeof state!=='undefined'&&typeof defaults!=='undefined')state=window.CombatData.loadState(defaults);
    if(typeof renderAll==='function')renderAll();
    if(typeof renderAttendance==='function')renderAttendance();
  }catch(error){announce('הנתונים נטענו, אך רענון התצוגה נכשל: '+error.message,'error')}
  window.dispatchEvent(new CustomEvent('combat-cloud-data-loaded'));
}

// Brings the device and the cloud copy of one workspace into agreement without silently dropping unsynced local changes.
async function adoptRemote(remote,ownerId){
  activeOwner=ownerId;revision=remote.revision;
  const dirty=readDirty(),localOwner=localStorage.getItem(WORKSPACE_KEY);
  if(snapshotText(remote.data)===snapshotText(snapshot())){
    clearDirty();localStorage.setItem(WORKSPACE_KEY,ownerId);recordSynced(ownerId,remote.revision);synced={owner:ownerId,revision:remote.revision,raws:readRaws()};return;
  }
  const ownDirty=dirty&&dirty.owner===ownerId;
  // Data of another account is never uploaded here; replaceLocal keeps a safety copy of it.
  const unsynced=ownDirty||(hasLocalData()&&(!localOwner||localOwner===ownerId)&&!localMatchesSynced(ownerId));
  if(unsynced){
    localStorage.setItem(WORKSPACE_KEY,ownerId);
    const last=readSynced(),base=ownDirty?dirty.base:last?.owner===ownerId?last.revision:null;
    let keepLocal=base===remote.revision;
    if(!keepLocal)keepLocal=confirm('יש במכשיר הזה נתונים שלא סונכרנו לענן, והם שונים מהנתונים שבענן.\n\nאישור — לשמור את הנתונים מהמכשיר הזה (הם יחליפו את הענן)\nביטול — לטעון את הנתונים מהענן\n\nבשתי הדרכים נשמר עותק ביטחון של הצד שמוחלף, ואפשר לשחזר אותו במסך החשבון.');
    if(keepLocal){
      if(base!==remote.revision)keepSafetyCopy(remote.data,'cloud');
      writeDirty(ownerId,remote.revision);queueSave(true);return;
    }
  }
  const copied=replaceLocal(remote.data,ownerId,remote.revision);refreshAppFromLocal();
  if(copied)announce('הנתונים נטענו מהענן. עותק ביטחון של נתוני המכשיר נשמר במסך החשבון.');
}

async function openOwnWorkspace(){
  const remote=await getState(user.id),remoteHasData=remote.data&&Object.keys(remote.data).length>0;
  const localOwner=localStorage.getItem(WORKSPACE_KEY),dirty=readDirty();
  activeOwner=user.id;revision=remote.revision;
  if(!remoteHasData&&hasLocalData()&&!(dirty&&dirty.owner===user.id)){
    if(localOwner&&localOwner!==user.id){
      // The data on this device belongs to another account: never offer to upload it into this account.
      const otherUnsynced=(dirty&&dirty.owner===localOwner)||!localMatchesSynced(localOwner);
      if(otherUnsynced&&!confirm('במכשיר יש שינויים של חשבון אחר שעדיין לא סונכרנו. מומלץ לבטל, להתחבר לחשבון ההוא ולסנכרן. להמשיך ולמחוק אותם מהמכשיר?')){await client.auth.signOut();throw new Error('הכניסה בוטלה כדי לשמור על הנתונים שבמכשיר')}
      replaceLocal({},user.id,remote.revision);refreshAppFromLocal();return;
    }
    pendingMigration=true;announce('הנתונים עדיין רק במכשיר. נדרש אישור כדי להעביר אותם לענן.');return;
  }
  pendingMigration=false;
  await adoptRemote(remote,user.id);
}

async function openRememberedAdminWorkspace(){
  if(profile?.role!=='admin')return false;
  const remembered=localStorage.getItem(WORKSPACE_KEY);
  if(!remembered||remembered===user.id)return false;
  let remote;
  try{remote=await getState(remembered)}
  catch(error){if(isNetworkError(error))throw error;localStorage.removeItem(WORKSPACE_KEY);return false}
  pendingMigration=false;
  await adoptRemote(remote,remembered);
  return true;
}

async function approveMigration(){
  pendingMigration=false;
  if(!await saveSnapshot(false)){pendingMigration=true;return}
  announce('הנתונים הועברו לענן בהצלחה');await signedInUi();
}

async function loadCoaches(){
  const {data,error}=await client.from('profiles').select('id,email,display_name,role,disabled_at').is('disabled_at',null).order('display_name',{ascending:true});
  if(error){announce('לא ניתן לטעון את רשימת המאמנים','error');return}
  const list=$('coachList');list.innerHTML=data.map(item=>`<button type="button" class="coach-choice ${item.id===activeOwner?'active':''}" data-owner="${escapeHtml(item.id)}"><b>${escapeHtml(displayName(item))}</b><span>${escapeHtml(item.email)}${item.role==='admin'?' · אדמין':''}</span></button>`).join('')||'<span class="mini">אין עדיין מאמנים</span>';
  list.querySelectorAll('[data-owner]').forEach(button=>button.onclick=()=>switchWorkspace(button.dataset.owner));
}

async function switchWorkspace(ownerId){
  if(ownerId===activeOwner)return;
  if(!confirm('לעבור לסביבת העבודה של המאמן שנבחר?'))return;
  try{
    if(activeOwner&&!pendingMigration&&!await flushSave()){announce('לא ניתן לעבור מאמן לפני שהשינויים הנוכחיים יסונכרנו. בדקו את החיבור ונסו שוב.','error');return}
    const remote=await getState(ownerId);replaceLocal(remote.data,ownerId,remote.revision);refreshAppFromLocal();await signedInUi();announce('סביבת המאמן נטענה');
  }catch(error){announce('לא ניתן לפתוח את נתוני המאמן: '+friendlyError(error),'error')}
}

async function saveSnapshot(showSuccess=false){
  if(!client||!user||!activeOwner||pendingMigration)return false;
  if(saveInFlight){saveAgain=true;return false}
  saveInFlight=true;
  const seq=changeSeq;let ok=false,conflict=false;
  try{
    const raws=readRaws(),owner=activeOwner;
    const base=patchSupported&&synced?.owner===owner&&synced.revision===revision?synced.raws:null;
    let next=null,patched=false;
    if(base){
      const set={},remove=[];
      raws.forEach((raw,key)=>{if(raw===(base.get(key)??null))return;if(raw===null)remove.push(key);else set[key]=JSON.parse(raw)});
      if(!Object.keys(set).length&&!remove.length)next=revision;
      else{
        const {data,error}=await client.rpc('patch_coach_state',{p_owner:owner,p_revision:revision,p_set:set,p_remove:remove});
        if(error&&isMissingFunction(error))patchSupported=false;
        else if(error)throw error;
        else{patched=true;if(data===null)conflict=true;else next=Number(data)}
      }
    }
    if(next===null&&!conflict&&!patched){
      const {data,error}=await client.from('coach_states').update({data:dataFromRaws(raws)}).eq('owner_id',owner).eq('revision',revision).select('revision').maybeSingle();
      if(error)throw error;
      if(!data)conflict=true;else next=data.revision;
    }
    if(conflict)synced=null;
    else{
      revision=next;synced={owner,revision,raws};recordSynced(owner,revision,snapshotText(dataFromRaws(raws)));
      if(changeSeq===seq)clearDirty();else writeDirty(activeOwner,revision);
      ok=true;if(showSuccess)announce('הסנכרון הושלם');
    }
  }catch(error){announce('הסנכרון נכשל: '+friendlyError(error),isNetworkError(error)?'offline':'error')}
  finally{saveInFlight=false}
  if(conflict){
    try{const remote=await getState(activeOwner);await adoptRemote(remote,activeOwner);await signedInUi()}
    catch(error){announce('הסנכרון נכשל: '+friendlyError(error),'error')}
  }else if(saveAgain){saveAgain=false;queueSave(false)}
  return ok&&!readDirty();
}

// Saves now and waits; resolves true only when nothing is left unsynced.
async function flushSave(){
  clearTimeout(saveTimer);
  while(saveInFlight)await new Promise(resolve=>setTimeout(resolve,100));
  if(!readDirty())return true;
  await saveSnapshot(false);
  return !readDirty();
}

function queueSave(immediate=false){
  if(!activeOwner||pendingMigration||suppressWrites)return;
  if(saveInFlight){saveAgain=true;return}
  clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveSnapshot(immediate),immediate?0:900);
}

function watchStorage(){
  const originalSet=Storage.prototype.setItem,originalRemove=Storage.prototype.removeItem;
  const changed=key=>{if(APP_KEYS().includes(String(key))){markDirty();queueSave(false)}};
  Storage.prototype.setItem=function(key,value){const result=originalSet.call(this,key,value);if(this===localStorage)changed(key);return result};
  Storage.prototype.removeItem=function(key){const result=originalRemove.call(this,key);if(this===localStorage)changed(key);return result};
  // beforeunload cannot wait for a network request; save when the app is hidden and rely on the dirty marker otherwise.
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&activeOwner&&readDirty())queueSave(true)});
  window.addEventListener('online',()=>{
    if(waitingForNetwork)connect();
    else if(activeOwner&&readDirty())queueSave(true);
  });
}

async function onSession(session){
  user=session?.user||null;profile=null;activeOwner=null;pendingMigration=false;
  if(!user){signedOutUi();window.dispatchEvent(new CustomEvent('combat-cloud-ready'));return}
  try{await loadProfile();if(!await openRememberedAdminWorkspace())await openOwnWorkspace();await signedInUi();window.dispatchEvent(new CustomEvent('combat-cloud-ready'))}
  catch(error){
    if(isNetworkError(error)){waitingForNetwork=true;offlineUi()}
    else{announce('לא ניתן לפתוח את החשבון: '+friendlyError(error),'error');signedOutUi()}
    window.dispatchEvent(new CustomEvent('combat-cloud-ready'));
  }
}

async function connect(){
  if(connecting)return;connecting=true;waitingForNetwork=false;
  try{
    const {data:{session},error}=await client.auth.getSession();
    if(error&&isNetworkError(error)){
      // The saved login is kept by the auth client; only the token refresh failed. Retry when the network returns.
      waitingForNetwork=true;offlineUi();window.dispatchEvent(new CustomEvent('combat-cloud-ready'));return;
    }
    if(error)announce('שגיאה בפתיחת החשבון: '+friendlyError(error),'error');
    if(!session&&sessionStorage.getItem(DEMO_KEY)==='1'){demoUi();window.dispatchEvent(new CustomEvent('combat-cloud-ready'));return}
    await onSession(session);
  }finally{connecting=false}
}

// Used by "clear device data": keeps the cloud copy intact and detaches this device from the account.
async function detachDevice(){
  if(!client||!user)return true;
  if(activeOwner&&!pendingMigration&&!await flushSave()){
    if(!confirm('יש שינויים שעדיין לא סונכרנו לענן והם יימחקו. להמשיך בכל זאת?'))return false;
  }
  clearTimeout(saveTimer);activeOwner=null;clearDirty();localStorage.removeItem(WORKSPACE_KEY);localStorage.removeItem(SYNCED_KEY);localStorage.removeItem(SAFETY_KEY);
  try{await client.auth.signOut()}catch{}
  return true;
}

async function start(){
  addUi();
  window.CombatCloud=Object.freeze({isSignedIn:()=>Boolean(user),detachDevice});
  if(!READY){unavailableUi();return}
  client=createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  watchStorage();
  await connect();
  client.auth.onAuthStateChange((event,nextSession)=>{
    if(event==='SIGNED_OUT')setTimeout(()=>onSession(null),0);
    else if(event==='SIGNED_IN'&&nextSession?.user?.id&&nextSession.user.id!==user?.id)setTimeout(()=>onSession(nextSession),0);
  });
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
