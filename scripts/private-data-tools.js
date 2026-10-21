import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import JSZip from 'jszip';
import {backupDatabase} from './backup.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
export function walk(folder){return fs.existsSync(folder)?fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>{
 if(e.isSymbolicLink())throw new Error('不允许私有包或发布目录包含符号链接');
 return e.isDirectory()?walk(path.join(folder,e.name)):[path.join(folder,e.name)];
}):[];}
const slash=value=>value.replaceAll('\\','/');
const allowedPrivate=name=>/^(?:private-data|data)\//.test(name)||['.env','.env.local','.env.docker'].includes(name);
function safeName(name){return !!name&&!name.includes('\\')&&!name.includes('\0')&&!name.startsWith('/')&&!/^[A-Za-z]:/.test(name)&&!name.split('/').some(x=>x==='..'||x==='.'||!x);}

export async function backupPrivate({root=process.cwd(),output,dbPath=process.env.DB_PATH||'data/production.sqlite'}={}){
 root=path.resolve(root);const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 output=path.resolve(output||path.join(root,'backups','private-data-'+stamp+'.zip'));
 if(fs.existsSync(output))throw new Error('备份目标已存在，请使用新文件名');
 const zip=new JSZip(),files={},put=(name,buffer)=>{files[name]=digest(buffer);zip.file(name,buffer);};
 for(const folder of ['private-data','data'])for(const file of walk(path.join(root,folder))){
  if(/\.(?:sqlite|db)(?:-.+)?$/i.test(file))continue;
  put(slash(path.relative(root,file)),fs.readFileSync(file));
 }
 for(const name of ['.env','.env.local','.env.docker'])if(fs.existsSync(path.join(root,name)))put(name,fs.readFileSync(path.join(root,name)));
 const source=path.resolve(root,dbPath),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'factory-backup-'));
 try{if(fs.existsSync(source)){const copy=path.join(temporary,'production.sqlite');backupDatabase(source,copy);put('data/production.sqlite',fs.readFileSync(copy));}}
 finally{fs.rmSync(temporary,{recursive:true,force:true});}
 if(!Object.keys(files).length)throw new Error('没有可以备份的私有资料');
 zip.file('manifest.json',JSON.stringify({format:1,createdAt:new Date().toISOString(),files},null,2));
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),{mode:0o600});
 return {file:output,files:Object.keys(files).length};
}

export async function restorePrivate({file,target}={}){
 if(!file||!target)throw new Error('恢复需指定--from备份包和--target目标项目目录');
 target=path.resolve(target);const zip=await JSZip.loadAsync(fs.readFileSync(file),{checkCRC32:true});
 if(!zip.file('manifest.json'))throw new Error('不是本工具生成的私有备份包');
 const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
 if(manifest.format!==1||!manifest.files||typeof manifest.files!=='object'||!Object.keys(manifest.files).length)throw new Error('备份清单格式不正确');
 const files=Object.entries(zip.files).filter(([,entry])=>!entry.dir&&entry.name!=='manifest.json');
 if(files.length!==Object.keys(manifest.files).length)throw new Error('备份内容与清单不一致');
 const restored=[];
 // Validate every destination and every checksum before writing any file.
 for(const [name,entry]of files){
  if(!safeName(name)||!allowedPrivate(name)||entry.unsafeOriginalName&&entry.unsafeOriginalName!==name)throw new Error('备份含非法路径');
  const dest=path.join(target,name);let parent=path.dirname(dest);
  while(parent.startsWith(target)){if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw new Error('恢复路径中不能有符号链接');if(parent===target)break;parent=path.dirname(parent);}
  if(fs.existsSync(dest))throw new Error('目标已有私有资料，恢复已取消；请使用新的空目录');
  const buffer=await entry.async('nodebuffer');if(digest(buffer)!==manifest.files[name])throw new Error('备份完整性校验失败');restored.push({name,dest,buffer});
 }
 if(fs.existsSync(path.join(target,'data'))&&walk(path.join(target,'data')).length)throw new Error('目标已有运行数据，恢复已取消');
 if(fs.existsSync(path.join(target,'private-data'))&&walk(path.join(target,'private-data')).length)throw new Error('目标已有私有资料，恢复已取消');
 for(const item of restored){fs.mkdirSync(path.dirname(item.dest),{recursive:true});fs.writeFileSync(item.dest,item.buffer,{flag:'wx',mode:0o600});}
 const database=path.join(target,'data','production.sqlite');
 if(fs.existsSync(database)){const db=new DatabaseSync(database);try{
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('恢复数据库校验失败');
  db.exec('DELETE FROM codes; DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE)');
 }finally{db.close();}}
 for(const name of ['.env','.env.local','.env.docker']){const envFile=path.join(target,name);if(fs.existsSync(envFile)){
  let env=fs.readFileSync(envFile,'utf8').replace(/^DB_PATH=.*$/m,'DB_PATH=./data/production.sqlite');
  env=env.replace(/^PRIVATE_DATA_DIR=.*$/m,'PRIVATE_DATA_DIR=./private-data');fs.writeFileSync(envFile,env,{mode:0o600});
 }}
 return {directory:target,files:restored.length};
}

