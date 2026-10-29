import {fail,round} from './service.js';
import {now} from './db.js';

export function initializeTeam(db){db.exec(`CREATE TABLE IF NOT EXISTS frequent_workers (leader_id TEXT REFERENCES users(id),worker_id TEXT REFERENCES users(id),uses INTEGER NOT NULL,last_used TEXT NOT NULL,PRIMARY KEY(leader_id,worker_id))`);}
export function sortedWorkers(db,user){
 const workers=db.prepare("SELECT id,name,group_id groupId,is_leader isLeader FROM users WHERE role='worker' AND active=1 ORDER BY name").all();
 if(!user.is_leader)return workers;
 const ranked=new Map(db.prepare('SELECT worker_id,uses,last_used FROM frequent_workers WHERE leader_id=?').all(user.id).map(x=>[x.worker_id,x]));
 return workers.sort((a,b)=>(ranked.get(b.id)?.uses||0)-(ranked.get(a.id)?.uses||0)||(ranked.get(b.id)?.last_used||'').localeCompare(ranked.get(a.id)?.last_used||'')||(b.id===user.id?1:0)-(a.id===user.id?1:0)||a.name.localeCompare(b.name,'zh-CN'));
}
export function rememberWorkers(db,user,ids){initializeTeam(db);for(const id of new Set(ids))db.prepare('INSERT INTO frequent_workers VALUES (?,?,1,?) ON CONFLICT(leader_id,worker_id) DO UPDATE SET uses=uses+1,last_used=excluded.last_used').run(user.id,id,now());}
const empty=()=>['预制块','浇注料','装车','卸车'].map(name=>({name,unit:name==='预制块'?'块':'吨',quantity:0,referenceQuantity:0,confirmed:0,pendingCount:0,weightKg:0,referenceWeightKg:0,items:[]}));
function metrics(service,records){
 const result=empty(),pending=new Map(),itemMaps=new Map(result.map(m=>[m.name,new Map()])),latest=records,unitsByCategory=new Map(result.map(m=>[m.name,new Set()]));
 for(const r of latest.filter(r=>r.counted)){
  const name=r.product.loadingOperation||r.product.category,m=result.find(m=>m.name===name);if(!m)continue;
  const quantity=r.quantity;
  unitsByCategory.get(name)?.add(r.product.unit);
  const isGroupTotal=['shared','historical-group','crew'].includes(r.mode),key=r.product.loadingOperation?name:`${r.product.id}|${r.product.unit}${isGroupTotal?'|group':''}`;
  if(isGroupTotal){m.referenceQuantity=round(m.referenceQuantity+quantity);m.referenceWeightKg=round(m.referenceWeightKg+(r.weightKg||0));}else{m.quantity=round(m.quantity+quantity);m.weightKg=round(m.weightKg+(r.weightKg||0));}
  const items=itemMaps.get(name),item=items.get(key)||{id:key,name:r.product.loadingOperation||r.product.fullName||r.product.name||r.product.spec,productTitle:r.product.productTitle||r.product.name,productDetail:r.product.productDetail??r.product.spec??'',isGroupTotal,unit:r.product.unit,quantity:0,count:0,weightKg:0};
  item.quantity=round(item.quantity+quantity);item.count+=1;item.weightKg=round(item.weightKg+(r.weightKg||0));items.set(key,item);
 }
 for(const r of records){const name=r.product.loadingOperation||r.product.category,m=result.find(m=>m.name===name);if(!m)continue;if(r.counted&&r.status==='approved'&&!['shared','historical-group','crew'].includes(r.mode)){m.confirmed=round(m.confirmed+r.quantity);}if(r.status==='pending')pending.set(name,(pending.get(name)||0)+1);}
 for(const m of result){m.pendingCount=pending.get(m.name)||0;m.items=[...itemMaps.get(m.name).values()];const units=[...unitsByCategory.get(m.name)];if(units.length===1)m.unit=units[0];else if(units.length>1)m.unit='多单位';m.isGroupTotal=!!m.items.length&&m.items.every(item=>item.isGroupTotal);}
 return result;
}
export function productionOverview(db,service,user,q={}){
 if(user.role!=='worker')fail(403,'此页面只展示员工和组长的生产');
 const {from,to}=service.range(q),all=service.annotate(service.rawList({from,to})),own=all.filter(r=>r.members.some(m=>m.id===user.id));
 const result={from,to,metrics:metrics(service,own),records:own.slice(0,30),people:[]};
 if(!user.is_leader){if(q.workerId&&q.workerId!==user.id)fail(403,'只能查看自己的生产');return result;}
 const ids=new Set([user.id,...db.prepare("SELECT id FROM users WHERE role='worker' AND active=1 AND group_id=?").all(user.group_id).map(u=>u.id),...db.prepare("SELECT DISTINCT m.user_id FROM members m JOIN records r ON r.id=m.record_id WHERE r.submitted_by=? AND r.mode IN ('leader','crew') AND r.deleted_at=''").all(user.id).map(m=>m.user_id)]);
 const workers=sortedWorkers(db,user).filter(w=>ids.has(w.id));
 if(q.workerId&&!ids.has(q.workerId))fail(403,'不能查看其他班组工人的生产');
 result.people=workers.map(w=>{const records=all.filter(r=>r.members.some(m=>m.id===w.id));return {...w,metrics:metrics(service,records),pendingCount:records.filter(r=>r.status==='pending').length};});
 if(q.workerId){if(q.category&&!['预制块','浇注料','装/卸车'].includes(q.category))fail(400,'生产类型不正确');if(q.loadingOperation&&!['装车','卸车'].includes(q.loadingOperation))fail(400,'装卸类型不正确');result.memberRecords=all.filter(r=>r.members.some(m=>m.id===q.workerId)&&(!q.category||r.product.category===q.category)&&(!q.loadingOperation||r.product.loadingOperation===q.loadingOperation));}
 return result;
}
