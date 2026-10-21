import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {BatchProductionService} from '../server/batch-service.js';
import {InventoryService} from '../server/inventory.js';
import {readOpeningSnapshot,planOpeningImport,importOpeningStock} from '../server/opening-import.js';
import {backupDatabase} from './backup.js';

const apply=process.argv.includes('--apply'),filename=path.resolve(process.env.DB_PATH||'./data/production.sqlite');
if(!fs.existsSync(filename))throw new Error('请先启动系统初始化数据库，再执行期初导入。');
const db=new DatabaseSync(filename,{readOnly:!apply});
try{
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
 const inventory=new InventoryService(db,new BatchProductionService(db),{initialize:apply}),user=db.prepare('SELECT * FROM users WHERE active=1 AND is_super_admin=1').get();
 const snapshot=readOpeningSnapshot(),plan=planOpeningImport(inventory,user,snapshot);
 let backup;
 if(apply&&!plan.alreadyApplied){backup=backupDatabase(filename,path.join(process.env.BACKUP_DIR||'./backups','before-september-opening-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite'));}
 const result=apply?importOpeningStock(inventory,user,snapshot):plan;
 console.log(JSON.stringify({mode:apply?'apply':'preview',database:filename,month:result.month,startDate:result.startDate,alreadyApplied:result.alreadyApplied,available:snapshot.rows.filter(r=>r.quantity!==null).length,imported:result.imported||0,toImport:result.toImport?.length||0,preserved:result.preserved.length,missing:result.missing.length,recalculated:result.recalculated.length,...backup?{backup:backup.file}:{}},null,2));
}finally{db.close();}
