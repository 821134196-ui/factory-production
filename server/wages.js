import {readPrivateJson,initialWagePolicy} from './private-data.js';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fail,date,text,round,productView} from './service.js';
import {now,today,transaction} from './db.js';
import {assertPermission,isSuper} from './permissions.js';
import {wageBreakdown} from './wage-breakdown.js';
import {precastSupplements} from './precast-wage-rules.js';
import {wageBasisForProduct,materialUnitSpec,configuredMaterialIds} from './material-units.js';
const source=readPrivateJson('wage-source.json',{});
function month(value){if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||value>today().slice(0,7))fail(400,'工资月份不正确');return value;}
function money(value){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e9||Math.abs(value*100-Math.round(value*100))>0.0001)fail(400,'金额最多2位小数');return round(value,2);}
export class WageService{
 constructor(db,production){this.db=db;this.production=production;
  db.exec(`CREATE TABLE IF NOT EXISTS wage_rates (product_id TEXT NOT NULL REFERENCES products(id),month TEXT NOT NULL,rate REAL NOT NULL,basis TEXT NOT NULL CHECK(basis IN ('tonne','quantity')),PRIMARY KEY(product_id,month));
   CREATE TABLE IF NOT EXISTS wage_policy_dates (effective_date TEXT PRIMARY KEY,policy_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS wage_adjustments (worker_id TEXT NOT NULL REFERENCES users(id),production_date TEXT NOT NULL,amount REAL NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(worker_id,production_date));
   CREATE TABLE IF NOT EXISTS wage_history (id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,target TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_at TEXT NOT NULL);`);
  db.exec("UPDATE wage_rates SET month=month||'-01' WHERE length(month)=7");
  if(!db.prepare("SELECT 1 FROM app_meta WHERE key='material_unit_wage_v1'").get())transaction(db,()=>{
   for(const id of configuredMaterialIds()){
    const raw=source[id],spec=materialUnitSpec(id);
    db.prepare("UPDATE wage_rates SET basis='quantity',rate=COALESCE(?,rate) WHERE product_id=?").run(raw?.rawRate??null,id);
   }
   db.prepare("INSERT INTO app_meta VALUES ('material_unit_wage_v1','done')").run();
  });
  db.prepare("INSERT OR IGNORE INTO app_meta VALUES ('wage_policy_v1',?)").run(JSON.stringify(initialWagePolicy));
  if(!db.prepare("SELECT 1 FROM app_meta WHERE key='precast_source_wages_v2'").get())transaction(db,()=>{
   const before=this.policy(),after={...before,precastMode:'crew'};
   db.prepare("UPDATE app_meta SET value=? WHERE key='wage_policy_v1'").run(JSON.stringify(after));
   db.prepare("INSERT INTO app_meta VALUES ('precast_source_wages_v2','done')").run();
   const actor=db.prepare('SELECT * FROM users WHERE is_super_admin=1').get();
   if(actor)this.audit(actor,'source-policy-migration','precast_source_wages_v2',before,after);
  });
 }
 policy(day){const base=JSON.parse(this.db.prepare("SELECT value FROM app_meta WHERE key='wage_policy_v1'").get()?.value||'{"precastMode":"pending","precastRate":0,"materialMultiplier":null,"supplementsConfirmed":false}');if(!day)return base;const dated=this.db.prepare('SELECT policy_json FROM wage_policy_dates WHERE effective_date<=? ORDER BY effective_date DESC LIMIT 1').get(day);return dated?{...base,...JSON.parse(dated.policy_json)}:base;}
 rate(product,period){const day=period.length===7?period+'-31':period;const own=this.db.prepare('SELECT * FROM wage_rates WHERE product_id=? AND month<=? ORDER BY month DESC LIMIT 1').get(product.id,day);if(own)return {rate:own.rate,basis:wageBasisForProduct(product)==='quantity'?'quantity':own.basis,source:'总管理员配置（'+own.month+'起）'};
  if(product.category==='预制块'){const policy=this.policy(day);return policy.precastMode==='pending'?null:{rate:policy.precastRate,basis:'tonne',source:'预制块基础工资'};}
  const raw=source[product.id],basis=wageBasisForProduct(product);if(!raw||raw.rawRate===null||raw.rawRate===undefined)return {rate:0,basis,source:basis==='quantity'?'未设置单价，暂按0元/当前单位':'未设置单价，暂按0元/吨'};
  if(product.category==='装/卸车')return {rate:raw.rawRate,basis:'tonne',source:'配置 '+raw.sourceCell};
  if(basis==='quantity')return {rate:raw.rawRate,basis,source:'配置 '+raw.sourceCell+'，按'+product.unit+'计价'};
  const factor=this.policy(day).materialMultiplier;return factor===null?null:{rate:raw.rawRate*factor,basis:'tonne',source:'配置 '+raw.sourceCell+'，已换算元/吨'};
 }
 config(user,period=today().slice(0,7)){if(!isSuper(user))fail(403,'只有总管理员可以设置工资');month(period);return {month:period,effectiveDate:today(),policy:this.policy(today()),products:this.db.prepare('SELECT * FROM products WHERE active=1 ORDER BY category,name,spec').all().map(productView).map(p=>({...p,rate:this.rate(p,period===today().slice(0,7)?today():period),originalRate:source[p.id]?.rawRate??null})),workers:this.db.prepare("SELECT id,name FROM users WHERE active=1 AND role='worker' ORDER BY name").all()};}
 audit(user,kind,target,before,after){this.db.prepare('INSERT INTO wage_history VALUES (?,?,?,?,?,?,?)').run(randomUUID(),user.id,kind,target,JSON.stringify(before),JSON.stringify(after),now());}
 setRate(user,input){
  if(!isSuper(user))fail(403,'只有总管理员可以设置工资单价');
  const effectiveDate=input.effectiveDate?date(input.effectiveDate):month(input.month)+'-01',p=this.db.prepare('SELECT * FROM products WHERE id=?').get(input.productId);
  if(!p)fail(400,'产品不存在');const rate=money(input.rate);if(rate<0||!['tonne','quantity'].includes(input.basis))fail(400,'工资单价或计价方式不正确');
  return transaction(this.db,()=>{const before=this.db.prepare('SELECT * FROM wage_rates WHERE product_id=? AND month>=? ORDER BY month').all(p.id,effectiveDate);
   this.db.prepare('DELETE FROM wage_rates WHERE product_id=? AND month>=?').run(p.id,effectiveDate);
   this.db.prepare('INSERT INTO wage_rates VALUES (?,?,?,?)').run(p.id,effectiveDate,rate,input.basis);
   this.audit(user,'rate',p.id+'|'+effectiveDate,before,{...input,effectiveDate});return {ok:true,effectiveDate};
  });
 }
 setPolicy(user,input){
  if(!isSuper(user))fail(403,'只有总管理员可以设置工资规则');if(input.precastMode!=='crew'||typeof input.supplementsConfirmed!=='boolean')fail(400,'预制块按当日班组参与人数均分');
  const rate=money(input.precastRate);if(rate<0||input.materialMultiplier!==null&&(!Number.isFinite(input.materialMultiplier)||input.materialMultiplier<=0))fail(400,'单价换算不正确');
  const after={precastMode:'crew',precastRate:rate,materialMultiplier:input.materialMultiplier,supplementsConfirmed:input.supplementsConfirmed},effectiveDate=input.effectiveDate?date(input.effectiveDate):'';
  return transaction(this.db,()=>{
   if(effectiveDate){const before=this.db.prepare('SELECT * FROM wage_policy_dates WHERE effective_date>=? ORDER BY effective_date').all(effectiveDate);this.audit(user,'policy-date',effectiveDate,before,after);this.db.prepare('DELETE FROM wage_policy_dates WHERE effective_date>=?').run(effectiveDate);this.db.prepare('INSERT INTO wage_policy_dates VALUES (?,?)').run(effectiveDate,JSON.stringify({precastMode:after.precastMode,precastRate:rate,materialMultiplier:after.materialMultiplier}));const base={...this.policy(),supplementsConfirmed:after.supplementsConfirmed};this.db.prepare("UPDATE app_meta SET value=? WHERE key='wage_policy_v1'").run(JSON.stringify(base));}
   else{this.audit(user,'policy','wage_policy_v1',this.policy(),after);this.db.prepare("INSERT INTO app_meta VALUES ('wage_policy_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(after));}
   return {ok:true,effectiveDate};
  });
 }
 setAdjustment(user,input){if(!isSuper(user))fail(403,'只有总管理员可以设置工资补助');const day=date(input.date);if(day>today())fail(400,'不能设置未来日期的补助');const worker=this.db.prepare("SELECT * FROM users WHERE id=? AND role='worker'").get(input.workerId);if(!worker)fail(400,'工人不存在');const amount=money(input.amount),reason=text(input.reason,'补助或扣款说明',300);return transaction(this.db,()=>{const before=this.db.prepare('SELECT * FROM wage_adjustments WHERE worker_id=? AND production_date=?').get(worker.id,day)||null;this.db.prepare('INSERT INTO wage_adjustments VALUES (?,?,?,?) ON CONFLICT(worker_id,production_date) DO UPDATE SET amount=excluded.amount,reason=excluded.reason').run(worker.id,day,amount,reason);this.audit(user,'adjustment',worker.id+'|'+day,before,{amount,reason});return {ok:true};});}
 summary(user,q={}){
  if(user.role==='admin')assertPermission(user,'salary');
  const {from,to}=this.production.range(q),policy=this.policy(to),rows=this.production.annotate(this.production.rawList({from,to})).filter(r=>r.counted&&(!q.groupId||r.groupId===q.groupId));
  // 先构建全班组、全日的分母，再筛选可查看的个人。人员筛选不能改变均分结果。
  const crew=new Map(),workerId=user.role==='worker'?user.id:q.workerId,workers=new Map(),details=[],supplements=[],crews=[];let unallocated=0;
  const person=(id,name)=>{if(!workers.has(id))workers.set(id,{id,name,baseMicros:0,supplementMicros:0,adjustmentCents:0,unpricedCount:0});return workers.get(id);};
  const addBase=(member,detail)=>{if(workerId&&member.id!==workerId)return;const p=person(member.id,member.name);if(detail.amount===null)p.unpricedCount++;else p.baseMicros+=Math.round(detail.amount*1e6);details.push({...detail,workerId:member.id,workerName:member.name});};
  for(const r of rows){
   if(r.product.category==='预制块'){const key=r.date+'|'+r.groupId,c=crew.get(key)||{date:r.date,groupId:r.groupId,records:[],members:new Map()};c.records.push(r);r.members.forEach(m=>c.members.set(m.id,m));crew.set(key,c);continue;}
   if(r.members.length!==1){unallocated++;continue;}
   const rate=this.rate(r.product,r.date),tonnes=r.weightKg===null?null:r.weightKg/1000,basis=rate?.basis==='tonne'?tonnes:r.quantity;
   addBase(r.members[0],{recordId:r.id,productId:r.product.id,groupId:r.groupId,date:r.date,productName:r.product.fullName,productSpec:r.product.spec,category:r.product.category,quantity:r.quantity,unit:r.product.unit,tonnes,rate:rate?.rate??null,basis:rate?.basis||'',amount:rate&&basis!==null?round(basis*rate.rate,6):null,source:rate?.source||'单价或计价方式待设置'});
  }
  for(const c of crew.values()){
   const headcount=c.members.size,unknownMembers=c.records.filter(r=>!r.members.length).length;unallocated+=unknownMembers;
   const totalKg=c.records.some(r=>r.weightKg===null)?null:c.records.reduce((n,r)=>n+r.weightKg,0),automatic=totalKg===null||unknownMembers?[]:precastSupplements(c.records,headcount);
   const visible=!workerId||c.members.has(workerId);
   for(const r of c.records){const rate=this.rate(r.product,r.date),tonnes=r.weightKg===null?null:r.weightKg/1000,basis=rate?.basis==='quantity'?r.quantity/headcount:tonnes===null?null:tonnes/headcount;
    for(const member of c.members.values())addBase(member,{recordId:r.id,productId:r.product.id,groupId:r.groupId,date:r.date,productName:r.product.fullName,productSpec:r.product.spec,category:'预制块',quantity:r.quantity/headcount,unit:r.product.unit,tonnes:tonnes===null?null:tonnes/headcount,crewQuantity:r.quantity,crewTonnes:tonnes,headcount,rate:rate?.rate??null,basis:rate?.basis||'',amount:!unknownMembers&&rate&&basis!==null?round(basis*rate.rate,6):null,source:unknownMembers?'历史班组记录缺少核准参与人，人数待核定':'班组当日'+headcount+'人均分：该型号总量÷人数；'+(rate?.source||'单价待设置')});
   }
   for(const member of c.members.values()){
    if(workerId&&member.id!==workerId)continue;const p=person(member.id,member.name);
    for(const a of automatic){if(!a.quantity)continue;const amount=round(a.amount,6);p.supplementMicros+=Math.round(amount*1e6);supplements.push({...a,amount,date:c.date,groupId:c.groupId,workerId:member.id,workerName:member.name,headcount});}
   }
   if(visible){const own=details.filter(d=>d.groupId===c.groupId&&d.date===c.date&&d.category==='预制块'),base=own.some(d=>d.amount===null)||!headcount?null:round(own.reduce((n,d)=>n+d.amount,0)/(workerId?1:headcount),6);crews.push({date:c.date,groupId:c.groupId,groupName:this.db.prepare('SELECT name FROM groups WHERE id=?').get(c.groupId)?.name,headcount,totalKg,averageTonnes:headcount&&totalKg!==null?totalKg/1000/headcount:null,base,small:automatic.filter(a=>a.kind==='small').reduce((n,a)=>n+a.amount,0),large:automatic.filter(a=>a.kind==='large').reduce((n,a)=>n+a.amount,0),tonnage:automatic.filter(a=>a.kind==='tonnage').reduce((n,a)=>n+a.amount,0),unknownMembers,...(user.role==='admin'?{members:[...c.members.values()]}:{})});}
  }
  const adjustments=this.db.prepare('SELECT a.*,u.name FROM wage_adjustments a JOIN users u ON u.id=a.worker_id WHERE production_date BETWEEN ? AND ?').all(from,to).filter(a=>!workerId||a.worker_id===workerId);
  for(const a of adjustments)person(a.worker_id,a.name).adjustmentCents+=Math.round(a.amount*100);
  const people=[...workers.values()].map(p=>({id:p.id,name:p.name,base:round(p.baseMicros/1e6,2),automaticSupplements:round(p.supplementMicros/1e6,2),adjustments:round(p.adjustmentCents/100,2),unpricedCount:p.unpricedCount,total:p.unpricedCount?null:round((p.baseMicros+p.supplementMicros)/1e6+p.adjustmentCents/100,2)}));
  return {from,to,people,details,supplements,crews,days:wageBreakdown(details,supplements,adjustments.map(a=>({date:a.production_date,amount:a.amount,reason:a.reason}))),adjustments:adjustments.map(a=>({workerId:a.worker_id,name:a.name,date:a.production_date,amount:a.amount,reason:a.reason})),base:round(people.reduce((n,p)=>n+p.base,0),2),automaticSupplementTotal:round(people.reduce((n,p)=>n+p.automaticSupplements,0),2),adjustmentTotal:round(people.reduce((n,p)=>n+p.adjustments,0),2),unpricedCount:people.reduce((n,p)=>n+p.unpricedCount,0),unallocatedCount:user.role==='admin'?unallocated:0,supplementsConfirmed:policy.supplementsConfirmed,total:people.some(p=>p.total===null)||(user.role==='admin'&&unallocated)?null:round(people.reduce((n,p)=>n+p.total,0),2),policy};
 }
}
export function registerWageRoutes(app,db,production){const wages=new WageService(db,production);app.get('/api/wages',(req,res)=>res.json(wages.summary(req.user,req.query)));app.get('/api/wages/config',(req,res)=>res.json(wages.config(req.user,req.query.month)));app.put('/api/wages/rates',(req,res)=>res.json(wages.setRate(req.user,req.body)));app.put('/api/wages/policy',(req,res)=>res.json(wages.setPolicy(req.user,req.body)));app.put('/api/wages/adjustments',(req,res)=>res.json(wages.setAdjustment(req.user,req.body)));app.get('/api/wages/history',(req,res)=>{if(!isSuper(req.user))fail(403,'只有总管理员可以查看工资设置历史');res.json({history:db.prepare('SELECT h.*,u.name actor FROM wage_history h JOIN users u ON u.id=h.actor_id ORDER BY created_at DESC LIMIT 100').all().map(h=>({...h,before:JSON.parse(h.before_json),after:JSON.parse(h.after_json)}))});});return wages;}
