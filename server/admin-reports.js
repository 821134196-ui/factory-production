import {today} from './db.js';
import {date,fail,round,productView} from './service.js';
import {hasPermission,assertPermission} from './permissions.js';

const iso=d=>d.toISOString().slice(0,10),dayDate=s=>new Date(s+'T00:00:00Z');
export function reportRange(q={},current=today()){
 if(q.period==='custom'){
  const from=date(q.from||current.slice(0,7)+'-01'),to=date(q.to||current);
  if(from>to)fail(400,'开始日期不能晚于结束日期');
  if(to>current)fail(400,'结束日期不能晚于今天');
  if(Date.parse(to)-Date.parse(from)>366*864e5)fail(400,'查询时间范围最多一年');
  return {period:'custom',date:to,from,to,previousDate:null,nextDate:null,nextDisabled:true};
 }
 const period=q.period||'day',anchor=date(q.date||current);if(!['day','week','month'].includes(period)||anchor>current)fail(400,'请选择日、周、月及不晚于今天的日期');
 const start=dayDate(anchor),end=dayDate(anchor);
 if(period==='week'){start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);end.setTime(start.getTime());end.setUTCDate(end.getUTCDate()+6);}
 if(period==='month'){start.setUTCDate(1);end.setUTCMonth(end.getUTCMonth()+1,0);}
 const move=n=>{const d=dayDate(period==='week'?iso(start):anchor);if(period==='month'){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);}else d.setUTCDate(d.getUTCDate()+n*(period==='week'?7:1));return iso(d);};
 return {period,date:anchor,from:iso(start),to:iso(end)>current?current:iso(end),previousDate:move(-1),nextDate:move(1),nextDisabled:move(1)>current};
}
const business=q=>{const category=q.category||'预制块';if(!['预制块','浇注料','装车','卸车'].includes(category))fail(400,'统计模块不正确');return {category:['装车','卸车'].includes(category)?'装/卸车':category,loadingOperation:['装车','卸车'].includes(category)?category:''};};
function aggregate(rows){const units=new Map();let weightKg=0,unknownWeight=0;for(const r of rows){const key=r.product.unit;units.set(key,round((units.get(key)||0)+r.quantity,6));if(r.weightKg===null)unknownWeight++;else weightKg+=r.weightKg;}return {quantity:round([...units.values()].reduce((n,v)=>n+v,0),6),units:[...units].map(([unit,quantity])=>({unit,quantity})),weightTonnes:unknownWeight?null:round(weightKg/1000,6),recordCount:rows.length};}
export class AdminReports{
 constructor(db,production,wages){this.db=db;this.production=production;this.wages=wages;}
 access(user){if(user.role!=='admin'||!hasPermission(user,'stats')&&!hasPermission(user,'salary'))fail(403,'需要生产统计或工资权限');}
 filters(q,range){const filter={from:range.from,to:range.to,...business(q)};if(q.groupId){if(!this.db.prepare('SELECT 1 FROM groups WHERE id=?').get(q.groupId))fail(400,'班组不存在');filter.groupId=q.groupId;}return filter;}
 summary(user,q={}){
  this.access(user);const range=reportRange(q),result={...range,production:null,wages:null};
  if(hasPermission(user,'stats')){
   const filter=this.filters(q,range),all=this.production.list(user,filter),rows=all.filter(r=>r.counted),summary=aggregate(rows);
   const groups=new Map(this.db.prepare('SELECT id,name FROM groups').all().map(g=>[g.id,g.name]));
   const workers=this.db.prepare("SELECT id,name,group_id groupId FROM users WHERE role='worker' AND (active=1 OR id IN (SELECT user_id FROM members m JOIN records r ON r.id=m.record_id WHERE r.deleted_at='' AND r.production_date BETWEEN ? AND ?))").all(range.from,range.to).map(w=>{const own=rows.filter(r=>r.members.length===1&&r.members[0].id===w.id),sharedCount=rows.filter(r=>r.members.length!==1&&r.members.some(m=>m.id===w.id)).length;return {...w,...aggregate(own),sharedCount};}).sort((a,b)=>b.quantity-a.quantity||a.name.localeCompare(b.name,'zh-CN'));
   const products=[...new Set(rows.map(r=>r.product.id))].map(id=>{const own=rows.filter(r=>r.product.id===id),p=own[0].product;return {id,name:p.productTitle,spec:p.productDetail,groupName:groups.get(own[0].groupId)||'',...aggregate(own)};}).sort((a,b)=>b.quantity-a.quantity);
   const daily=[];for(const d=dayDate(range.from);iso(d)<=range.to;d.setUTCDate(d.getUTCDate()+1)){const day=iso(d);daily.push({id:day,date:day,...aggregate(rows.filter(r=>r.date===day))});}
   result.production={...summary,workerCount:new Set(rows.flatMap(r=>r.members.map(m=>m.id))).size,pendingCount:all.filter(r=>r.status==='pending').length,workers,products,daily};
  }
  if(hasPermission(user,'salary')){const w=this.wages.summary(user,{from:range.from,to:range.to});result.wages={from:w.from,to:w.to,total:w.total,base:w.base,automaticSupplementTotal:w.automaticSupplementTotal,adjustmentTotal:w.adjustmentTotal,unpricedCount:w.unpricedCount,unallocatedCount:w.unallocatedCount,supplementsConfirmed:w.supplementsConfirmed,people:w.people.sort((a,b)=>(b.total??b.base)-(a.total??a.base))};}
  return result;
 }
 detail(user,q={}){
  this.access(user);const range=reportRange(q),kind=q.kind;
  if(kind==='wage-worker'){
   assertPermission(user,'salary');const worker=this.db.prepare("SELECT id,name FROM users WHERE id=? AND role='worker'").get(q.id);if(!worker)fail(404,'工人不存在');
   return {...range,kind,name:worker.name,wages:this.wages.summary(user,{from:range.from,to:range.to,workerId:worker.id})};
  }
  assertPermission(user,'stats');if(!['worker','product','day'].includes(kind))fail(400,'明细类型不正确');
  const filter=this.filters(q,range);let name='';
  if(kind==='worker'){const w=this.db.prepare("SELECT name FROM users WHERE id=? AND role='worker'").get(q.id);if(!w)fail(404,'工人不存在');filter.workerId=q.id;name=w.name;}
  if(kind==='product'){const p=this.db.prepare('SELECT * FROM products WHERE id=?').get(q.id);if(!p)fail(404,'产品不存在');filter.productId=q.id;name=productView(p).fullName;}
  if(kind==='day'){const day=date(q.id);if(day<range.from||day>range.to)fail(400,'日期不在所选统计期间');filter.from=day;filter.to=day;name=day;}
  const records=this.production.list(user,filter).filter(r=>r.counted),own=kind==='worker'?records.filter(r=>r.members.length===1):records;
  return {...range,kind,name,...aggregate(own),sharedCount:records.length-own.length,records};
 }
}
export function registerAdminReports(app,db,production,wages){const reports=new AdminReports(db,production,wages);app.get('/api/admin/reports',(req,res)=>res.json(reports.summary(req.user,req.query)));app.get('/api/admin/reports/detail',(req,res)=>res.json(reports.detail(req.user,req.query)));return reports;}
