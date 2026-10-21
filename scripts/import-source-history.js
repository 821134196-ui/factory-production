import {privatePath} from '../server/private-data.js';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createApp} from '../server/app.js';
import {configFromEnv} from '../server/config.js';
import {transaction} from '../server/db.js';
import {WorkbookService} from '../server/workbooks.js';
import {readSourceHistory,importSourceExtras,ensureHistoryProductPositions} from '../server/source-history.js';
import {readOpeningSnapshot} from '../server/opening-import.js';
import {backupDatabase} from './backup.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),month='2026-09',range={from:month+'-01',to:month+'-30'};
const fingerprint=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function sourceFile(file,template){const original=privatePath('originals/'+file);return {file,buffer:fs.readFileSync(fs.existsSync(original)?original:privatePath('templates/'+template))};}
function currentState(f,admin,excludeProducts=[]){
 return {
  records:f.db.prepare("SELECT * FROM records WHERE production_date NOT LIKE '2026-09-%' ORDER BY id").all(),
  shipments:f.db.prepare("SELECT * FROM shipments WHERE shipping_date NOT LIKE '2026-09-%' ORDER BY id").all(),
  openings:f.db.prepare('SELECT * FROM inventory_openings ORDER BY product_id').all().filter(o=>!excludeProducts.includes(o.product_id)),
  balances:f.inventory.summary(admin,{from:'2026-10-01',to:'2026-10-31'}).rows.filter(r=>!excludeProducts.includes(r.product.id)).map(r=>[r.product.id,r.balance]).sort((a,b)=>a[0].localeCompare(b[0]))
 };
}
async function perform(f,sources){
 const admin=f.db.prepare('SELECT * FROM users WHERE active=1 AND is_super_admin=1').get();if(!admin)throw new Error('总管理员不存在');
 const additionalProducts=await ensureHistoryProductPositions(f.db,sources.precast);
 const workbook=new WorkbookService(f.db,f.service),previews=[];
 for(const [category,key]of [['预制块','precast'],['浇注料','material']]){
  const source=sources[key],preview=await workbook.preview(admin,{category,month,fileName:source.file,base64:source.buffer.toString('base64')});
  const blocked=preview.entries.filter(e=>!e.ready&&!e.recordId);if(blocked.length)throw new Error('历史生产有未解决问题：'+JSON.stringify(blocked.slice(0,10)));
  previews.push({category,preview});
 }
 const extra=await readSourceHistory(f.db,{month,...sources});if(extra.issues.length)throw new Error(JSON.stringify(extra.issues));
 const expected=readOpeningSnapshot();for(const source of extra.sources){const old=expected.sources.find(s=>s.file===source.file);if(!old||source.sha256!==old.sha256)throw new Error('表格内容与已结转的9月库存版本不同，请核对：'+source.file);}
 const before=currentState(f,admin,additionalProducts);
 const imported=transaction(f.db,()=>{
  const production=previews.map(({category,preview})=>({category,...workbook.commit(admin,preview.id,{confirmed:true,sourceRefs:preview.entries.map(e=>e.sourceRef)})}));
  const extras=importSourceExtras(f.db,f.service,f.inventory,admin,extra);
  if(fingerprint(before)!==fingerprint(currentState(f,admin,additionalProducts)))throw new Error('导入改变了9月以外的数据或10月库存，已回滚');
  return {production:production.map(p=>({category:p.category,imported:p.imported,total:p.preview.total})),...extras};
 });
 const rows=f.service.list(admin,range).filter(r=>r.counted),totals=new Map();
 for(const r of rows){const key=r.product.loadingOperation||r.product.category,item=totals.get(key)||{category:key,records:0,quantity:0,unit:r.product.unit,tonnes:0};item.records++;item.quantity+=r.quantity;item.tonnes+=(r.weightKg||0)/1000;totals.set(key,item);}
 const wages=workbook.wages.summary(admin,range),inventory=f.inventory.summary(admin,range),byProduct=new Map(inventory.rows.map(r=>[r.product.id,r]));
 const discrepancies=expected.rows.filter(e=>e.quantity!==null&&byProduct.get(e.productId)?.balance!==null&&Math.abs(e.quantity-byProduct.get(e.productId).balance)>1e-6).map(e=>({productId:e.productId,name:e.name,octoberOpening:e.quantity,septemberCalculated:byProduct.get(e.productId).balance}));
 return {month,sources:extra.sources,additionalProducts,imported,production:[...totals.values()].map(r=>({...r,quantity:Math.round(r.quantity*1e6)/1e6,tonnes:Math.round(r.tonnes*1e6)/1e6})),wages:{total:wages.total,base:wages.base,automaticSupplements:wages.automaticSupplementTotal,adjustments:wages.adjustmentTotal,unallocated:wages.unallocatedCount,unpriced:wages.unpricedCount,people:wages.people},inventory:{products:inventory.rows.length,openingRows:extra.openings.length,physicalCounts:extra.counts.length,unknown:inventory.uninitialized,octoberPreserved:true,septemberVsOctoberDifferences:discrepancies},loadingControls:extra.loadingControls,manualSupplements:extra.adjustments.length};
}

