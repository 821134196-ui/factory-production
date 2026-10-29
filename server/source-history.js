import ExcelJS from 'exceljs';
import {createHash,randomUUID} from 'node:crypto';
import {productView,quantity,round,fail} from './service.js';
import {now,transaction} from './db.js';
import {isSuper} from './permissions.js';
import {WorkbookService} from './workbooks.js';
import {attendanceMarked,shippingHeaderRows} from './workbook-layout.js';

const specs=[{groupId:'g1',start:27,end:322,shippingStart:52,shippingEnd:85,dateRow:26,customerRow:25,stockCol:88,countCol:90,loadingRow:13,staffStart:15,staffEnd:23,supplementRows:[341,342,343,345]},
 {groupId:'g2',start:25,end:183,shippingStart:41,shippingEnd:74,dateRow:21,customerRow:22,stockCol:77,countCol:79,loadingRow:14,staffStart:16,staffEnd:23,supplementRows:[202,203,204,206]},
 {groupId:'g3',start:22,end:122,shippingStart:41,shippingEnd:74,dateRow:18,customerRow:19,stockCol:77,countCol:79,loadingRow:12,staffStart:14,staffEnd:19,supplementRows:[141,142,143,145]}];
const scalar=cell=>typeof cell.value==='object'&&cell.value!==null?(cell.value.richText?.map(t=>t.text).join('')??null):cell.value;
const number=v=>typeof v==='number'&&Number.isFinite(v);
const reference=(month,kind,sheet,cell)=>JSON.stringify([month,kind,sheet,cell]);
const hash=value=>createHash('sha256').update(value).digest('hex');

export function initializeSourceHistory(db){
 db.exec(`CREATE TABLE IF NOT EXISTS history_source_rows (source_ref TEXT PRIMARY KEY,kind TEXT NOT NULL,target_id TEXT NOT NULL,source_json TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS inventory_month_openings (product_id TEXT NOT NULL REFERENCES products(id),month TEXT NOT NULL,quantity REAL,source_ref TEXT NOT NULL,PRIMARY KEY(product_id,month));`);
}

export async function ensureHistoryProductPositions(db,source){
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(source.buffer);const added=[];
 for(const [index,spec]of specs.entries())for(let row=spec.start;row<=spec.end;row++){
  const s=wb.worksheets[index],name=scalar(s.getCell(row,2)),weight=scalar(s.getCell(row,3));if(typeof name!=='string'||!number(weight)||weight<=0)continue;
  const location=source.file+' / '+s.name+' / B'+row+':C'+row;if(db.prepare('SELECT 1 FROM products WHERE source=?').get(location))continue;
  const id='source-'+hash(spec.groupId+'|'+name.trim()+'|'+weight+'|'+row).slice(0,16);
  db.prepare('INSERT INTO products (id,name,spec,category,unit,precision,weight_kg,group_id,active,source) VALUES (?,?,?,\'预制块\',\'块\',0,?,?,0,?)').run(id,name.trim(),weight+'公斤/块',weight,spec.groupId,location);added.push(id);
 }
 return added;
}

