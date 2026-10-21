import {businessRules} from './private-data.js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const now = () => new Date().toISOString();
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function openDatabase(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL UNIQUE,role TEXT NOT NULL CHECK(role IN ('worker','admin')),group_id TEXT REFERENCES groups(id),active INTEGER NOT NULL DEFAULT 1,font_size INTEGER NOT NULL DEFAULT 22,expected INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY,name TEXT NOT NULL,spec TEXT NOT NULL DEFAULT '',category TEXT NOT NULL,unit TEXT NOT NULL,precision INTEGER NOT NULL DEFAULT 0,weight_kg REAL,group_id TEXT REFERENCES groups(id),active INTEGER NOT NULL DEFAULT 1,source TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY,production_date TEXT NOT NULL,product_id TEXT REFERENCES products(id),product_json TEXT NOT NULL,group_id TEXT REFERENCES groups(id),mode TEXT NOT NULL,quantity REAL NOT NULL,original_quantity REAL NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),submitted_by TEXT NOT NULL REFERENCES users(id),submitted_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,remark TEXT NOT NULL DEFAULT '',rejection_reason TEXT NOT NULL DEFAULT '',UNIQUE(submitted_by,request_id));
    CREATE TABLE IF NOT EXISTS members (record_id TEXT REFERENCES records(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id),PRIMARY KEY(record_id,user_id));
    CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES records(id),actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attendance (user_id TEXT REFERENCES users(id),production_date TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('rest','stopped')),PRIMARY KEY(user_id,production_date));
    CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),record_id TEXT REFERENCES records(id),message TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT);
    CREATE TABLE IF NOT EXISTS change_requests (id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES records(id),user_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL,resolved_at TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS codes (phone TEXT PRIMARY KEY,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,sent_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,consumed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS records_date ON records(production_date);
    CREATE INDEX IF NOT EXISTS notices_user ON notices(user_id,created_at);
  `);
  const columns=db.prepare('PRAGMA table_info(users)').all();
  if(!columns.some(c=>c.name==='is_leader'))db.exec('ALTER TABLE users ADD COLUMN is_leader INTEGER NOT NULL DEFAULT 0');
  if(!columns.some(c=>c.name==='source_json'))db.exec("ALTER TABLE users ADD COLUMN source_json TEXT NOT NULL DEFAULT '[]'");
  if(!columns.some(c=>c.name==='is_super_admin'))db.exec('ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0');
  if(!columns.some(c=>c.name==='permissions_json'))db.exec("ALTER TABLE users ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]'");
  if(!columns.some(c=>c.name==='deleted_at'))db.exec("ALTER TABLE users ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE TABLE IF NOT EXISTS admin_account_history (id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_at TEXT NOT NULL)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_single_super_admin ON users(is_super_admin) WHERE is_super_admin=1; CREATE TABLE IF NOT EXISTS permission_history (id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),user_id TEXT NOT NULL REFERENCES users(id),before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_at TEXT NOT NULL)');
  const recordColumns=db.prepare('PRAGMA table_info(records)').all();
  if(!recordColumns.some(c=>c.name==='deleted_at'))db.exec("ALTER TABLE records ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''");
  if(!recordColumns.some(c=>c.name==='revision_at')){
    db.exec("ALTER TABLE records ADD COLUMN revision_at TEXT NOT NULL DEFAULT ''; UPDATE records SET revision_at=COALESCE((SELECT MAX(created_at) FROM history WHERE record_id=records.id AND action IN ('submit','worker_edit','correct')),submitted_at)");
  }
  for(const name of ['shift','batch_code','source_ref'])if(!recordColumns.some(c=>c.name===name))db.exec(`ALTER TABLE records ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
  db.exec("CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY,file_name TEXT NOT NULL,month TEXT NOT NULL,file_hash TEXT NOT NULL,entries_json TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,UNIQUE(file_hash,month))");
  db.exec("CREATE TABLE IF NOT EXISTS leader_requests (user_id TEXT NOT NULL REFERENCES users(id),request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,PRIMARY KEY(user_id,request_id)); CREATE UNIQUE INDEX IF NOT EXISTS records_source_unique ON records(source_ref) WHERE source_ref!=''");
  return db;
}
const transactionDepth=new WeakMap();
export function transaction(db, fn) {
  const depth=transactionDepth.get(db)||0,savepoint='factory_transaction_'+depth;
  db.exec(depth?'SAVEPOINT '+savepoint:'BEGIN IMMEDIATE');transactionDepth.set(db,depth+1);
  try { const result=fn();db.exec(depth?'RELEASE SAVEPOINT '+savepoint:'COMMIT');return result; }
  catch(error){db.exec(depth?'ROLLBACK TO SAVEPOINT '+savepoint+'; RELEASE SAVEPOINT '+savepoint:'ROLLBACK');throw error;}
  finally{if(depth)transactionDepth.set(db,depth);else transactionDepth.delete(db);}
}
export function seed(db, config, catalog = [], roster = []) {
  const addProduct = p => db.prepare('INSERT OR IGNORE INTO products (id,name,spec,category,unit,precision,weight_kg,group_id,active,source) VALUES (?,?,?,?,?,?,?,?,?,?)').run(p.id,p.name,p.spec||'',p.category,p.unit,p.precision||0,p.weightKg??null,p.groupId??null,p.active?1:0,p.source||'演示样例');
  if (db.prepare('SELECT count(*) n FROM users').get().n) { transaction(db,()=>{ for(const p of catalog){addProduct(p);db.prepare("UPDATE products SET name=?,spec=?,source=? WHERE id=? AND source='演示样例'").run(p.name,p.spec,p.source,p.id);}if(config.demo)seedMaterialDemo(db,catalog);seedRoster(db,config,roster); }); return; }
  transaction(db, () => {
    const groups = [['g1','预制块一组'],['g2','预制块二组'],['g3','预制块三组'],['g4','浇注料组'],['g5','装/卸车']];
    for (const row of groups) db.prepare('INSERT INTO groups VALUES (?,?)').run(...row);
    db.prepare('INSERT INTO users (id,name,phone,role,group_id,expected) VALUES (?,?,?,?,?,?)').run('admin','管理员',config.adminPhone,'admin',null,0);
    if (config.demo) {
      for (const [id,name,phone] of (businessRules.sampleWorkers||[])) db.prepare('INSERT INTO users (id,name,phone,role,group_id) VALUES (?,?,?,?,?)').run(id,name,phone,'worker','g3');
    }
    const defaults = config.demo?(businessRules.sampleProducts||[]):[];
    for (const p of [...defaults,...catalog]) addProduct(catalog.find(x=>x.id===p.id)||p);
    if (config.demo) for (const [id,productId,quantity] of [['demo-1','bamei',80],['demo-2','jinwantong',100]]) {
      const p = defaults.find(p=>p.id===productId), stamp=now();
      db.prepare('INSERT INTO records (id,production_date,product_id,product_json,group_id,mode,quantity,original_quantity,status,submitted_by,submitted_at,updated_at,version,request_id,payload_hash,remark,rejection_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,today(),productId,JSON.stringify(p),'g3','shared',quantity,quantity,'approved','w1',stamp,stamp,1,id,'seed','演示数量','');
      for (const user of ['w1','w2','w3']) db.prepare('INSERT INTO members VALUES (?,?)').run(id,user);
    }
    if(config.demo)seedMaterialDemo(db,catalog);
    seedRoster(db,config,roster);
  });
}
function seedRoster(db,config,roster){
  if(!db.prepare("SELECT 1 FROM app_meta WHERE key='staff_roster_v1'").get()){
  for(const person of roster){
    let u=db.prepare("SELECT * FROM users WHERE name=? AND role='worker'").get(person.name);
    if(!u){const id=randomUUID();db.prepare("INSERT INTO users (id,name,phone,role,group_id,active,expected,source_json) VALUES (?,?,?,'worker',?,1,0,?)").run(id,person.name,'unbound:'+id,person.defaultGroupId,JSON.stringify(person.sources));}
    else if(u.source_json==='[]')db.prepare('UPDATE users SET source_json=? WHERE id=?').run(JSON.stringify(person.sources),u.id);
  }
  db.prepare("INSERT INTO app_meta VALUES ('staff_roster_v1','done')").run();
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS worker_name_unique ON users(name) WHERE role='worker'");
  if(config.demo&&!db.prepare("SELECT 1 FROM app_meta WHERE key='unified_report_v1'").get()){
    db.prepare("UPDATE users SET is_leader=1 WHERE id='w1'").run();
    // 旧演示员工仍保留其账号和历史；所有员工现在使用同一填写页。
    db.prepare("INSERT INTO app_meta VALUES ('unified_report_v1','done')").run();
  }
}
function seedMaterialDemo(db,catalog){
  if(db.prepare("SELECT 1 FROM app_meta WHERE key='material_demo_v1'").get())return;
  for(const [id,name,phone] of (businessRules.materialSampleWorkers||[]))db.prepare("INSERT OR IGNORE INTO users (id,name,phone,role,group_id) VALUES (?,?,?,'worker','g4')").run(id,name,phone);
  db.prepare("UPDATE products SET group_id='g4' WHERE id='material-demo' AND group_id IS NULL AND source='演示样例'").run();
  for(const [id,name] of (businessRules.materialSamples||[])){
    const source=catalog.find(p=>p.category==='浇注料'&&p.name===name)?.source||'浇注料记工表';
    db.prepare('INSERT OR IGNORE INTO products VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,name+'（演示）','演示按公斤填写，正式单位需核实','浇注料','公斤',2,null,'g4',1,'演示项目 / '+source);
  }
  for(const [id,productId,userId,qty,status] of [['demo-material-1','material-demo','mw1',1250,'approved'],['demo-material-2','material-demo-cast','mw2',800,'pending']]){
    const p=db.prepare('SELECT * FROM products WHERE id=?').get(productId),u=db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if(!p||!u||u.group_id!=='g4')continue;
    const snapshot={id:p.id,name:p.name,spec:p.spec,category:p.category,unit:p.unit,precision:p.precision,weightKg:p.weight_kg,groupId:p.group_id,active:!!p.active,source:p.source},stamp=now();
    db.prepare('INSERT OR IGNORE INTO records (id,production_date,product_id,product_json,group_id,mode,quantity,original_quantity,status,submitted_by,submitted_at,updated_at,version,request_id,payload_hash,remark,rejection_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,today(),productId,JSON.stringify(snapshot),'g4','personal',qty,qty,status,userId,stamp,stamp,1,id,'seed','浇注料演示数量','');
    db.prepare('INSERT OR IGNORE INTO members VALUES (?,?)').run(id,userId);
  }
  db.prepare("INSERT INTO app_meta VALUES ('material_demo_v1','done')").run();
}
export function demoAccounts(){return [];}
export function insertNotice(db, userId, recordId, message) {
  db.prepare('INSERT INTO notices (id,user_id,record_id,message,created_at) VALUES (?,?,?,?,?)').run(randomUUID(),userId,recordId,message,now());
}
