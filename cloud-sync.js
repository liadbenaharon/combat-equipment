import {createClient} from '@supabase/supabase-js';

const config=window.COMBAT_CLOUD||{};
const APP_KEYS=()=>Object.values(window.CombatData?.KEYS||{});
const WORKSPACE_KEY='combatCloudWorkspaceV1';
const READY=typeof config.url==='string'&&config.url.startsWith('https://')&&
  typeof config.publishableKey==='string'&&!config.publishableKey.startsWith('REPLACE_');

let client=null,user=null,profile=null,activeOwner=null,revision=0;
let suppressWrites=false,pendingMigration=false,saveTimer=0,saveInFlight=false,saveAgain=false;

const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const displayName=item=>item?.display_name?.trim()||item?.email||'מאמן ללא שם';
const snapshot=()=>window.CombatData?.exportBackup()?.data||{};
const snapshotText=data=>JSON.stringify(data||{});
const hasLocalData=()=>APP_KEYS().some(key=>localStorage.getItem(key)!==null);

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
  $('cloudAccountBody').innerHTML=`<div class="cloud-panel"><h3>שמירה מאובטחת בענן</h3><p class="mini">הנתונים במכשיר לא יועלו בלי אישור מפורש. לאחר הכניסה כל מאמן רואה רק את הנתונים שלו.</p><div class="cloud-actions"><button id="googleSignIn" class="btn primary" type="button">כניסה עם Google</button></div></div>`;
  $('googleSignIn').onclick=signIn;
}

function unavailableUi(){
  $('cloudAccountButton').textContent='ענן בהכנה';
  $('cloudAccountBody').innerHTML='<div class="cloud-panel"><h3>החיבור כמעט מוכן</h3><p class="mini">חסר מפתח הפרסום הציבורי של פרויקט Supabase. השמירה המקומית ממשיכה לעבוד כרגיל.</p></div>';
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
  if(error)announce('לא ניתן לפתוח כניסה עם Google: '+error.message,'error');
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
  activeOwner=ownerId;revision=remoteRevision;
}

async function openOwnWorkspace(){
  const remote=await getState(user.id),remoteHasData=remote.data&&Object.keys(remote.data).length>0;
  activeOwner=user.id;revision=remote.revision;
  if(!remoteHasData&&hasLocalData()){
    pendingMigration=true;announce('הנתונים עדיין רק במכשיר. נדרש אישור כדי להעביר אותם לענן.');return;
  }
  pendingMigration=false;
  if(remoteHasData&&snapshotText(remote.data)!==snapshotText(snapshot())){
    replaceLocal(remote.data,user.id,remote.revision);location.reload();return;
  }
  localStorage.setItem(WORKSPACE_KEY,user.id);
}

async function openRememberedAdminWorkspace(){
  if(profile?.role!=='admin')return false;
  const remembered=localStorage.getItem(WORKSPACE_KEY);
  if(!remembered||remembered===user.id)return false;
  try{
    const remote=await getState(remembered);
    activeOwner=remembered;revision=remote.revision;pendingMigration=false;
    if(snapshotText(remote.data)!==snapshotText(snapshot())){
      replaceLocal(remote.data,remembered,remote.revision);location.reload();
    }
    return true;
  }catch{
    localStorage.removeItem(WORKSPACE_KEY);return false;
  }
}

async function approveMigration(){
  pendingMigration=false;
  await saveSnapshot(true);
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
    if(activeOwner&&!pendingMigration)await saveSnapshot(false);
    const remote=await getState(ownerId);replaceLocal(remote.data,ownerId,remote.revision);location.reload();
  }catch(error){announce('לא ניתן לפתוח את נתוני המאמן: '+error.message,'error')}
}

async function saveSnapshot(showSuccess=false){
  if(!client||!user||!activeOwner||pendingMigration||saveInFlight)return;
  saveInFlight=true;
  try{
    const current=snapshot();
    const {data,error}=await client.from('coach_states').update({data:current}).eq('owner_id',activeOwner).eq('revision',revision).select('revision').maybeSingle();
    if(error)throw error;
    if(!data)throw new Error('המידע השתנה במכשיר אחר. יש לרענן לפני שמירה נוספת.');
    revision=data.revision;
    if(showSuccess)announce('הסנכרון הושלם');
  }catch(error){announce('הסנכרון נכשל: '+error.message,'error')}
  finally{saveInFlight=false;if(saveAgain){saveAgain=false;queueSave(false)}}
}

function queueSave(immediate=false){
  if(!activeOwner||pendingMigration||suppressWrites)return;
  if(saveInFlight){saveAgain=true;return}
  clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveSnapshot(immediate),immediate?0:900);
}

function watchStorage(){
  const originalSet=Storage.prototype.setItem,originalRemove=Storage.prototype.removeItem;
  Storage.prototype.setItem=function(key,value){const result=originalSet.call(this,key,value);if(this===localStorage&&APP_KEYS().includes(String(key)))queueSave(false);return result};
  Storage.prototype.removeItem=function(key){const result=originalRemove.call(this,key);if(this===localStorage&&APP_KEYS().includes(String(key)))queueSave(false);return result};
  window.addEventListener('beforeunload',()=>{if(activeOwner&&!pendingMigration)queueSave(true)});
}

async function onSession(session){
  user=session?.user||null;profile=null;activeOwner=null;pendingMigration=false;
  if(!user){signedOutUi();return}
  try{await loadProfile();if(!await openRememberedAdminWorkspace())await openOwnWorkspace();await signedInUi()}
  catch(error){announce('לא ניתן לפתוח את החשבון: '+error.message,'error');signedOutUi()}
}

async function start(){
  addUi();
  if(!READY){unavailableUi();return}
  client=createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  watchStorage();
  const {data:{session},error}=await client.auth.getSession();
  if(error)announce('שגיאה בפתיחת החשבון: '+error.message,'error');
  await onSession(session);
  client.auth.onAuthStateChange((event,nextSession)=>{if(event==='SIGNED_IN'||event==='SIGNED_OUT')setTimeout(()=>onSession(nextSession),0)});
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