export function publicFiles(root=process.cwd()){
 const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 return [...new Set(files)].filter(file=>fs.existsSync(path.join(root,file)));
}
export async function scanPublic({root=process.cwd(),files=publicFiles(root),sensitiveValues=[],readFile}={}){
 const problems=[];
 const forbidden=/(^|\/)(?:private-data|data|backups|qa|reports|release|public-release|node_modules|\.git)(\/|$)|(?:^|\/)\.env(?!.*\.example$)|\.(?:sqlite(?:-\w+)?|db|pem|key|zip|bundle|log)$/i;
 const privateSource=/^server\/(?:source-data\/|templates\/|accounts\.json$|staff-roster\.json$|catalog\.json$|shipping-customers\.json$|opening-stock-.*\.json$|wage-source\.json$)/;
 for(const file of files){
  if(forbidden.test(file)||privateSource.test(file)){problems.push({file,reason:'私有文件不得发布'});continue;}
  const full=path.join(root,file);if(!readFile&&fs.lstatSync(full).isSymbolicLink()){problems.push({file,reason:'发布文件不能是符号链接'});continue;}
  let texts=[];const buffer=readFile?readFile(file):fs.readFileSync(full);
  if(file.endsWith('.xlsx')){const book=await JSZip.loadAsync(buffer);texts=await Promise.all(Object.values(book.files).filter(e=>!e.dir&&/\.(?:xml|rels)$/.test(e.name)).map(e=>e.async('string')));}
  else if(!/\.(?:png|jpg|jpeg|gif|woff2?)$/i.test(file))texts=[buffer.toString('utf8')];
  for(const text of texts){
   if(file.endsWith('.example')&&/^(?:APP_SECRET|ADMIN_PHONE|TENCENT_SECRET_ID|TENCENT_SECRET_KEY|TENCENT_SMS_SDK_APP_ID|TENCENT_SMS_SIGN_NAME|TENCENT_SMS_TEMPLATE_ID|SMS_WEBHOOK_TOKEN)=[ \t]*[^ \t\r\n].*$/m.test(text)){problems.push({file,reason:'公开配置示例必须留空身份与凭证字段'});break;}
   if(/\bAKID[A-Za-z0-9]{25,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)){problems.push({file,reason:'疑似真实密钥'});break;}
   if(sensitiveValues.some(value=>value.length>=2&&text.includes(value))){problems.push({file,reason:'包含本地真实身份、客户或凭证'});break;}
   if(/(?<![\dA-Za-z])1[3-9]\d{9}(?!\d)/.test(text)){problems.push({file,reason:'包含完整手机号；示例与测试应使用合成号码'});break;}
  }
 }
 return {files:files.length,problems};
}

export async function scanHistory({root=process.cwd(),sensitiveValues=[]}={}){
 const objects=execFileSync('git',['rev-list','--objects','--all'],{cwd:root,encoding:'utf8'}).split('\n').map(line=>line.match(/^([a-f0-9]+) (.+)$/)).filter(Boolean);
 const problems=[];let checked=0;
 for(const [,id,file]of objects){
  const type=execFileSync('git',['cat-file','-t',id],{cwd:root,encoding:'utf8'}).trim();if(type!=='blob')continue;
  const report=await scanPublic({root,files:[file],sensitiveValues,readFile:()=>execFileSync('git',['cat-file','blob',id],{cwd:root,maxBuffer:64*1024*1024})});
  checked++;problems.push(...report.problems);
 }
 return {objects:checked,problems};
}

export async function createPublicRelease({root=process.cwd(),target,sensitiveValues=[]}={}){
 root=path.resolve(root);target=path.resolve(target||path.join(root,'public-release','factory-production-'+new Date().toISOString().replace(/[:.]/g,'-')));
 if(fs.existsSync(target))throw new Error('发布目录已存在，请指定一个新目录');
 const files=publicFiles(root),report=await scanPublic({root,files,sensitiveValues});
 if(report.problems.length){const error=new Error('脱敏检查未通过：'+report.problems.map(p=>p.file+'（'+p.reason+'）').join('、'));error.report=report;throw error;}
 fs.mkdirSync(target,{recursive:true});for(const file of files){const dest=path.join(target,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,file),dest);}
 const clean=await scanPublic({root:target,files:walk(target).map(f=>slash(path.relative(target,f))),sensitiveValues});
 if(clean.problems.length)throw new Error('发布目录复查失败');
 return {directory:target,files:files.length};
}
