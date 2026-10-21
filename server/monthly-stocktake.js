import {createHash} from 'node:crypto';
import {today,now,transaction} from './db.js';
import {fail,quantity,round} from './service.js';
import {hasPermission} from './permissions.js';

export function lastMonth(day=today()){
 const end=new Date(day.slice(0,7)+'-01T00:00:00Z');end.setUTCDate(0);
 const to=end.toISOString().slice(0,10);return {month:to.slice(0,7),from:to.slice(0,7)+'-01',to};
}
export const canStocktake=u=>u?.role==='admin'&&(hasPermission(u,'review')||hasPermission(u,'inventory'));
export class MonthlyStocktake{
 constructor(db,inventory){
  this.db=db;this.inventory=inventory;
  db.exec(`CREATE TABLE IF NOT EXISTS monthly_stocktakes (month TEXT NOT NULL,product_id TEXT NOT NULL REFERENCES products(id),status TEXT NOT NULL CHECK(status IN ('confirmed','error')),fingerprint TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(month,product_id));
   CREATE TABLE IF NOT EXISTS monthly_stocktake_reopens (month TEXT NOT NULL,product_id TEXT NOT NULL,review_version INTEGER NOT NULL,PRIMARY KEY(month,product_id),FOREIGN KEY(month,product_id) REFERENCES monthly_stocktakes(month,product_id) ON DELETE CASCADE)`);
 }
 access(user,q={}){if(!canStocktake(user))fail(403,'没有月度盘点权限');const range=lastMonth();if(q.month&&q.month!==range.month)fail(400,'只能盘点上个月的数据');return range;}
 snapshot(user,q={}){
  const range=this.access(user,q),report=this.inventory.summary(user,range),records=this.inventory.production.annotate(this.inventory.production.rawList(range)).filter(r=>r.counted),ships=this.inventory.list(user,range);
  const day=today(),currentRange={from:day.slice(0,7)+'-01',to:day},currentRows=new Map(this.inventory.summary(user,currentRange).rows.map(r=>[r.product.id,r]));
  const saved=new Map(this.db.prepare('SELECT s.*,u.name actor,CASE WHEN o.review_version=s.version THEN 1 ELSE 0 END reopened FROM monthly_stocktakes s JOIN users u ON u.id=s.actor_id LEFT JOIN monthly_stocktake_reopens o ON o.month=s.month AND o.product_id=s.product_id WHERE s.month=?').all(range.month).map(s=>[s.product_id,s]));
  const rows=report.rows.filter(r=>records.some(p=>p.product.id===r.product.id)||ships.some(s=>s.entries.some(e=>e.product.id===r.product.id))).map(r=>{
   const id=r.product.id,production=records.filter(p=>p.product.id===id).map(p=>[p.id,p.version,p.date,p.quantity,p.product.unit,p.weightKg,p.members.map(m=>[m.id,m.name])]).sort((a,b)=>a[0].localeCompare(b[0])),shipments=ships.filter(s=>s.entries.some(e=>e.product.id===id)).map(s=>[s.id,s.version,s.date,s.customer,s.entries.filter(e=>e.product.id===id)]).sort((a,b)=>a[0].localeCompare(b[0]));
   const fingerprint=createHash('sha256').update(JSON.stringify([r.opening,r.balance,r.produced,r.shipped,r.initial,production,shipments])).digest('hex'),old=saved.get(id),stale=!!old&&old.fingerprint!==fingerprint;
   const current=currentRows.get(id);
   return {...r,current:{opening:current.opening,produced:current.produced,shipped:current.shipped,change:current.issue==='历史单位需核对'?null:round(current.produced-current.shipped,6),balance:current.balance,issue:current.issue},fingerprint,status:!old||stale||old.reopened?'pending':old.status,stale,reopened:!!old?.reopened,reviewVersion:old?.version||0,reviewedBy:old?.actor||'',reviewedAt:old?.updated_at||''};
  });
  return {...range,currentRange,rows,confirmedCount:rows.filter(r=>r.status==='confirmed').length,errorCount:rows.filter(r=>r.status==='error').length};
 }
 detail(user,id,q={}){
  const report=this.snapshot(user,q),view=q.view||'previous';if(!['previous','month','current'].includes(view))fail(400,'请选择有效的库存明细');
  const row=report.rows.find(r=>r.product.id===id);if(!row)fail(404,'上月该产品没有库存变化');
  const flow=this.inventory.movements(user,id,view==='previous'?report:report.currentRange);
  let change=0;for(const f of flow.flows){change=round(change+(f.kind==='production'?f.quantity:-f.quantity),6);f.change=change;}
  return {...flow,view,change:round(flow.produced-flow.shipped,6),issue:view==='previous'?row.issue:row.current.issue,month:report.month,review:row};
 }
 // This transition is authorized by the enclosing stocktake save, including
 // inventory-only administrators. It cannot confirm records outside its scope.
 #confirmProduction(user,id,range){
  const production=this.inventory.production,records=production.annotate(production.rawList(range)).filter(r=>r.product.id===id&&r.counted&&r.status==='pending');
  const stamp=now();
  for(const record of records){
   const r=production.get(user,record.id),p=record.product;
   if(!p.unit)fail(400,'请先核准产品计量单位');
   quantity(r.quantity,p,true);
   production.assertNoHistoricalOverlap({date:r.production_date,productId:r.product_id,groupId:r.group_id,memberIds:record.members.map(m=>m.id),sourceRef:r.source_ref,id:r.id,quantity:r.quantity});
   const before=production.snapshot(r),after={...before,status:'approved'};
   this.db.prepare("UPDATE records SET status='approved',version=version+1,updated_at=?,rejection_reason='' WHERE id=?").run(stamp,r.id);
   production.audit(r,user,'approve',before,after,range.month+'月度盘点确认');
   production.announce(r,user,'生产记录已随'+range.month+'月度盘点确认');
   this.db.prepare("UPDATE change_requests SET status='resolved',resolved_at=? WHERE record_id=? AND status='open'").run(stamp,r.id);
  }
  return records.length;
 }
 save(user,id,input){return transaction(this.db,()=>{
  const report=this.snapshot(user,input),row=report.rows.find(r=>r.product.id===id);
  if(!row)fail(400,'只能盘点上月有库存变化的产品');
  if(!['confirmed','error'].includes(input.status))fail(400,'请选择确认或错误');
  if(input.version!==row.reviewVersion||input.fingerprint!==row.fingerprint)fail(409,'库存或盘点结果已变化，请刷新后重新盘点');
  if(input.status==='confirmed'&&row.balance===null)fail(400,'请先设置期初库存或处理单位问题');
  const before=this.db.prepare('SELECT * FROM monthly_stocktakes WHERE month=? AND product_id=?').get(report.month,id)||{};
  const confirmedRecords=input.status==='confirmed'?this.#confirmProduction(user,id,report):0;
  // Record versions change on approval. Save the resulting fingerprint so a
  // successful stocktake does not immediately appear stale on the next read.
  const fingerprint=confirmedRecords?this.snapshot(user,report).rows.find(r=>r.product.id===id).fingerprint:row.fingerprint;
  this.db.prepare('INSERT INTO monthly_stocktakes (month,product_id,status,fingerprint,actor_id,updated_at,version) VALUES (?,?,?,?,?,?,1) ON CONFLICT(month,product_id) DO UPDATE SET status=excluded.status,fingerprint=excluded.fingerprint,actor_id=excluded.actor_id,updated_at=excluded.updated_at,version=version+1').run(report.month,id,input.status,fingerprint,user.id,now());
  this.db.prepare('DELETE FROM monthly_stocktake_reopens WHERE month=? AND product_id=?').run(report.month,id);
  this.inventory.audit(user,'monthly-stocktake',report.month+'|'+id,before,{status:input.status,fingerprint,confirmedRecords},input.status==='confirmed'?'月度盘点确认':'月度盘点标记错误');
  return {ok:true,confirmedRecords};
 });}
 reopen(user,id,input){return transaction(this.db,()=>{
  const report=this.snapshot(user,input),row=report.rows.find(r=>r.product.id===id);
  if(!row)fail(404,'上月该产品没有库存变化');
  if(input.version!==row.reviewVersion||input.fingerprint!==row.fingerprint)fail(409,'库存或盘点结果已变化，请刷新后重新盘点');
  if(row.status==='pending')fail(409,'该产品已在待盘点中，请刷新列表');
  const before=this.db.prepare('SELECT * FROM monthly_stocktakes WHERE month=? AND product_id=?').get(report.month,id);
  this.db.prepare('UPDATE monthly_stocktakes SET version=version+1,actor_id=?,updated_at=? WHERE month=? AND product_id=?').run(user.id,now(),report.month,id);
  this.db.prepare('INSERT INTO monthly_stocktake_reopens VALUES (?,?,?) ON CONFLICT(month,product_id) DO UPDATE SET review_version=excluded.review_version').run(report.month,id,row.reviewVersion+1);
  this.inventory.audit(user,'monthly-stocktake',report.month+'|'+id,before,{status:'pending',fingerprint:row.fingerprint,reopened:true},'重新盘点');
  return {ok:true};
 });}
}
export function registerMonthlyStocktake(app,db,inventory){const service=new MonthlyStocktake(db,inventory);app.get('/api/monthly-stocktake',(req,res)=>res.json(service.snapshot(req.user,req.query)));app.get('/api/monthly-stocktake/:id',(req,res)=>res.json(service.detail(req.user,req.params.id,req.query)));app.put('/api/monthly-stocktake/:id',(req,res)=>res.json(service.save(req.user,req.params.id,req.body)));app.post('/api/monthly-stocktake/:id/reopen',(req,res)=>res.json(service.reopen(req.user,req.params.id,req.body)));return service;}
