import {exportTemplatePath} from './private-data.js';
import fs from 'node:fs';
import {patchInventoryTemplate} from './inventory-template.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {fail,text,quantity,productView,round} from './service.js';
import {today,now,transaction} from './db.js';
import {canonicalStaffName} from './factory-rules.js';
import {assertPermission,hasPermission} from './permissions.js';
import {WageService} from './wages.js';
import {precastWageRules} from './precast-wage-rules.js';
import {attendanceMarked} from './workbook-layout.js';

const directory=path.dirname(fileURLToPath(import.meta.url));
const groupSpecs=[{groupId:'g1',start:27,end:322,staffStart:2,staffEnd:10,summaryCol:50,segments:[[27,209,323,324],[210,229,327,328],[230,321,331,332]],totals:[335,336]},
 {groupId:'g2',start:25,end:183,staffStart:4,staffEnd:12,summaryCol:39,segments:[[25,112,184,185],[113,134,188,189],[135,183,192,193]],totals:[196,197]},
 {groupId:'g3',start:22,end:122,staffStart:4,staffEnd:10,summaryCol:39,segments:[[22,73,123,124],[74,88,127,128],[89,122,131,132]],totals:[135,136]}];
const norm=value=>String(value??'').replace(/\s+/g,'').normalize('NFC');
function scalar(cell){const v=cell.value;if(v&&typeof v==='object'){if('formula'in v||'sharedFormula'in v)return undefined;if(v.richText)return v.richText.map(x=>x.text).join('');return v.text;}return v;}
function materialName(sheet,col){const value=scalar(sheet.getCell(6,col))??scalar(sheet.getCell(5,col));return typeof value==='string'||typeof value==='number'?String(value).trim():'';}
function monthInfo(value){const month=text(value,'生产月份',7);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month>today().slice(0,7))fail(400,'请选择不晚于本月的月份');const [year,m]=month.split('-').map(Number);return {month,year,m,days:new Date(Date.UTC(year,m,0)).getUTCDate()};}
function actualDate(month,day){return month+'-'+String(day).padStart(2,'0');}
function cellName(col,row){let label='';for(let n=col;n;n=Math.floor((n-1)/26))label=String.fromCharCode(65+(n-1)%26)+label;return label+row;}
function columnIndex(address){return address.match(/^[A-Z]+/)[0].split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);}
function fitQuantityColumns(xml,sheet,widths){
 return xml.replace(/<col\b([^>]*?)\/>/g,(full,attrs)=>{
  const min=Number(attrs.match(/\bmin="(\d+)"/)?.[1]),max=Number(attrs.match(/\bmax="(\d+)"/)?.[1]);
  if(![...widths.keys()].some(col=>col>=min&&col<=max))return full;
  let result='';for(let col=min;col<=max;col++){
   let next=attrs.replace(/\bmin="\d+"/,'min="'+col+'"').replace(/\bmax="\d+"/,'max="'+col+'"');
   if(widths.has(col)){const width=Math.max(sheet.getColumn(col).width||sheet.properties.defaultColWidth||9,widths.get(col));next=next.replace(/\s+(?:width|customWidth)="[^"]*"/g,'')+' width="'+width+'" customWidth="1"';}
   result+='<col'+next+'/>';
  }return result;
 });
}
const escapeXML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

export class WorkbookService{
 constructor(db,service){this.db=db;this.service=service;this.wages=new WageService(db,service);}
 products(){return this.db.prepare('SELECT * FROM products').all().map(productView);}
 workerByName(name){const key=canonicalStaffName(name),direct=this.db.prepare("SELECT * FROM users WHERE name=? AND role='worker'").get(key);if(direct)return direct;const alias=this.db.prepare('SELECT user_id,original_json FROM staff_aliases').all().find(a=>canonicalStaffName(JSON.parse(a.original_json).name)===key);return alias?this.db.prepare("SELECT * FROM users WHERE id=? AND role='worker'").get(alias.user_id):null;}
 resolveEntry(entry,context){
  const products=context.products,product=context.byId.get(entry.productId)||context.byKey.get(JSON.stringify([entry.category,norm(entry.productName),entry.groupId,entry.category==='预制块'?entry.weightKg:null]));
  const worker=context.workersById.get(entry.workerId)||context.workersByName.get(canonicalStaffName(entry.workerName));
  const reasons=[];if(!/^\d{4}-\d{2}-\d{2}$/.test(entry.date))reasons.push('表格日期在该月份不存在');else if(entry.date>today())reasons.push('日期晚于今天');if(!product)reasons.push('产品未匹配');else if(!product.unit)reasons.push('计量单位未确认');else{try{quantity(entry.quantity,product);}catch(e){reasons.push(e.message);}}
  const members=(entry.workerNames||[]).map(name=>context.workersByName.get(canonicalStaffName(name)));
  if(entry.historicalGroup&&Array.isArray(entry.workerNames)){if(!entry.workerNames.length)reasons.push('该日生产缺少出勤人员');if(members.some(m=>!m))reasons.push('出勤人员姓名未匹配');if(!Number.isInteger(entry.headcount)||new Set(members.filter(Boolean).map(m=>m.id)).size!==entry.headcount)reasons.push('出勤人数与当日工数不一致');}
  if(entry.category!=='预制块'&&!worker)reasons.push('工人姓名未匹配');
  const recordId=context.records.get(entry.sourceRef)||null,overlap=product&&!recordId?(context.byProduction.get(JSON.stringify([entry.date,product.id,entry.groupId]))||[]).filter(r=>entry.category==='预制块'||r.workerId===worker?.id):[];
  if(overlap.length)reasons.push('与当天已有生产记录重叠，请先核对已有记录，退回误填后刷新预览');
  return {...entry,productId:product?.id,productFullName:product?.fullName||entry.productName,unit:product?.unit||'',workerId:worker?.id,workerName:worker?.name||entry.workerName,memberIds:members.filter(Boolean).map(m=>m.id),issue:reasons.join('；'),ready:!reasons.length,recordId,overlapRecordIds:[...new Set(overlap.map(r=>r.id))]};
 }
 previewView(row){
  const products=this.products(),workers=this.db.prepare("SELECT id,name FROM users WHERE role='worker'").all(),context={products,byId:new Map(products.map(p=>[p.id,p])),byKey:new Map(products.map(p=>[JSON.stringify([p.category,norm(p.name),p.groupId,p.category==='预制块'?p.weightKg:null]),p])),workersByName:new Map(workers.map(w=>[canonicalStaffName(w.name),w])),workersById:new Map(workers.map(w=>[w.id,w])),records:new Map(this.db.prepare("SELECT id,source_ref FROM records WHERE source_ref!=''").all().map(r=>[r.source_ref,r.id])),byProduction:new Map()};
  for(const alias of this.db.prepare('SELECT old_id,user_id,original_json FROM staff_aliases').all()){context.workersById.set(alias.old_id,context.workersById.get(alias.user_id));context.workersByName.set(canonicalStaffName(JSON.parse(alias.original_json).name),context.workersById.get(alias.user_id));}
  for(const r of this.db.prepare("SELECT r.id,r.production_date date,r.product_id productId,r.group_id groupId,m.user_id workerId FROM records r LEFT JOIN members m ON m.record_id=r.id WHERE r.production_date LIKE ? AND r.status!='rejected' AND r.deleted_at='' AND r.quantity>0").all(row.month+'-%')){const key=JSON.stringify([r.date,r.productId,r.groupId]),items=context.byProduction.get(key)||[];items.push(r);context.byProduction.set(key,items);}
  const entries=JSON.parse(row.entries_json).map(e=>this.resolveEntry(e,context));return {id:row.id,fileName:row.file_name,month:row.month,createdAt:row.created_at,entries,total:entries.length,readyCount:entries.filter(e=>e.ready&&!e.recordId).length,blockedCount:entries.filter(e=>!e.ready&&!e.recordId).length,importedCount:entries.filter(e=>e.recordId).length};
 }
 list(){return this.db.prepare('SELECT * FROM imports ORDER BY created_at DESC LIMIT 30').all().map(r=>{const v=this.previewView(r);return {...v,entries:undefined};});}
 get(id){const row=this.db.prepare('SELECT * FROM imports WHERE id=?').get(id);if(!row)fail(404,'导入预览不存在');return this.previewView(row);}
 async preview(user,input){
  const {month,days,m,year}=monthInfo(input.month),category=input.category;if(!['预制块','浇注料'].includes(category))fail(400,'请选择表格分类');
  const fileName=path.basename(text(input.fileName,'文件名',160));if(!fileName.toLowerCase().endsWith('.xlsx'))fail(400,'请选择xlsx表格');
  if(typeof input.base64!=='string'||input.base64.length>12e6||!input.base64.length)fail(400,'表格文件为空或超过大小限制');const buffer=Buffer.from(input.base64,'base64');
  let wb;try{wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer);}catch{fail(400,'无法读取该xlsx文件');}
  const entries=[],products=this.products(),findProduct=(name,gid,weight)=>products.find(p=>norm(p.name)===norm(name)&&p.groupId===gid&&(category!=='预制块'||p.weightKg===weight));
  if(category==='浇注料'){
   const s=wb.worksheets[0];if(!s||!String(scalar(s.getCell('A1'))||'').includes('记'))fail(400,'表格不符合浇注料表格结构');
   const title=norm(scalar(s.getCell('A1'))),headerMonth=Number(title.match(/^(\d{1,2})月/)?.[1]);if(headerMonth&&headerMonth!==m)fail(400,'表格标题月份与选择月份不一致，请核对');
   for(let day=1;day<=31;day++)for(let offset=0;offset<18;offset++){
    const row=8+(day-1)*18+offset,name=scalar(s.getCell(row,2));
    for(let col=3;col<=76;col++){const qty=scalar(s.getCell(row,col)),productName=materialName(s,col);if(typeof qty!=='number'||qty===0||!productName)continue;
     const product=products.find(p=>p.id==='material-'+col&&['浇注料','装/卸车'].includes(p.category)&&norm(p.name)===norm(productName))||findProduct(productName,'g4');
     const sourceCell=cellName(col,row),workerName=typeof name==='string'?canonicalStaffName(name):'',workerId=this.workerByName(workerName)?.id;entries.push({category:product?.category||category,date:actualDate(month,day),quantity:qty,productId:product?.id,productName,groupId:product?.groupId||'g4',workerName,workerId,sheet:s.name,cell:sourceCell,sourceRef:JSON.stringify([month,category,s.name,sourceCell]),invalidDay:day>days});
    }
   }
  }else{
   for(const [index,spec] of groupSpecs.entries()){
    const s=wb.worksheets[index];if(!s||!String(scalar(s.getCell('B1'))||'').includes('预'))fail(400,'表格不符合预制块一至三组表格结构');
    const title=norm(scalar(s.getCell('B1'))),match=title.match(/(\d{4})年(\d{1,2})月/);if(match&&(Number(match[1])!==year||Number(match[2])!==m))fail(400,'表格标题年月与选择月份不一致，请核对');
    for(let row=spec.start;row<=spec.end;row++){
     const productName=scalar(s.getCell(row,2)),weightKg=scalar(s.getCell(row,3));if(typeof productName!=='string'||typeof weightKg!=='number'||weightKg<=0)continue;
     for(let day=1;day<=31;day++){const col=day+5,qty=scalar(s.getCell(row,col));if(typeof qty!=='number'||qty===0)continue;const sourceCell=cellName(col,row);
      const source=products.find(p=>p.category===category&&p.groupId===spec.groupId&&p.source.endsWith(' / '+s.name+' / B'+row+':C'+row));
      const workerNames=[];for(let staff=spec.staffStart;staff<=spec.staffEnd;staff++)if(attendanceMarked(scalar(s.getCell(staff,col))))workerNames.push(String(scalar(s.getCell(staff,5))||'').trim());
      const headcount=scalar(s.getCell([12,13,11][index],col));
      entries.push({category,date:actualDate(month,day),quantity:qty,productId:(source||findProduct(productName,spec.groupId,weightKg))?.id,productName,weightKg,groupId:spec.groupId,sheet:s.name,cell:sourceCell,sourceRef:JSON.stringify([month,category,s.name,sourceCell]),invalidDay:day>days,historicalGroup:true,workerNames,headcount});
     }
    }
   }
  }
  if(entries.length>15000)fail(400,'记录超过导入上限，请拆分文件');
  const hash=createHash('sha256').update(buffer).update(category).digest('hex'),old=this.db.prepare('SELECT * FROM imports WHERE file_hash=? AND month=?').get(hash,month);
  if(old)return this.previewView(old);
  for(const e of entries)if(e.invalidDay)e.date='无效日期 '+e.date;
  const id=randomUUID();this.db.prepare('INSERT INTO imports VALUES (?,?,?,?,?,?,?)').run(id,fileName,month,hash,JSON.stringify(entries),user.id,now());return this.get(id);
 }
 commit(user,id,input){
  assertPermission(user,'history');assertPermission(user,'review');
  if(input.confirmed!==true)fail(400,'请确认已经核准选中的历史数据');
  const preview=this.get(id),selected=Array.isArray(input.sourceRefs)?new Set(input.sourceRefs):null;if(!selected?.size)fail(400,'请选择已核准的历史记录');
  const entries=preview.entries.filter(e=>selected.has(e.sourceRef));if(entries.length!==selected.size)fail(400,'选择的历史记录不存在');
  if(entries.some(e=>!e.ready&&!e.recordId))fail(400,'选中的历史数据仍有单位、人员、日期或重复记录问题，请刷新预览核对');
  return transaction(this.db,()=>{
   const records=[];for(const e of entries){if(e.recordId){records.push(e.recordId);continue;}
    this.service.assertNoHistoricalOverlap({date:e.date,productId:e.productId,groupId:e.groupId,memberIds:e.workerId?[e.workerId]:[],sourceRef:e.sourceRef,quantity:e.quantity});
    const p=productView(this.db.prepare('SELECT * FROM products WHERE id=?').get(e.productId)),recordId=randomUUID(),stamp=now(),requestId='history:'+createHash('sha256').update(e.sourceRef).digest('hex'),mode=e.historicalGroup?'historical-group':'personal';
    this.db.prepare('INSERT INTO records (id,production_date,product_id,product_json,group_id,mode,quantity,original_quantity,status,submitted_by,submitted_at,updated_at,version,request_id,payload_hash,remark,rejection_reason,source_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(recordId,e.date,p.id,JSON.stringify(p),e.groupId,mode,e.quantity,e.quantity,'approved',user.id,stamp,stamp,1,requestId,requestId,'历史表格导入：'+preview.fileName+' / '+e.sheet+' / '+e.cell,'',e.sourceRef);
    if(e.workerId)this.db.prepare('INSERT INTO members VALUES (?,?)').run(recordId,e.workerId);
    for(const memberId of e.memberIds||[])this.db.prepare('INSERT OR IGNORE INTO members VALUES (?,?)').run(recordId,memberId);
    const r=this.service.get(user,recordId);this.service.audit(r,user,'submit',{},this.service.snapshot(r),'表格历史导入');this.service.audit(r,user,'approve',{quantity:e.quantity,status:'pending'},this.service.snapshot(r),'管理员核准历史表格数据');records.push(recordId);
   }
   return {recordIds:records,imported:entries.filter(e=>!e.recordId).length,preview:this.get(id)};
  });
 }
 async template(user,input){
  const {month,year,m,days}=monthInfo(input.month),category=input.category;if(!['预制块','浇注料'].includes(category))fail(400,'请选择要导出的生产模块');
  const dataset=JSON.parse(this.db.prepare("SELECT value FROM app_meta WHERE key='workbook_dataset_v1'").get()?.value||'null');
  const file=category==='预制块'?'precast.xlsx':'material.xlsx',template=fs.readFileSync(exportTemplatePath(file,dataset?.month===month?month:null)),wb=new ExcelJS.Workbook();await wb.xlsx.load(template);
  const historicalLoading=this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='history_source_rows'").get()?this.db.prepare("SELECT target_id,source_json FROM history_source_rows WHERE kind='loading'").all().map(r=>({id:r.target_id,...JSON.parse(r.source_json)})):[],loadingIds=new Set(historicalLoading.map(r=>r.id));
  const rows=this.service.list(user,{from:month+'-01',to:actualDate(month,days),...(category==='预制块'?{category}:{})}).filter(r=>r.counted&&!loadingIds.has(r.id)&&(category==='预制块'||['浇注料','装/卸车'].includes(r.product.category))),patches=new Map();
  const patch=(sheet,address,value)=>{const data=patches.get(sheet)||new Map();data.set(address,value);patches.set(sheet,data);};
  if(category==='预制块'){
   for(const [index,spec] of groupSpecs.entries()){
    const s=wb.worksheets[index],mapping=new Map(),totals=new Map();
    for(let row=spec.start;row<=spec.end;row++){
     const name=scalar(s.getCell(row,2)),weight=scalar(s.getCell(row,3));if(typeof name!=='string'||typeof weight!=='number')continue;
     const key=norm(name)+'|'+weight;if(!mapping.has(key))mapping.set(key,row);
     for(let day=1;day<=days;day++)patch(s.name,cellName(day+5,row),null);
     patch(s.name,cellName(spec.summaryCol,row),0);patch(s.name,cellName(spec.summaryCol+1,row),0);
    }
    const weightByRow=new Map();for(const r of rows.filter(r=>r.groupId===spec.groupId)){
     const sourceRow=Number(r.product.source?.match(/B(\d+):C\d+$/)?.[1]),row=sourceRow>=spec.start&&sourceRow<=spec.end?sourceRow:mapping.get(norm(r.product.name)+'|'+r.product.weightKg);
     if(!row)fail(400,'产品“'+r.product.name+'”没有表格位置，请维护表格映射后再导出');
     if(weightByRow.has(row)&&weightByRow.get(row)!==r.product.weightKg)fail(400,'同型号本月存在不同单重，无法放进表格同一行，请导出明细核对');weightByRow.set(row,r.product.weightKg);patch(s.name,'C'+row,r.product.weightKg);
     const address=cellName(Number(r.date.slice(-2))+5,row),old=patches.get(s.name)?.get(address)||0;patch(s.name,address,round(old+r.quantity));totals.set(row,round((totals.get(row)||0)+r.quantity));
    }
    for(const [row,qty] of totals){patch(s.name,cellName(spec.summaryCol,row),qty);patch(s.name,cellName(spec.summaryCol+1,row),round(rows.filter(r=>r.groupId===spec.groupId&&(Number(r.product.source?.match(/B(\d+):C\d+$/)?.[1])||mapping.get(norm(r.product.name)+'|'+r.product.weightKg))===row).reduce((n,r)=>n+(r.weightKg||0),0)));}
    for(let day=1;day<=31;day++)patch(s.name,cellName(day+5,spec.start-1),day<=days?day:null);
    patch(s.name,'B1',`${year}年 ${m}月 预制块记工表（${['一','二','三'][index]}组）`);
    for(const [sourceStart,sourceEnd,qtyRow,weightRow] of spec.segments){
     const range=s.getCell(qtyRow,6).value?.formula?.match(/SUM\(F(\d+):F(\d+)\)/i),start=range?Number(range[1]):sourceStart,end=range?Number(range[2]):sourceEnd;
     let monthQty=0,monthWeight=0;
     for(let day=1;day<=days;day++){const col=day+5,qty=Array.from({length:end-start+1},(_,i)=>patches.get(s.name)?.get(cellName(col,start+i))||0).reduce((n,x)=>n+x,0),weight=rows.filter(r=>r.groupId===spec.groupId&&Number(r.date.slice(-2))===day&&((Number(r.product.source?.match(/B(\d+):C\d+$/)?.[1])||mapping.get(norm(r.product.name)+'|'+r.product.weightKg))>=start)&&((Number(r.product.source?.match(/B(\d+):C\d+$/)?.[1])||mapping.get(norm(r.product.name)+'|'+r.product.weightKg))<=end)).reduce((n,r)=>n+(r.weightKg||0),0);patch(s.name,cellName(col,qtyRow),qty);patch(s.name,cellName(col,weightRow),round(weight));monthQty+=qty;monthWeight+=weight;}
     patch(s.name,cellName(spec.summaryCol,qtyRow),monthQty);patch(s.name,cellName(spec.summaryCol+1,weightRow),round(monthWeight));
    }
    for(let day=1;day<=days;day++){const daily=rows.filter(r=>r.groupId===spec.groupId&&Number(r.date.slice(-2))===day);patch(s.name,cellName(day+5,spec.totals[0]),round(daily.reduce((n,r)=>n+r.quantity,0)));patch(s.name,cellName(day+5,spec.totals[1]),round(daily.reduce((n,r)=>n+(r.weightKg||0),0)));}
   }
   if(wb.worksheets[3])patch(wb.worksheets[3].name,'A1','四组（未启用，待核对表格月份）');
   const summary=wb.worksheets[4];if(summary){patch(summary.name,'E3','本月生产（公斤）');let all=0;for(const [index,spec] of groupSpecs.entries()){const offsets=[4,8,12],startRow=offsets[index],data=patches.get(wb.worksheets[index].name);for(const [segmentIndex,segment] of spec.segments.entries()){const targetRow=startRow+[0,2,1][segmentIndex],weight=data.get(cellName(spec.summaryCol+1,segment[3]))||0;patch(summary.name,'E'+targetRow,weight);all+=weight;}patch(summary.name,'E'+(startRow+3),rows.filter(r=>r.groupId===spec.groupId).reduce((n,r)=>n+(r.weightKg||0),0));}for(const [row,offset] of [[16,0],[17,1],[18,2]])patch(summary.name,'E'+row,[4,8,12].reduce((n,start)=>n+(patches.get(summary.name)?.get('E'+(start+offset))||0),0));patch(summary.name,'E19',round(all));}
  }else{
   const s=wb.worksheets[0],names=new Map(),mapping=new Map();for(let offset=0;offset<18;offset++){const name=scalar(s.getCell(8+offset,2));if(typeof name==='string')names.set(norm(name),offset);}for(let col=3;col<=76;col++){const name=materialName(s,col);if(name)mapping.set(norm(name),col);}
   const workers=this.db.prepare("SELECT id,name,source_json FROM users WHERE role='worker'").all(),personOffsets=new Map(),usedOffsets=new Set();
   for(const worker of workers){
    const source=JSON.parse(worker.source_json||'[]').find(v=>v.sheet===s.name&&/浇注料/.test(v.file)&&/^B\d+$/.test(v.cell)),row=source?Number(source.cell.slice(1)):null,offset=row>=8?(row-8)%18:names.get(norm(worker.name));
    if(offset===undefined||offset===null||usedOffsets.has(offset))continue;personOffsets.set(worker.id,offset);usedOffsets.add(offset);
   }
   const neededWorkers=new Set(rows.flatMap(r=>r.members.map(m=>m.id))),freeOffsets=[...Array(18).keys()].filter(offset=>!usedOffsets.has(offset));
   for(const worker of workers.filter(w=>neededWorkers.has(w.id)&&!personOffsets.has(w.id)).sort((a,b)=>a.name.localeCompare(b.name))){
    const offset=freeOffsets.shift();if(offset===undefined)fail(400,'浇注料原表人员行不足，无法放入：'+worker.name+'。请先维护原表人员映射');personOffsets.set(worker.id,offset);usedOffsets.add(offset);
    const sources=JSON.parse(worker.source_json||'[]'),cell='B'+(8+offset);if(!sources.some(v=>v.sheet===s.name&&v.cell===cell&&/浇注料/.test(v.file)))this.db.prepare('UPDATE users SET source_json=? WHERE id=?').run(JSON.stringify([...sources,{file:'2026年 9月浇注料记工表 .xlsx',sheet:s.name,cell}]),worker.id);
   }
   for(const worker of workers){const offset=personOffsets.get(worker.id);if(offset===undefined)continue;for(let day=1;day<=31;day++)patch(s.name,'B'+(8+(day-1)*18+offset),worker.name);patch(s.name,'B'+(566+offset),worker.name);}
   patch(s.name,'A1',`${year}年 ${m}月 浇注料记工表（按产品计量单位填写）`);
   for(const r of rows){if(r.members.length!==1)fail(400,'浇注料记录需要明确一名生产工人');const offset=personOffsets.get(r.members[0].id),sourceCol=/^material-\d+$/.test(r.product.id)?Number(r.product.id.slice(9)):null,col=sourceCol||mapping.get(norm(r.product.name));if(offset===undefined||!col)fail(400,'工人或项目没有表格位置：'+r.members[0].name+' / '+(r.product.fullName||r.product.name));if(!['吨','袋','kg','公斤'].includes(r.product.unit))fail(400,'历史计量单位无法导出，请管理员核对该记录：'+(r.product.fullName||r.product.name));const qty=r.quantity,address=cellName(col,8+(Number(r.date.slice(-2))-1)*18+offset);patch(s.name,address,round((patches.get(s.name)?.get(address)||0)+qty));}
   for(let day=1;day<=31;day++)patch(s.name,'A'+(8+(day-1)*18),day<=days?day:null);
   for(let col=3;col<=76;col++){let total=0;for(let offset=0;offset<18;offset++){let own=0;for(let day=1;day<=days;day++)own+=patches.get(s.name)?.get(cellName(col,8+(day-1)*18+offset))||0;patch(s.name,cellName(col,566+offset),round(own));total+=own;}patch(s.name,cellName(col,584),round(total));}
  }
  if(hasPermission(user,'salary')){
   const pay=this.wages.summary(user,{from:month+'-01',to:actualDate(month,days)});
   if(category==='浇注料'){
    const s=wb.worksheets[0],people=new Map();
    for(const u of this.db.prepare("SELECT id,name,source_json FROM users WHERE role='worker'").all()){const ref=JSON.parse(u.source_json||'[]').find(v=>v.sheet===s.name&&/浇注料/.test(v.file)&&/^B\d+$/.test(v.cell));if(ref)people.set((Number(ref.cell.slice(1))-8)%18,u);}
    for(let col=3;col<=76;col++){
     const p=this.products().find(p=>p.id==='material-'+col),rate=p?this.wages.rate(p,month):null;patch(s.name,cellName(col,7),rate?.rate??null);
     const column=pay.details.filter(d=>d.productId===p?.id&&!loadingIds.has(d.recordId));let total=0,missing=false;
     for(let offset=0;offset<18;offset++){const u=people.get(offset);if(!u)continue;const own=column.filter(d=>d.workerId===u.id),unpriced=own.some(d=>d.amount===null),amount=round(own.reduce((n,d)=>n+(d.amount||0),0),6);patch(s.name,cellName(col,585+offset),unpriced?'待设置':amount);patch(s.name,'B'+(585+offset),u.name);total+=amount;missing||=unpriced;}
     patch(s.name,cellName(col,603),missing?'待设置':round(total,6));
    }
    patch(s.name,'A585','基础工资（元）');patch(s.name,'A603','基础工资合计（元）');
   }else{
    for(const [index,spec] of groupSpecs.entries()){
     const s=wb.worksheets[index],rule=precastWageRules[spec.groupId];patch(s.name,cellName(spec.summaryCol,1),'工资（基础＋自动补助）');patch(s.name,'B'+rule.supplementRow,'自动补助合计（手工另计）');
     for(let day=1;day<=days;day++){
      const col=day+5,c=pay.crews.find(c=>c.groupId===spec.groupId&&c.date===actualDate(month,day));
      patch(s.name,cellName(col,rule.countRow),c?.headcount||null);
      patch(s.name,cellName(col,rule.averageKgRow),c?c.averageTonnes===null?'待核定':round(c.averageTonnes*1000,6):null);
      patch(s.name,cellName(col,rule.baseRow),c?c.base===null?'待核定':c.base:null);
      for(const [key,row]of [['small',rule.smallRow],['large',rule.largeRow],['tonnage',rule.tonnageRow]])patch(s.name,cellName(col,row),c?c.base===null?'待核定':key!=='tonnage'&&!rule[key].length?'手工核定':round(c[key],6):null);
      if(index===2)patch(s.name,cellName(col,rule.complexRow),c?'手工核定':null);
      patch(s.name,cellName(col,rule.supplementRow),c?c.base===null?'待核定':round(c.small+c.large+c.tonnage,6):null);
     }
     for(let row=spec.staffStart;row<=spec.staffEnd;row++){
      const name=scalar(s.getCell(row,5)),worker=this.workerByName(name);if(!worker)continue;
      patch(s.name,'E'+row,worker.name);
      const own=pay.details.filter(d=>d.groupId===spec.groupId&&d.workerId===worker.id&&d.category==='预制块'),extra=pay.supplements.filter(d=>d.groupId===spec.groupId&&d.workerId===worker.id);
      patch(s.name,cellName(spec.summaryCol,row),own.some(d=>d.amount===null)?'待核定':round([...own,...extra].reduce((n,d)=>n+(d.amount||0),0),2));
      for(let day=1;day<=days;day++){const c=pay.crews.find(c=>c.groupId===spec.groupId&&c.date===actualDate(month,day));patch(s.name,cellName(day+5,row),c?.members?.some(m=>m.id===worker.id)?'*':null);}
     }
     const loadingRow=[13,14,12][index],first=[15,16,14][index],last=[23,23,19][index],controls=this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='history_source_rows'").get()?this.db.prepare("SELECT source_json FROM history_source_rows WHERE kind='loading-control'").all().map(r=>JSON.parse(r.source_json)).filter(c=>c.groupId===spec.groupId&&c.date.startsWith(month)):[];
     for(const control of controls){const col=Number(control.date.slice(-2))+5;patch(s.name,cellName(col,loadingRow),control.tonnes);patch(s.name,cellName(col,loadingRow+1),control.tonnes*(this.wages.rate(this.products().find(p=>p.id==='material-73'),control.date)?.rate||0));}
     for(let row=first;row<=last;row++){
      const worker=this.workerByName(scalar(s.getCell(row,5)));if(!worker)continue;let total=0;
      for(let day=1;day<=days;day++){const own=historicalLoading.filter(e=>e.workerId===worker.id&&e.groupId===spec.groupId&&e.date===actualDate(month,day)),amount=pay.details.filter(d=>own.some(e=>e.id===d.recordId)).reduce((n,d)=>n+(d.amount||0),0);patch(s.name,cellName(day+5,row),own.length?round(amount,6):null);total+=amount;}
      patch(s.name,'E'+row,worker.name);patch(s.name,cellName(spec.summaryCol,row),round(total,2));
     }
    }
   }
  }
  patchInventoryTemplate(this.db,this.service,user,{wb,month,days,category,groupSpecs,patch,cellName});
  // 保留原包内的样式、合并、打印配置和绘图，仅替换业务单元格及需要容纳数量的窄列。
  const zip=await JSZip.loadAsync(template);
  for(const [index,s] of wb.worksheets.entries()){
   const file='xl/worksheets/sheet'+(index+1)+'.xml',entry=zip.file(file);if(!entry)continue;let xml=await entry.async('string'),data=patches.get(s.name)||new Map();
   if(category==='浇注料'&&index===0){const widths=new Map();for(const [address,value] of data){const col=columnIndex(address);if(col<3||col>76||typeof value!=='number'||!value)continue;const fontSize=s.getCell(address).font?.size||12,width=Math.ceil(String(value).length*fontSize/11*1.2+2);widths.set(col,Math.max(widths.get(col)||0,width));}xml=fitQuantityColumns(xml,s,widths);}
   xml=xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,(full,attrs,body='')=>{
    const address=attrs.match(/\br="([A-Z]+\d+)"/)?.[1];if(!address)return full;const cell=s.getCell(address),value=scalar(cell),row=cell.row,col=cell.col;
    let clear=cell.type===ExcelJS.ValueType.Formula||typeof value==='number';
    if(category==='预制块'){const spec=groupSpecs[index];if(spec&&((col===3&&row>=spec.start&&row<=spec.end)||(col>=6&&col<=36&&(row===spec.start-1||row===3))))clear=false;if(value==='*'||value==='休'||value==='停')clear=true;}
    else if(index===0){if(row===5||row===6)clear=false;if(col===1&&row>=8&&row<=548&&(row-8)%18===0)clear=false;if(row>=8&&col>=3)clear=true;}
    if(!data.has(address)&&!clear)return full;const replacement=data.has(address)?data.get(address):null;data.delete(address);const kept=attrs.replace(/\s+t="[^"]*"/g,'');
    if(replacement==null)return '<c'+kept+'/>';return typeof replacement==='number'?'<c'+kept+'><v>'+replacement+'</v></c>':'<c'+kept+' t="inlineStr"><is><t>'+escapeXML(replacement)+'</t></is></c>';
   });
   // 表格空白的生产格仍带样式；新增值落到原行，避免移动版式。
   for(const [address,value] of data){if(value==null)continue;const row=Number(address.match(/\d+$/)[0]),valueXml=typeof value==='number'?'<v>'+value+'</v>':'<is><t>'+escapeXML(value)+'</t></is>',type=typeof value==='number'?'':' t="inlineStr"',cell='<c r="'+address+'"'+type+'>'+valueXml+'</c>',rowPattern=new RegExp('(<row\\b[^>]*\\br="'+row+'"[^>]*>)([\\s\\S]*?)(</row>)');if(!rowPattern.test(xml))fail(500,'表格行不存在，无法保存导出');xml=xml.replace(rowPattern,(full,open,content,close)=>{const next=[...content.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"/g)].find(match=>columnIndex(match[1])>columnIndex(address)),at=next?next.index:content.length;return open+content.slice(0,at)+cell+content.slice(at)+close;});}
   zip.file(file,xml);
  }
  // 所有导出的生产合计由最新有效明细重新计算，不沿用表格的工资/库存公式。
  return {buffer:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),fileName:month+category+'记工表.xlsx'};
 }
}

export function registerWorkbookRoutes(app,db,service,permission){const workbooks=new WorkbookService(db,service);
 app.get('/api/imports',permission('history'),(req,res)=>res.json({imports:workbooks.list()}));
 app.get('/api/imports/:id',permission('history'),(req,res)=>res.json(workbooks.get(req.params.id)));
 app.post('/api/imports/preview',permission('history'),async(req,res)=>res.json(await workbooks.preview(req.user,req.body)));
 app.post('/api/imports/:id/commit',permission('history'),permission('review'),(req,res)=>res.json(workbooks.commit(req.user,req.params.id,req.body)));
 app.get('/api/export-template',permission('export'),async(req,res)=>{const result=await workbooks.template(req.user,req.query);res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.set('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(result.fileName));res.send(result.buffer);});
 return workbooks;
}
