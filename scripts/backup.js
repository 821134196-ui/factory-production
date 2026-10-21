import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
export function backupDatabase(source,output){
 const target=path.resolve(output);if(path.resolve(source)===target||fs.existsSync(target))throw new Error('备份文件已存在或与数据库相同，请使用新文件名。');
 fs.mkdirSync(path.dirname(target),{recursive:true});const live=new DatabaseSync(path.resolve(source),{readOnly:true});
 try{live.prepare('VACUUM INTO ?').run(target);}finally{live.close();}
 const copy=new DatabaseSync(target,{readOnly:true});try{if(copy.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('备份校验失败');return {file:target,records:copy.prepare('SELECT count(*) n FROM records').get().n,history:copy.prepare('SELECT count(*) n FROM history').get().n};}finally{copy.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const index=process.argv.indexOf('--output'),file=index>=0?process.argv[index+1]:path.join(process.env.BACKUP_DIR||'./backups','production-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
 if(!file)throw new Error('--output后需要备份路径');console.log(JSON.stringify(backupDatabase(process.env.DB_PATH||'./data/production.sqlite',file),null,2));
}
