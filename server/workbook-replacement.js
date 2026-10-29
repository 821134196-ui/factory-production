import path from 'node:path';
import {privatePath,readPrivateJson,initialWagePolicy} from './private-data.js';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import {now,transaction} from './db.js';
import {WorkbookService} from './workbooks.js';
import {initializeSourceHistory,readSourceHistory,importSourceExtras} from './source-history.js';
import {inputValue,attendanceMarked} from './workbook-layout.js';
import {round,quantity,productView} from './service.js';
import {wageBasisForProduct,quantityToTonnes} from './material-units.js';

export const bundledMonth=readPrivateJson('source-data/current.json',{month:''}).month;
export const replacementKey='workbook_dataset_v1';
const baseCatalog=readPrivateJson('catalog.json',[]);
const specs=[{id:'g1',start:27,end:322,staff:[2,10],count:12},{id:'g2',start:25,end:183,staff:[4,12],count:13},{id:'g3',start:22,end:122,staff:[4,10],count:11}];
const norm=value=>String(value??'').normalize('NFC').replace(/\s/g,'').replace(/灌/g,'罐');
const sha=value=>createHash('sha256').update(value).digest('hex');
const businessTables=['monthly_stocktake_reopens','monthly_stocktakes','notices','change_requests','history','members','records','attendance','leader_requests','frequent_workers','imports','shipments','shipment_files','inventory_counts','inventory_openings','inventory_month_openings','inventory_history','history_source_rows','wage_adjustments','wage_history','wage_rates','wage_policy_dates'];
const exists=(db,table)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
export function businessCounts(db){return Object.fromEntries(businessTables.filter(t=>exists(db,t)).map(t=>[t,db.prepare('SELECT count(*) n FROM '+t).get().n]));}

export function loadBundledWorkbooks(){
 const folder=privatePath('source-data/'+bundledMonth),manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
 const result={...manifest};
 for(const key of ['precast','material']){
  const buffer=fs.readFileSync(path.join(folder,key+'.xlsx'));
  if(sha(buffer)!==manifest[key].sha256)throw new Error('来源表格校验不通过：'+key);
  result[key]={...manifest[key],buffer};
 }
 return result;
}

function clearBusiness(db){
 for(const table of businessTables)if(exists(db,table))db.exec('DELETE FROM '+table);
 db.prepare("DELETE FROM app_meta WHERE key=? OR key LIKE 'opening_stock_%' OR key LIKE 'source_history_%'").run(replacementKey);
 db.prepare("INSERT OR REPLACE INTO app_meta VALUES ('wage_policy_v1',?)").run(JSON.stringify(initialWagePolicy));
}

function synchronizeCatalog(db,books,snapshot){
 db.exec('UPDATE products SET active=0');const used=new Set(),rows=[];
 for(const [index,spec]of specs.entries()){
  const sheet=books.precast.worksheets[index];
  for(let row=spec.start;row<=spec.end;row++){
   const name=inputValue(sheet.getCell(row,2)),weight=inputValue(sheet.getCell(row,3));
   if(typeof name!=='string'||typeof weight!=='number'||weight<=0)continue;
   const matches=baseCatalog.filter(p=>p.category==='预制块'&&p.groupId===spec.id&&norm(p.name)===norm(name)&&p.weightKg===weight&&!used.has(p.id));
   const original=matches.find(p=>p.source.endsWith('/ B'+row+':C'+row))||matches[0];
   const id=original?.id||'source-'+sha(spec.id+'|'+name.trim()+'|'+weight+'|'+row).slice(0,16);used.add(id);
   rows.push({id,name:name.trim(),spec:weight+'公斤/块',category:'预制块',unit:'块',precision:0,weightKg:weight,groupId:spec.id,active:!!original,source:snapshot.precast.file+' / '+sheet.name+' / B'+row+':C'+row});
  }
 }
 const sheet=books.material.worksheets[0];
 for(const original of baseCatalog.filter(p=>p.id.startsWith('material-'))){
  const col=Number(original.id.slice(9)),value=inputValue(sheet.getCell(6,col))??inputValue(sheet.getCell(5,col));
  if(!['string','number'].includes(typeof value))continue;
  const loading=col>=73,detail=loading?(col===73?'按吨填写':'卸车 · 按吨填写'):inputValue(sheet.getCell(5,col));
  rows.push({...original,name:String(value).trim(),spec:typeof detail==='string'?detail.trim():original.spec,category:loading?'装/卸车':'浇注料',groupId:loading?'g5':'g4',active:true,source:snapshot.material.file+' / '+sheet.name+' / '+sheet.getCell(original.source.endsWith('5')?5:6,col).address});
 }
 const put=db.prepare('INSERT INTO products (id,name,spec,category,unit,precision,weight_kg,group_id,active,source) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,spec=excluded.spec,category=excluded.category,unit=excluded.unit,precision=excluded.precision,weight_kg=excluded.weight_kg,group_id=excluded.group_id,active=excluded.active,source=excluded.source');
 for(const p of rows)put.run(p.id,p.name,p.spec,p.category,p.unit,p.precision,p.weightKg,p.groupId,p.active?1:0,p.source);
 return db.prepare('SELECT * FROM products').all();
}

