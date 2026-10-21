import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const compiler=process.env.WECHAT_COMPILER_DIR||'C:/Program Files (x86)/Tencent/微信web开发者工具/code/package.nw/node_modules/wcc-exec';
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(dir,x.name)):[path.join(dir,x.name).replaceAll('\\','/')]);}
const source=files('miniprogram'),qa=path.resolve('qa');fs.mkdirSync(qa,{recursive:true});
for(const [tool,ext,out] of [['wcc','.wxml','native-wxml.js'],['wcsc','.wxss','native-wxss.txt']]){
 const executable=path.join(compiler,tool+'.exe');if(!fs.existsSync(executable))throw new Error('未找到微信编译器，请设置WECHAT_COMPILER_DIR');
 const inputs=source.filter(f=>f.endsWith(ext)).map(f=>f.slice('miniprogram/'.length));
 const r=spawnSync(executable,['-o',path.join(qa,out),...inputs],{cwd:'miniprogram',encoding:'utf8',maxBuffer:20e6});
 if(r.status||/error|unexpected|failed/i.test(r.stderr)){console.error(r.stderr||r.stdout);process.exit(1);}console.log(`${tool}编译通过：${inputs.length}个${ext}文件。`);
}
