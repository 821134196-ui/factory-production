import {businessRules} from './private-data.js';
import {transaction,now} from './db.js';

export const canonicalStaffName=value=>String(value??'').normalize('NFC').replace(/\s+/g,'').replace(/^(.+)$/,name=>businessRules.aliases?.[name]||name);
export const crewLeaders=businessRules.crewLeaders||[];

// 姓名合并保留原编号映射，历史预览仍能解析旧员工编号。
export function mergeStaffAlias(db,oldName=Object.keys(businessRules.aliases||{})[0],name=businessRules.aliases?.[oldName]){
 if(!oldName||!name)return;
 const alias=db.prepare("SELECT * FROM users WHERE name=? AND role='worker'").get(oldName);if(!alias)return;
 const person=db.prepare("SELECT * FROM users WHERE name=? AND role='worker'").get(name);
 if(!person){db.prepare('INSERT OR REPLACE INTO staff_aliases VALUES (?,?,?,?)').run(alias.id,alias.id,JSON.stringify(alias),now());db.prepare('UPDATE users SET name=? WHERE id=?').run(name,alias.id);return;}
 const id=person.id,oldId=alias.id,sources=[...JSON.parse(person.source_json||'[]'),...JSON.parse(alias.source_json||'[]')],unique=[...new Map(sources.map(s=>[JSON.stringify(s),s])).values()];
 db.prepare('INSERT OR REPLACE INTO staff_aliases VALUES (?,?,?,?)').run(oldId,id,JSON.stringify(alias),now());
 db.prepare('INSERT OR IGNORE INTO members SELECT record_id,? FROM members WHERE user_id=?').run(id,oldId);db.prepare('DELETE FROM members WHERE user_id=?').run(oldId);
 db.prepare('INSERT OR IGNORE INTO attendance SELECT ?,production_date,status FROM attendance WHERE user_id=?').run(id,oldId);db.prepare('DELETE FROM attendance WHERE user_id=?').run(oldId);
 for(const r of db.prepare('SELECT id,request_id FROM records WHERE submitted_by=?').all(oldId)){
  if(db.prepare('SELECT 1 FROM records WHERE submitted_by=? AND request_id=?').get(id,r.request_id))db.prepare('UPDATE records SET request_id=? WHERE id=?').run(oldId+':'+r.request_id,r.id);
 }
 for(const [table,column]of [['records','submitted_by'],['history','actor_id'],['notices','user_id'],['change_requests','user_id'],['sessions','user_id'],['imports','created_by']])db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).run(id,oldId);
 db.prepare('INSERT OR IGNORE INTO leader_requests SELECT ?,request_id,payload_hash FROM leader_requests WHERE user_id=?').run(id,oldId);db.prepare('DELETE FROM leader_requests WHERE user_id=?').run(oldId);
 db.prepare('UPDATE staff_aliases SET user_id=? WHERE user_id=?').run(id,oldId);
 db.prepare('DELETE FROM users WHERE id=?').run(oldId);
 const phone=/^1\d{10}$/.test(person.phone)?person.phone:/^1\d{10}$/.test(alias.phone)?alias.phone:person.phone;
 db.prepare('UPDATE users SET source_json=?,phone=?,active=?,expected=? WHERE id=?').run(JSON.stringify(unique),phone,Math.max(person.active,alias.active),Math.max(person.expected,alias.expected),id);
}

export function applyFactoryRules(db,catalog){
 db.exec('CREATE TABLE IF NOT EXISTS staff_aliases (old_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),original_json TEXT NOT NULL,merged_at TEXT NOT NULL)');
 applyFullCatalog(db,catalog);
 applyLoadingModule(db);
 stripPersonalModuleLabels(db);
 if(db.prepare("SELECT 1 FROM app_meta WHERE key='factory_rules_tons_2_v1'").get())return;
 transaction(db,()=>{
  mergeStaffAlias(db);
  for(const p of catalog.filter(p=>p.category==='浇注料'))db.prepare("UPDATE products SET unit='吨',precision=2,weight_kg=NULL,active=CASE WHEN unit='' THEN ? ELSE active END,spec=CASE WHEN spec='计量单位待管理员确认' THEN ? ELSE spec END WHERE id=?").run(p.active?1:0,p.spec,p.id);
  db.prepare("UPDATE products SET active=0 WHERE category='浇注料' AND id LIKE 'material-demo%'").run();
  for(const [id,name]of crewLeaders){db.prepare('UPDATE groups SET name=? WHERE id=?').run(['一班','二班','三班'][Number(id.slice(1))-1]+'（'+name+'）',id);db.prepare("UPDATE users SET group_id=?,is_leader=1 WHERE name=? AND role='worker'").run(id,name);}
  db.prepare("UPDATE groups SET name='浇注料（个人模块）' WHERE id='g4'").run();
  db.prepare("INSERT INTO app_meta VALUES ('factory_rules_tons_2_v1','done')").run();
 });
}

// 页面和导出直接展示业务模块名称，隐藏内部模块标记。
function stripPersonalModuleLabels(db){
 if(db.prepare("SELECT 1 FROM app_meta WHERE key='strip_personal_module_labels_v1'").get())return;
 transaction(db,()=>{
  db.prepare("UPDATE groups SET name=replace(name,'（个人模块）','') WHERE name LIKE '%（个人模块）%'").run();
  db.prepare("INSERT INTO app_meta VALUES ('strip_personal_module_labels_v1','done')").run();
 });
}

function applyLoadingModule(db){
 if(db.prepare("SELECT 1 FROM app_meta WHERE key='loading_module_v1'").get())return;
 transaction(db,()=>{
  db.prepare("INSERT OR IGNORE INTO groups VALUES ('g5','装/卸车（个人模块）')").run();
  const ids=['material-73','material-74','material-75','material-76'];
  for(const id of ids){
   db.prepare("UPDATE products SET category='装/卸车',group_id='g5',spec=CASE WHEN id='material-73' THEN '按吨填写' ELSE '卸车 · 按吨填写' END WHERE id=?").run(id);
   for(const r of db.prepare('SELECT * FROM records WHERE product_id=?').all(id)){
    const p=JSON.parse(r.product_json);p.category='装/卸车';p.groupId='g5';p.spec=id==='material-73'?'按吨填写':'卸车 · 按吨填写';
    db.prepare('UPDATE records SET product_json=?,group_id=? WHERE id=?').run(JSON.stringify(p),'g5',r.id);
   }
  }
  // 历史导入预览保留原表坐标，项目归入独立模块。
  for(const row of db.prepare('SELECT id,entries_json FROM imports').all()){
   const entries=JSON.parse(row.entries_json).map(e=>ids.includes(e.productId)?{...e,category:'装/卸车',groupId:'g5'}:e);
   db.prepare('UPDATE imports SET entries_json=? WHERE id=?').run(JSON.stringify(entries),row.id);
  }
  db.prepare("INSERT INTO app_meta VALUES ('loading_module_v1','done')").run();
 });
}

// 最新确认全部原表项目启用；只执行一次，之后管理员仍可维护和停用。
function applyFullCatalog(db,catalog){
 if(db.prepare("SELECT 1 FROM app_meta WHERE key='full_source_catalog_v1'").get())return;
 transaction(db,()=>{
  for(const p of catalog)db.prepare('UPDATE products SET active=1,spec=? WHERE id=?').run(p.spec,p.id);
  db.prepare("INSERT INTO app_meta VALUES ('full_source_catalog_v1','done')").run();
 });
}
