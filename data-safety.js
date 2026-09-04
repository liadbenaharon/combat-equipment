(function(root){
  'use strict';
  const KEYS=Object.freeze({
    state:'combatEquipmentStateV1',history:'combatEquipmentHistoryV1',
    attendance:'combatEquipmentAttendanceV2',returns:'combatEquipmentReturnsV1',
    contacts:'combatEquipmentContactsV1',phones:'combatEquipmentPhonesV1',
    trainees:'combatEquipmentTraineesV1'
  });
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const int=(value,fallback,min=0,max=100)=>{
    const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;
  };
  function normalizeAssignment(value,qty){
    if(!value||typeof value!=='object')return null;
    const name=String(value.name||'').trim();if(!name)return null;
    const units=Array.isArray(value.units)?[...new Set(value.units.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<qty))]:null;
    const amount=units?units.length:int(value.qty,0,0,qty);
    if(amount<1)return null;
    return {...value,name,qty:amount,...(units?{units}: {})};
  }
  function normalizeEquipment(value,index=0){
    if(!value||typeof value!=='object')return null;
    const qty=int(value.qty,1,1,100),id=String(value.id||`legacy-${index}`).trim()||`legacy-${index}`;
    const checked=Array.from({length:qty},(_,i)=>Boolean(Array.isArray(value.checked)&&value.checked[i]));
    const assignments=(Array.isArray(value.assignments)?value.assignments:[]).map(a=>normalizeAssignment(a,qty)).filter(Boolean);
    assignments.forEach(a=>{if(Array.isArray(a.units))a.units.forEach(i=>{checked[i]=true})});
    return {...value,id,name:String(value.name||'ציוד').trim()||'ציוד',icon:String(value.icon||'🎒'),qty,checked,assignments};
  }
  function normalizeState(value,defaults=[]){
    const fallback={equipment:clone(defaults)};
    if(!value||typeof value!=='object'||!Array.isArray(value.equipment))return fallback;
    const equipment=value.equipment.map(normalizeEquipment).filter(Boolean);
    return {...value,equipment};
  }
  function normalizeHistory(value){
    if(!Array.isArray(value))return [];
    return value.filter(x=>x&&typeof x==='object').slice(0,100).map((x,index)=>{
      const equipment=Array.isArray(x.equipment)?x.equipment.map(normalizeEquipment).filter(Boolean):[];
      const people=Array.isArray(x.people)?x.people.filter(Boolean):[];
      return {...x,id:x.id??`legacy-${index}-${String(x.date||'')}`,date:String(x.date||''),total:int(x.total,equipment.reduce((n,e)=>n+e.qty,0),0,10000),people,equipment};
    });
  }
  function parse(key,fallback){
    const raw=localStorage.getItem(key);if(raw===null)return fallback;
    try{return JSON.parse(raw)}catch(error){throw new Error(`הנתונים השמורים פגומים (${key})`,{cause:error})}
  }
  function writeJson(key,value){
    try{localStorage.setItem(key,JSON.stringify(value));return true}
    catch(error){root.dispatchEvent?.(new CustomEvent('combat-storage-error',{detail:{key,error}}));return false}
  }
  function loadState(defaults){try{return normalizeState(parse(KEYS.state,null),defaults)}catch{return normalizeState(null,defaults)}}
  function loadHistory(){try{return normalizeHistory(parse(KEYS.history,[]))}catch{return []}}
  function exportBackup(){
    const data={};Object.values(KEYS).forEach(key=>{const raw=localStorage.getItem(key);if(raw!==null)data[key]=JSON.parse(raw)});
    return {app:'combat-equipment',format:root.COMBAT_APP?.dataFormat||2,version:root.COMBAT_APP?.version||'unknown',exportedAt:new Date().toISOString(),data};
  }
  function validateBackup(payload){
    if(!payload||payload.app!=='combat-equipment'||!payload.data||typeof payload.data!=='object'||Array.isArray(payload.data))throw new Error('קובץ הגיבוי אינו תקין');
    const allowed=new Set(Object.values(KEYS));for(const key of Object.keys(payload.data))if(!allowed.has(key))throw new Error('קובץ הגיבוי מכיל שדה לא מוכר');
    if(own(payload.data,KEYS.state))normalizeState(payload.data[KEYS.state],[]);
    if(own(payload.data,KEYS.history))normalizeHistory(payload.data[KEYS.history]);
    return true;
  }
  function importBackup(payload){
    validateBackup(payload);const previous=new Map(),written=[];
    try{
      for(const [key,value] of Object.entries(payload.data)){previous.set(key,localStorage.getItem(key));localStorage.setItem(key,JSON.stringify(value));written.push(key)}
    }catch(error){for(const key of written){const before=previous.get(key);if(before===null)localStorage.removeItem(key);else localStorage.setItem(key,before)}throw new Error('לא ניתן לשחזר את הגיבוי; הנתונים הקיימים נשמרו',{cause:error})}
    return written.length;
  }
  root.CombatData={KEYS,normalizeState,normalizeHistory,loadState,loadHistory,writeJson,exportBackup,validateBackup,importBackup};
})(typeof window!=='undefined'?window:globalThis);
