import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import JSZip from 'jszip';
import {execFileSync} from 'node:child_process';
import {backupPrivate,restorePrivate,scanPublic,scanHistory,createPublicRelease} from '../scripts/private-data-tools.js';

function directory(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'factory-privacy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('备份与恢复包含私有资料、数据库、附件和配置，清除旧会话且不覆盖现有资料',async t=>{
 const root=directory(t);fs.mkdirSync(path.join(root,'private-data'));fs.mkdirSync(path.join(root,'data'));
 fs.writeFileSync(path.join(root,'private-data','accounts.json'),'[{"name":"合成员工"}]');fs.writeFileSync(path.join(root,'data','photo.bin'),'synthetic attachment');
 fs.writeFileSync(path.join(root,'.env'),'APP_SECRET=synthetic-backup-secret\nDB_PATH=C:/obsolete/database.sqlite\nPRIVATE_DATA_DIR=C:/obsolete/private\n');
 const db=new DatabaseSync(path.join(root,'data','production.sqlite'));db.exec("CREATE TABLE records(id TEXT); INSERT INTO records VALUES ('sample'); CREATE TABLE history(id TEXT); CREATE TABLE codes(id TEXT); INSERT INTO codes VALUES ('code'); CREATE TABLE sessions(id TEXT); INSERT INTO sessions VALUES ('session')");db.close();
 const output=path.join(root,'backup.zip'),saved=await backupPrivate({root,output});assert.ok(saved.files>=4);
 const target=path.join(root,'restored');await restorePrivate({file:output,target});
 assert.equal(fs.readFileSync(path.join(target,'data','photo.bin'),'utf8'),'synthetic attachment');assert.match(fs.readFileSync(path.join(target,'.env'),'utf8'),/DB_PATH=\.\/data\/production.sqlite/);
 const copy=new DatabaseSync(path.join(target,'data','production.sqlite'));assert.equal(copy.prepare('SELECT count(*) n FROM records').get().n,1);assert.equal(copy.prepare('SELECT count(*) n FROM sessions').get().n,0);copy.close();
 await assert.rejects(restorePrivate({file:output,target}),/已有/);
});
test('恢复拒绝被篡改的数据包，所有文件验证后才写入',async t=>{
 const root=directory(t),zip=new JSZip();zip.file('private-data/accounts.json','changed');zip.file('manifest.json',JSON.stringify({format:1,files:{'private-data/accounts.json':'wrong'}}));
 const file=path.join(root,'bad.zip');fs.writeFileSync(file,await zip.generateAsync({type:'nodebuffer'}));const target=path.join(root,'target');await assert.rejects(restorePrivate({file,target}),/完整性/);assert.equal(fs.existsSync(target),false);
});
test('恢复拒绝跨目录路径和未列入清单的文件',async t=>{
 const root=directory(t),zip=new JSZip();zip.file('../outside.txt','bad');zip.file('manifest.json',JSON.stringify({format:1,files:{'outside.txt':'wrong'}}));const file=path.join(root,'bad.zip');fs.writeFileSync(file,await zip.generateAsync({type:'nodebuffer'}));await assert.rejects(restorePrivate({file,target:path.join(root,'target')}),/路径/);
});
test('发布检查能发现私有路径、身份、密钥及暂存内容中的泄漏',async t=>{
 const root=directory(t);fs.writeFileSync(path.join(root,'safe.js'),'export const ok=true;');fs.writeFileSync(path.join(root,'leak.js'),'const person="合成敏感名字";');
 const report=await scanPublic({root,files:['safe.js','leak.js','private-data/accounts.json'],sensitiveValues:['合成敏感名字']});assert.equal(report.problems.length,2);
 const staged=await scanPublic({root,files:['safe.js'],sensitiveValues:['合成敏感名字'],readFile:()=>Buffer.from('合成敏感名字')});assert.equal(staged.problems.length,1);
});
test('干净发布不复制Git历史、私有资料和忽略文件，可用于全新仓库',async t=>{
 const root=directory(t);execFileSync('git',['init','-q'],{cwd:root});fs.writeFileSync(path.join(root,'.gitignore'),'private-data/\n');fs.writeFileSync(path.join(root,'app.js'),'export const ok=true;');fs.mkdirSync(path.join(root,'private-data'));fs.writeFileSync(path.join(root,'private-data','accounts.json'),'private');execFileSync('git',['add','.'],{cwd:root});
 const target=path.join(directory(t),'published');await createPublicRelease({root,target});assert.ok(fs.existsSync(path.join(target,'app.js')));assert.equal(fs.existsSync(path.join(target,'.git')),false);assert.equal(fs.existsSync(path.join(target,'private-data')),false);
});
test('历史检查能发现已在最新版本删除的私有资料',async t=>{
 const root=directory(t),git=args=>execFileSync('git',['-c','user.name=PrivacyTest','-c','user.email=tests@example.invalid',...args],{cwd:root,stdio:'pipe'});
 git(['init','-q']);fs.mkdirSync(path.join(root,'private-data'));fs.writeFileSync(path.join(root,'private-data','accounts.json'),'[]');git(['add','.']);git(['commit','-qm','fixture']);git(['rm','-q','private-data/accounts.json']);git(['commit','-qm','remove fixture']);
 const report=await scanHistory({root});assert.ok(report.problems.some(p=>p.file==='private-data/accounts.json'));
});
