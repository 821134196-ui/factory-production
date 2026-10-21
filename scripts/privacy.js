import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {backupPrivate,restorePrivate,scanPublic,scanHistory,createPublicRelease} from './private-data-tools.js';

function option(name){const i=process.argv.indexOf(name);if(i<0)return undefined;if(!process.argv[i+1]||process.argv[i+1].startsWith('--'))throw new Error(name+'缺少参数');return process.argv[i+1];}
function localSensitiveValues(){
 const folder=path.resolve(process.env.PRIVATE_DATA_DIR||'private-data'),values=[];
 for(const file of ['accounts.json','staff-roster.json','shipping-customers.json']){
  const name=path.join(folder,file);if(!fs.existsSync(name))continue;const json=JSON.parse(fs.readFileSync(name,'utf8'));
  for(const row of Array.isArray(json)?json:json.customers||[])for(const key of ['name','phone'])if(row[key])values.push(String(row[key]));
 }
 const ruleFile=path.join(folder,'business-rules.json');if(fs.existsSync(ruleFile)){const aliases=JSON.parse(fs.readFileSync(ruleFile,'utf8')).aliases||{};values.push(...Object.keys(aliases),...Object.values(aliases));}
 const catalogFile=path.join(folder,'catalog.json');if(fs.existsSync(catalogFile)){
  const generic=new Set(['预制块','浇注料','装车','卸车','装/卸车']);
  for(const product of JSON.parse(fs.readFileSync(catalogFile,'utf8')))if(product.name?.length>=4&&!generic.has(product.name))values.push(product.name);
 }
 for(const file of ['.env','.env.local','.env.docker'])if(fs.existsSync(file)){
  for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const match=line.match(/^(APP_SECRET|TENCENT_SECRET_ID|TENCENT_SECRET_KEY|SMS_WEBHOOK_TOKEN|TENCENT_SMS_SIGN_NAME|TENCENT_SMS_SDK_APP_ID|TENCENT_SMS_TEMPLATE_ID)=(.*)$/);if(match&&match[2].trim().length>=6)values.push(match[2].trim());}
 }
 return [...new Set(values)];
}
try{
 const command=process.argv[2];let result;
 if(command==='backup')result=await backupPrivate({output:option('--output')});
 else if(command==='restore')result=await restorePrivate({file:option('--from'),target:option('--target')});
 else if(command==='release')result=await createPublicRelease({target:option('--target'),sensitiveValues:localSensitiveValues()});
 else if(command==='check'){
  const staged=process.argv.includes('--staged');
  const files=staged?execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean):undefined;
  result=process.argv.includes('--history')?await scanHistory({sensitiveValues:localSensitiveValues()}):await scanPublic({sensitiveValues:localSensitiveValues(),...(staged?{files,readFile:file=>execFileSync('git',['show',':'+file],{maxBuffer:32*1024*1024})}:{})});
  if(result.problems.length){console.error(JSON.stringify(result,null,2));process.exitCode=1;}
 }else throw new Error('用法：privacy.js backup | restore --from <包> --target <新目录> | check | release [--target <新目录>]');
 console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
