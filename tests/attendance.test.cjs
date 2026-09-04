// Run with: node --test tests/attendance.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'attendance.js'),'utf8');
const CK='combatEquipmentContactsV1',PK='combatEquipmentPhonesV1',AK='combatEquipmentAttendanceV2';
function harness(seed={}){
  const data=new Map(Object.entries(seed)),elements={},alerts=[],prompts=[],clipboard=[];
  const localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const ctx={localStorage,document:{getElementById:id=>elements[id]||null,querySelectorAll:()=>[]},window:{location:{href:''}},navigator:{clipboard:{writeText:async s=>clipboard.push(s)}},alert:s=>alerts.push(s),prompt:(...a)=>prompts.push(a),confirm:()=>true,esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),state:{equipment:[]}};
  vm.createContext(ctx);
  // Exercise production functions without booting the DOM observer or page UI.
  vm.runInContext(source.slice(0,source.indexOf('  let observerBusy='))+`\nwindow.test={normalizePhone,makeContact,parseContacts,validateContacts,readContacts,writeContacts,contactPhone,parseList,statusOf,noShowsWithGear,openWhatsApp,copyMessage,checkAssignedNoShows,deleteSelectedContacts,selectedContacts,updateContactSelection,clearContactSelection,renderContacts,select:key=>selectedWorkout=key};})();`,ctx);
  return {api:ctx.window.test,ctx,data,elements,alerts,prompts,clipboard};
}
test('phone normalization: local, international, punctuation, invalid input',()=>{
  const {api:a}=harness();
  for(const [input,want] of [['050-000-0000','972500000000'],['03 000 0000','97230000000'],['+44 7700 900123','447700900123'],['0044 (7700) 900123','447700900123'],['abc0500000000',''],['123',''],['+972+500000000',''],['0000000000',''],['1234567890123456','']])assert.equal(a.normalizePhone(input),want,input);
});
test('import CSV, spreadsheet tabs, semicolons, header, aliases and Hebrew quotes',()=>{
  const {api:a}=harness();
  const rows=a.parseContacts('שם,מספר,שמות חלופיים\n"בדיקה, אחת",0500000000,ראשון|ראשון\nבדיקה שתיים\t+44 7700 900123\tשני\nד"ר בדיקה;0500000002;שלישי');
  assert.equal(rows.length,3);assert.equal(rows[0].name,'בדיקה, אחת');assert.equal(rows[0].aliases.length,1);assert.equal(rows[1].phone,'447700900123');assert.equal(rows[2].name,'ד"ר בדיקה');
  assert.throws(()=>a.parseContacts('תקין,0500000000\nשגוי,no-number'),/שורה 2/);
  assert.throws(()=>a.parseContacts('"לא סגור,0500000000'),/מרכאות/);
  assert.throws(()=>a.parseContacts('שם,מספר'),/לפחות/);
});
test('exact normalized alias lookup, ambiguous names and conflicts fail safely',()=>{
  const {api:a,data}=harness();
  const first=a.makeContact('בדיקה אחת','0500000000',['כינוי ראשון']);a.writeContacts([first]);
  assert.equal(a.contactPhone('\u200f כינוי   ראשון '),'972500000000');assert.equal(a.contactPhone('בדיקה'),'');
  const before=data.get(CK);
  assert.throws(()=>a.writeContacts([first,a.makeContact('בדיקה שתיים','0500000001',['כינוי ראשון'])]),/כבר שייך/);
  assert.equal(data.get(CK),before);
  data.set(CK,JSON.stringify([first,first]));assert.equal(a.contactPhone('בדיקה אחת'),'');
});
test('legacy migration, edits, removal and reload leave equipment/history untouched',()=>{
  const equipment='{"equipment":[]}',history='[{"date":"test"}]';
  const {api:a,data}=harness({[PK]:JSON.stringify({'בדיקה':'0500000000'}),combatEquipmentStateV1:equipment,combatEquipmentHistoryV1:history});
  assert.equal(a.contactPhone('בדיקה'),'972500000000');
  a.writeContacts([a.makeContact('בדיקה חדשה','0500000001',['בדיקה'])]);
  assert.equal(data.has(PK),false);assert.equal(a.contactPhone('בדיקה'),'972500000001');
  assert.equal(harness(Object.fromEntries(data)).api.contactPhone('בדיקה חדשה'),'972500000001');
  a.writeContacts([]);assert.equal(a.contactPhone('בדיקה'),'');
  assert.equal(data.get('combatEquipmentStateV1'),equipment);assert.equal(data.get('combatEquipmentHistoryV1'),history);
});
test('corrupt or unavailable storage never routes to a guessed number',()=>{
  const {api:a,ctx,data}=harness({[CK]:'bad json'});
  assert.equal(a.contactPhone('בדיקה'),'');assert.throws(()=>a.readContacts());assert.equal(data.get(CK),'bad json');
  ctx.localStorage.setItem=()=>{throw Error('quota')};assert.throws(()=>a.writeContacts([]),/לא ניתן לשמור/);
});
function bulkHarness(){
  const h=harness({combatEquipmentStateV1:'equipment sentinel',[AK]:'attendance sentinel'});
  for(const id of ['contactForm','saveContact','cancelContactEdit','contactsList','contactNotice','deleteSelectedContacts','clearContactSelection','contactSelectionCount'])h.elements[id]={style:{},reset(){}};
  h.api.writeContacts([h.api.makeContact('ראשון','0500000000',['כינוי ראשון']),h.api.makeContact('נשאר','0500000001',['כינוי נשאר']),h.api.makeContact('אחרון','0500000002',['כינוי אחרון'])]);
  return h;
}
test('bulk deletion removes only selected contacts and aliases, preserving other app data',()=>{
  const {api:a,ctx,data,elements}=bulkHarness();let confirmation='';
  a.selectedContacts.add('ראשון');a.selectedContacts.add('אחרון');a.updateContactSelection();
  assert.equal(elements.deleteSelectedContacts.textContent,'מחק נבחרים (2)');assert.equal(elements.deleteSelectedContacts.disabled,false);
  ctx.confirm=s=>{confirmation=s;return true};a.deleteSelectedContacts();
  assert.match(confirmation,/2 אנשי קשר/);assert.ok(confirmation.includes('ראשון\nאחרון'));assert.ok(!confirmation.includes('נשאר'));
  assert.equal(a.readContacts().length,1);assert.equal(a.contactPhone('כינוי נשאר'),'972500000001');assert.equal(a.contactPhone('כינוי ראשון'),'');assert.equal(a.contactPhone('כינוי אחרון'),'');
  assert.equal(data.get('combatEquipmentStateV1'),'equipment sentinel');assert.equal(data.get(AK),'attendance sentinel');
  assert.equal(a.selectedContacts.size,0);assert.equal(elements.deleteSelectedContacts.disabled,true);assert.match(elements.contactNotice.textContent,/2 אנשי קשר נמחקו/);
});
test('empty selection, cancellation, clear selection and list refresh never delete contacts',()=>{
  const {api:a,ctx,data,elements}=bulkHarness();const before=data.get(CK);let prompts=0;
  ctx.confirm=()=>{prompts++;return false};a.deleteSelectedContacts();assert.equal(prompts,0);
  a.selectedContacts.add('ראשון');a.deleteSelectedContacts();assert.equal(prompts,1);assert.equal(data.get(CK),before);assert.equal(a.selectedContacts.size,1);
  const boxes=[{checked:true},{checked:true}];ctx.document.querySelectorAll=()=>boxes;a.clearContactSelection();assert.ok(boxes.every(b=>!b.checked));assert.equal(a.selectedContacts.size,0);
  a.selectedContacts.add('ראשון');a.renderContacts();assert.equal(a.selectedContacts.size,0);assert.equal(elements.deleteSelectedContacts.disabled,true);assert.equal(data.get(CK),before);
});
test('failed bulk save preserves contacts and selected rows for retry',()=>{
  const {api:a,ctx,data,elements}=bulkHarness();const before=data.get(CK);a.selectedContacts.add('ראשון');
  ctx.localStorage.setItem=()=>{throw Error('quota')};a.deleteSelectedContacts();
  assert.equal(data.get(CK),before);assert.equal(a.selectedContacts.size,1);assert.match(elements.contactNotice.textContent,/לא ניתן לשמור/);
});
test('attendance current/history filtering and unit quantities are preserved',()=>{
  const {api:a,ctx,data}=harness();
  const d=a.parseList('נרשמו באפליקציה\n1. מגיע\nלא מגיעים\n1. נעדר\n2. נעדר ללא ציוד\nנעדר');
  assert.equal(d.absent.length,2);data.set(AK,JSON.stringify({current:d,'history-0':d}));
  ctx.state.equipment=[{id:'water',name:'מים',assignments:[{name:'נעדר',qty:9,units:[1,2]},{name:'נעדר',qty:1},{name:'מגיע',qty:1}]}];
  assert.equal(a.statusOf('מגיע'),'attending');assert.equal(a.statusOf('נעדר'),'absent');assert.equal(a.statusOf('אחר'),'unknown');
  assert.equal(a.noShowsWithGear().length,1);assert.equal(a.noShowsWithGear()[0].gear[0].qty,3);
  data.set('combatEquipmentHistoryV1',JSON.stringify([{id:'test',date:'past',equipment:[{name:'חבל',assignments:[{name:'נעדר',qty:4}]}]}]));data.set(AK,JSON.stringify({current:d,'history:test':d}));a.select('history:test');assert.equal(a.noShowsWithGear()[0].gear[0].qty,4);
});
test('WhatsApp direct/fallback URLs, copy and special characters in names',async()=>{
  const {api:a,ctx,data,elements,clipboard,prompts}=harness();
  const name="בדיקה O'Name <tag>";
  ctx.state.equipment=[{name:'חבל',assignments:[{name,qty:2}]}];data.set(AK,JSON.stringify({current:{attending:[],absent:[name]}}));
  a.openWhatsApp(encodeURIComponent(name));let url=new URL(ctx.window.location.href);assert.equal(url.pathname,'/');assert.match(url.searchParams.get('text'),/2 × חבל/);
  a.writeContacts([a.makeContact('שם ראשי','0500000000',[name])]);a.openWhatsApp(encodeURIComponent(name));url=new URL(ctx.window.location.href);assert.equal(url.pathname,'/972500000000');
  await a.copyMessage(encodeURIComponent(name));assert.equal(clipboard[0],url.searchParams.get('text'));
  ctx.navigator.clipboard.writeText=async()=>{throw Error('denied')};await a.copyMessage(encodeURIComponent(name));assert.equal(prompts[0][1],clipboard[0]);
  elements.noShowWarnings={innerHTML:''};a.checkAssignedNoShows();assert.ok(elements.noShowWarnings.innerHTML.includes('&lt;tag&gt;'));assert.ok(!elements.noShowWarnings.innerHTML.includes('onclick='));
});
test('service worker cache/assets and injection agree; injection is idempotent',()=>{
  const events={},ctx={self:{addEventListener:(name,fn)=>events[name]=fn}};ctx.importScripts=()=>{ctx.self.COMBAT_APP={cache:'combat-equipment-v35'}};vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8')+'\nthis.test={CACHE,ASSETS};',ctx);
  const a=ctx.test,html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.equal(a.CACHE,'combat-equipment-v35');
  for(const asset of a.ASSETS)assert.ok(fs.existsSync(path.join(root,asset.split('?')[0])),asset);
  assert.ok(a.ASSETS.includes('./attendance.js?v=8'));assert.ok(html.includes('./attendance.js?v=8'));
  assert.ok(a.ASSETS.includes('./app-lifecycle.js?v=1'));assert.ok(html.includes('./app-lifecycle.js?v=1'));
});
test('service worker installs new cache and serves enhanced HTML/assets offline',async()=>{
  const events={},cache=new Map(),deleted=[];let installed;
  const ctx={Response,URL,fetch:async()=>{throw Error('offline')},self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches:{open:async()=>({addAll:async assets=>{installed=assets},put:async(k,v)=>cache.set(k,v)}),keys:async()=>['combat-equipment-v21','combat-equipment-v35'],delete:async k=>deleted.push(k),match:async k=>cache.get(k)}};ctx.importScripts=()=>{ctx.self.COMBAT_APP={cache:'combat-equipment-v35'}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),ctx);
  let pending;events.install({waitUntil:p=>pending=p});await pending;assert.ok(installed.includes('./attendance.js?v=8'));
  events.activate({waitUntil:p=>pending=p});await pending;assert.deepEqual(deleted,['combat-equipment-v21']);
  cache.set('./index.html',new Response('<body>offline shell</body>'));
  events.fetch({request:{method:'GET',mode:'navigate',url:'https://example.test/app'},respondWith:p=>pending=p});assert.match(await (await pending).text(),/offline shell/);
  const request={method:'GET',mode:'cors',url:'https://example.test/app.js'};cache.set(request,new Response('cached asset'));events.fetch({request,respondWith:p=>pending=p});assert.equal(await (await pending).text(),'cached asset');
});
