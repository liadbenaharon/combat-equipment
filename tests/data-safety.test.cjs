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
  const config=fs.readFileSync(path.join(root,'app-config.js'),'utf8');assert.match(config,/version:'2\.0\.0'/);
  for(const file of ['equipment-icons.js','quantity-shortcut.js','attendance.js','contacts-count.js','app-lifecycle.js'])assert.match(fs.readFileSync(path.join(root,file),'utf8'),/COMBAT_APP/,file);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,'2.0.0');
});

test('native mobile shell and theme are shipped in both HTML and offline cache',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),theme=fs.readFileSync(path.join(root,'app-theme.css'),'utf8');
  assert.match(html,/app-theme\.css\?v=4/);assert.match(html,/native-ui\.js\?v=3/);assert.match(sw,/app-theme\.css\?v=4/);assert.match(sw,/native-ui\.js\?v=3/);
  assert.match(theme,/@media\(max-width:699px\)/);assert.match(theme,/position:fixed/);assert.match(theme,/safe-area-inset-bottom/);
});

test('attendance and returns use stable history ids and finish moves current attendance',()=>{
  const attendance=fs.readFileSync(path.join(root,'attendance.js'),'utf8'),returns=fs.readFileSync(path.join(root,'returns.js'),'utf8');
  assert.match(attendance,/key:`history:\$\{x\.id\|\|i\}`/);assert.match(attendance,/legacyKey:'history-'\+i/);
  assert.match(returns,/attendance\[`history:\$\{id\}`\]=attendance\.current/);assert.match(returns,/delete attendance\.current/);assert.match(returns,/CombatData\.transaction/);
});
