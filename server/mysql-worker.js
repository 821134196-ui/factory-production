import {translate} from './mysql-dialect.js';
import mysql from 'mysql2/promise';
import {workerData} from 'node:worker_threads';
import {readFileSync} from 'node:fs';

const {port,signal} = workerData;
const schema = readFileSync(new URL('./mysql-schema.sql',import.meta.url),'utf8');
const declared = new Set([...schema.matchAll(/CREATE TABLE `(\w+)`/g)].map(m=>m[1]));
let connection;
let inTransaction=false;
let lostTransaction=false;
async function connect() {
  if (!connection) {
    const next = await mysql.createConnection({
      host:process.env.MYSQL_HOST, port:Number(process.env.MYSQL_PORT||3306),
      user:process.env.MYSQL_USER, password:process.env.MYSQL_PASSWORD,
      database:process.env.MYSQL_DATABASE, charset:'utf8mb4', connectTimeout:8000
    });
    await next.query("SET SESSION sql_mode=CONCAT_WS(',',@@sql_mode,'PIPES_AS_CONCAT'), SESSION transaction_isolation='SERIALIZABLE'");
    const [rows]=await next.query('SHOW TABLES');
    const existing=new Set(rows.map(row=>Object.values(row)[0]));
    if ([...declared].some(name=>!existing.has(name))) {await next.end();throw new Error('MySQL schema incomplete; run the database migration first');}
    connection=next;
    next.on('error',()=>{connection=undefined;lostTransaction=inTransaction;});
  }
  return connection;
}
port.on('message',async ({operation,sql,args})=>{
  try {
    let result;
    if(operation==='close') await connection?.end();
    else {
      if(lostTransaction){if(sql!=='ROLLBACK') throw new Error('MySQL transaction connection lost');lostTransaction=false;inTransaction=false;}
      const c=await connect(),statement=translate(sql,declared);
      if(statement) {
        const params=args.map(x=>x instanceof Uint8Array?Buffer.from(x):x);
        const [rows]=params.length?await c.execute(statement,params):await c.query(statement);
        if(statement==='START TRANSACTION')inTransaction=true;
        if(statement==='ROLLBACK'||statement==='COMMIT')inTransaction=false;
        result=operation==='run'?{changes:rows.affectedRows,lastInsertRowid:rows.insertId}:operation==='get'?rows[0]:rows;
      }
    }
    port.postMessage({result});
  } catch(e) {
    port.postMessage({error:{message:e.code==='ER_DUP_ENTRY'?'UNIQUE constraint failed':e.sqlMessage?.replace(/near '[\s\S]*' at line/,'near SQL expression at line')||e.message,code:e.code}});
  } finally {Atomics.store(signal,0,1);Atomics.notify(signal,0);}
});
