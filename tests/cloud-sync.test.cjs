const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
function makeEnv({remote,local,dirty,workspace,online=true,confirmAns=true,rpc=true}){
  const ls=new Map(Object.entries(local||{}));if(dirty)ls.set('combatCloudDirtyV1',JSON.stringify(dirty));if(workspace)ls.set('combatCloudWorkspaceV1',workspace);
  class Storage{getItem(k){return ls.has(k)?ls.get(k):null}setItem(k,v){ls.set(k,String(v))}removeItem(k){ls.delete(k)}}
  const localStorage=new Storage(),sessionStorage=new Storage();
  const el=()=>({style:{},dataset:{},classList:{add(){},remove(){}},setAttribute(){},appendChild(){},addEventListener(){},querySelector:()=>el(),querySelectorAll:()=>[],set innerHTML(v){},set textContent(v){}});
  const els={};const $=id=>els[id]??=el();
  const log=[];const db={...remote};let net=online;
  const client={auth:{getSession:async()=>net?{data:{session:{user:{id:'u1',email:'a@b'}}},error:null}:{data:{session:null},error:Object.assign(new Error('Failed to fetch'),{name:'AuthRetryableFetchError'})},onAuthStateChange(){},signOut:async()=>{}},
    async rpc(name,args){if(!net)return{data:null,error:new TypeError('Failed to fetch')};if(!rpc)return{data:null,error:{code:'PGRST202',message:'Could not find the function public.patch_coach_state'}};
      if(args.p_owner!=='u1'||args.p_revision!==db.revision)return{data:null,error:null};const next={...db.data,...args.p_set};for(const k of args.p_remove)delete next[k];db.data=next;db.revision++;log.push('patched '+[...Object.keys(args.p_set),...args.p_remove.map(k=>'-'+k)].join(','));return{data:db.revision,error:null}},
    from(t){const q={_t:t,f:{},_u:null,select(){return q},eq(k,v){q.f[k]=v;return q},is(){return q},order(){return q},update(d){q._u=d;return q},
      async single(){if(!net)throw TypeError('Failed to fetch');if(t==='profiles')return{data:{id:'u1',email:'a@b',role:'coach'},error:null};return{data:{owner_id:'u1',data:db.data,revision:db.revision},error:null}},
      async maybeSingle(){if(!net)return{data:null,error:new TypeError('Failed to fetch')};if(q.f.revision!==db.revision)return{data:null,error:null};db.data=q._u.data;db.revision++;log.push('saved rev '+db.revision);return{data:{revision:db.revision},error:null}}};return q}};
  const KEYS={state:'combatEquipmentStateV1',history:'combatEquipmentHistoryV1',returns:'combatEquipmentReturnsV1'};
  const win={COMBAT_CLOUD:{url:'https://x',publishableKey:'k'},CombatData:{KEYS,exportBackup:()=>{const d={};for(const k of Object.values(KEYS)){const r=localStorage.getItem(k);if(r!==null)d[k]=JSON.parse(r)}return{data:d}},clearAll(){for(const k of Object.values(KEYS))localStorage.removeItem(k)},importBackup({data}){for(const[k,v]of Object.entries(data))localStorage.setItem(k,JSON.stringify(v))}},
    dispatchEvent(){},addEventListener(){}};
  const ctx={window:win,document:{readyState:'complete',getElementById:$,createElement:el,querySelector:()=>el(),body:el(),head:el(),addEventListener(){},visibilityState:'visible'},
    localStorage,sessionStorage,Storage,CustomEvent:class{},confirm:()=>{log.push('confirm');return confirmAns},setTimeout:(f)=>{Promise.resolve().then(f);return 1},clearTimeout(){},console,Promise,JSON,Object,String,Number,Error,TypeError,Boolean,
    createClient:()=>client};
  let src=fs.readFileSync(path.join(__dirname,'..','cloud-sync.js'),'utf8').replace(/^import .*$/m,'');
  vm.createContext(ctx);vm.runInContext(src,ctx);
  return {ls,db,log,els,localStorage,setNet:v=>net=v};
}
const plain=x=>JSON.parse(JSON.stringify(x));
// Same fingerprint as cloud-sync.js, over the snapshot of the app keys the harness knows.
function fingerprint(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)+':'+text.length}
function syncedRecord(owner,revision,local){const d={};for(const k of ['combatEquipmentStateV1','combatEquipmentHistoryV1','combatEquipmentReturnsV1'])if(local[k]!==undefined)d[k]=JSON.parse(local[k]);return JSON.stringify({owner,revision,hash:fingerprint(JSON.stringify(d))})}
const wait=()=>new Promise(r=>setTimeout(r,50));
const S='combatEquipmentStateV1',D='combatCloudDirtyV1';
test('unsynced local changes are pushed, not overwritten by older cloud data',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:'old'}},revision:3},local:{[S]:JSON.stringify({v:'new'})},dirty:{owner:'u1',base:3},workspace:'u1'});await wait();
  assert.deepEqual(plain(e.db.data),{[S]:{v:'new'}});assert.equal(e.ls.get(S),'{"v":"new"}');assert.equal(e.ls.has(D),false);
});
test('a real two-device conflict asks before choosing a side',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:'other'}},revision:5},local:{[S]:JSON.stringify({v:'new'})},dirty:{owner:'u1',base:3},workspace:'u1',confirmAns:false});await wait();
  assert.ok(e.log.includes('confirm'));assert.equal(e.ls.get(S),'{"v":"other"}');assert.equal(e.ls.has(D),false);
});
test('clean device loads the cloud copy',async()=>{
  const local={[S]:JSON.stringify({v:'stale'})};
  const e=makeEnv({remote:{data:{[S]:{v:'cloud'}},revision:5},local:{...local,combatCloudSyncedV1:syncedRecord('u1',3,local)},workspace:'u1'});await wait();
  assert.equal(e.ls.get(S),'{"v":"cloud"}');assert.deepEqual(e.log,[]);
});
test('network failure keeps local data and does not sign the user out',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:'cloud'}},revision:5},local:{[S]:JSON.stringify({v:'mine'})},online:false,workspace:'u1'});await wait();
  assert.equal(e.ls.get(S),'{"v":"mine"}');assert.deepEqual(e.log,[]);
});
test("another account's device data is never offered for upload",async()=>{
  const local={[S]:JSON.stringify({v:'otheruser'})};
  const e=makeEnv({remote:{data:{},revision:1},local:{...local,combatCloudSyncedV1:syncedRecord('u2',4,local)},workspace:'u2'});await wait();
  assert.equal(e.ls.has(S),false);assert.deepEqual(e.log,[]);
});

