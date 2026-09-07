const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'returns.js'),'utf8');

function harness(state,returns={},history=[],historyReturns={}){
  const data=new Map([['combatEquipmentReturnsV1',JSON.stringify({current:returns,...historyReturns})],['combatEquipmentHistoryV1',JSON.stringify(history)]]);
  const context={state,renderAll:()=>{},CombatData:{transaction(entries){for(const [key,value] of Object.entries(entries))data.set(key,JSON.stringify(value));return true}},localStorage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)},window:{}};
  vm.createContext(context);
  vm.runInContext(source.slice(0,source.indexOf('  function setAll'))+'\nwindow.test={carryEquipment,missingCurrent,recoverOutstandingFromHistory,reconcileCarriedWorkout,removeCarriedWorkout,removeOrphanedCarriedAssignments};})();',context);
  return {api:context.window.test,context,data};
}

test('finishing carries only active equipment that was not returned into the new workout',()=>{
  const state={equipment:[
    {id:'anchor',name:'עוגן',qty:1,checked:[true],assignments:[{name:'רימון',qty:1,units:[0]}]},
    {id:'stretcher',name:'אלונקה',qty:3,checked:[true,true,true],assignments:[{name:'מאליק',qty:3,units:[0,1,2]}]},
    {id:'vest',name:'ווסט',qty:2,checked:[false,false],assignments:[]}
  ]};
  const {api}=harness(state,{'stretcher:0':true}),next=api.carryEquipment(123,{'stretcher:0':true});
  assert.deepEqual(JSON.parse(JSON.stringify(next[0].assignments)),[{name:'רימון',qty:1,units:[0],carriedFromWorkoutId:123}]);
  assert.deepEqual(JSON.parse(JSON.stringify(next[1].assignments)),[{name:'מאליק',qty:2,units:[1,2],carriedFromWorkoutId:123}]);
  assert.deepEqual([...next[1].checked],[false,true,true]);
  assert.deepEqual([...next[2].checked],[false,false]);assert.equal(next[2].assignments.length,0);
});

test('returned equipment is cleared instead of being carried to the next workout',()=>{
  const state={equipment:[{id:'anchor',name:'עוגן',qty:1,checked:[true],assignments:[{name:'רימון',qty:1,units:[0]}]}]};
  const {api}=harness(state,{'anchor:0':true}),next=api.carryEquipment(456,{'anchor:0':true});
  assert.deepEqual([...next[0].checked],[false]);assert.equal(next[0].assignments.length,0);assert.equal(api.missingCurrent().length,0);
});

test('an empty current workout repairs legacy open equipment into its numbered squares once',()=>{
  const state={equipment:[{id:'anchor',name:'עוגן',qty:1,checked:[false],assignments:[]},{id:'stretcher',name:'אלונקה',qty:3,checked:[false,false,false],assignments:[]}]};
  const history=[
    {id:'empty',equipment:[{id:'anchor',name:'עוגן',qty:1,checked:[false],assignments:[]}]},
    {id:'debt',equipment:[{id:'anchor',name:'עוגן',qty:1,checked:[true],assignments:[{name:'רימון',qty:1,units:[0]}]},{id:'stretcher',name:'אלונקה',qty:3,checked:[true,true,true],assignments:[{name:'מאליק',qty:3,units:[0,1,2]}]}]}
  ];
  const {api,context,data}=harness(state,{},history,{'history:debt':{'stretcher:0':true}});
  assert.equal(api.recoverOutstandingFromHistory(),true);
  assert.deepEqual([...context.state.equipment[0].checked],[true]);assert.equal(context.state.equipment[0].assignments[0].name,'רימון');
  assert.deepEqual([...context.state.equipment[1].checked],[false,true,true]);assert.equal(context.state.equipment[1].assignments[0].name,'מאליק');
  assert.equal(JSON.parse(data.get('combatEquipmentReturnsV1'))['history:debt'].__carriedIntoCurrentV1,true);
  assert.equal(api.recoverOutstandingFromHistory(),false);
});

test('partial historical returns immediately remove only those carried units from the current squares',()=>{
  const state={equipment:[{id:'stretcher',name:'אלונקה',qty:3,checked:[true,true,true],assignments:[{name:'מאליק',qty:3,units:[0,1,2],carriedFromWorkoutId:'past'}]}]};
  const history=[{id:'past',equipment:[{id:'stretcher',name:'אלונקה',qty:3,checked:[true,true,true],assignments:[{name:'מאליק',qty:3,units:[0,1,2]}]}]}];
  const {api,context}=harness(state,{},history,{'history:past':{'stretcher:0':true,__carriedIntoCurrentV1:true}});
  assert.equal(api.reconcileCarriedWorkout('past'),true);
  assert.deepEqual([...context.state.equipment[0].checked],[false,true,true]);
  assert.deepEqual([...context.state.equipment[0].assignments[0].units],[1,2]);
  assert.equal(context.state.equipment[0].assignments[0].qty,2);
});

test('repeated return reconciliation never duplicates assignments and supports undoing a return',()=>{
  const state={equipment:[{id:'anchor',name:'עוגן',qty:1,checked:[true],assignments:[{name:'רימון',qty:1,units:[0],carriedFromWorkoutId:'past'}]}]};
  const history=[{id:'past',equipment:[{id:'anchor',name:'עוגן',qty:1,checked:[true],assignments:[{name:'רימון',qty:1,units:[0]}]}]}];
  const {api,context,data}=harness(state,{},history,{'history:past':{__carriedIntoCurrentV1:true}});
  for(let i=0;i<30;i++)api.reconcileCarriedWorkout('past');
  assert.equal(context.state.equipment[0].assignments.length,1);
  data.set('combatEquipmentReturnsV1',JSON.stringify({current:{},'history:past':{'anchor:0':true,__carriedIntoCurrentV1:true}}));
  api.reconcileCarriedWorkout('past');assert.equal(context.state.equipment[0].assignments.length,0);assert.deepEqual([...context.state.equipment[0].checked],[false]);
  data.set('combatEquipmentReturnsV1',JSON.stringify({current:{},'history:past':{__carriedIntoCurrentV1:true}}));
  api.reconcileCarriedWorkout('past');assert.equal(context.state.equipment[0].assignments.length,1);assert.deepEqual([...context.state.equipment[0].checked],[true]);
});

test('orphaned carried equipment is removed after its source workout was already deleted',()=>{
  const state={equipment:[{id:'anchor',name:'עוגן',qty:2,checked:[true,true],assignments:[{name:'רימון',qty:1,units:[0],carriedFromWorkoutId:'deleted'},{name:'חדש',qty:1,units:[1]}]}]};
  const {api,context,data}=harness(state,{},[]);
  assert.equal(api.removeOrphanedCarriedAssignments(),true);
  assert.deepEqual([...context.state.equipment[0].checked],[false,true]);
  assert.deepEqual(context.state.equipment[0].assignments.map(a=>a.name),['חדש']);
  assert.equal(JSON.parse(data.get('combatEquipmentReturnsV1')).__legacyCarryRecoveryDoneV1,true);
  assert.equal(api.recoverOutstandingFromHistory(),false);
});
