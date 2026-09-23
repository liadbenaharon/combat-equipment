import {createClient} from '@supabase/supabase-js';

const config=window.COMBAT_CLOUD||{};
const APP_KEYS=()=>Object.values(window.CombatData?.KEYS||{});
const WORKSPACE_KEY='combatCloudWorkspaceV1';
const DEMO_KEY='combatReviewDemoV1';
const DIRTY_KEY='combatCloudDirtyV1';
const READY=typeof config.url==='string'&&config.url.startsWith('https://')&&
  typeof config.publishableKey==='string'&&!config.publishableKey.startsWith('REPLACE_');

let client=null,user=null,profile=null,activeOwner=null,revision=0;
let suppressWrites=false,pendingMigration=false,saveTimer=0,saveInFlight=false,saveAgain=false;
let changeSeq=0,connecting=false,waitingForNetwork=false;

const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const displayName=item=>item?.display_name?.trim()||item?.email||'מאמן ללא שם';
const snapshot=()=>window.CombatData?.exportBackup()?.data||{};
const snapshotText=data=>JSON.stringify(data||{});
const hasLocalData=()=>APP_KEYS().some(key=>localStorage.getItem(key)!==null);

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
    .headline{flex-wrap:wrap}.cloud-account{order:3;width:100%;min-height:42px;border:1px solid #52634a;border-radius:12px;background:#182017;color:#f4f2e8;font:inherit;font-weight:900;padding:8px 12px}
    .cloud-account[data-online="true"]{color:#c9ffd0;border-color:#53745a}.cloud-modal{max-height:min(82vh,720px);overflow:auto}.cloud-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.cloud-title h2{margin:0}.cloud-close{width:44px;min-height:44px;border:1px solid #56624e;border-radius:12px;background:#171c15;color:#fff;font-size:28px}.cloud-notice{margin:12px 0;padding:10px 12px;border-radius:11px;background:#293221}.cloud-notice[data-type="error"]{background:#4a211d;color:#ffd5d0}.cloud-panel{border:1px solid #43513d;border-radius:14px;padding:13px;margin-top:12px}.cloud-actions{display:grid;gap:8px;margin-top:12px}.cloud-user{font-weight:900;font-size:17px}.cloud-status{color:#b8baaf;font-size:13px;margin-top:4px}.coach-list{display:grid;gap:8px;margin-top:10px}.coach-choice{text-align:right;border:1px solid #4c5843;border-radius:12px;background:#161c14;color:#fff;padding:11px}.coach-choice.active{border-color:#f07a22;background:#322317}.coach-choice span{display:block;color:#b8baaf;font-size:12px;margin-top:3px}
  `;document.head.appendChild(style);
}

function signedOutUi(){
  $('cloudAccountButton').textContent='כניסה עם Google';$('cloudAccountButton').dataset.online='false';
  $('cloudAccountBody').innerHTML=`<div class="cloud-panel"><h3>שמירה מאובטחת בענן</h3><p class="mini">הנתונים במכשיר לא יועלו בלי אישור מפורש. לאחר הכניסה כל מאמן רואה רק את הנתונים שלו.</p><div class="cloud-actions"><button id="googleSignIn" class="btn primary" type="button">כניסה עם Google</button><button id="startDemo" class="btn" type="button">כניסה למצב הדגמה</button></div><p class="mini">מצב ההדגמה מאפשר לבדוק את כל כלי ניהול הציוד במכשיר ללא חשבון וללא העלאת נתונים לענן.</p></div>`;
  $('googleSignIn').onclick=signIn;
  $('startDemo').onclick=startDemo;
}

function demoUi(){
  $('cloudAccountButton').textContent='מצב הדגמה';$('cloudAccountButton').dataset.online='false';
  $('cloudAccountBody').innerHTML='<div class="cloud-panel"><div class="cloud-user">מצב הדגמה פעיל</div><div class="cloud-status">הציוד, השיוכים, ההחזרות, הנוכחות וההיסטוריה זמינים לבדיקה ללא התחברות. הנתונים נשמרים במכשיר בלבד ואינם נשלחים לענן.</div><div class="cloud-actions"><button id="exitDemo" class="btn" type="button">יציאה ממצב הדגמה</button><button id="demoGoogleSignIn" class="btn primary" type="button">כניסה עם Google לסנכרון</button></div></div>';
  $('exitDemo').onclick=()=>{sessionStorage.removeItem(DEMO_KEY);signedOutUi()};
  $('demoGoogleSignIn').onclick=()=>{sessionStorage.removeItem(DEMO_KEY);signIn()};
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
}

function offlineUi(){
  $('cloudAccountButton').textContent='אין חיבור לענן';$('cloudAccountButton').dataset.online='false';
  $('cloudAccountBody').innerHTML='<div class="cloud-panel"><h3>אין חיבור לשרת הסנכרון</h3><p class="mini">החשבון לא נותק. אפשר להמשיך לעבוד — הנתונים נשמרים במכשיר ויסונכרנו אוטומטית כשהחיבור יחזור.</p><div class="cloud-actions"><button id="cloudRetry" class="btn primary" type="button">ניסיון חוזר</button></div></div>';
  $('cloudRetry').onclick=()=>connect();
  announce(friendlyError({message:'Failed to fetch'}),'error');
}

async function signedInUi(){
  $('cloudAccountButton').textContent=profile?.role==='admin'?'אדמין · '+displayName(profile):displayName(profile);
  $('cloudAccountButton').dataset.online='true';
  $('cloudAccountBody').innerHTML=`<div class="cloud-panel"><div class="cloud-user">${escapeHtml(displayName(profile))}</div><div class="cloud-status">${escapeHtml(user.email||'')} · ${profile?.role==='admin'?'מנהל מערכת':'מאמן'}</div><div class="cloud-actions">${pendingMigration?'<button id="approveMigration" class="btn primary" type="button">אישור העברת נתוני המכשיר לענן</button>':'<button id="syncNow" class="btn" type="button">סנכרון עכשיו</button>'}<button id="signOut" class="btn danger" type="button">יציאה מהחשבון</button><a class="btn" href="./delete-account.html">בקשת מחיקת חשבון ונתונים</a></div></div>${profile?.role==='admin'?'<div class="cloud-panel"><h3>ניהול מאמנים</h3><p class="mini">בחירת מאמן פותחת את סביבת העבודה שלו. כל שינוי נשמר בחשבונו ונרשם ביומן הבקרה.</p><div id="coachList" class="coach-list"><span class="mini">טוען מאמנים…</span></div></div>':''}`;
  $('approveMigration')?.addEventListener('click',approveMigration);
  if($('syncNow'))$('syncNow').onclick=()=>queueSave(true);
  $('signOut').onclick=()=>client.auth.signOut();
  if(profile?.role==='admin')await loadCoaches();
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

function replaceLocal(data,ownerId,remoteRevision){
  suppressWrites=true;
  try{window.CombatData.clearAll();if(data&&Object.keys(data).length)window.CombatData.importBackup({app:'combat-equipment',data});localStorage.setItem(WORKSPACE_KEY,ownerId)}
  finally{suppressWrites=false}
  clearDirty();activeOwner=ownerId;revision=remoteRevision;
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
  const dirty=readDirty();
  if(dirty&&dirty.owner===ownerId){
    localStorage.setItem(WORKSPACE_KEY,ownerId);
    if(dirty.base===remote.revision){queueSave(true);return}
    if(snapshotText(remote.data)===snapshotText(snapshot())){clearDirty();return}
    const keepLocal=confirm('יש במכשיר הזה שינויים שעדיין לא סונכרנו, ובינתיים הנתונים בענן עודכנו ממכשיר אחר.\n\nאישור — לשמור את הנתונים מהמכשיר הזה (הם יחליפו את הענן)\nביטול — לטעון את הנתונים מהענן (השינויים שלא סונכרנו יימחקו)');
    if(keepLocal){queueSave(true);return}
  }
  if(snapshotText(remote.data)!==snapshotText(snapshot())){replaceLocal(remote.data,ownerId,remote.revision);refreshAppFromLocal();return}
  clearDirty();localStorage.setItem(WORKSPACE_KEY,ownerId);
}

async function openOwnWorkspace(){
  const remote=await getState(user.id),remoteHasData=remote.data&&Object.keys(remote.data).length>0;
  const localOwner=localStorage.getItem(WORKSPACE_KEY),dirty=readDirty();
  activeOwner=user.id;revision=remote.revision;
  if(!remoteHasData&&hasLocalData()&&!(dirty&&dirty.owner===user.id)){
    if(localOwner&&localOwner!==user.id){
      // The data on this device belongs to another account: never offer to upload it into this account.
      const otherUnsynced=dirty&&dirty.owner===localOwner;
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
    const current=snapshot();
    const {data,error}=await client.from('coach_states').update({data:current}).eq('owner_id',activeOwner).eq('revision',revision).select('revision').maybeSingle();
    if(error)throw error;
    if(!data)conflict=true;
    else{
      revision=data.revision;
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
  clearTimeout(saveTimer);activeOwner=null;clearDirty();localStorage.removeItem(WORKSPACE_KEY);
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
