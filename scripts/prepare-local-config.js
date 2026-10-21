import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
const file='.env';
if(!fs.existsSync(file))fs.copyFileSync('.env.example',file);
let content=fs.readFileSync(file,'utf8'),secret=content.match(/^APP_SECRET=(.*)$/m)?.[1].trim()||'';
if(secret.length<32||secret.includes('demo-secret')||secret.startsWith('请')){
 const line='APP_SECRET='+randomBytes(32).toString('hex');content=/^APP_SECRET=/m.test(content)?content.replace(/^APP_SECRET=.*$/m,line):content+'\n'+line+'\n';fs.writeFileSync(file,content);
}
content=fs.readFileSync(file,'utf8');
for(const [key,value] of [['AUTH_MODE','sms'],['DEMO_MODE','false']]){const pattern=new RegExp('^'+key+'=.*$','m');content=pattern.test(content)?content.replace(pattern,key+'='+value):content+'\n'+key+'='+value+'\n';}
fs.writeFileSync(file,content);
console.log('仅支持短信验证码登录；请确认.env已填写腾讯云短信配置。');
