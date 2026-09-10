const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const context={};context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','assignment-transfer.js'),'utf8'),context);
const api=context.CombatAssignmentTransfer;

function sample(){return {equipment:[
  {id:'stretcher',name:'אלונקה',qty:3,checked:[true,false,false],assignments:[{name:'דני, כהן',qty:1,units:[0]}]},
  {id:'vest',name:'ווסט ירוק',qty:4,checked:[false,false,false,false],assignments:[]}
]}}

test('assignment CSV exports every saved trainee and current quantity in an Excel-friendly table',()=>{
  const csv=api.exportCsv(sample(),['דני, כהן','נועה']);
  assert.ok(csv.startsWith('\ufeffשם,אלונקה,ווסט ירוק'));
  assert.match(csv,/"דני, כהן",1,/);
  assert.match(csv,/נועה,,/);
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseRows(csv))),[['שם','אלונקה','ווסט ירוק'],['דני, כהן','1',''],['נועה','','']]);
});

test('edited CSV replaces active assignments and allocates numbered equipment units',()=>{
  const state=sample(),plan=api.importPlan('\ufeffשם,אלונקה,ווסט ירוק\r\nדני,2,1\r\nנועה,1,2\r\n',state);
  assert.equal(plan.people,2);assert.equal(plan.total,6);api.applyPlan(state,plan);
  assert.deepEqual(JSON.parse(JSON.stringify(state.equipment[0].assignments)),[{name:'דני',qty:2,units:[0,1]},{name:'נועה',qty:1,units:[2]}]);
  assert.deepEqual([...state.equipment[0].checked],[true,true,true]);
  assert.deepEqual(JSON.parse(JSON.stringify(state.equipment[1].assignments)),[{name:'דני',qty:1,units:[0]},{name:'נועה',qty:2,units:[1,2]}]);
});

test('import rejects unknown equipment, invalid quantities and allocations over inventory',()=>{
  assert.throws(()=>api.importPlan('שם,חבל\nדני,1',sample()),/לא מוכרת/);
  assert.throws(()=>api.importPlan('שם,אלונקה,ווסט ירוק\nדני,1.5,0',sample()),/כמות לא תקינה/);
  assert.throws(()=>api.importPlan('שם,אלונקה,ווסט ירוק\nדני,4,0',sample()),/יש רק 3/);
});
