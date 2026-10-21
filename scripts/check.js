import {readPrivateJson} from '../server/private-data.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=path.resolve('.');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(dir,x.name)):[path.join(dir,x.name)]);}
let count=0;
for(const base of ['server','web','miniprogram','tests','scripts'])for(const file of files(path.join(root,base))){if(file.endsWith('.js')){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status){console.error(r.stderr);process.exit(1);}count++;}if(file.endsWith('.json'))JSON.parse(fs.readFileSync(file,'utf8'));}
const config=JSON.parse(fs.readFileSync('miniprogram/app.json','utf8'));
for(const page of config.pages)for(const ext of ['.js','.wxml'])if(!fs.existsSync('miniprogram/'+page+ext))throw new Error('缺少页面'+page+ext);
for(const p of readPrivateJson('catalog.json',[]))if(!p.id||!p.name||(p.active&&!p.unit))throw new Error('产品目录不完整');
console.log(`检查通过：${count}个JS文件、JSON配置、全部小程序页面和产品目录。`);