const apply=process.argv.includes('--apply'),config=configFromEnv(),stamp=new Date().toISOString().replace(/[:.]/g,'-');
if(!fs.existsSync(config.dbPath))throw new Error('请先启动系统初始化数据库');
const sources={precast:sourceFile('2026年9月预制块组记工表.xlsx','precast.xlsx'),material:sourceFile('2026年 9月浇注料记工表 .xlsx','material.xlsx')};
// Always rehearse the entire import against a consistent copy first.
const copy=path.join(root,'qa','source-history-preview-'+stamp+'.sqlite');backupDatabase(config.dbPath,copy);
const rehearsal=createApp({...config,dbPath:copy});let report;
try{report=await perform(rehearsal,sources);}finally{rehearsal.db.close();}
let backup;
if(apply){
 backup=backupDatabase(config.dbPath,path.join(root,'backups','before-source-history-'+stamp+'.sqlite'));
 const live=createApp(config);try{report=await perform(live,sources);}finally{live.db.close();}
}
report={mode:apply?'applied':'preview',createdAt:new Date().toISOString(),...report,...backup?{backup:backup.file}:{}};
fs.mkdirSync(path.join(root,'reports'),{recursive:true});
const output=path.join(root,'reports','2026-09-history-import-'+(apply?'result':'preview')+'.json');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
if(apply){
 const differenceRows=report.loadingControls.filter(c=>c.difference!==0),names={g1:'一组',g2:'二组',g3:'三组'};
 const lines=['# 2026年9月历史数据导入说明','','已导入两份2026年9月表格。生产记录896条（预制块505条、浇注料192条、装车132条、卸车67条），发货86笔，月初库存447项，月末实盘71项。当天工数和出勤人员随预制块生产记录保存，班组工资按当天实际出勤人数均分。','','表内6个同名、同单重的重复位置保留独立历史项目，不加入当前填报下拉。现有10月记录、发货和已设置的期初未变；补齐6个历史产品位置的10月结转。缺失库存保持待设置。','','预制块表顶部装卸已按确认口径归为装车，个人吨数＝逐人工资÷5。浇注料表中的装车另行累计，不互相覆盖。班组手填装车吨数单独保留，未用差额改动个人工资。','','## 装车分配差异','','以下差额＝按逐人工资还原的吨数合计－手填班组吨数。9月19日一组的268吨与26.8吨存在明显差异，待核对，未修改表格。','','| 日期 | 班组 | 手填合计（吨） | 工资还原合计（吨） | 差额（吨） |','| --- | --- | ---: | ---: | ---: |',...differenceRows.map(r=>`| ${r.date} | ${names[r.groupId]} | ${r.tonnes} | ${r.allocatedTonnes} | ${r.difference} |`),'','备份：'+path.basename(backup.file),'','重复运行同一导入不会新增重复记录。'];
 fs.writeFileSync(path.join(root,'reports','2026-09历史数据导入说明.md'),lines.join('\n')+'\n');
}
const summary={mode:report.mode,month,imported:report.imported,production:report.production,wages:report.wages,inventory:report.inventory,loadingDifferenceDays:report.loadingControls.filter(c=>c.difference!==0).length,report:output,...backup?{backup:backup.file}:{}};
delete summary.wages.people;
console.log(JSON.stringify(summary,null,2));