// These workbooks contain individual material entries and group precast entries.
// Keep the latter whole; attendance supplies the wage denominator, not invented piece counts.
export async function readSourceHistory(db,{month,precast,material,countDate,allocateMarkedLoading=false}){
 if(!/^\d{4}-\d{2}$/.test(month))fail(400,'历史月份不正确');
 const days=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(-2)),0)).getUTCDate();
 const books=await Promise.all([precast,material].map(async source=>{const wb=new ExcelJS.Workbook();await wb.xlsx.load(source.buffer);return wb;}));
 const catalog=db.prepare('SELECT * FROM products').all().map(productView),workbooks=new WorkbookService(db,null);
 const result={month,sources:[precast,material].map(s=>({file:s.file,sha256:hash(s.buffer)})),loading:[],loadingControls:[],shipments:[],openings:[],additionalCurrentOpenings:[],counts:[],adjustments:[],issues:[]};
 const dayDate=day=>month+'-'+String(day).padStart(2,'0');
 const recordIssue=(kind,sheet,cell,issue)=>result.issues.push({kind,sheet,cell,issue});
 const addOpening=(p,s,cell,endCell)=>{
  const raw=scalar(s.getCell(cell)),hasFormula=!!s.getCell(endCell).formula;
  const qty=number(raw)?raw:raw==null&&hasFormula?0:null;
  result.openings.push({productId:p.id,quantity:qty,cell,sheet:s.name,sourceRef:reference(month,'期初',s.name,cell)});
 };
 for(const [index,spec]of specs.entries()){
  const s=books[0].worksheets[index];
  const headers=shippingHeaderRows(s,index);
  const products=catalog.filter(p=>p.category==='预制块'&&p.groupId===spec.groupId&&p.source.includes(' / '+s.name+' / '));
  const byRow=new Map(products.map(p=>[Number(p.source.match(/B(\d+):C/)[1]),p]));
  for(const [row,p]of byRow){
   addOpening(p,s,'D'+row,s.getCell(row,spec.stockCol).address);
   if(!p.active&&s.getCell(row,spec.stockCol).formula){
    const opening=result.openings.at(-1).quantity,produced=Array.from({length:days},(_,i)=>scalar(s.getCell(row,i+6))).filter(number).reduce((n,v)=>n+v,0),shipped=Array.from({length:spec.shippingEnd-spec.shippingStart+1},(_,i)=>scalar(s.getCell(row,spec.shippingStart+i))).filter(number).reduce((n,v)=>n+v,0);
    if(opening!==null)result.additionalCurrentOpenings.push({productId:p.id,quantity:round(opening+produced-shipped,6),sourceRef:reference(month,'历史位置结转',s.name,s.getCell(row,spec.stockCol).address),sheet:s.name,cell:s.getCell(row,spec.stockCol).address});
   }
   const physical=scalar(s.getCell(row,spec.countCol));if(number(physical))result.counts.push({productId:p.id,quantity:physical,date:countDate||dayDate(days),sheet:s.name,cell:s.getCell(row,spec.countCol).address,sourceRef:reference(month,'实盘',s.name,s.getCell(row,spec.countCol).address)});
  }
  for(let col=spec.shippingStart;col<=spec.shippingEnd;col++){
   const entries=[];for(const [row,p]of byRow){const qty=scalar(s.getCell(row,col));if(number(qty)&&qty!==0)entries.push({productId:p.id,quantity:qty,cell:s.getCell(row,col).address});}
   if(!entries.length)continue;
   const day=scalar(s.getCell(headers.dateRow,col)),customer=scalar(s.getCell(headers.customerRow,col));
   if(!Number.isInteger(day)||day<1||day>days||typeof customer!=='string'||!customer.trim()){recordIssue('发货',s.name,s.getCell(headers.dateRow,col).address,'发货日期或客户不完整');continue;}
   result.shipments.push({date:dayDate(day),customer:customer.trim(),entries,sheet:s.name,cell:s.getCell(headers.dateRow,col).address,sourceRef:reference(month,'预制块发货',s.name,s.getCell(headers.dateRow,col).address)});
  }
  for(let day=1;day<=days;day++){
   const col=day+5,tonnes=scalar(s.getCell(spec.loadingRow,col)),allocated=[],marked=[];
   if(allocateMarkedLoading)for(let row=spec.staffStart;row<=spec.staffEnd;row++){const raw=scalar(s.getCell(row,col));if(typeof raw==='string'&&attendanceMarked(raw))marked.push(row);}
   for(let row=spec.staffStart;row<=spec.staffEnd;row++){
    const raw=scalar(s.getCell(row,col)),amount=allocateMarkedLoading&&marked.includes(row)&&number(tonnes)?tonnes*5/marked.length:raw;if(!number(amount)||amount===0)continue;
    const name=scalar(s.getCell(row,5)),worker=workbooks.workerByName(name),cell=s.getCell(row,col).address;
    if(!worker){recordIssue('装车',s.name,cell,'装车人员未匹配：'+name);continue;}
    const entry={workerId:worker.id,workerName:worker.name,date:dayDate(day),quantity:round(amount/5,6),amount,rate:5,groupId:spec.groupId,sheet:s.name,cell,sourceRef:reference(month,'预制块装车',s.name,cell)};
    result.loading.push(entry);allocated.push(entry);
   }
   if(number(tonnes)&&tonnes!==0||allocated.length){
    const difference=round(allocated.reduce((n,r)=>n+r.quantity,0)-(tonnes||0),6);
    result.loadingControls.push({date:dayDate(day),groupId:spec.groupId,sheet:s.name,cell:s.getCell(spec.loadingRow,col).address,tonnes:tonnes??null,allocatedTonnes:round(allocated.reduce((n,r)=>n+r.quantity,0),6),difference,sourceRef:reference(month,'装车分配核对',s.name,s.getCell(spec.loadingRow,col).address)});
    if(!allocated.length)recordIssue('装车',s.name,s.getCell(spec.loadingRow,col).address,'有装车总量但没有逐人工资');
   }
   const attendanceRows=index===0?[2,10]:index===1?[4,12]:[4,10],members=[];
   for(let row=attendanceRows[0];row<=attendanceRows[1];row++)if(attendanceMarked(scalar(s.getCell(row,col)))){const person=workbooks.workerByName(scalar(s.getCell(row,5)));if(person)members.push(person);}
   for(const row of spec.supplementRows){const amount=scalar(s.getCell(row,col));if(!number(amount)||amount===0)continue;for(const person of members)result.adjustments.push({workerId:person.id,date:dayDate(day),amount,sheet:s.name,cell:s.getCell(row,col).address,name:scalar(s.getCell(row,2)),sourceRef:reference(month,'补助',s.name,s.getCell(row,col).address+'|'+person.id)});}
  }
 }
 const s=books[1].worksheets[0];
 for(let col=3;col<=72;col++){
  const p=catalog.find(p=>p.id==='material-'+col);if(!p)continue;
  addOpening(p,s,s.getCell(4,col).address,s.getCell(641,col).address);
  const physical=scalar(s.getCell(642,col));if(number(physical))result.counts.push({productId:p.id,quantity:physical,date:countDate||dayDate(days),sheet:s.name,cell:s.getCell(642,col).address,sourceRef:reference(month,'实盘',s.name,s.getCell(642,col).address)});
 }
 for(let row=604;row<=639;row++){
  const entries=[];for(let col=3;col<=72;col++){const qty=scalar(s.getCell(row,col));if(number(qty)&&qty!==0)entries.push({productId:'material-'+col,quantity:qty,cell:s.getCell(row,col).address});}
  if(!entries.length)continue;
  const label=String(scalar(s.getCell(row,2))||'').trim(),match=label.match(/^(\d{1,2})\s*(?:号|日)?\s*(.+)$/),day=Number(match?.[1]),customer=match?.[2]?.trim();
  if(!day||day>days||!customer){recordIssue('发货',s.name,'B'+row,'发货日期或客户不完整');continue;}
  result.shipments.push({date:dayDate(day),customer,entries,sheet:s.name,cell:'B'+row,sourceRef:reference(month,'浇注料发货',s.name,'B'+row)});
 }
 return result;
}

