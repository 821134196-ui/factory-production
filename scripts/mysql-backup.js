import mysql from 'mysql2/promise';
import {open,link,unlink,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Standalone SQL dump. InnoDB supplies a single snapshot across all tables.
export async function backupMySQL(output) {
  const target=path.resolve(output),temp=target+'.'+randomUUID()+'.tmp';
  await mkdir(path.dirname(target),{recursive:true});
  const db=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),
    user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE});
  let file;
  try {
    file=await open(temp,'wx',0o600);
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const schema=readFileSync(new URL('../server/mysql-schema.sql',import.meta.url),'utf8');
    const tables=[...schema.matchAll(/CREATE TABLE `(\w+)`/g)].map(x=>x[1]);
    await file.writeFile("SET NAMES utf8mb4;\nSET SESSION sql_mode='STRICT_ALL_TABLES,NO_AUTO_VALUE_ON_ZERO';\n");
    for(const table of tables){
      const t=mysql.escapeId(table),[ddl]=await db.query('SHOW CREATE TABLE '+t);
      await file.writeFile(ddl[0]['Create Table']+';\n');
    }
    await file.writeFile('START TRANSACTION;\n');
    let total=0;
    for(const table of tables){
      const t=mysql.escapeId(table),[columns]=await db.query('SHOW COLUMNS FROM '+t);
      const fields=columns.map(c=>mysql.escapeId(c.Field)).join(',');
      const [rows]=await db.query({sql:'SELECT '+fields+' FROM '+t,rowsAsArray:true});
      for(const row of rows) await file.writeFile('INSERT INTO '+t+' ('+fields+') VALUES ('+row.map(v=>mysql.escape(v)).join(',')+');\n');
      total+=rows.length;
    }
    await db.commit();
    await file.writeFile('COMMIT;\n');await file.sync();await file.close();file=null;
    await link(temp,target);
    return {file:target,tables:tables.length,rows:total};
  } finally {await file?.close();await unlink(temp).catch(()=>{});await db.end();}
}
