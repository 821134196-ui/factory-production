import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {brotliCompressSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {parseEnv} from 'node:util';
import {createInitialDataScript} from '../scripts/create-initial-data-script.js';
import {scanPublic} from '../scripts/private-data-tools.js';
const {restoreInitialData}=createRequire(import.meta.url)('../scripts/initial-data-restore.cjs');

function directory(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'factory-initial-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function project(t){const root=directory(t);fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'factory-production'}));return root;}
function fixture(t){
 const root=project(t),privateDir=path.join(root,'private-data');fs.mkdirSync(privateDir);fs.mkdirSync(path.join(root,'data'));
 fs.writeFileSync(path.join(privateDir,'accounts.json'),'[{"name":"合成人员"}]');
 fs.mkdirSync(path.join(privateDir,'templates'));fs.writeFileSync(path.join(privateDir,'templates','precast.xlsx'),Buffer.from([0,1,2,255]));
 fs.mkdirSync(path.join(privateDir,'legacy-release'));fs.writeFileSync(path.join(privateDir,'legacy-release','old.zip'),'excluded legacy data');
 fs.writeFileSync(path.join(root,'.env'),'TENCENT_SECRET_ID=synthetic-sms-id\nTENCENT_SECRET_KEY=synthetic-sensitive-$-secret\nTENCENT_SMS_SDK_APP_ID=1001\nTENCENT_SMS_SIGN_NAME="合成短信签名"\nTENCENT_SMS_TEMPLATE_ID=2001\nTENCENT_SMS_TEMPLATE_PARAMS=code\nADMIN_PHONE=10000000001\nAPP_SECRET=synthetic-original-session-secret\nDB_PATH=C:/old/database.sqlite\nPRIVATE_DATA_DIR=C:/old/private\nUNRELATED_PRIVATE_VALUE=excluded-local-value\n');
 const file=path.join(root,'data','production.sqlite'),db=new DatabaseSync(file);
 db.exec("PRAGMA foreign_keys=ON; CREATE TABLE records(id TEXT PRIMARY KEY, quantity REAL); INSERT INTO records VALUES ('sample',12.34); CREATE TABLE history(id TEXT, record_id TEXT REFERENCES records(id)); INSERT INTO history VALUES ('history','sample'); CREATE TABLE codes(id TEXT); INSERT INTO codes VALUES ('old-code'); CREATE TABLE sessions(id TEXT); INSERT INTO sessions VALUES ('old-session'); CREATE TABLE shipment_files(id TEXT, data BLOB); INSERT INTO shipment_files VALUES ('pump',x'01020304'); CREATE TABLE wage_rates(id TEXT, rate REAL); INSERT INTO wage_rates VALUES ('rate',7.5)");db.close();
 return {root,file};
}
const run=(script,target,args=[])=>spawnSync(process.execPath,[script,...args],{cwd:target,encoding:'utf8'});
const cannotChown=process.platform==='linux'&&![0,1000].includes(process.getuid());

test('单文件脚本还原业务及短信配置，修正路径并生成独立登录密钥',t=>{
 const {root,file}=fixture(t),before=fs.readFileSync(file),saved=createInitialDataScript({root,privateDir:'private-data',dbPath:'data/production.sqlite'});
 assert.equal(saved.smsConfigIncluded,true);
 assert.deepEqual(fs.readFileSync(file),before);
 const target=project(t),script=path.join(target,'恢复初始化数据.cjs');fs.copyFileSync(saved.file,script);
 const result=run(script,target);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/初始化完成/);
 const db=new DatabaseSync(path.join(target,'data','production.sqlite'),{readOnly:true});
 try{
  assert.equal(db.prepare('SELECT quantity FROM records').get().quantity,12.34);
  assert.equal(db.prepare('SELECT count(*) n FROM history').get().n,1);
  assert.deepEqual(Buffer.from(db.prepare('SELECT data FROM shipment_files').get().data),Buffer.from([1,2,3,4]));
  assert.equal(db.prepare('SELECT rate FROM wage_rates').get().rate,7.5);
  for(const table of ['sessions','codes'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);
 }finally{db.close();}
 const sourceEnv=parseEnv(fs.readFileSync(path.join(root,'.env'),'utf8')),restoredEnv=parseEnv(fs.readFileSync(path.join(target,'.env'),'utf8'));
 for(const key of ['TENCENT_SECRET_ID','TENCENT_SECRET_KEY','TENCENT_SMS_SDK_APP_ID','TENCENT_SMS_SIGN_NAME','TENCENT_SMS_TEMPLATE_ID','TENCENT_SMS_TEMPLATE_PARAMS','ADMIN_PHONE'])assert.equal(restoredEnv[key],sourceEnv[key]);
 assert.equal(restoredEnv.DB_PATH,'./data/production.sqlite');assert.equal(restoredEnv.PRIVATE_DATA_DIR,'./private-data');
 assert.equal(restoredEnv.AUTH_MODE,'sms');assert.equal(restoredEnv.DEMO_MODE,'false');assert.equal(restoredEnv.IMPORT_BUNDLED_DATA,'false');
 if(process.platform==='linux'){
  assert.equal(restoredEnv.HOST,'0.0.0.0');
  assert.equal(fs.statSync(path.join(target,'data')).mode&0o777,0o700);
  assert.equal(fs.statSync(path.join(target,'data','production.sqlite')).mode&0o777,0o600);
  assert.equal(fs.statSync(path.join(target,'.env')).mode&0o777,0o600);
 }
 assert.match(restoredEnv.APP_SECRET,/^[a-f0-9]{64}$/);assert.notEqual(restoredEnv.APP_SECRET,sourceEnv.APP_SECRET);assert.equal(restoredEnv.UNRELATED_PRIVATE_VALUE,undefined);
 assert.equal(result.stdout.includes(sourceEnv.TENCENT_SECRET_KEY),false);assert.equal(result.stderr.includes(sourceEnv.TENCENT_SECRET_KEY),false);
 const second=project(t);assert.equal(run(saved.file,second).status,0);assert.notEqual(parseEnv(fs.readFileSync(path.join(second,'.env'),'utf8')).APP_SECRET,restoredEnv.APP_SECRET);
 assert.equal(fs.existsSync(path.join(target,'private-data','legacy-release')),false);
 assert.deepEqual(fs.readFileSync(path.join(target,'private-data','templates','precast.xlsx')),Buffer.from([0,1,2,255]));
 const source=new DatabaseSync(file,{readOnly:true});assert.equal(source.prepare('SELECT count(*) n FROM sessions').get().n,1);source.close();
 const initial=fs.readFileSync(path.join(target,'data','production.sqlite'));assert.notEqual(run(script,target).status,0);assert.deepEqual(fs.readFileSync(path.join(target,'data','production.sqlite')),initial);
});

test('Docker模式生成独立短信配置及数据挂载，保留密钥中的美元符号',{skip:cannotChown},t=>{
 const {root}=fixture(t),saved=createInitialDataScript({root}),target=project(t);
 const result=run(saved.file,target,['--docker']);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/docker compose up/);
 const local=parseEnv(fs.readFileSync(path.join(target,'.env'),'utf8')),docker=parseEnv(fs.readFileSync(path.join(target,'.env.docker'),'utf8'));
 assert.equal(local.APP_ENV_FILE,'.env.docker');assert.equal(local.WEB_PORT,'8080');assert.equal(local.HOST,'0.0.0.0');
 assert.equal(docker.APP_SECRET,local.APP_SECRET);assert.equal(docker.TENCENT_SECRET_KEY,'synthetic-sensitive-$-secret');
 assert.equal(docker.DB_PATH,'/app/data/production.sqlite');assert.equal(docker.PRIVATE_DATA_DIR,'/app/private-data');assert.equal(docker.PORT,'3188');
 const override=fs.readFileSync(path.join(target,'compose.override.yaml'),'utf8');assert.match(override,/source: \.\/data/);assert.match(override,/target: \/app\/data/);assert.match(override,/create_host_path: false/);
 if(process.platform==='linux'){
  for(const name of ['data','private-data'])assert.equal(fs.statSync(path.join(target,name)).uid,1000);
  assert.equal(fs.statSync(path.join(target,'.env.docker')).mode&0o777,0o600);
 }
});

test('Docker模式拒绝覆盖已有容器配置和挂载配置',{skip:cannotChown},t=>{
 const {root}=fixture(t),saved=createInitialDataScript({root});
 for(const name of ['.env.docker','compose.override.yaml']){
  const target=project(t);fs.writeFileSync(path.join(target,name),'keep');
  const result=run(saved.file,target,['--target',target,'--docker']);assert.notEqual(result.status,0);assert.match(result.stderr,/已有/);
  assert.equal(fs.readFileSync(path.join(target,name),'utf8'),'keep');assert.equal(fs.existsSync(path.join(target,'data')),false);assert.equal(fs.existsSync(path.join(target,'.env')),false);
 }
});

test('帮助可单独查看且拒绝未知选项',t=>{
 const {root}=fixture(t),saved=createInitialDataScript({root}),target=project(t);
 const help=run(saved.file,target,['--help']);assert.equal(help.status,0);assert.match(help.stdout,/--docker/);assert.equal(fs.existsSync(path.join(target,'data')),false);
 assert.notEqual(run(saved.file,target,['--unknown']).status,0);
});

test('已有.env时整体停止，保留配置且不写入业务资料',t=>{
 const {root}=fixture(t),saved=createInitialDataScript({root}),target=project(t);
 const existing='TENCENT_SECRET_KEY=existing-local-config\n';fs.writeFileSync(path.join(target,'.env'),existing);
 const result=run(saved.file,target);assert.notEqual(result.status,0);assert.match(result.stderr,/已有.env/);
 assert.equal(fs.readFileSync(path.join(target,'.env'),'utf8'),existing);
 assert.equal(fs.existsSync(path.join(target,'data')),false);assert.equal(fs.existsSync(path.join(target,'private-data')),false);
});

test('源项目没有.env时仍可生成只含业务资料的脚本',t=>{
 const {root}=fixture(t);fs.unlinkSync(path.join(root,'.env'));const saved=createInitialDataScript({root}),target=project(t);
 assert.equal(saved.smsConfigIncluded,false);const result=run(saved.file,target);assert.equal(result.status,0,result.stderr);
 assert.equal(fs.existsSync(path.join(target,'.env')),false);assert.equal(fs.existsSync(path.join(target,'data','production.sqlite')),true);
});

test('初始化拒绝已有资料和错误项目目录，重复生成也不覆盖本地脚本',t=>{
 const {root}=fixture(t),saved=createInitialDataScript({root});assert.throws(()=>createInitialDataScript({root}),/已存在/);
 const target=project(t);fs.mkdirSync(path.join(target,'private-data'));fs.writeFileSync(path.join(target,'private-data','keep.txt'),'keep');
 const result=run(saved.file,target);assert.notEqual(result.status,0);assert.match(result.stderr,/已有/);assert.equal(fs.existsSync(path.join(target,'data')),false);
 const wrong=directory(t);assert.notEqual(run(saved.file,wrong).status,0);assert.equal(fs.existsSync(path.join(wrong,'data')),false);
});

test('损坏脚本数据、非法路径和无效数据库在写入前被拒绝',t=>{
 const target=project(t),payload=object=>{const encoded=brotliCompressSync(Buffer.from(JSON.stringify(object)));return [encoded.toString('base64'),createHash('sha256').update(encoded).digest('hex')];};
 assert.throws(()=>restoreInitialData('bad','wrong',['--target',target]),/校验/);
 const buffer=Buffer.from('invalid database'),sha256=createHash('sha256').update(buffer).digest('hex');
 assert.throws(()=>restoreInitialData(...payload({format:1,files:[{name:'private-data/../outside.json',sha256}],blobs:{[sha256]:buffer.toString('base64')}}),['--target',target]),/路径/);
 assert.throws(()=>restoreInitialData(...payload({format:1,files:[{name:'data/production.sqlite',sha256}],blobs:{[sha256]:buffer.toString('base64')}}),['--target',target]));
 assert.equal(fs.existsSync(path.join(target,'data')),false);assert.equal(fs.existsSync(path.join(target,'private-data')),false);
 assert.deepEqual(fs.readdirSync(target),['package.json']);
});

test('初始化拒绝指向现有资料的符号链接',t=>{
 const {root}=fixture(t),saved=createInitialDataScript({root}),target=project(t),outside=directory(t);
 fs.writeFileSync(path.join(outside,'keep.txt'),'keep');fs.symlinkSync(outside,path.join(target,'data'),'junction');
 const result=run(saved.file,target);assert.notEqual(result.status,0);assert.match(result.stderr,/符号链接/);assert.equal(fs.readFileSync(path.join(outside,'keep.txt'),'utf8'),'keep');
});

test('生成脚本和恢复临时目录被Git忽略且被发布扫描拦截',async t=>{
 const root=directory(t);execFileSync('git',['init','-q'],{cwd:root});fs.copyFileSync(new URL('../.gitignore',import.meta.url),path.join(root,'.gitignore'));
 const files=['恢复初始化数据.cjs','.initial-data-restore-test/data.bin','compose.override.yaml'];
 for(const file of files){const name=path.join(root,file);fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,'synthetic');}
 for(const file of files)assert.equal(execFileSync('git',['-c','core.quotePath=false','check-ignore',file],{cwd:root,encoding:'utf8'}).trim().replaceAll('\\','/'),file);
 const report=await scanPublic({root,files});assert.equal(report.problems.length,3);
});