export function importSourceExtras(db,production,inventory,user,source){
 if(!isSuper(user))fail(403,'只有总管理员可以导入历史数据');
 if(source.issues.length)fail(400,'历史数据仍有未匹配的来源，请先处理核对报告');
 initializeSourceHistory(db);
 return transaction(db,()=>{
  const result={loading:0,shipments:0,openings:0,counts:0,adjustments:0,controls:0},stamp=now();
  const existing=ref=>db.prepare('SELECT * FROM history_source_rows WHERE source_ref=?').get(ref);
  const track=(kind,item,target)=>db.prepare('INSERT INTO history_source_rows VALUES (?,?,?,?,?)').run(item.sourceRef,kind,target,JSON.stringify(item),stamp);
  const loadingProduct=productView(db.prepare("SELECT * FROM products WHERE id='material-73'").get());
  for(const e of source.loading){
   if(existing(e.sourceRef))continue;
   // Wage-derived historical tonnes retain the source amount even when it
   // implies more decimal places than the current two-decimal input form.
   const historicalProduct={...loadingProduct,precision:6},qty=quantity(e.quantity,historicalProduct),id=randomUUID(),requestId='history:'+hash(e.sourceRef);
   db.prepare(`INSERT INTO records (id,production_date,product_id,product_json,group_id,mode,quantity,original_quantity,status,submitted_by,submitted_at,updated_at,version,request_id,payload_hash,remark,source_ref,revision_at) VALUES (?,?,?,?,?,'personal',?,?,'approved',?,?,?,1,?,?,?,?,?)`).run(id,e.date,loadingProduct.id,JSON.stringify(historicalProduct),'g5',qty,qty,user.id,stamp,stamp,requestId,requestId,'历史装车 · '+e.sheet+' '+e.cell,e.sourceRef,stamp);
   db.prepare('INSERT INTO members VALUES (?,?)').run(id,e.workerId);
   const r=production.get(user,id);production.audit(r,user,'submit',{},production.snapshot(r),'按已确认口径由逐人工资÷5还原装车吨数');production.audit(r,user,'approve',{},production.snapshot(r),'历史装车导入');track('loading',e,id);result.loading++;
  }
  for(const e of source.shipments){
   if(existing(e.sourceRef))continue;
   const entries=e.entries.map(v=>{const p=productView(db.prepare('SELECT * FROM products WHERE id=?').get(v.productId));return {product:p,quantity:quantity(v.quantity,p)};}),id=randomUUID(),requestId='history:'+hash(e.sourceRef),payload=JSON.stringify({date:e.date,customer:e.customer,entries});
   // Historical shipments precede the current October anchor; importing them
   // must not move that anchor or subtract September movements a second time.
   db.prepare('INSERT INTO shipments (id,shipping_date,customer,weighed_tonnes,entries_json,created_by,created_at,updated_at,request_id,payload_hash) VALUES (?,?,?,NULL,?,?,?,?,?,?)').run(id,e.date,e.customer,JSON.stringify(entries),user.id,stamp,stamp,requestId,hash(payload));
   inventory.audit(user,'shipment',id,{},inventory.view(db.prepare('SELECT * FROM shipments WHERE id=?').get(id)),'历史发货导入 · '+e.sheet+' '+e.cell);track('shipment',e,id);result.shipments++;
  }
  for(const e of source.openings){
   if(existing(e.sourceRef))continue;
   const p=productView(db.prepare('SELECT * FROM products WHERE id=?').get(e.productId));if(e.quantity!==null)quantity(e.quantity,p,true);
   db.prepare('INSERT INTO inventory_month_openings VALUES (?,?,?,?)').run(e.productId,source.month,e.quantity,e.sourceRef);track('opening',e,e.productId);result.openings++;
  }
  for(const e of source.additionalCurrentOpenings){
   if(existing(e.sourceRef))continue;
   if(!db.prepare('SELECT 1 FROM inventory_openings WHERE product_id=?').get(e.productId)){
    const p=productView(db.prepare('SELECT * FROM products WHERE id=?').get(e.productId));quantity(e.quantity,p,true);const next=new Date(source.month+'-01T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
    db.prepare('INSERT INTO inventory_openings VALUES (?,?,?,1)').run(e.productId,next.toISOString().slice(0,10),e.quantity);inventory.audit(user,'opening',e.productId,{},e,'补齐独立历史产品位置的期末结转');
   }
   track('position-opening',e,e.productId);
  }
  for(const e of source.counts){
   if(existing(e.sourceRef))continue;
   if(db.prepare('SELECT 1 FROM inventory_counts WHERE product_id=? AND count_date=?').get(e.productId,e.date))fail(409,'该产品已登记历史实盘，不能覆盖：'+e.productId);
   inventory.setCount(user,{productId:e.productId,date:e.date,quantity:e.quantity,version:0});track('count',e,e.productId+'|'+e.date);result.counts++;
  }
  const adjustments=new Map();for(const e of source.adjustments){const key=e.workerId+'|'+e.date,entry=adjustments.get(key)||{workerId:e.workerId,date:e.date,amount:0,entries:[]};entry.amount=round(entry.amount+e.amount,2);entry.entries.push(e);adjustments.set(key,entry);}
  const wages=new WorkbookService(db,production).wages;
  for(const e of adjustments.values()){
   if(e.entries.every(item=>existing(item.sourceRef)))continue;
   if(db.prepare('SELECT 1 FROM wage_adjustments WHERE worker_id=? AND production_date=?').get(e.workerId,e.date))fail(409,'该人员已设置当日补助，不能覆盖');
   wages.setAdjustment(user,{workerId:e.workerId,date:e.date,amount:e.amount,reason:e.entries.map(a=>a.name||'历史补助').join('、')});for(const item of e.entries)track('adjustment',item,e.workerId+'|'+e.date);result.adjustments++;
  }
  for(const e of source.loadingControls)if(!existing(e.sourceRef)){track('loading-control',e,e.groupId+'|'+e.date);result.controls++;}
  return result;
 });
}
