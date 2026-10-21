import { randomUUID, createHash } from 'node:crypto';
import { now, today, transaction, insertNotice } from './db.js';
import {permissionsOf,isSuper,assertProductionRead,assertRecordAction,hasPermission} from './permissions.js';
import {loadingFields} from './loading.js';
export function fail(status, message) { const error=new Error(message);error.status=status;throw error; }
export function text(value, label, max=120, required=true) { if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))fail(400,`${label}填写不正确`);return value.trim(); }
export function date(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value) fail(400,'日期不正确');
  return value;
}
export function userView(u) { return {id:u.id,name:u.name,phone:/^1\d{10}$/.test(u.phone)?u.phone:'',role:u.role,isSuperAdmin:isSuper(u),permissions:permissionsOf(u),groupId:u.group_id,isLeader:!!u.is_leader,active:!!u.active,fontSize:u.font_size,expected:!!u.expected,sources:JSON.parse(u.source_json||'[]')}; }
export function productView(p) { return {id:p.id,name:p.name,spec:p.spec,category:p.category,unit:p.unit,precision:p.precision,weightKg:p.weight_kg,groupId:p.group_id,active:!!p.active,source:p.source,...loadingFields(p)}; }
export const round=(n,places=3)=>Math.round((n+Number.EPSILON)*10**places)/10**places;
export function quantity(value,p,allowZero=false) {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||(!allowZero&&value===0)||value>1e9||Math.abs(value*10**p.precision-Math.round(value*10**p.precision))>0.0001)fail(400,`数量须为${allowZero?'0或':''}正数，最多${p.precision}位小数`);
  return round(value,p.precision);
}
export class ProductionService {
  constructor(db){this.db=db;}
  members(id){return this.db.prepare('SELECT u.id,u.name,u.group_id groupId FROM members m JOIN users u ON u.id=m.user_id WHERE record_id=? ORDER BY u.name').all(id);}
  view(r){const original=JSON.parse(r.product_json),p={...original,...loadingFields(original)};return {id:r.id,date:r.production_date,product:p,groupId:r.group_id,mode:r.mode,quantity:r.quantity,originalQuantity:r.original_quantity,weightKg:p.weightKg?round(r.quantity*p.weightKg):p.unit==='公斤'?r.quantity:p.unit==='吨'?round(r.quantity*1000):null,status:r.status,submittedBy:r.submitted_by,submittedName:this.db.prepare('SELECT name FROM users WHERE id=?').get(r.submitted_by)?.name,submittedAt:r.submitted_at,updatedAt:r.updated_at,version:r.version,remark:r.remark,rejectionReason:r.rejection_reason,members:this.members(r.id)};}
  get(user,id){assertProductionRead(user);const r=this.db.prepare("SELECT * FROM records WHERE id=? AND deleted_at=''").get(id);if(!r)fail(404,'记录不存在或已删除');if(user.role!=='admin'&&r.submitted_by!==user.id&&!this.members(id).some(m=>m.id===user.id))fail(403,'只能查看自己的记录');return r;}
  history(user,id){this.get(user,id);return this.db.prepare('SELECT h.*,u.name actor FROM history h LEFT JOIN users u ON u.id=h.actor_id WHERE record_id=? ORDER BY created_at,id').all(id).map(h=>({id:h.id,actor:h.actor,action:h.action,before:JSON.parse(h.before_json),after:JSON.parse(h.after_json),reason:h.reason,time:h.created_at}));}
  range(q={}){const from=date(q.from||today()),to=date(q.to||from);if(from>to||Date.parse(to)-Date.parse(from)>366*864e5)fail(400,'查询时间范围最多一年');return {from,to};}
  rawList(q={}){
    const {from,to}=this.range(q);
    const rows=this.db.prepare("SELECT COALESCE((SELECT MAX(h.rowid) FROM history h WHERE h.record_id=records.id AND h.action IN ('submit','worker_edit','correct')),rowid) sequence,* FROM records WHERE deleted_at='' AND production_date BETWEEN ? AND ? ORDER BY production_date DESC,submitted_at DESC LIMIT 10001").all(from,to);
    if(rows.length>10000)fail(400,'记录较多，请缩小日期范围');
    return rows.map(r=>this.view(r)).filter(r=>(!q.groupId||r.groupId===q.groupId)&&(!q.workerId||r.members.some(m=>m.id===q.workerId)||r.submittedBy===q.workerId)&&(!q.productId||r.product.id===q.productId)&&(!q.category||r.product.category===q.category)&&(!q.status||r.status===q.status));
  }
  list(user,q={}){assertProductionRead(user);return this.rawList(q).filter(r=>user.role==='admin'||r.submittedBy===user.id||r.members.some(m=>m.id===user.id));}
  audit(r,user,action,before,after,reason){this.db.prepare('INSERT INTO history VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),r.id,user.id,action,JSON.stringify(before),JSON.stringify(after),reason,now());}
  announce(r,user,message){for(const member of this.members(r.id))if(member.id!==user.id)insertNotice(this.db,member.id,r.id,message);if(r.submitted_by!==user.id&&!this.members(r.id).some(m=>m.id===r.submitted_by))insertNotice(this.db,r.submitted_by,r.id,message);}
  create(user,input){
    const productionDate=date(input.date);if(productionDate>today())fail(400,'不能填写未来日期');
    const raw=this.db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(input.productId);if(!raw||!raw.unit)fail(400,'请选择已配置计量单位的产品');const p=productView(raw);
    const qty=quantity(input.quantity,p),material=p.category==='浇注料',groupId=input.groupId||(material?'g4':p.groupId||user.group_id);
    if(!this.db.prepare('SELECT id FROM groups WHERE id=?').get(groupId))fail(400,'请选择班组');
    if(material&&groupId!=='g4')fail(400,'浇注料须在浇注料模块填写');
    if(p.category==='预制块'&&groupId==='g4')fail(400,'请选择预制块生产班组');
    if(p.groupId&&p.groupId!==groupId)fail(400,'产品不属于所选班组');
    const mode=input.mode;if(!['personal','shared'].includes(mode))fail(400,'请选择个人或共同生产');
    if(material&&mode!=='personal')fail(400,'浇注料只能按个人填写');
    if(mode==='shared'&&user.role!=='admin'&&(!user.is_leader||groupId!==user.group_id))fail(403,'只有本班组组长可以填报班组产量');
    if(mode==='personal'&&input.memberIds?.length&&(!Array.isArray(input.memberIds)||input.memberIds.some(id=>id!==user.id)))fail(400,'个人填报只能归属于本人');
    const memberIds=mode==='personal'?[user.id]:Array.isArray(input.memberIds)?[...new Set(input.memberIds)].sort():[];
    if(!memberIds.length||memberIds.length>100||memberIds.some(id=>typeof id!=='string'))fail(400,'请选择实际参与生产的工人');
    for(const id of memberIds){const m=this.db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(id);if(!m||m.role!=='worker')fail(400,'请选择在岗工人');}
    const requestId=text(input.requestId,'提交标识',100),remark=text(input.remark||'','备注',300,false);
    const hash=createHash('sha256').update(JSON.stringify([productionDate,p.id,groupId,mode,memberIds,qty,remark])).digest('hex');
    return transaction(this.db,()=>{
      const existing=this.db.prepare('SELECT * FROM records WHERE submitted_by=? AND request_id=?').get(user.id,requestId);
      if(existing){if(existing.payload_hash!==hash)fail(409,'重复提交内容不一致，请重新填写');return this.view(existing);}
      for(const id of memberIds)if(this.db.prepare('SELECT 1 FROM attendance WHERE user_id=? AND production_date=?').get(id,productionDate))fail(400,'参与工人当天已标记休息或停产，请先取消该标记');
      const id=randomUUID(),stamp=now();
      this.db.prepare('INSERT INTO records (id,production_date,product_id,product_json,group_id,mode,quantity,original_quantity,status,submitted_by,submitted_at,updated_at,version,request_id,payload_hash,remark,rejection_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,productionDate,p.id,JSON.stringify(p),groupId,mode,qty,qty,'pending',user.id,stamp,stamp,1,requestId,hash,remark,'');
      for(const member of memberIds)this.db.prepare('INSERT INTO members VALUES (?,?)').run(id,member);
      const r=this.get(user,id);this.audit(r,user,'submit',{}, {quantity:qty,status:'pending'},'首次填写');return this.view(r);
    });
  }
  update(user,id,input){return transaction(this.db,()=>{
    assertRecordAction(user,input.action);
    const r=this.get(user,id);if(!Number.isInteger(input.version)||input.version!==r.version)fail(409,'记录已被其他人更新，请刷新后重新核对');
    const action=input.action,before={quantity:r.quantity,status:r.status};let after={...before},reason='';
    if(user.role==='admin'){
      if(action==='correct'){after.quantity=quantity(input.quantity,JSON.parse(r.product_json),true);if(after.quantity===r.quantity)fail(400,'数量未变化，请直接确认');reason=text(input.reason,'修改原因',300);after.status=hasPermission(user,'review')?'approved':'pending';}
      else if(action==='approve'){if(r.status!=='pending')fail(400,'只有待确认记录可确认');after.status='approved';reason='数量核对正确';}
      else if(action==='reject'){if(r.status==='rejected')fail(400,'该记录已经退回');reason=text(input.reason,'退回原因',300);after.status='rejected';}
      else fail(400,'操作不正确');
    }else{
      if(r.submitted_by!==user.id||!['pending','rejected'].includes(r.status)||action!=='worker_edit')fail(403,'只能修改自己提交的待确认或退回记录');
      after.quantity=quantity(input.quantity,JSON.parse(r.product_json));after.status='pending';reason=text(input.reason||'工人修改后重新提交','修改原因',300);
    }
    this.db.prepare('UPDATE records SET quantity=?,status=?,version=version+1,updated_at=?,rejection_reason=? WHERE id=?').run(after.quantity,after.status,now(),after.status==='rejected'?reason:'',id);
    if(action==='worker_edit')this.db.prepare('UPDATE records SET revision_at=? WHERE id=?').run(now(),id);
    this.audit(r,user,action,before,after,reason);
    this.announce(r,user,action==='correct'?`${user.name}将${JSON.parse(r.product_json).name}从${r.quantity}修改为${after.quantity}${JSON.parse(r.product_json).unit}。原因：${reason}`:after.status==='rejected'?`记录被退回：${reason}`:'生产记录已核对确认');
    if(user.role==='admin')this.db.prepare("UPDATE change_requests SET status='resolved',resolved_at=? WHERE record_id=? AND status='open'").run(now(),id);
    return this.view(this.get(user,id));
  });}
  stats(user,q){const rows=this.list(user,q),done=rows.filter(r=>r.status==='approved'),units=new Map(),products=new Map(),groups=new Map();let weightKg=0;
    for(const r of done){const key=r.product.category+'|'+r.product.unit;const u=units.get(key)||{category:r.product.category,unit:r.product.unit,quantity:0};u.quantity=round(u.quantity+r.quantity);units.set(key,u);if(r.weightKg!==null)weightKg=round(weightKg+r.weightKg);
      const p=products.get(r.product.id)||{id:r.product.id,name:r.product.name,spec:r.product.spec,unit:r.product.unit,quantity:0,weightKg:0,category:r.product.category};p.quantity=round(p.quantity+r.quantity);p.weightKg=round(p.weightKg+(r.weightKg||0));products.set(p.id,p);
      const gkey=r.groupId+'|'+key;const g=groups.get(gkey)||{groupId:r.groupId,name:this.db.prepare('SELECT name FROM groups WHERE id=?').get(r.groupId)?.name,category:r.product.category,unit:r.product.unit,quantity:0};g.quantity=round(g.quantity+r.quantity);groups.set(gkey,g);
    }
    const {from,to}=this.range(q);let missing=[];
    if(user.role==='admin'&&from===to){const present=new Set(this.db.prepare("SELECT DISTINCT m.user_id FROM members m JOIN records r ON r.id=m.record_id WHERE r.production_date=? AND r.status!='rejected' AND r.deleted_at=''").all(from).map(m=>m.user_id));const attendance=this.db.prepare('SELECT user_id FROM attendance WHERE production_date=?').all(from);for(const a of attendance)present.add(a.user_id);missing=this.db.prepare("SELECT id,name,group_id groupId FROM users WHERE active=1 AND role='worker' AND expected=1").all().filter(u=>(!q.groupId||q.groupId==='g4'||u.groupId===q.groupId)&&(!q.workerId||u.id===q.workerId)&&!present.has(u.id));}
    return {from,to,units:[...units.values()],weightKg,approvedCount:done.length,pendingCount:rows.filter(r=>r.status==='pending').length,rejectedCount:rows.filter(r=>r.status==='rejected').length,products:[...products.values()],groups:[...groups.values()],missing};
  }
}
