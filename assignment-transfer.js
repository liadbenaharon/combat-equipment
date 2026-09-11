(function(root){
  'use strict';
  const NAME_HEADER='שם';
  const EQUIPMENT_HEADER='ציוד';
  const QUANTITY_HEADER='כמות';
  const clean=value=>String(value??'').trim();
  const key=value=>clean(value).toLocaleLowerCase('he-IL').replace(/\s+/g,' ');

  function columnsFor(equipment=[]){
    const counts=new Map();
    return equipment.map((item,index)=>{
      const base=clean(item?.name)||`ציוד ${index+1}`;
      const number=(counts.get(key(base))||0)+1;counts.set(key(base),number);
      return {id:String(item?.id||index),index,label:number===1?base:`${base} (${number})`};
    });
  }
  function csvCell(value){const text=String(value??'');return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text}
  function assignmentTable(currentState,savedNames=[]){
    const equipment=Array.isArray(currentState?.equipment)?currentState.equipment:[],columns=columnsFor(equipment),people=new Map();
    for(const value of savedNames){const name=clean(value);if(name&&!people.has(key(name)))people.set(key(name),{name,amounts:Array(columns.length).fill(0)})}
    equipment.forEach((item,columnIndex)=>(item.assignments||[]).forEach(assignment=>{
      const name=clean(assignment?.name),amount=Number(assignment?.qty||0);if(!name||!Number.isFinite(amount)||amount<=0)return;
      const personKey=key(name);if(!people.has(personKey))people.set(personKey,{name,amounts:Array(columns.length).fill(0)});
      people.get(personKey).amounts[columnIndex]+=amount;
    }));
    return {columns,rows:[...people.values()].sort((a,b)=>a.name.localeCompare(b.name,'he'))};
  }
  function exportCsv(currentState,savedNames=[]){
    const table=assignmentTable(currentState,savedNames),lines=[[NAME_HEADER,...table.columns.map(column=>column.label)],...table.rows.map(row=>[row.name,...row.amounts.map(value=>value||'')])];
    return '\ufeff'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  }
  function exportEditableCsv(currentState,savedNames=[]){
    const table=assignmentTable(currentState,savedNames),lines=[[NAME_HEADER,EQUIPMENT_HEADER,QUANTITY_HEADER]];
    table.rows.forEach(row=>{
      let assigned=false;
      row.amounts.forEach((amount,index)=>{if(amount>0){lines.push([row.name,table.columns[index].label,amount]);assigned=true}});
      if(!assigned)lines.push([row.name,'','']);
    });
    return '\ufeff'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  }
  function workoutOptions(currentState,history=[]){
    const options=[{key:'current',label:'האימון הנוכחי',state:currentState}];
    (Array.isArray(history)?history:[]).forEach((workout,index)=>{
      if(!Array.isArray(workout?.equipment))return;
      const id=workout.id===undefined||workout.id===null?`index-${index}`:String(workout.id);
      options.push({key:`history:${id}`,label:clean(workout.date)||`אימון שמור ${index+1}`,state:{equipment:workout.equipment}});
    });
    return options;
  }
  function detectDelimiter(text){const first=String(text||'').replace(/^\ufeff/,'').split(/\r?\n/,1)[0]||'';return ['\t',';',','].sort((a,b)=>(first.split(b).length-first.split(a).length))[0]}
  function parseRows(text){
    const delimiter=detectDelimiter(text),source=String(text||'').replace(/^\ufeff/,''),rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<source.length;i++){const char=source[i];if(quoted){if(char==='"'&&source[i+1]==='"'){cell+='"';i++}else if(char==='"')quoted=false;else cell+=char;continue}if(char==='"'){quoted=true;continue}if(char===delimiter){row.push(cell);cell='';continue}if(char==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';continue}cell+=char}
    if(quoted)throw new Error('יש מרכאות שלא נסגרו בקובץ');if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row)}
    return rows.filter(cells=>cells.some(value=>clean(value)));
  }
  function importPlan(text,currentState){
    const rows=parseRows(text);if(rows.length<1)throw new Error('הקובץ ריק');
    const equipment=Array.isArray(currentState?.equipment)?currentState.equipment:[],columns=columnsFor(equipment),header=rows[0].map(clean);
    if(key(header[0])!==key(NAME_HEADER)&&key(header[0])!=='name')throw new Error('העמודה הראשונה חייבת להיקרא "שם"');
    if(key(header[1])===key(EQUIPMENT_HEADER)&&key(header[2])===key(QUANTITY_HEADER))return importEditableRows(rows,equipment,columns);
    const expected=new Map(columns.map(column=>[key(column.label),column]));
    const mapped=header.slice(1).map(label=>{const column=expected.get(key(label));if(!column&&label)throw new Error(`עמודת ציוד לא מוכרת: ${label}`);return column||null});
    if(!mapped.some(Boolean))throw new Error('לא נמצאו בקובץ עמודות ציוד שמתאימות לאימון');
    const people=new Map();
    rows.slice(1).forEach((cells,rowIndex)=>{
      const name=clean(cells[0]);if(!name){if(cells.slice(1).some(value=>clean(value)))throw new Error(`חסר שם בשורה ${rowIndex+2}`);return}
      const personKey=key(name);if(!people.has(personKey))people.set(personKey,{name,amounts:new Map()});const person=people.get(personKey);
      mapped.forEach((column,columnIndex)=>{if(!column)return;const raw=clean(cells[columnIndex+1]);if(!raw)return;const amount=Number(raw);if(!Number.isInteger(amount)||amount<0||amount>100)throw new Error(`כמות לא תקינה עבור ${name} בעמודה ${column.label}`);if(amount)person.amounts.set(column.index,(person.amounts.get(column.index)||0)+amount)});
    });
    const totals=Array(equipment.length).fill(0);for(const person of people.values())for(const [index,amount] of person.amounts)totals[index]+=amount;
    totals.forEach((total,index)=>{const available=Number(equipment[index]?.qty||0);if(total>available)throw new Error(`הוקצו ${total} יחידות של ${columns[index].label}, אך באימון יש רק ${available}`)});
    const assignments=equipment.map(()=>[]);for(const person of people.values())for(const [index,qty] of person.amounts)assignments[index].push({name:person.name,qty});
    return {assignments,people:[...people.values()].filter(person=>person.amounts.size>0).length,total:totals.reduce((sum,value)=>sum+value,0),rows:people.size};
  }
  function importEditableRows(rows,equipment,columns){
    const expected=new Map(columns.map(column=>[key(column.label),column])),people=new Map();
    rows.slice(1).forEach((cells,rowIndex)=>{
      const name=clean(cells[0]),equipmentName=clean(cells[1]),raw=clean(cells[2]);
      if(!name){if(equipmentName||raw)throw new Error(`חסר שם בשורה ${rowIndex+2}`);return}
      const personKey=key(name);if(!people.has(personKey))people.set(personKey,{name,amounts:new Map()});const person=people.get(personKey);
      if(!equipmentName&&!raw)return;
      if(!equipmentName)throw new Error(`חסר סוג ציוד עבור ${name} בשורה ${rowIndex+2}`);
      if(!raw)throw new Error(`חסרה כמות עבור ${name} בשורה ${rowIndex+2}`);
      const column=expected.get(key(equipmentName));if(!column)throw new Error(`סוג ציוד לא מוכר: ${equipmentName}`);
      const amount=Number(raw);if(!Number.isInteger(amount)||amount<0||amount>100)throw new Error(`כמות לא תקינה עבור ${name} בשורה ${rowIndex+2}`);
      if(amount)person.amounts.set(column.index,(person.amounts.get(column.index)||0)+amount);
    });
    const totals=Array(equipment.length).fill(0);for(const person of people.values())for(const [index,amount] of person.amounts)totals[index]+=amount;
    totals.forEach((total,index)=>{const available=Number(equipment[index]?.qty||0);if(total>available)throw new Error(`הוקצו ${total} יחידות של ${columns[index].label}, אך באימון יש רק ${available}`)});
    const assignments=equipment.map(()=>[]);for(const person of people.values())for(const [index,qty] of person.amounts)assignments[index].push({name:person.name,qty});
    return {assignments,people:[...people.values()].filter(person=>person.amounts.size>0).length,total:totals.reduce((sum,value)=>sum+value,0),rows:people.size};
  }
  function applyPlan(currentState,plan){
    currentState.equipment.forEach((item,index)=>{let unit=0;item.checked=Array(Number(item.qty)||0).fill(false);item.assignments=(plan.assignments[index]||[]).map(assignment=>{const units=Array.from({length:assignment.qty},()=>unit++);units.forEach(position=>{item.checked[position]=true});return {...assignment,units}})});return currentState;
  }
  const api={columnsFor,assignmentTable,exportCsv,exportEditableCsv,workoutOptions,parseRows,importPlan,applyPlan};root.CombatAssignmentTransfer=api;
  if(typeof document==='undefined')return;

  function savedTrainees(){try{return JSON.parse(localStorage.getItem('combatEquipmentTraineesV1')||'[]')}catch{return[]}}
  function savedWorkouts(){try{return JSON.parse(localStorage.getItem('combatEquipmentHistoryV1')||'[]')}catch{return[]}}
  function saveFile(contents,filename){
    if(root.CombatAndroid?.saveFile){root.CombatAndroid.saveFile(contents,filename,'text/csv');return}
    const blob=new Blob([contents],{type:'text/csv;charset=utf-8'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),0);
  }
  function announce(message,type='info'){if(typeof root.combatAnnounce==='function')root.combatAnnounce(message,type);else alert(message)}
  function install(){
    const summary=document.getElementById('summary');if(!summary||document.getElementById('assignmentTransfer'))return;
    const card=document.createElement('section');card.id='assignmentTransfer';card.className='card assignment-transfer';card.innerHTML='<h2>שיתוף רשימת שיוכים</h2><p class="mini">הטבלה כוללת רק 3 עמודות: שם, ציוד וכמות. כדי לתת לאדם כמה סוגי ציוד, מוסיפים לו שורה לכל סוג. הייבוא מחליף את השיוכים באימון הפעיל בלבד.</p><div class="field assignment-workout-field"><label for="exportAssignmentWorkout">מאיזה אימון להוריד?</label><select id="exportAssignmentWorkout" class="input"></select></div><div class="assignment-transfer-actions"><button type="button" class="btn" id="exportAssignments">הורדת טבלה נוחה לעריכה</button><label class="btn import-label">ייבוא טבלה מעודכנת<input id="importAssignments" type="file" accept=".csv,text/csv,text/plain,application/vnd.ms-excel"></label></div>';
    summary.insertBefore(card,document.getElementById('dataTools')||null);
    const picker=document.getElementById('exportAssignmentWorkout');
    const refreshPicker=()=>{const selected=picker.value,options=workoutOptions(state,savedWorkouts());picker.innerHTML=options.map(option=>`<option value="${option.key.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">${option.label.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</option>`).join('');picker.value=options.some(option=>option.key===selected)?selected:'current';return options};
    refreshPicker();picker.addEventListener('focus',refreshPicker);picker.addEventListener('pointerdown',refreshPicker);root.addEventListener?.('combat-cloud-data-loaded',refreshPicker);
    document.getElementById('exportAssignments').onclick=()=>{try{const options=refreshPicker(),selected=options.find(option=>option.key===picker.value)||options[0],suffix=selected.key==='current'?new Date().toISOString().slice(0,10):selected.key.slice(8).replace(/[^a-zA-Z0-9_-]/g,'-');saveFile(exportEditableCsv(selected.state,savedTrainees()),`combat-equipment-assignments-${suffix}.csv`);announce(`טבלת השיוכים של ${selected.label} מוכנה לשמירה`)}catch{announce('לא ניתן ליצור את טבלת השיוכים','error')}};
    document.getElementById('importAssignments').onchange=async event=>{const input=event.currentTarget,file=input.files?.[0];if(!file)return;try{if(file.size>2*1024*1024)throw new Error('הקובץ גדול מדי. הגודל המרבי הוא 2MB');const plan=importPlan(await file.text(),state);if(!confirm(`נמצאו ${plan.people} מתאמנים עם ${plan.total} יחידות ציוד.\n\nהייבוא יחליף את כל השיוכים באימון הפעיל. להמשיך?`))return;applyPlan(state,plan);for(const list of plan.assignments)for(const assignment of list)root.rememberTrainee?.(assignment.name);if(save()===false)throw new Error('השינוי לא נשמר');announce(`יובאו ${plan.total} יחידות ציוד עבור ${plan.people} מתאמנים`)}catch(error){announce(error?.message||'לא ניתן לייבא את הטבלה','error')}finally{input.value=''}};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(typeof window!=='undefined'?window:globalThis);
