import { randomUUID,createHash } from 'node:crypto';
import { ProductionService,fail,text,date,productView,quantity,round } from './service.js';
import { now,today,transaction } from './db.js';
import {assertProductionRead,assertRecordAction,assertPermission,hasPermission} from './permissions.js';
import {rememberWorkers} from './team.js';

export function fillDates(){const d=new Date(today()+'T00:00:00Z');return Array.from({length:7},(_,i)=>{const day=new Date(d);day.setUTCDate(day.getUTCDate()-i);return day.toISOString().slice(0,10);});}
export function earliestFillDate(){return fillDates()[6];}
export function batchFields(input,required=false){
 const shift=text(input.shift||'','班次',30,required).normalize('NFC').replace(/\s+/g,' '),batchCode=text(input.batchCode||'','批次编号',40,required).normalize('NFC').toUpperCase();
 if(!!shift!==!!batchCode)fail(400,'班次和批次编号需要一起填写');return {shift,batchCode};
}
const batchKey=r=>JSON.stringify([r.date,r.product.id,r.groupId,r.shift,r.batchCode]);
// A worker can submit one effective quantity per day and product.  The
// production group is kept for reporting, but does not create a second
// logical entry for the same person/material/day.
const dayKey=r=>JSON.stringify([r.date,r.product.id]);
const latestFirst=(a,b)=>b.revisionAt.localeCompare(a.revisionAt)||b.sequence-a.sequence;
export class BatchProductionService extends ProductionService{
 view(r){
  const row=this.db.prepare("SELECT after_json FROM history WHERE record_id=? AND action='submit' ORDER BY created_at,id LIMIT 1").get(r.id),original=row?JSON.parse(row.after_json).product:null;
  const firstCorrection=original?null:this.db.prepare("SELECT before_json FROM history WHERE record_id=? AND action='correct' ORDER BY created_at,id LIMIT 1").get(r.id);
  return {...super.view(r),revisionAt:r.revision_at||r.submitted_at,sequence:r.sequence||this.db.prepare('SELECT rowid n FROM records WHERE id=?').get(r.id)?.n||0,originalUnit:original?.unit||(firstCorrection?JSON.parse(firstCorrection.before_json).product?.unit:null)||JSON.parse(r.product_json).unit,shift:r.shift||'',batchCode:r.batch_code||'',sourceRef:r.source_ref||''};
 }
 annotate(rows){
  // A crew entry is a single daily product total, regardless of its headcount.
  // It replaces earlier online entries for that product/group/day; imported
  // historical cells remain protected by assertNoHistoricalOverlap.
  const crews=new Map();
  const crewKey=r=>JSON.stringify([r.date,r.product.id,r.groupId]);
  for(const r of rows.filter(r=>r.mode==='crew'&&r.status!=='rejected'&&!r.sourceRef).sort(latestFirst))if(!crews.has(crewKey(r)))crews.set(crewKey(r),r);
  const approved=new Map();
  const days=new Map();
  // Historical source cells are independent audited work. In particular,
  // material loading and precast loading on the same day must both count.
  for(const r of rows){r.counted=r.status!=='rejected';r.excludedReason='';delete r.effectiveRecordId;if(r.members.length!==1||r.status==='rejected'||r.sourceRef||!['personal','leader'].includes(r.mode))continue;
   const day=dayKey(r)+'|'+r.members[0].id,daily=days.get(day)||[];daily.push(r);days.set(day,daily);
   if(!r.batchCode)continue;
   const key=batchKey(r)+'|'+r.members[0].id,list=approved.get(key)||[];list.push(r);approved.set(key,list);
  }
  for(const list of days.values()){
   const daily=list.filter(r=>!r.batchCode).sort(latestFirst);
   if(!daily.length)continue;
   const winner=[...list].sort(latestFirst)[0];
   for(const r of list){if(r.id===winner.id)continue;if(winner.batchCode&&r.batchCode)continue;r.counted=false;r.effectiveRecordId=winner.id;r.excludedReason='已采用最新填写的数量，原记录保留';}
  }
  for(const list of approved.values()){
   list.sort(latestFirst);
   const winner=list[0];for(const r of list.slice(1)){r.counted=false;r.effectiveRecordId=winner.id;r.excludedReason='已采用最新填写的数量，原记录保留';}
  }
  for(const r of rows){const winner=crews.get(crewKey(r));if(winner&&!r.sourceRef&&r.status!=='rejected'&&r.id!==winner.id){r.counted=false;r.effectiveRecordId=winner.id;r.excludedReason='已采用最新班组填写的总量与生产人员，原记录保留';}}
  const batches=new Map();for(const r of rows){if(!r.batchCode)continue;const key=batchKey(r),b=batches.get(key)||{quantity:0,names:new Set()};if(r.counted){b.quantity=round(b.quantity+r.quantity);for(const m of r.members)b.names.add(m.name);}batches.set(key,b);}
  const dailyTotals=new Map();for(const r of rows)if(r.counted){const key=dayKey(r);dailyTotals.set(key,round((dailyTotals.get(key)||0)+r.quantity));}
  for(const r of rows){r.dailyQuantity=dailyTotals.get(dayKey(r))||0;if(r.batchCode){const b=batches.get(batchKey(r));r.batchQuantity=b.quantity;r.batchMemberNames=[...b.names].join('、');}}
  return rows;
 }
 list(user,q={}){
  if(q.loadingOperation&&!['装车','卸车'].includes(q.loadingOperation))fail(400,'装卸作业类型不正确');
  assertProductionRead(user);const range=this.range(q),rows=this.annotate(this.rawList(range));
  return rows.filter(r=>(user.role==='admin'||r.submittedBy===user.id||r.members.some(m=>m.id===user.id))&&(!q.groupId||r.groupId===q.groupId)&&(!q.workerId||r.members.some(m=>m.id===q.workerId))&&(!q.productId||r.product.id===q.productId)&&(!q.category||r.product.category===q.category)&&(!q.loadingOperation||r.product.loadingOperation===q.loadingOperation)&&(!q.status||r.status===q.status)).map(r=>({...r,canDelete:r.status!=='approved'&&(user.role==='admin'?hasPermission(user,'edit'):r.mode==='crew'?!!user.is_leader&&r.submittedBy===user.id:r.submittedBy===user.id||r.members.some(m=>m.id===user.id))}));
 }
 approveMany(user,entries){
  assertPermission(user,'review');
  if(!Array.isArray(entries)||!entries.length||entries.length>200||entries.some(e=>!e||typeof e.id!=='string'||!e.id||!Number.isInteger(e.version)||e.version<1)||new Set(entries.map(e=>e.id)).size!==entries.length)fail(400,'请选择1至200条不同的待确认记录');
  return transaction(this.db,()=>entries.map(e=>this.update(user,e.id,{action:'approve',version:e.version})));
 }
 remove(user,id,input){return transaction(this.db,()=>{const r=this.get(user,id);if(user.role==='admin')assertPermission(user,'edit');else if(r.mode==='crew'&&(!user.is_leader||r.submitted_by!==user.id))fail(403,'班组生产记录只能由填写组长或管理员删除');if(r.status==='approved')fail(403,'已确认记录不能删除');if(!Number.isInteger(input.version)||input.version!==r.version)fail(409,'记录已被更新，请刷新后再删除');const before=this.snapshot(r),stamp=now();this.db.prepare('UPDATE records SET deleted_at=?,updated_at=?,version=version+1 WHERE id=?').run(stamp,stamp,id);this.audit(r,user,'delete',before,{...before,deletedAt:stamp},'删除未确认记录');this.db.prepare("UPDATE change_requests SET status='resolved',resolved_at=? WHERE record_id=? AND status='open'").run(stamp,id);this.announce(r,user,'未确认生产记录已删除');this.db.prepare('UPDATE notices SET record_id=NULL WHERE record_id=?').run(id);return {ok:true};});}
 detail(user,id){const r=this.get(user,id);return this.list(user,{from:r.production_date,to:r.production_date}).find(row=>row.id===id);}
 create(user,input){
  return transaction(this.db,()=>this.insertBatchRecord(user,input));
 }
 createLeader(user,input){
  if(user.role!=='admin'&&!user.is_leader)fail(403,'需要组长权限');
  if(!Array.isArray(input.entries)||!input.entries.length||input.entries.length>100)fail(400,'一次可填写1至100行生产量');
  if(input.entries.some(e=>!e||typeof e.workerId!=='string'||!e.workerId))fail(400,'请选择实际生产工人');
  if(new Set(input.entries.map(e=>JSON.stringify([e.workerId,e.productId||input.productId]))).size!==input.entries.length)fail(400,'同一工人的同一产品只能填写一行');
  const requestId=text(input.requestId,'提交标识',100);
  const requestHash=createHash('sha256').update(JSON.stringify([input.date,input.productId,input.groupId,input.shift,input.batchCode,input.remark||'',input.entries.slice().sort((a,b)=>String(a.workerId).localeCompare(String(b.workerId)))])).digest('hex');
  return transaction(this.db,()=>{
   const old=this.db.prepare('SELECT payload_hash FROM leader_requests WHERE user_id=? AND request_id=?').get(user.id,requestId);if(old&&old.payload_hash!==requestHash)fail(409,'重复提交内容不一致，请重新填写');
   const products=input.entries.map(e=>this.db.prepare('SELECT * FROM products WHERE id=?').get(e.productId||input.productId)),categories=new Set(products.map(p=>p?.category));
   if(categories.size!==1||![...categories].every(c=>['预制块','浇注料','装/卸车'].includes(c)))fail(400,'一次填写同一模块的数量');
   if(categories.has('装/卸车')){const operations=new Set(products.map(p=>productView(p).loadingOperation)),operation=[...operations][0];if(operations.size!==1||!['装车','卸车'].includes(operation)||(input.loadingOperation&&input.loadingOperation!==operation))fail(400,'装车和卸车请分别批量填写，并选择对应项目');}
   const rows=input.entries.map(e=>this.insertBatchRecord(user,{...input,productId:e.productId||input.productId,mode:'leader',workerId:e.workerId,quantity:e.quantity,requestId:old&&this.db.prepare('SELECT 1 FROM records WHERE submitted_by=? AND request_id=?').get(user.id,createHash('sha256').update(requestId+'|'+e.workerId).digest('hex'))?createHash('sha256').update(requestId+'|'+e.workerId).digest('hex'):createHash('sha256').update(requestId+'|'+e.workerId+'|'+(e.productId||input.productId)).digest('hex')}));this.db.prepare('INSERT OR IGNORE INTO leader_requests VALUES (?,?,?)').run(user.id,requestId,requestHash);if(!old)rememberWorkers(this.db,user,input.entries.map(e=>e.workerId));return rows;
  });
 }
 createCrew(user,input){
  if(user.role!=='admin'&&!user.is_leader)fail(403,'需要组长权限');
  const productionDate=date(input.date);if(productionDate>today()||productionDate<earliestFillDate())fail(400,'只能填写最近7天（含今天）的生产数量');
  const groupId=text(input.groupId,'生产班组',40);
  if(['g4','g5'].includes(groupId)||!this.db.prepare('SELECT 1 FROM groups WHERE id=?').get(groupId))fail(400,'请选择预制块生产班组');
  if(!Array.isArray(input.memberIds)||!input.memberIds.length||input.memberIds.length>100||input.memberIds.some(id=>typeof id!=='string'||!id)||new Set(input.memberIds).size!==input.memberIds.length)fail(400,'请选择不同的实际生产人员');
  if(!Array.isArray(input.products)||!input.products.length||input.products.length>100||input.products.some(p=>!p||typeof p.productId!=='string')||new Set(input.products.map(p=>p.productId)).size!==input.products.length)fail(400,'请选择1至100个不同的预制块产品');
  const memberIds=input.memberIds.slice().sort(),requestId=text(input.requestId,'提交标识',100);
  const requestHash=createHash('sha256').update(JSON.stringify(['crew',productionDate,groupId,memberIds,input.products.slice().sort((a,b)=>a.productId.localeCompare(b.productId))])).digest('hex');
  return transaction(this.db,()=>{
   const old=this.db.prepare('SELECT payload_hash FROM leader_requests WHERE user_id=? AND request_id=?').get(user.id,requestId);
   if(old&&old.payload_hash!==requestHash)fail(409,'重复提交内容不一致，请重新填写');
   for(const id of memberIds){
    if(!this.db.prepare("SELECT 1 FROM users WHERE id=? AND role='worker' AND active=1").get(id))fail(400,'请选择在岗工人');
    if(this.db.prepare('SELECT 1 FROM attendance WHERE user_id=? AND production_date=?').get(id,productionDate))fail(400,'参与工人当天已标记休息或停产，请先取消标记');
   }
   const rows=input.products.map(e=>{
    const raw=this.db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(e.productId);if(!raw||raw.category!=='预制块'||!raw.unit)fail(400,'请选择已启用的预制块产品');
    const p=productView(raw);if(p.groupId&&p.groupId!==groupId)fail(400,'产品和生产班组不匹配');
    const qty=quantity(e.quantity,p),recordRequest=createHash('sha256').update('crew|'+requestId+'|'+p.id).digest('hex');
    const existing=this.db.prepare('SELECT * FROM records WHERE submitted_by=? AND request_id=?').get(user.id,recordRequest);if(existing)return this.view(existing);
    this.assertNoHistoricalOverlap({date:productionDate,productId:p.id,groupId,memberIds,quantity:qty});
    const id=randomUUID(),stamp=now();
    this.db.prepare('INSERT INTO records (id,production_date,product_id,product_json,group_id,mode,quantity,original_quantity,status,submitted_by,submitted_at,updated_at,version,request_id,payload_hash,revision_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,productionDate,p.id,JSON.stringify(p),groupId,'crew',qty,qty,'pending',user.id,stamp,stamp,1,recordRequest,requestHash,stamp);
    for(const workerId of memberIds)this.db.prepare('INSERT INTO members VALUES (?,?)').run(id,workerId);
    const r=this.get(user,id);this.audit(r,user,'submit',{},this.snapshot(r),'组长填写班组产量及参与人员');return this.view(r);
   });
   this.db.prepare('INSERT OR IGNORE INTO leader_requests VALUES (?,?,?)').run(user.id,requestId,requestHash);
   if(!old)rememberWorkers(this.db,user,memberIds);return rows;
  });
 }
 insertBatchRecord(user,input){
  const productionDate=date(input.date);if(productionDate>today()||productionDate<earliestFillDate())fail(400,'只能填写最近7天（含今天）的生产数量');
  const raw=this.db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(input.productId);if(!raw||!raw.unit)fail(400,'请选择已配置单位的产品');
  const p=productView(raw),mode=input.mode;if(!['personal','leader'].includes(mode))fail(400,'请选择个人填写或组长逐人填写');
  if(mode==='leader'&&(!['预制块','浇注料','装/卸车'].includes(p.category)||(user.role!=='admin'&&!user.is_leader)))fail(403,'需要组长权限才可代填生产或装卸数量');
  const groupId=input.groupId||(p.category==='浇注料'?'g4':p.category==='装/卸车'?'g5':p.groupId||user.group_id);
  if(!this.db.prepare('SELECT 1 FROM groups WHERE id=?').get(groupId)||(p.groupId&&p.groupId!==groupId)||(p.category==='浇注料'&&groupId!=='g4')||(p.category==='装/卸车'&&groupId!=='g5')||(p.category==='预制块'&&['g4','g5'].includes(groupId)))fail(400,'产品和生产班组不匹配');
  const workerId=mode==='leader'?input.workerId:user.id;
  if(mode==='personal'&&input.memberIds!==undefined&&(!Array.isArray(input.memberIds)||input.memberIds.length!==1||input.memberIds[0]!==user.id))fail(400,'个人产量只能归属于本人');
  if(typeof workerId!=='string'||!workerId)fail(400,'请选择实际生产工人');
  if(!this.db.prepare("SELECT 1 FROM users WHERE id=? AND role='worker' AND active=1").get(workerId))fail(400,'请选择在岗工人');
  const {shift,batchCode}=batchFields(input),qty=quantity(input.quantity,p),remark=text(input.remark||'','备注',300,false),requestId=text(input.requestId,'提交标识',100);
  const hash=createHash('sha256').update(JSON.stringify([productionDate,p.id,groupId,mode,workerId,shift,batchCode,qty,remark])).digest('hex');
  const existing=this.db.prepare('SELECT * FROM records WHERE submitted_by=? AND request_id=?').get(user.id,requestId);
  if(existing){if(existing.payload_hash!==hash)fail(409,'重复提交内容不一致，请重新填写');return this.view(existing);}
  if(p.category==='预制块'&&this.annotate(this.rawList({from:productionDate,to:productionDate})).some(r=>r.counted&&r.mode==='crew'&&r.product.id===p.id&&r.groupId===groupId))fail(409,'该产品已按班组填写，请使用预制块的产品及生产人员填写方式');
  this.assertNoHistoricalOverlap({date:productionDate,productId:p.id,groupId,memberIds:[workerId],quantity:qty});
  if(this.db.prepare('SELECT 1 FROM attendance WHERE user_id=? AND production_date=?').get(workerId,productionDate))fail(400,'该工人当天已标记整天休息或停产，请先取消标记');
  const id=randomUUID(),stamp=now();
  this.db.prepare('INSERT INTO records (id,production_date,product_id,product_json,group_id,mode,quantity,original_quantity,status,submitted_by,submitted_at,updated_at,version,request_id,payload_hash,remark,rejection_reason,shift,batch_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,productionDate,p.id,JSON.stringify(p),groupId,mode,qty,qty,'pending',user.id,stamp,stamp,1,requestId,hash,remark,'',shift,batchCode);
  this.db.prepare('UPDATE records SET revision_at=? WHERE id=?').run(stamp,id);this.db.prepare('INSERT INTO members VALUES (?,?)').run(id,workerId);const r=this.get(user,id);this.audit(r,user,'submit',{},this.snapshot(r),mode==='leader'?'组长逐人填报':'本人填写');return this.view(r);
 }
 assertNoHistoricalOverlap({date,productId,groupId,memberIds,sourceRef='',id='',quantity:qty}){
  if(qty===0)return;
  const rows=this.db.prepare("SELECT r.id,m.user_id workerId FROM records r LEFT JOIN members m ON m.record_id=r.id WHERE r.production_date=? AND r.product_id=? AND r.group_id=? AND r.id!=? AND r.status!='rejected' AND r.deleted_at='' AND r.quantity>0 AND (?!='' OR r.source_ref!='')").all(date,productId,groupId,id,sourceRef);
  if(rows.some(r=>!['g4','g5'].includes(groupId)||memberIds.includes(r.workerId)))fail(409,'该日该产品的历史日汇总与现有填写重叠，请管理员先核对并退回误填记录');
 }
 snapshot(r){return {quantity:r.quantity,status:r.status,date:r.production_date,product:JSON.parse(r.product_json),groupId:r.group_id,memberIds:this.members(r.id).map(m=>m.id),shift:r.shift||'',batchCode:r.batch_code||'',remark:r.remark,mode:r.mode};}
 update(user,id,input){
  assertRecordAction(user,input.action);
  if(user.role!=='admin'||input.action!=='correct'){
   if(input.action==='approve'){const r=this.get(user,id),p=JSON.parse(r.product_json);if(!p.unit)fail(400,'请先核准产品计量单位');quantity(r.quantity,p,true);}
   if(['approve','worker_edit'].includes(input.action)){const r=this.get(user,id);this.assertNoHistoricalOverlap({date:r.production_date,productId:r.product_id,groupId:r.group_id,memberIds:this.members(id).map(m=>m.id),sourceRef:r.source_ref,id,quantity:input.action==='worker_edit'?input.quantity:r.quantity});}
   return super.update(user,id,input);
  }
  return transaction(this.db,()=>{
   const r=this.get(user,id);if(!Number.isInteger(input.version)||input.version!==r.version)fail(409,'记录已被更新，请刷新后重新核对');
   const before=this.snapshot(r),productionDate=date(input.date??r.production_date);if(productionDate>today())fail(400,'不能修改为未来日期');
   const productId=input.productId??r.product_id,raw=this.db.prepare('SELECT * FROM products WHERE id=?').get(productId);if(!raw)fail(400,'产品不存在');
   const p=productId===r.product_id&&before.product.unit?before.product:productView(raw);if(!p.unit)fail(400,'请先确认产品的计量单位');
   const groupId=input.groupId??r.group_id;if(!this.db.prepare('SELECT 1 FROM groups WHERE id=?').get(groupId)||(p.groupId&&p.groupId!==groupId)||(p.category==='浇注料'&&groupId!=='g4')||(p.category==='装/卸车'&&groupId!=='g5')||(p.category==='预制块'&&['g4','g5'].includes(groupId)))fail(400,'产品和班组不匹配');
   const mode=p.category!=='预制块'?'personal':r.mode,memberIds=input.memberIds??before.memberIds;if(!Array.isArray(memberIds)||(mode!=='historical-group'&&!memberIds.length)||memberIds.length>100||new Set(memberIds).size!==memberIds.length)fail(400,'请选择实际生产工人');
   if((!['shared','historical-group','crew'].includes(mode)||p.category!=='预制块')&&memberIds.length!==1)fail(400,'逐人记录只能归属一名工人');
   for(const workerId of memberIds){if(!this.db.prepare("SELECT 1 FROM users WHERE id=? AND role='worker'").get(workerId))fail(400,'工人不存在');if(this.db.prepare('SELECT 1 FROM attendance WHERE user_id=? AND production_date=?').get(workerId,productionDate))fail(400,'该工人当天已标记整天休息或停产');}
   const fields=batchFields({shift:input.shift??r.shift,batchCode:input.batchCode??r.batch_code},false),qty=quantity(input.quantity??r.quantity,p,true),remark=text(input.remark??r.remark,'备注',300,false),reason=text(input.reason,'修改原因',300);
   this.assertNoHistoricalOverlap({date:productionDate,productId:p.id,groupId,memberIds,sourceRef:r.source_ref,id,quantity:qty});
   const status='pending',after={quantity:qty,status,date:productionDate,product:p,groupId,memberIds,shift:fields.shift,batchCode:fields.batchCode,remark,mode};
   if(JSON.stringify({...before,status})===JSON.stringify(after)&&r.status===status)fail(400,'内容未变化，请直接确认或返回');
   this.db.prepare("UPDATE records SET production_date=?,product_id=?,product_json=?,group_id=?,quantity=?,status=?,version=version+1,updated_at=?,rejection_reason='',shift=?,batch_code=?,remark=?,mode=? WHERE id=?").run(productionDate,p.id,JSON.stringify(p),groupId,qty,status,now(),fields.shift,fields.batchCode,remark,mode,id);
   this.db.prepare('UPDATE records SET revision_at=? WHERE id=?').run(now(),id);this.db.prepare('DELETE FROM members WHERE record_id=?').run(id);for(const workerId of memberIds)this.db.prepare('INSERT INTO members VALUES (?,?)').run(id,workerId);
   this.audit(r,user,'correct',before,after,reason);const updated=this.get(user,id);
   this.announce({...r},user,`管理员更正生产记录：${before.quantity} → ${qty}${p.unit}。原因：${reason}`);
   for(const workerId of before.memberIds.filter(id=>!memberIds.includes(id)))this.db.prepare('INSERT INTO notices (id,user_id,record_id,message,created_at) VALUES (?,?,?,?,?)').run(randomUUID(),workerId,id,'管理员已调整这条记录的归属工人。原因：'+reason,now());
   this.db.prepare("UPDATE change_requests SET status='resolved',resolved_at=? WHERE record_id=? AND status='open'").run(now(),id);
   return this.view(updated);
  });
 }
 stats(user,q={},permission='stats'){
  if(user.role==='admin')assertPermission(user,permission);
  const rows=this.list(user,q),workerId=user.role==='admin'?q.workerId:user.id,done=rows.filter(r=>r.counted&&(!workerId||r.members.length===1&&r.members[0].id===workerId)),units=new Map(),products=new Map(),groups=new Map();let weightKg=0;
  for(const r of done){const key=r.product.category+'|'+r.product.unit,u=units.get(key)||{category:r.product.category,unit:r.product.unit,quantity:0};u.quantity=round(u.quantity+r.quantity);units.set(key,u);if(r.weightKg!==null)weightKg=round(weightKg+r.weightKg);
   const p=products.get(r.product.id)||{id:r.product.id,name:r.product.name,spec:r.product.spec,unit:r.product.unit,quantity:0,weightKg:0,category:r.product.category};p.quantity=round(p.quantity+r.quantity);p.weightKg=round(p.weightKg+(r.weightKg||0));products.set(p.id,p);
   const gkey=r.groupId+'|'+key,g=groups.get(gkey)||{groupId:r.groupId,name:this.db.prepare('SELECT name FROM groups WHERE id=?').get(r.groupId)?.name,category:r.product.category,unit:r.product.unit,quantity:0};g.quantity=round(g.quantity+r.quantity);groups.set(gkey,g);
  }
  const {from,to}=this.range(q);let missing=[];
  if(user.role==='admin'&&from===to){const present=new Set(this.db.prepare("SELECT DISTINCT m.user_id FROM members m JOIN records r ON r.id=m.record_id WHERE r.production_date=? AND r.status!='rejected' AND r.deleted_at=''").all(from).map(m=>m.user_id));for(const a of this.db.prepare('SELECT user_id FROM attendance WHERE production_date=?').all(from))present.add(a.user_id);missing=this.db.prepare("SELECT id,name,group_id groupId FROM users WHERE active=1 AND role='worker' AND expected=1").all().filter(u=>(!q.groupId||q.groupId==='g4'||u.groupId===q.groupId)&&(!q.workerId||u.id===q.workerId)&&!present.has(u.id));}
  return {from,to,units:[...units.values()],weightKg,approvedCount:done.length,pendingCount:rows.filter(r=>r.status==='pending').length,rejectedCount:rows.filter(r=>r.status==='rejected').length,replacedCount:rows.filter(r=>r.status==='approved'&&!r.counted).length,products:[...products.values()],groups:[...groups.values()],missing};
 }
}