// This preparation runs against a disposable database copy. Nothing is cleared
// in the live database until parsing and a complete rehearsal have succeeded.
export async function prepareWorkbookReplacement(f,snapshot=loadBundledWorkbooks()){
 const books={};for(const key of ['precast','material']){books[key]=new ExcelJS.Workbook();await books[key].xlsx.load(snapshot[key].buffer);}
 clearBusiness(f.db);initializeSourceHistory(f.db);
 const products=synchronizeCatalog(f.db,books,snapshot),user=f.db.prepare('SELECT * FROM users WHERE is_super_admin=1 AND active=1').get();
 if(!user)throw new Error('总管理员不存在');
 const service=new WorkbookService(f.db,f.service),imports=[],production=[];
 for(const [key,category]of [['precast','预制块'],['material','浇注料']]){
  const source=snapshot[key],preview=await service.preview(user,{category,month:snapshot.month,fileName:source.file,base64:source.buffer.toString('base64')});
  if(preview.blockedCount)throw new Error('表格有未解决的数据：'+JSON.stringify(preview.entries.filter(e=>!e.ready).map(e=>({sheet:e.sheet,cell:e.cell,issue:e.issue}))));
  imports.push(f.db.prepare('SELECT * FROM imports WHERE id=?').get(preview.id));production.push(...preview.entries);
 }
 const extras=await readSourceHistory(f.db,{...snapshot});
 if(extras.issues.length)throw new Error('表格有未解决的数据：'+JSON.stringify(extras.issues));
 extras.additionalCurrentOpenings=[];
 const attendance=[];
 for(const [index,spec]of specs.entries())for(let day=1;day<=31;day++){
  const sheet=books.precast.worksheets[index],col=day+5,members=[];
  for(let row=spec.staff[0];row<=spec.staff[1];row++)if(attendanceMarked(inputValue(sheet.getCell(row,col)))){
   const worker=service.workerByName(inputValue(sheet.getCell(row,5)));if(!worker)throw new Error('出勤人员未匹配');members.push({id:worker.id,name:worker.name,cell:sheet.getCell(row,col).address});
  }
  if(members.length)attendance.push({groupId:spec.id,date:snapshot.month+'-'+String(day).padStart(2,'0'),members,headcount:inputValue(sheet.getCell(spec.count,col)),sheet:sheet.name});
 }
 const rates=products.filter(p=>p.category==='浇注料'||p.category==='装/卸车').filter(p=>/^material-\d+$/.test(p.id)).map(p=>({productId:p.id,rate:inputValue(books.material.worksheets[0].getCell(7,Number(p.id.slice(9))))??0}));
 if(rates.some(r=>typeof r.rate!=='number'||r.rate<0))throw new Error('工资单价不是非负数');
 const manifest={month:snapshot.month,countDate:snapshot.countDate,allocateMarkedLoading:snapshot.allocateMarkedLoading,decisions:snapshot.decisions,sources:['precast','material'].map(key=>({file:snapshot[key].file,sha256:sha(snapshot[key].buffer)}))};
 const workers=f.db.prepare("SELECT id,name,phone FROM users WHERE role='worker'").all();
 return {manifest,products,imports,production,extras,attendance,rates,workers,fingerprint:sha(JSON.stringify(manifest))};
}

