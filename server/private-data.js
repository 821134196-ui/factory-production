import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function privateDirectory(){return path.resolve(process.env.PRIVATE_DATA_DIR||path.join(projectRoot,'private-data'));}
export function privatePath(relative){
 const root=privateDirectory(),file=path.resolve(root,relative);
 if(file===root||!file.startsWith(root+path.sep))throw new Error('私有资料路径必须位于PRIVATE_DATA_DIR中');
 return file;
}
export function readPrivateJson(relative,fallback){
 const file=privatePath(relative);
 if(!fs.existsSync(file)){if(fallback!==undefined)return structuredClone(fallback);throw new Error('缺少本地私有资料：'+relative+'；请先恢复私有数据包。');}
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
export const businessRules=readPrivateJson('business-rules.json',{});
export const initialWagePolicy=businessRules.wagePolicy||{precastMode:'crew',precastRate:0,materialMultiplier:1,supplementsConfirmed:false};
export function exportTemplatePath(file,month){
 const source=month&&privatePath(path.join('source-data',month,file));
 if(source&&fs.existsSync(source))return source;
 const template=privatePath(path.join('templates',file));
 if(!fs.existsSync(template)){const error=new Error('尚未配置本地Excel导出模板，请恢复私有模板资料。');error.status=400;throw error;}
 return template;
}
