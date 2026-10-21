import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {transaction} from './db.js';
import {mergeStaffAlias} from './factory-rules.js';
import {businessRules} from './private-data.js';

export function applyOfficialRoster(db,config,file){
 if(!config.officialRoster||!fs.existsSync(file))return;
 if(!db.prepare("SELECT 1 FROM app_meta WHERE key='official_accounts_v1'").get()){
  const accounts=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Array.isArray(accounts)||!accounts.length||new Set(accounts.map(x=>x.phone)).size!==accounts.length||new Set(accounts.map(x=>x.name)).size!==accounts.length||accounts.filter(x=>x.isSuperAdmin).length!==1)throw new Error('人员名单需姓名、手机号唯一，且有一位总管理员');
  if(accounts.find(x=>x.isSuperAdmin).phone!==config.adminPhone)throw new Error('人员名单总管理员与ADMIN_PHONE不一致');
  if(accounts.some(x=>!x.name||!/^1\d{10}$/.test(x.phone)||!['worker','admin'].includes(x.role)||x.isSuperAdmin&&x.role!=='admin'))throw new Error('人员名单格式不正确');
  transaction(db,()=>{
   for(const [oldName,name]of Object.entries(businessRules.aliases||{}))mergeStaffAlias(db,oldName,name);
   const ids=[];
   for(const person of accounts){
    const old=db.prepare('SELECT * FROM users WHERE phone=?').get(person.phone)||db.prepare('SELECT * FROM users WHERE name=? AND role=?').get(person.name,person.role);
    if(old&&old.role!==person.role)throw new Error('手机号已登记为其他身份：'+person.name);
    const id=old?.id||randomUUID();ids.push(id);
    db.prepare('INSERT INTO users (id,name,phone,role,group_id,active,expected,is_leader,is_super_admin,permissions_json) VALUES (?,?,?,?,?,1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,role=excluded.role,group_id=excluded.group_id,active=1,expected=excluded.expected,is_leader=excluded.is_leader,is_super_admin=excluded.is_super_admin').run(id,person.name,person.phone,person.role,person.role==='worker'?(person.groupId||old?.group_id||null):null,person.role==='worker'?1:0,person.isLeader?1:0,person.isSuperAdmin?1:0,'[]');
   }
   db.prepare('UPDATE users SET active=0,expected=0 WHERE id NOT IN ('+ids.map(()=>'?').join(',')+')').run(...ids);
   db.prepare("INSERT INTO app_meta VALUES ('official_accounts_v1','done')").run();
  });
 }
 for(const change of businessRules.leaderChanges||[]){
  if(db.prepare('SELECT 1 FROM app_meta WHERE key=?').get(change.key))continue;
  transaction(db,()=>{
   const leader=db.prepare("SELECT id,name FROM users WHERE phone=? AND role='worker'").get(change.phone);
   if(!leader)throw new Error('指定的新组长未登记');
   if(change.previousPhone)db.prepare("UPDATE users SET is_leader=0 WHERE phone=? AND role='worker'").run(change.previousPhone);
   db.prepare('UPDATE users SET is_leader=1,group_id=? WHERE id=?').run(change.groupId,leader.id);
   const label=['一班','二班','三班'][Number(change.groupId.slice(1))-1]||'班组';
   db.prepare('UPDATE groups SET name=? WHERE id=?').run(label+'（'+leader.name+'）',change.groupId);
   db.prepare('INSERT INTO app_meta VALUES (?,?)').run(change.key,'done');
  });
 }
}
