import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {brotliCompressSync,constants} from 'node:zlib';
import {parseEnv} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {backupDatabase} from './backup.js';

const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const runtime=fileURLToPath(new URL('./initial-data-restore.cjs',import.meta.url));
const jsonFiles=['accounts.json','staff-roster.json','catalog.json','shipping-customers.json','wage-source.json','opening-stock-2026-10.json','business-rules.json'];
const configKeys=['HOST','PORT','FACTORY_NAME','ADMIN_PHONE','SMS_PROVIDER','TENCENT_SECRET_ID','TENCENT_SECRET_KEY','TENCENT_SMS_SDK_APP_ID','TENCENT_SMS_SIGN_NAME','TENCENT_SMS_TEMPLATE_ID','TENCENT_SMS_REGION','TENCENT_SMS_TEMPLATE_PARAMS','SMS_WEBHOOK_URL','SMS_WEBHOOK_TOKEN','TRUST_PROXY'];

function initialConfig(root){
 const file=path.join(root,'.env');if(!fs.existsSync(file))return null;
 if(fs.lstatSync(file).isSymbolicLink())throw new Error('本地短信配置不能是符号链接');
 const local=parseEnv(fs.readFileSync(file,'utf8'));
 const config=Object.fromEntries(configKeys.filter(key=>local[key]!==undefined).map(key=>[key,local[key]]));
 Object.assign(config,{AUTH_MODE:'sms',DEMO_MODE:'false',OFFICIAL_ROSTER:'true',IMPORT_BUNDLED_DATA:'false',DB_PATH:'./data/production.sqlite',PRIVATE_DATA_DIR:'./private-data',APP_SECRET:''});
 return Buffer.from(Object.entries(config).map(([key,value])=>{
  if(/["\r\n\0]/.test(value))throw new Error('本地配置值包含不支持的引号或换行：'+key);
  return key+'="'+value+'"';
 }).join('\n')+'\n');
}

function walk(folder){
 if(!fs.existsSync(folder))return [];
 if(fs.lstatSync(folder).isSymbolicLink())throw new Error('初始化资料不能包含符号链接');
 return fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
  const file=path.join(folder,entry.name);
  if(entry.isSymbolicLink())throw new Error('初始化资料不能包含符号链接');
  return entry.isDirectory()?walk(file):[file];
 });
}

export function createInitialDataScript({root=process.cwd(),privateDir=process.env.PRIVATE_DATA_DIR||'private-data',dbPath=process.env.DB_PATH||'data/production.sqlite',output}={}){
 root=path.resolve(root);privateDir=path.resolve(root,privateDir);
 output=path.resolve(root,output||'private-data/恢复初始化数据.cjs');
 const source=path.resolve(root,dbPath);
 if(!fs.existsSync(source))throw new Error('没有可生成初始化脚本的业务数据库');
 if(fs.existsSync(output))throw new Error('初始化脚本已存在，请先移动旧文件或指定新的--output');
 const files=[],blobs={};
 const put=(name,buffer)=>{const sha256=hash(buffer);files.push({name,sha256});blobs[sha256]??=buffer.toString('base64');};
 for(const name of jsonFiles){const file=path.join(privateDir,name);if(fs.existsSync(file))put('private-data/'+name,fs.readFileSync(file));}
 for(const folder of ['templates','source-data'])for(const file of walk(path.join(privateDir,folder))){
  if(/\.(?:json|xlsx)$/i.test(file))put('private-data/'+path.relative(privateDir,file).replaceAll('\\','/'),fs.readFileSync(file));
 }
 if(!files.length)throw new Error('没有找到人员、产品等初始化资料');
 const config=initialConfig(root);if(config)put('.env',config);
 // Work on a consistent disposable copy; the running database stays untouched.
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'factory-initial-data-'));
 try{
  const snapshot=path.join(temporary,'production.sqlite');backupDatabase(source,snapshot);
  const db=new DatabaseSync(snapshot);
  try{
   for(const table of ['codes','sessions'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))db.exec('DELETE FROM '+table);
   db.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; VACUUM');
   if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('初始化数据库校验失败');
  }finally{db.close();}
  put('data/production.sqlite',fs.readFileSync(snapshot));
 }finally{
  if(path.dirname(temporary)===os.tmpdir()&&path.basename(temporary).startsWith('factory-initial-data-'))fs.rmSync(temporary,{recursive:true,force:true});
 }
 const payload=brotliCompressSync(Buffer.from(JSON.stringify({format:1,createdAt:new Date().toISOString(),files,blobs})),{params:{[constants.BROTLI_PARAM_QUALITY]:9}});
 const encoded=payload.toString('base64').match(/.{1,120}/g).map(line=>JSON.stringify(line)).join('+\n');
 const script=fs.readFileSync(runtime,'utf8')+'\nif(require.main===module){\n try{restoreInitialData(\n'+encoded+',\n'+JSON.stringify(hash(payload))+');}\n catch(error){console.error("恢复失败："+error.message);process.exitCode=1;}\n}\n';
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,script,{flag:'wx',mode:0o600});
 return {file:output,bytes:Buffer.byteLength(script),files:files.length,smsConfigIncluded:!!config};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);let output;
  if(args.length){if(args.length!==2||args[0]!=='--output'||!args[1])throw new Error('用法：node scripts/create-initial-data-script.js [--output <本地脚本路径>]');output=args[1];}
  console.log(JSON.stringify(createInitialDataScript({output}),null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
