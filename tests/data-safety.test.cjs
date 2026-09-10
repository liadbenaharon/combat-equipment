const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');

function harness(seed={}){
  const data=new Map(Object.entries(seed));
  const context={
    localStorage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)},
    dispatchEvent(){},CustomEvent:class{},Date,JSON
  };
  context.window=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'app-config.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'data-safety.js'),'utf8'),context);
  return {api:context.CombatData,context,data};
}

test('legacy state is normalized without dropping unknown fields',()=>{
  const state={custom:'keep',equipment:[{id:'x',name:' X ',qty:'3',checked:[1],assignments:[{name:' Dana ',qty:2,legacy:true}],future:'keep'}]};
  const {api}=harness();const normalized=api.normalizeState(state,[]),eq=normalized.equipment[0];
  assert.equal(normalized.custom,'keep');assert.equal(eq.future,'keep');assert.equal(eq.name,'X');assert.deepEqual([...eq.checked],[true,false,false]);assert.equal(eq.assignments[0].name,'Dana');assert.equal(eq.assignments[0].legacy,true);
});

test('invalid state falls back and malformed equipment is repaired safely',()=>{
  const {api}=harness();const defaults=[{id:'default',name:'Default',qty:1,checked:[false],assignments:[]}];
  assert.equal(api.normalizeState(null,defaults).equipment[0].id,'default');
  const repaired=api.normalizeState({equipment:[null,{name:'',qty:999,assignments:'bad'}]},defaults);
  assert.equal(repaired.equipment.length,1);assert.equal(repaired.equipment[0].qty,1);assert.deepEqual([...repaired.equipment[0].assignments],[]);
});

test('history receives stable legacy ids and remains capped',()=>{
  const {api}=harness();const input=Array.from({length:110},(_,i)=>({date:`d${i}`,equipment:[]}));const history=api.normalizeHistory(input);
  assert.equal(history.length,100);assert.match(String(history[0].id),/^legacy-0-/);assert.equal(history[0].date,'d0');
});

test('backup exports only app keys and round-trips',()=>{
  const key='combatEquipmentStateV1',source={equipment:[{id:'x',name:'x',qty:1,checked:[false],assignments:[]}]};
  const {api,data}=harness({[key]:JSON.stringify(source),unrelated:'untouched'});const backup=api.exportBackup();
  assert.equal(backup.app,'combat-equipment');assert.deepEqual(backup.data[key],source);assert.equal(backup.data.unrelated,undefined);
  data.set(key,'changed');assert.equal(api.importBackup(backup),1);const restored=JSON.parse(data.get(key));assert.equal(restored.equipment[0].id,'x');assert.equal(restored.equipment[0].icon,'🎒');assert.equal(data.get('unrelated'),'untouched');
});

test('backup rejects unknown keys before writing',()=>{
  const {api,data}=harness({sentinel:'safe'});
  assert.throws(()=>api.importBackup({app:'combat-equipment',data:{evil:{}}}),/לא מוכר/);assert.equal(data.get('sentinel'),'safe');
});

test('backup rejects invalid known shapes instead of persisting them',()=>{
  const {api,data}=harness({combatEquipmentStateV1:'safe'});
  assert.throws(()=>api.importBackup({app:'combat-equipment',data:{combatEquipmentStateV1:{equipment:'bad'}}}),/מצב הציוד/);assert.equal(data.get('combatEquipmentStateV1'),'safe');
});

test('clear all removes only application data',()=>{
  const {api,data}=harness({combatEquipmentStateV1:'state',combatEquipmentContactsV1:'contacts',unrelated:'keep'});api.clearAll();
  assert.equal(data.has('combatEquipmentStateV1'),false);assert.equal(data.has('combatEquipmentContactsV1'),false);assert.equal(data.get('unrelated'),'keep');
});

test('failed safe write reports failure and leaves the caller in control',()=>{
  const {api,context}=harness();context.localStorage.setItem=()=>{throw Error('quota')};assert.equal(api.writeJson('combatEquipmentStateV1',{}),false);
});

test('transaction rolls back every earlier write when a later write fails',()=>{
  const {api,context,data}=harness({a:'old-a',b:'old-b'});let writes=0;
  context.localStorage.setItem=(key,value)=>{writes++;if(key==='b'&&writes===2)throw Error('quota');data.set(key,value)};
  assert.equal(api.transaction({a:'new-a',b:'new-b'}),false);assert.equal(data.get('a'),'old-a');assert.equal(data.get('b'),'old-b');
});

test('all visible version writers use the central version',()=>{
  const config=fs.readFileSync(path.join(root,'app-config.js'),'utf8');assert.match(config,/version:'2\.4\.11'/);
  for(const file of ['equipment-icons.js','quantity-shortcut.js','history-collapse.js','attendance.js','contacts-count.js','app-lifecycle.js'])assert.match(fs.readFileSync(path.join(root,file),'utf8'),/COMBAT_APP/,file);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,'2.4.11');
});

