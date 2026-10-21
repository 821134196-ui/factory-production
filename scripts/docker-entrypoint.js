import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function containerSecret(env=process.env){
 const configured=String(env.APP_SECRET||'').trim();
 if(configured){if(configured.length<32)throw new Error('APP_SECRET至少需要32位');return configured;}
 const directory=path.dirname(path.resolve(env.DB_PATH||'/app/data/production.sqlite'));
 fs.mkdirSync(directory,{recursive:true});
 const file=path.join(directory,'.app-secret');
 try{fs.writeFileSync(file,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});}
 catch(error){if(error.code!=='EEXIST')throw error;}
 const secret=fs.readFileSync(file,'utf8').trim();
 if(secret.length<32)throw new Error('已保存的登录密钥无效，请恢复数据卷中的.app-secret或配置APP_SECRET');
 return secret;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.env.APP_SECRET=containerSecret();
 await import('../server/index.js');
}