const H='combatEquipmentHistoryV1',R='combatEquipmentReturnsV1';
test('after the first sync only the changed keys are sent',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:1},[H]:[{big:true}]},revision:5},local:{[S]:JSON.stringify({v:1}),[H]:JSON.stringify([{big:true}])},workspace:'u1'});await wait();
  e.localStorage.setItem(S,JSON.stringify({v:2}));await wait();
  assert.deepEqual(e.log,['patched '+S]);assert.deepEqual(plain(e.db.data),{[S]:{v:2},[H]:[{big:true}]});assert.equal(e.db.revision,6);assert.equal(e.ls.has(D),false);
  e.localStorage.setItem(R,JSON.stringify({current:{}}));e.localStorage.removeItem(H);await wait();
  assert.equal(e.log.length,2);assert.match(e.log[1],/^patched /);assert.deepEqual(plain(e.db.data),{[S]:{v:2},[R]:{current:{}}});assert.equal(e.ls.has(D),false);
});
test('a write that changes nothing does not reach the cloud',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:1}},revision:5},local:{[S]:JSON.stringify({v:1})},workspace:'u1'});await wait();
  e.localStorage.setItem(S,JSON.stringify({v:1}));await wait();
  assert.deepEqual(e.log,[]);assert.equal(e.db.revision,5);assert.equal(e.ls.has(D),false);
});
test('without the patch function the whole workspace is saved as before',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:1}},revision:5},local:{[S]:JSON.stringify({v:1})},workspace:'u1',rpc:false});await wait();
  e.localStorage.setItem(S,JSON.stringify({v:2}));await wait();
  assert.deepEqual(e.log,['saved rev 6']);assert.deepEqual(plain(e.db.data),{[S]:{v:2}});assert.equal(e.ls.has(D),false);
});
test('a patch against a newer cloud revision is treated as a conflict',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:1}},revision:5},local:{[S]:JSON.stringify({v:1})},workspace:'u1',confirmAns:true});await wait();
  e.db.data={[S]:{v:'other'}};e.db.revision=9;
  e.localStorage.setItem(S,JSON.stringify({v:2}));await wait();
  assert.ok(e.log.includes('confirm'));assert.deepEqual(plain(e.db.data),{[S]:{v:2}});assert.equal(e.db.revision,10);
});