test('backup success status is automatically dismissed',()=>{
  const source=fs.readFileSync(path.join(root,'app-lifecycle.js'),'utf8');
  assert.match(source,/announce\('הגיבוי מוכן לשמירה'\)/);
  assert.match(source,/if\(duration>0\)statusTimer=setTimeout\(\(\)=>\{node\.hidden=true;node\.textContent=''\},duration\)/);
});

test('ambiguous attendance names get an explicit manual-review state',()=>{
  const source=fs.readFileSync(path.join(root,'contacts-count.js'),'utf8');
  assert.match(source,/function ambiguousPeople\(\)/);
  assert.match(source,/שמות שדורשים בדיקה/);
  assert.match(source,/לא משייכים אוטומטית/);
  assert.match(source,/trainee-ambiguous/);
});

test('Google Play native shell stays aligned with the web release',()=>{
  const web=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
  const twa=JSON.parse(fs.readFileSync(path.join(root,'android','twa-manifest.example.json'),'utf8'));
  const gradle=fs.readFileSync(path.join(root,'android','app','build.gradle'),'utf8');
  const androidManifest=fs.readFileSync(path.join(root,'android','app','src','main','AndroidManifest.xml'),'utf8');
  const workflow=fs.readFileSync(path.join(root,'.github','workflows','android-aab.yml'),'utf8');
  assert.equal(web.start_url,'/combat-equipment/');
  assert.equal(web.scope,'/combat-equipment/');
  assert.equal(twa.packageId,'com.liadbenaharon.combatequipment');
  assert.equal(twa.startUrl,web.start_url);
  assert.equal(twa.appVersion,'2.4.11');
  assert.equal(twa.appVersionCode,261);
  assert.equal(twa.enableNotifications,false);
  assert.match(gradle,/applicationId 'com\.liadbenaharon\.combatequipment'/);
  assert.match(gradle,/compileSdk 36/);
  assert.match(gradle,/targetSdk 36/);
  assert.match(gradle,/versionCode 261/);
  assert.match(gradle,/minifyEnabled false/);
  assert.match(gradle,/shrinkResources false/);
  assert.doesNotMatch(gradle,/androidbrowserhelper/);
  assert.deepEqual([...androidManifest.matchAll(/<uses-permission[^>]+android:name="([^"]+)"/g)].map(match=>match[1]),['android.permission.INTERNET']);
  assert.match(androidManifest,/android:usesCleartextTraffic="false"/);
  assert.match(androidManifest,/android:host="liadbenaharon\.github\.io"/);
  assert.match(androidManifest,/android:pathPrefix="\/combat-equipment\/"/);
  assert.match(androidManifest,/android:name="\.MainActivity"/);
  assert.doesNotMatch(androidManifest,/trusted\.LauncherActivity/);
  assert.doesNotMatch(androidManifest,/SPLASH_IMAGE_DRAWABLE|FILE_PROVIDER_AUTHORITY|FileProvider/);
  assert.match(fs.readFileSync(path.join(root,'android','app','src','main','res','values','strings.xml'),'utf8'),/<string name="app_name">Combat Equipment<\/string>/);
  assert.match(workflow,/bundleRelease/);
  assert.match(fs.readFileSync(path.join(root,'android','README.md'),'utf8'),/Digital Asset Links/);
});

test('Digital Asset Links template includes both Google Play app-signing certificates',()=>{
  const links=JSON.parse(fs.readFileSync(path.join(root,'android','assetlinks.template.json'),'utf8'));
  const target=links[0].target;
  assert.equal(target.package_name,'com.liadbenaharon.combatequipment');
  assert.deepEqual(target.sha256_cert_fingerprints,[
    'B8:94:BE:85:76:14:33:BB:0B:92:65:7A:32:04:07:BA:4D:11:76:48:BE:06:B9:B4:5B:4E:C9:DD:05:BA:00:34',
    'A8:2B:52:E5:97:CE:94:61:A9:3A:F6:89:AD:A6:73:8D:0E:2C:48:D2:46:7D:7D:03:84:37:D7:62:05:4A:AB:F4'
  ]);
});

test('Google Play review demo is available without cloud authentication',()=>{
  const source=fs.readFileSync(path.join(root,'cloud-sync.js'),'utf8');
  assert.match(source,/כניסה למצב הדגמה/);
  assert.match(source,/מצב הדגמה פעיל/);
  assert.match(source,/sessionStorage\.setItem\(DEMO_KEY,'1'\)/);
  assert.match(source,/הנתונים נשמרים במכשיר בלבד ואינם נשלחים לענן/);
});

test('cloud client points at the active Supabase project hostname',()=>{
  const config=fs.readFileSync(path.join(root,'cloud-config.js'),'utf8');
  assert.match(config,/https:\/\/rryvwztjrbvsczyamrtu\.supabase\.co/);
  assert.doesNotMatch(config,/rryvwztjbvsczyamrtu/);
});

test('cloud authentication loads data without a reload loop',()=>{
  const source=fs.readFileSync(path.join(root,'cloud-sync.js'),'utf8');
  assert.match(source,/function refreshAppFromLocal\(\)/);
  assert.match(source,/combat-cloud-data-loaded/);
  assert.doesNotMatch(source,/location\.reload\(/);
  assert.match(source,/nextSession\.user\.id!==user\?\.id/);
});

test('native mobile shell and theme are shipped in both HTML and offline cache',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),theme=fs.readFileSync(path.join(root,'app-theme.css'),'utf8');
  assert.match(html,/app-theme\.css\?v=6/);assert.match(html,/app-config\.js\?v=15/);assert.match(html,/native-ui\.js\?v=5/);assert.match(sw,/app-theme\.css\?v=6/);assert.match(sw,/app-config\.js\?v=15/);assert.match(sw,/native-ui\.js\?v=5/);
  assert.match(theme,/\.overlay\{z-index:240\}/);assert.match(theme,/\.overlay \.modalBtns\{position:sticky/);
  assert.match(theme,/@media\(max-width:699px\)/);assert.match(theme,/position:fixed/);assert.match(theme,/safe-area-inset-bottom/);
});

test('equipment saves expose a bounded undo flow',()=>{
  const lifecycle=fs.readFileSync(path.join(root,'app-lifecycle.js'),'utf8'),native=fs.readFileSync(path.join(root,'native-ui.js'),'utf8');
  assert.match(lifecycle,/combat-state-saved/);assert.match(lifecycle,/detail:\{previous\}/);assert.match(native,/offerUndo/);assert.match(native,/combat-state-restored/);assert.match(native,/7000/);
});

test('assignment dialog stays above undo feedback and ignores a stale rapid second save',()=>{
  const theme=fs.readFileSync(path.join(root,'app-theme.css'),'utf8'),equipment=fs.readFileSync(path.join(root,'equipment-icons.js'),'utf8');
  assert.match(theme,/\.overlay\{z-index:240\}/);assert.match(theme,/\.overlay \.modalBtns\{position:sticky/);
  assert.match(equipment,/if\(!assignModal\.classList\.contains\('show'\)\)return/);
});

test('attendance and returns use stable history ids and finish moves current attendance',()=>{
  const attendance=fs.readFileSync(path.join(root,'attendance.js'),'utf8'),returns=fs.readFileSync(path.join(root,'returns.js'),'utf8');
  assert.match(attendance,/key:`history:\$\{x\.id\|\|i\}`/);assert.match(attendance,/legacyKey:'history-'\+i/);
  assert.match(returns,/attendance\[`history:\$\{id\}`\]=attendance\.current/);assert.match(returns,/delete attendance\.current/);assert.match(returns,/CombatData\.transaction/);
});

test('open historical debts transfer into the next equipment cards and remain transferable from history',()=>{
  const attendance=fs.readFileSync(path.join(root,'attendance.js'),'utf8'),returns=fs.readFileSync(path.join(root,'returns.js'),'utf8'),history=fs.readFileSync(path.join(root,'history-collapse.js'),'utf8');
  assert.doesNotMatch(returns,/panel\.innerHTML=`<div id="carryOverList">/);assert.match(returns,/carryEquipment\(id,current\)/);
  assert.match(history,/history-transfer/);assert.match(history,/combatOpenHistoryTransfer/);
  assert.match(attendance,/historicalReturnData/);assert.match(attendance,/syncCarriedTransfer/);assert.match(attendance,/openSlots/);
});

test('cloud schema enforces coach isolation and an explicit admin role',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase','bootstrap.sql'),'utf8'),cloud=fs.readFileSync(path.join(root,'cloud-sync.js'),'utf8');
  assert.match(sql,/alter table public\.profiles enable row level security/);
  assert.match(sql,/alter table public\.coach_states enable row level security/);
  assert.match(sql,/owner_id = \(select auth\.uid\(\)\) or \(select private\.is_admin\(\)\)/);
  assert.match(sql,/liadpro12345@gmail\.com/);
  assert.doesNotMatch(sql,/user_metadata[^\n]+(?:role|admin)/i);
  assert.match(cloud,/flowType:'pkce'/);
  assert.match(cloud,/אישור העברת נתוני המכשיר לענן/);
  assert.match(cloud,/\.eq\('revision',revision\)/);
  assert.match(cloud,/openRememberedAdminWorkspace/);
});