export function applyWorkbookReplacement(f,plan,{backupFile=null}={}){
 return transaction(f.db,()=>{
  const previous=businessCounts(f.db),user=f.db.prepare('SELECT * FROM users WHERE is_super_admin=1 AND active=1').get();
  clearBusiness(f.db);initializeSourceHistory(f.db);
  const put=f.db.prepare('INSERT OR REPLACE INTO products (id,name,spec,category,unit,precision,weight_kg,group_id,active,source) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for(const p of plan.products)put.run(p.id,p.name,p.spec,p.category,p.unit,p.precision,p.weight_kg,p.group_id,p.active,p.source);
  const service=new WorkbookService(f.db,f.service);
  const remapWorker=id=>{const source=plan.workers.find(w=>w.id===id),person=source&&(f.db.prepare("SELECT * FROM users WHERE phone=? AND role='worker'").get(source.phone)||service.workerByName(source.name));if(!person)throw new Error('导入人员不存在：'+(source?.name||id));return person.id;};
  for(const row of plan.imports){const entries=JSON.parse(row.entries_json).map(e=>({...e,...e.workerId?{workerId:remapWorker(e.workerId)}:{}}));f.db.prepare('INSERT INTO imports VALUES (?,?,?,?,?,?,?)').run(row.id,row.file_name,row.month,row.file_hash,JSON.stringify(entries),user.id,now());service.commit(user,row.id,{confirmed:true,sourceRefs:entries.map(e=>e.sourceRef)});}
  for(const e of plan.extras.openings)if(e.quantity!==null){
   const p=productView(f.db.prepare('SELECT * FROM products WHERE id=?').get(e.productId));quantity(e.quantity,p,true);
   const opening={product_id:p.id,start_date:plan.manifest.month+'-01',quantity:e.quantity,version:1};
   f.db.prepare('INSERT INTO inventory_openings VALUES (?,?,?,1)').run(p.id,opening.start_date,e.quantity);
   f.inventory.audit(user,'opening',p.id,{},opening,'新月份表格期初库存 · '+e.sheet+' '+e.cell);
  }
  const resolvedExtras={...plan.extras,loading:plan.extras.loading.map(e=>({...e,workerId:remapWorker(e.workerId)})),adjustments:plan.extras.adjustments.map(e=>({...e,workerId:remapWorker(e.workerId)}))};
  const extras=importSourceExtras(f.db,f.service,f.inventory,user,resolvedExtras);
  for(const r of plan.rates){
    const product=plan.products.find(p=>p.id===r.productId);
    service.wages.setRate(user,{...r,basis:wageBasisForProduct(product),effectiveDate:plan.manifest.month+'-01'});
   }
  for(const entry of plan.attendance){const ref=JSON.stringify([plan.manifest.month,'出勤',entry.sheet,entry.date]),resolved={...entry,members:entry.members.map(m=>({...m,id:remapWorker(m.id)}))};f.db.prepare('INSERT INTO history_source_rows VALUES (?,?,?,?,?)').run(ref,'attendance',entry.groupId+'|'+entry.date,JSON.stringify(resolved),now());}
  const range={from:plan.manifest.month+'-01',to:plan.manifest.month+'-31'},records=f.service.list(user,range).filter(r=>r.counted);
  if(records.length!==plan.production.length+plan.extras.loading.length)throw new Error('生产记录数量未能对账，已回滚');
  const expected=new Map([...plan.production,...plan.extras.loading].map(e=>[e.sourceRef,e]));
  for(const r of records)if(!expected.has(r.sourceRef)||Math.abs(expected.get(r.sourceRef).quantity-r.quantity)>1e-6)throw new Error('来源数量未能对账，已回滚');
  const wages=service.wages.summary(user,range);if(wages.unallocatedCount||wages.unpricedCount)throw new Error('存在未归属或未计价的工资，已回滚');
  const totals=new Map();for(const r of records){const category=r.product.loadingOperation||r.product.category,t=totals.get(category)||{category,records:0,quantity:0,unit:r.product.unit,tonnes:0};const tonnes=quantityToTonnes(r.product,r.quantity);t.records++;t.quantity=round(t.quantity+r.quantity,6);t.tonnes=t.tonnes===null||tonnes===null?null:round(t.tonnes+tonnes,6);totals.set(category,t);}
  const inventory=f.inventory.summary(user,range),byProduct=new Map(inventory.rows.map(r=>[r.product.id,r]));
  for(const e of plan.extras.openings){const r=byProduct.get(e.productId);if(!r||r.opening!==e.quantity)throw new Error('期初库存未能对账，已回滚');}
  for(const r of inventory.rows)if(r.opening!==null&&Math.abs(r.balance-(r.opening+r.produced-r.shipped))>1e-6)throw new Error('库存流转未能对账，已回滚');
  if(f.db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('数据库关联校验失败，已回滚');
  const result={...plan.manifest,fingerprint:plan.fingerprint,appliedAt:now(),backupFile,previous,records:records.length,production:[...totals.values()],extras,attendanceDays:plan.attendance.length,wages:{total:wages.total,base:wages.base,automaticSupplements:wages.automaticSupplementTotal,adjustments:wages.adjustmentTotal,people:wages.people},inventory:{products:inventory.rows.length,initialized:inventory.rows.filter(r=>r.opening!==null).length,unknown:inventory.uninitialized},loadingDifferences:plan.extras.loadingControls.filter(e=>e.difference!==0)};
  f.db.prepare('INSERT INTO app_meta VALUES (?,?)').run(replacementKey,JSON.stringify(result));return result;
 });
}

export async function initializeBundledWorkbooks(f,enabled=true){
 if(!enabled||!bundledMonth||f.db.prepare('SELECT 1 FROM app_meta WHERE key=?').get(replacementKey))return null;
 const tables=['records','shipments','inventory_openings','inventory_month_openings','inventory_counts','wage_adjustments','wage_rates','wage_policy_dates','imports','monthly_stocktakes'];
 if(tables.some(t=>exists(f.db,t)&&f.db.prepare('SELECT count(*) n FROM '+t).get().n))return null;
 return applyWorkbookReplacement(f,await prepareWorkbookReplacement(f));
}
