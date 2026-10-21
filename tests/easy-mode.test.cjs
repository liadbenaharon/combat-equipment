const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');

function api(){const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','easy-mode.js'),'utf8'),ctx);return ctx.CombatEasy}
const plain=x=>JSON.parse(JSON.stringify(x));
const eq=()=>({id:'jerrycan',name:'ג׳ריקן',qty:4,checked:[false,false,false,false],assignments:[]});

test('quick tap gives the unit to the selected trainee and merges their units',()=>{
  const {applyQuickTap}=api(),e=eq();
  assert.equal(applyQuickTap(e,2,'דניאל'),'assigned');
  assert.equal(applyQuickTap(e,0,' דניאל '),'assigned');
  assert.deepEqual(plain(e.assignments),[{name:'דניאל',qty:2,units:[0,2]}]);
  assert.deepEqual(e.checked,[true,false,true,false]);
});

test('tapping a unit the trainee already holds gives it back',()=>{
  const {applyQuickTap}=api(),e=eq();
  applyQuickTap(e,1,'שי');
  assert.equal(applyQuickTap(e,1,'שי'),'removed');
  assert.deepEqual(plain(e.assignments),[]);assert.deepEqual(e.checked,[false,false,false,false]);
});

test('a unit held by someone else moves only after confirmation',()=>{
  const {applyQuickTap}=api(),e=eq();
  applyQuickTap(e,0,'רועי');
  assert.equal(applyQuickTap(e,0,'מאליק',()=>false),'');
  assert.deepEqual(plain(e.assignments),[{name:'רועי',qty:1,units:[0]}]);
  let asked='';assert.equal(applyQuickTap(e,0,'מאליק',name=>{asked=name;return true}),'moved');
  assert.equal(asked,'רועי');
  assert.deepEqual(plain(e.assignments),[{name:'מאליק',qty:1,units:[0]}]);assert.equal(e.checked[0],true);
});

test('carried-over equipment keeps its own assignment record',()=>{
  const {applyQuickTap}=api(),e=eq();
  e.assignments.push({name:'יוני',qty:1,units:[3],carriedFromWorkoutId:77});e.checked[3]=true;
  applyQuickTap(e,1,'יוני');
  assert.deepEqual(plain(e.assignments),[{name:'יוני',qty:1,units:[3],carriedFromWorkoutId:77},{name:'יוני',qty:1,units:[1]}]);
});

test('invalid input changes nothing',()=>{
  const {applyQuickTap}=api(),e=eq();
  assert.equal(applyQuickTap(e,9,'דניאל'),'');assert.equal(applyQuickTap(e,0,'  '),'');
  assert.deepEqual(plain(e.assignments),[]);
});
