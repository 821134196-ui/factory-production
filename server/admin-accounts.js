import {randomUUID} from 'node:crypto';
import {transaction,now} from './db.js';
import {fail,text,userView} from './service.js';
import {isSuper} from './permissions.js';

function superOnly(user){if(!isSuper(user))fail(403,'只有总管理员可以新增或删除管理员');}
function audit(db,actor,target,action,before,after){
 db.prepare('INSERT INTO admin_account_history (id,actor_id,user_id,action,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),actor.id,target.id,action,JSON.stringify(before),JSON.stringify(after),now());
}
export function createAdmin(db,actor,input){
 superOnly(actor);
 const name=text(input.name,'姓名',30),phone=text(input.phone,'手机号',11);
 if(!/^1\d{10}$/.test(phone))fail(400,'请输入11位手机号');
 if(Object.keys(input).some(k=>!['name','phone'].includes(k)))fail(400,'新增管理员只需填写姓名和手机号，权限请另行设置');
 return transaction(db,()=>{
  const old=db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if(old&&(!old.deleted_at||old.role!=='admin'||old.name!==name))fail(409,'该手机号已登记，请核对姓名和账号');
  const id=old?.id||randomUUID();
  if(old)db.prepare("UPDATE users SET active=1,deleted_at='',permissions_json='[]',expected=0,is_leader=0,group_id=NULL WHERE id=?").run(id);
  else db.prepare("INSERT INTO users (id,name,phone,role,active,expected,permissions_json) VALUES (?,?,?,'admin',1,0,'[]')").run(id,name,phone);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM codes WHERE phone=?').run(phone);
  const target=db.prepare('SELECT * FROM users WHERE id=?').get(id);
  audit(db,actor,target,old?'restore':'create',old?userView(old):null,userView(target));
  return userView(target);
 });
}
export function deleteAdmin(db,actor,id){
 superOnly(actor);
 const target=db.prepare("SELECT * FROM users WHERE id=? AND role='admin' AND deleted_at=''").get(id);
 if(!target)fail(404,'管理员不存在或已删除');
 if(isSuper(target)||id===actor.id)fail(403,'总管理员账号不可删除');
 return transaction(db,()=>{
  db.prepare("UPDATE users SET active=0,deleted_at=?,permissions_json='[]',expected=0 WHERE id=?").run(now(),id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM codes WHERE phone=?').run(target.phone);
  audit(db,actor,target,'delete',userView(target),userView(db.prepare('SELECT * FROM users WHERE id=?').get(id)));
  return {ok:true};
 });
}
