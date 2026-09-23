const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
function makeEnv({remote,local,dirty,workspace,online=true,confirmAns=true}){
  const ls=new Map(Object.entries(local||{}));if(dirty)ls.set('combatCloudDirtyV1',JSON.stringify(dirty));if(workspace)ls.set('combatCloudWorkspaceV1',workspace);
  class Storage{getItem(k){return ls.has(k)?ls.get(k):null}setItem(k,v){ls.set(k,String(v))}removeItem(k){ls.delete(k)}}
  const localStorage=new Storage(),sessionStorage=new Storage();
  const el=()=>({style:{},dataset:{},classList:{add(){},remove(){}},setAttribute(){},appendChild(){},addEventListener(){},querySelector:()=>el(),querySelectorAll:()=>[],set innerHTML(v){},set textContent(v){}});
  const els={};const $=id=>els[id]??=el();
  const log=[];const db={...remote};let net=online;
  const client={auth:{getSession:async()=>net?{data:{session:{user:{id:'u1',email:'a@b'}}},error:null}:{data:{session:null},error:Object.assign(new Error('Failed to fetch'),{name:'AuthRetryableFetchError'})},onAuthStateChange(){},signOut:async()=>{}},
    from(t){const q={_t:t,f:{},_u:null,select(){return q},eq(k,v){q.f[k]=v;return q},is(){return q},order(){return q},update(d){q._u=d;return q},
      async single(){if(!net)throw TypeError('Failed to fetch');if(t==='profiles')return{data:{id:'u1',email:'a@b',role:'coach'},error:null};return{data:{owner_id:'u1',data:db.data,revision:db.revision},error:null}},
      async maybeSingle(){if(!net)return{data:null,error:new TypeError('Failed to fetch')};if(q.f.revision!==db.revision)return{data:null,error:null};db.data=q._u.data;db.revision++;log.push('saved rev '+db.revision);return{data:{revision:db.revision},error:null}}};return q}};
  const KEYS={state:'combatEquipmentStateV1'};
  const win={COMBAT_CLOUD:{url:'https://x',publishableKey:'k'},CombatData:{KEYS,exportBackup:()=>{const d={};for(const k of Object.values(KEYS)){const r=localStorage.getItem(k);if(r!==null)d[k]=JSON.parse(r)}return{data:d}},clearAll(){for(const k of Object.values(KEYS))localStorage.removeItem(k)},importBackup({data}){for(const[k,v]of Object.entries(data))localStorage.setItem(k,JSON.stringify(v))}},
    dispatchEvent(){},addEventListener(){}};
  const ctx={window:win,document:{readyState:'complete',getElementById:$,createElement:el,querySelector:()=>el(),body:el(),head:el(),addEventListener(){},visibilityState:'visible'},
    localStorage,sessionStorage,Storage,CustomEvent:class{},confirm:()=>{log.push('confirm');return confirmAns},setTimeout:(f)=>{Promise.resolve().then(f);return 1},clearTimeout(){},console,Promise,JSON,Object,String,Number,Error,TypeError,Boolean,
    createClient:()=>client};
  let src=fs.readFileSync(path.join(__dirname,'..','cloud-sync.js'),'utf8').replace(/^import .*$/m,'');
  vm.createContext(ctx);vm.runInContext(src,ctx);
  return {ls,db,log,els,setNet:v=>net=v};
}
const wait=()=>new Promise(r=>setTimeout(r,50));
const S='combatEquipmentStateV1',D='combatCloudDirtyV1';
test('unsynced local changes are pushed, not overwritten by older cloud data',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:'old'}},revision:3},local:{[S]:JSON.stringify({v:'new'})},dirty:{owner:'u1',base:3},workspace:'u1'});await wait();
  assert.deepEqual(e.db.data,{[S]:{v:'new'}});assert.equal(e.ls.get(S),'{"v":"new"}');assert.equal(e.ls.has(D),false);
});
test('a real two-device conflict asks before choosing a side',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:'other'}},revision:5},local:{[S]:JSON.stringify({v:'new'})},dirty:{owner:'u1',base:3},workspace:'u1',confirmAns:false});await wait();
  assert.ok(e.log.includes('confirm'));assert.equal(e.ls.get(S),'{"v":"other"}');assert.equal(e.ls.has(D),false);
});
test('clean device loads the cloud copy',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:'cloud'}},revision:5},local:{[S]:JSON.stringify({v:'stale'})},workspace:'u1'});await wait();
  assert.equal(e.ls.get(S),'{"v":"cloud"}');assert.deepEqual(e.log,[]);
});
test('network failure keeps local data and does not sign the user out',async()=>{
  const e=makeEnv({remote:{data:{[S]:{v:'cloud'}},revision:5},local:{[S]:JSON.stringify({v:'mine'})},online:false,workspace:'u1'});await wait();
  assert.equal(e.ls.get(S),'{"v":"mine"}');assert.deepEqual(e.log,[]);
});
test("another account's device data is never offered for upload",async()=>{
  const e=makeEnv({remote:{data:{},revision:1},local:{[S]:JSON.stringify({v:'otheruser'})},workspace:'u2'});await wait();
  assert.equal(e.ls.has(S),false);assert.deepEqual(e.log,[]);
});