const SAFE='combatCloudSafetyCopyV1';
test('changes made while signed out or offline are pushed instead of replaced by an older cloud copy',async()=>{
  // Synced at revision 306, then the device kept working without the cloud; the cloud never moved.
  const before={[S]:JSON.stringify({v:'oct6'})};
  const e=makeEnv({remote:{data:{[S]:{v:'oct6'}},revision:306},local:{[S]:JSON.stringify({v:'oct21'}),combatCloudSyncedV1:syncedRecord('u1',306,before)},workspace:'u1'});await wait();
  assert.equal(e.log.includes('confirm'),false);
  assert.deepEqual(plain(e.db.data),{[S]:{v:'oct21'}});assert.equal(e.ls.get(S),'{"v":"oct21"}');assert.equal(e.ls.has(D),false);
});
test('device data with no sync record is never replaced silently',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:'cloud'}},revision:5},local:{[S]:JSON.stringify({v:'device'})},workspace:'u1',confirmAns:true});await wait();
  assert.ok(e.log.includes('confirm'));
  assert.deepEqual(plain(e.db.data),{[S]:{v:'device'}});assert.equal(e.ls.get(S),'{"v":"device"}');
  assert.deepEqual(JSON.parse(e.ls.get(SAFE)).data,{[S]:{v:'cloud'}});
});
test('choosing the cloud copy keeps a safety copy of the device data',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:'cloud'}},revision:5},local:{[S]:JSON.stringify({v:'device'})},workspace:'u1',confirmAns:false});await wait();
  assert.ok(e.log.includes('confirm'));
  assert.equal(e.ls.get(S),'{"v":"cloud"}');
  const copy=JSON.parse(e.ls.get(SAFE));assert.equal(copy.source,'device');assert.deepEqual(copy.data,{[S]:{v:'device'}});
});
test('a device that signed in for the first time keeps its data when it differs from the cloud',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:'cloud'}},revision:5},local:{[S]:JSON.stringify({v:'device'})},confirmAns:false});await wait();
  assert.ok(e.log.includes('confirm'));assert.deepEqual(JSON.parse(e.ls.get(SAFE)).data,{[S]:{v:'device'}});
});
test("another account's unsynced device data asks first and keeps a safety copy",async()=>{
  const e=makeEnv({remote:{data:{},revision:1},local:{[S]:JSON.stringify({v:'otheruser'})},workspace:'u2',confirmAns:true});await wait();
  assert.ok(e.log.includes('confirm'));assert.equal(e.ls.has(S),false);
  assert.deepEqual(JSON.parse(e.ls.get(SAFE)).data,{[S]:{v:'otheruser'}});
});
test('a successful sync records the device state so later cloud updates load silently',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:1}},revision:5},local:{[S]:JSON.stringify({v:1})},workspace:'u1'});await wait();
  e.localStorage.setItem(S,JSON.stringify({v:2}));await wait();
  const rec=JSON.parse(e.ls.get('combatCloudSyncedV1'));assert.equal(rec.owner,'u1');assert.equal(rec.revision,6);
  assert.equal(rec.hash,fingerprint(JSON.stringify({[S]:{v:2}})));
});

test('a clean device that loads newer cloud data keeps no safety copy',async()=>{
  const local={[S]:JSON.stringify({v:'old'})};
  const e=makeEnv({remote:{data:{[S]:{v:'new'}},revision:8},local:{...local,combatCloudSyncedV1:syncedRecord('u1',7,local)},workspace:'u1'});await wait();
  assert.equal(e.ls.get(S),'{"v":"new"}');assert.equal(e.ls.has(SAFE),false);assert.deepEqual(e.log,[]);
});
