import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeFixtures,phones} from '../tests/fixtures.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'factory-compose-test-'));
const project='factory-smoke-'+randomUUID().slice(0,8);
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const privateFolder=path.join(directory,'private-data');await writeFixtures(privateFolder,{templates:true});
const env={...process.env,PRIVATE_DATA_HOST_DIR:privateFolder,APP_ENV_FILE:path.join(directory,'not-configured.env'),WEB_BIND:'127.0.0.1',WEB_PORT:String(port)};
const empty=path.join(directory,'empty.env');fs.writeFileSync(empty,'');
// Only this isolated test mounts an SMS provider stub. The production image has no test gateway.
const mockFile=path.join(directory,'sms-provider.mjs');
fs.writeFileSync(mockFile,`import sdk from 'tencentcloud-sdk-nodejs-sms';
import fs from 'node:fs';
sdk.sms.v20210111.Client.prototype.SendSms=async input=>{
 const file='/app/data/test-sms-outbox.json',outbox=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 outbox[input.PhoneNumberSet[0].replace(/^\\+86/,'')]=input.TemplateParamSet[0];
 fs.writeFileSync(file,JSON.stringify(outbox));
 return {SendStatusSet:[{Code:'Ok'}]};
};
`);
const override=path.join(directory,'sms-test.json');
fs.writeFileSync(override,JSON.stringify({services:{app:{environment:{
 ADMIN_PHONE:phones.admin,OFFICIAL_ROSTER:'true',IMPORT_BUNDLED_DATA:'false',
 SMS_PROVIDER:'tencent',TENCENT_SECRET_ID:'isolated-test-id',TENCENT_SECRET_KEY:'isolated-test-key',
 TENCENT_SMS_SDK_APP_ID:'1400000000',TENCENT_SMS_SIGN_NAME:'SMS test',TENCENT_SMS_TEMPLATE_ID:'100000',
 NODE_OPTIONS:'--import=/app/test-sms-provider.mjs'
},volumes:[{type:'bind',source:mockFile,target:'/app/test-sms-provider.mjs',read_only:true}]}}}));
const base=['compose','--env-file',empty,'-p',project,'-f',path.join(root,'compose.yaml'),'-f',override];
function compose(args,capture=false){return new Promise((resolve,reject)=>{
 const child=spawn('docker',[...base,...args],{cwd:root,env,stdio:capture?['ignore','pipe','inherit']:'inherit'});
 let output='';if(capture)child.stdout.on('data',chunk=>output+=chunk);
 child.once('error',reject);child.once('exit',code=>code===0?resolve(output):reject(new Error('docker compose '+args[0]+' failed: '+code)));
});}
async function request(route,token,body){
 const response=await fetch('http://127.0.0.1:'+port+'/api'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 assert.equal(response.ok,true,route+' returned '+response.status);
 return response.headers.get('content-type')?.includes('application/json')?response.json():Buffer.from(await response.arrayBuffer());
}
async function login(phone){
 assert.deepEqual(await request('/auth/code',null,{phone}),{sent:true});
 const code=(await compose(['exec','-T','app','node','--input-type=module','-e',`import fs from 'node:fs';process.stdout.write(JSON.parse(fs.readFileSync('/app/data/test-sms-outbox.json','utf8'))[${JSON.stringify(phone)}]);`],true)).trim();
 assert.match(code,/^[1-9]\d{5}$/);return request('/auth/login',null,{phone,code});
}
try{
 await compose(['config','--quiet']);
 await compose(['up','-d','--build','--wait','--wait-timeout','120']);
 const health=await fetch('http://127.0.0.1:'+port+'/healthz');assert.deepEqual(await health.json(),{ok:true});
 const config=await request('/config');assert.equal(config.authMode,'sms');assert.equal(config.demoMode,false);assert.deepEqual(config.demoAccounts,[]);
 const admin=await login(phones.admin),leader=await login(phones.leader);assert.equal(admin.user.isSuperAdmin,true);assert.equal(leader.user.isLeader,true);
 const boot=await request('/bootstrap',leader.token);
 const baseline=(await request('/records?'+new URLSearchParams({from:boot.today,to:boot.today}),admin.token)).records;
 const product=boot.products.find(p=>p.active&&p.category==='预制块'&&p.groupId==='g1'&&!baseline.some(r=>r.product.id===p.id));assert.ok(product);
 const submitted=await request('/records/leader',leader.token,{date:boot.today,groupId:'g1',requestId:randomUUID(),entries:[{workerId:leader.user.id,productId:product.id,quantity:3}]});assert.equal(submitted.records.length,1);
 for(const category of ['预制块','浇注料']){
  const workbook=await request('/export-template?'+new URLSearchParams({category,month:boot.today.slice(0,7)}),admin.token);
  assert.equal(workbook.subarray(0,2).toString(),'PK');assert.ok(workbook.length>1000);
 }
 await compose(['exec','-T','app','node','scripts/backup.js','--output','/app/backups/smoke.sqlite']);
 await compose(['up','-d','--force-recreate','--wait','--wait-timeout','120']);
 const again=await request('/bootstrap',admin.token);assert.equal(again.user.id,admin.user.id);
 const records=(await request('/records?'+new URLSearchParams({from:boot.today,to:boot.today}),admin.token)).records;
 assert.equal(records.length,baseline.length+1);assert.equal(records.find(r=>r.id===submitted.records[0].id)?.quantity,3);for(const r of baseline)assert.ok(records.some(current=>current.id===r.id));
 await compose(['exec','-T','app','node','--input-type=module','-e',"import fs from 'node:fs';import assert from 'node:assert/strict';assert.ok(fs.existsSync('/app/backups/smoke.sqlite'));assert.match(fs.readFileSync('/app/data/.app-secret','utf8').trim(),/^[a-f0-9]{64}$/);for(const file of ['/app/.env','/app/.git','/app/server/accounts.json','/app/server/catalog.json','/app/server/templates','/app/server/source-data'])assert.ok(!fs.existsSync(file),file);console.log('Persistent data, backup, secret and image isolation verified');"]);
 console.log('Docker smoke passed: fresh boot, login, production, both Excel exports, backup and container recreation.');
}catch(error){await compose(['logs','--tail','80','app']).catch(()=>{});throw error;}
finally{
 // This project name and its volumes are created exclusively for this test.
 await compose(['down','-v','--remove-orphans']).finally(()=>{
  assert.ok(directory.startsWith(path.join(os.tmpdir(),'factory-compose-test-')));fs.rmSync(directory,{recursive:true,force:true});
 });
}
