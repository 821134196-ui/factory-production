// Run against a consistent SQLite backup. Target tables must be empty on every attempt.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import mysql from 'mysql2/promise';
const verify=process.argv.includes('--verify');
const source=process.argv[2];
if(!source) throw new Error('Usage: node scripts/migrate-to-mysql.js snapshot.sqlite [--commit|--verify]');
const sqlite=new DatabaseSync(source,{readOnly:true});
const db=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),
  database:process.env.MYSQL_DATABASE,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,charset:'utf8mb4'});
const quote=mysql.escapeId;
function digest(rows,columns) {
  const hashes=rows.map(row=>createHash('sha256').update(JSON.stringify(columns.map(k=>
    row[k] instanceof Uint8Array?{blob:Buffer.from(row[k]).toString('base64')}:row[k]))).digest('hex'));
  return createHash('sha256').update(hashes.sort().join('')).digest('hex');
}
try {
  if(sqlite.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||sqlite.prepare('PRAGMA foreign_key_check').get())
    throw new Error('Source integrity check failed');
  const ddl=readFileSync(new URL('../server/mysql-schema.sql',import.meta.url),'utf8').split(';').map(s=>s.trim()).filter(Boolean);
  const tables=ddl.map(s=>s.match(/^CREATE TABLE `(\w+)`/)[1]);
  const sourceTables=sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name);
  if(sourceTables.length!==tables.length||sourceTables.some(t=>!tables.includes(t))) throw new Error('Unexpected source schema');
  const [existing]=await db.query('SHOW TABLES');
  if(existing.some(r=>!tables.includes(Object.values(r)[0]))) throw new Error('Target contains unrelated tables');
  if(!verify) for(const sql of ddl) await db.query(sql.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'));
  if(verify) await db.query('START TRANSACTION READ ONLY');else await db.beginTransaction();
  let total=0;
  for(const table of tables) {
    const t=quote(table);
    if(!verify && (await db.query('SELECT 1 FROM '+t+' LIMIT 1'))[0].length) throw new Error('Target already contains data in '+table);
    const columns=sqlite.prepare('PRAGMA table_info('+t+')').all().map(c=>c.name);
    if(['records','history','inventory_history'].includes(table)) columns.push('rowid');
    const fields=columns.map(c=>quote(c)).join(',');
    const rows=sqlite.prepare('SELECT '+fields+' FROM '+t).all();
    const sql='INSERT INTO '+t+' ('+fields+') VALUES ?';
    for(let i=0;!verify && i<rows.length;i+=50) {
      const values=rows.slice(i,i+50).map(row=>columns.map(k=>row[k] instanceof Uint8Array?Buffer.from(row[k]):row[k]));
      await db.query(sql,[values]);
    }
    const [copy]=await db.query('SELECT '+fields+' FROM '+t);
    if(copy.length!==rows.length||digest(copy,columns)!==digest(rows,columns)) throw new Error('Round-trip mismatch in '+table);
    console.log(table,rows.length);
    total+=rows.length;
  }
  const commit=process.argv.includes('--commit');
  if(commit) await db.commit(); else await db.rollback();
  console.log(verify?'Verified':commit?'Committed':'Rehearsal rolled back',tables.length,'tables,',total,'rows');
} finally {await db.end();sqlite.close();}
