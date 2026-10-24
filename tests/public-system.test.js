import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {writeFixtures,phones} from './fixtures.js';

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'factory-public-'));
await writeFixtures(folder,{templates:true});process.env.PRIVATE_DATA_DIR=folder;
const {createApp}=await import('../server/app.js'),{configFromEnv}=await import('../server/config.js'),{today}=await import('../server/db.js');
after(()=>{fs.rmSync(folder,{recursive:true,force:true});});
function config(){return {...configFromEnv({AUTH_MODE:'sms',APP_SECRET:'synthetic-test-secret-'.repeat(3),ADMIN_PHONE:phones.admin,OFFICIAL_ROSTER:'true',SMS_PROVIDER:'webhook',SMS_WEBHOOK_URL:'https://sms.example.invalid/send'}),dbPath:':memory:'};}
async function fixture(t,{failSend=false,universalLoginCode=''}={}){
 const outbox=new Map(),f=createApp({...config(),universalLoginCode},{sendSms:async(phone,code)=>{if(failSend)throw new Error('test provider failure');outbox.set(phone,code);}});
 const server=f.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.db.close();});
 const base='http://127.0.0.1:'+server.address().port;
 const req=async(route,token,method='GET',body)=>{
  const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};
 };
 const login=async phone=>{assert.equal((await req('/api/auth/code',null,'POST',{phone})).status,200);const r=await req('/api/auth/login',null,'POST',{phone,code:outbox.get(phone)});assert.equal(r.status,200);return r.data;};
 const person=phone=>f.db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
 return {...f,req,login,outbox,person};
}
test('仅短信登录，随机验证码单次使用，无公开账号或私有文件',async t=>{
 const f=await fixture(t),config=(await f.req('/api/config')).data;assert.equal(config.authMode,'sms');assert.equal(config.demoMode,false);assert.deepEqual(config.demoAccounts,[]);
 assert.equal((await f.req('/api/records')).status,401);
 assert.equal((await f.req('/api/auth/code',null,'POST',{phone:phones.worker})).status,200);
 const code=f.outbox.get(phones.worker);assert.match(code,/^[1-9]\d{5}$/);
 const wrong=code==='123456'?'654321':'123456';assert.equal((await f.req('/api/auth/login',null,'POST',{phone:phones.worker,code:wrong})).status,400);
 assert.equal((await f.req('/api/auth/login',null,'POST',{phone:phones.worker,code})).status,200);
 assert.equal((await f.req('/api/auth/login',null,'POST',{phone:phones.worker,code})).status,400);
 for(const route of ['/.env','/private-data/accounts.json','/server/accounts.json','/data/production.sqlite'])assert.equal((await f.req(route)).status,404);
 assert.throws(()=>configFromEnv({AUTH_MODE:'fixed'}),/仅支持短信/);
});
test('短信发送失败不产生可用验证码',async t=>{
 const f=await fixture(t,{failSend:true});assert.equal((await f.req('/api/auth/code',null,'POST',{phone:phones.worker})).status,502);assert.equal(f.db.prepare('SELECT count(*) n FROM codes').get().n,0);
});
test('固定验证码仅在配置后生效，允许启用账号登录并保留短信登录',async t=>{
 const disabled=await fixture(t);
 assert.equal((await disabled.req('/api/auth/login',null,'POST',{phone:phones.worker,code:'666888'})).status,400);
 const f=await fixture(t,{universalLoginCode:'666888'});
 for(const phone of [phones.admin,phones.leader,phones.worker]){
  const r=await f.req('/api/auth/login',null,'POST',{phone,code:'666888'});
  assert.equal(r.status,200);assert.equal(r.data.user.id,f.person(phone).id);
  assert.equal((await f.req('/api/bootstrap',r.data.token)).status,200);
 }
 assert.equal(f.outbox.size,0);
 assert.equal((await f.req('/api/auth/login',null,'POST',{phone:phones.worker,code:'666889'})).status,400);
 assert.equal((await f.req('/api/auth/login',null,'POST',{phone:'10000009999',code:'666888'})).status,403);
 f.db.prepare('UPDATE users SET active=0 WHERE phone=?').run(phones.other);
 assert.equal((await f.req('/api/auth/login',null,'POST',{phone:phones.other,code:'666888'})).status,403);
 await f.login(phones.worker);
 assert.throws(()=>configFromEnv({UNIVERSAL_LOGIN_CODE:'123'}),/6位数字/);
});
test('组长批量填写、同人同日同料覆盖、本人可见范围和实时工资',async t=>{
 const f=await fixture(t),leader=await f.login(phones.leader),worker=await f.login(phones.worker),other=await f.login(phones.other);
 const submit=quantity=>f.req('/api/records/leader',leader.token,'POST',{date:today(),groupId:'g4',requestId:randomUUID(),entries:[{workerId:worker.user.id,productId:'material-3',quantity}]});
 const first=await submit(2);assert.equal(first.status,201);const second=await submit(3);assert.equal(second.status,201);
 const records=(await f.req('/api/records',worker.token)).data.records;assert.equal(records.filter(r=>r.counted).length,1);assert.equal(records.find(r=>r.counted).quantity,3);
 assert.equal((await f.req('/api/records',other.token)).data.records.length,0);
 assert.equal((await f.req('/api/wages',worker.token)).data.total,36);
 const own=(await f.req('/api/production-overview',worker.token)).data;assert.ok(own.metrics.some(m=>m.name==='浇注料'&&m.quantity===3));
 assert.equal((await f.req('/api/records/leader',worker.token,'POST',{date:today(),entries:[]})).status,403);
});

test('管理员自定义日期：产量、产品/人员/每日下钻和工资使用相同范围',async t=>{
 const f=await fixture(t),admin=await f.login(phones.admin),leader=await f.login(phones.leader),worker=await f.login(phones.worker);
 const ago=n=>{const d=new Date(today()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10);};
 for(const [days,quantity] of [[0,2],[1,3],[2,7]])assert.equal((await f.req('/api/records/leader',leader.token,'POST',{date:ago(days),groupId:'g4',requestId:randomUUID(),entries:[{workerId:worker.user.id,productId:'material-3',quantity}]})).status,201);
 const range={period:'custom',from:ago(1),to:today(),category:'浇注料'},query=new URLSearchParams(range);
 const report=await f.req('/api/admin/reports?'+query,admin.token);assert.equal(report.status,200);
 assert.equal(report.data.period,'custom');assert.equal(report.data.production.quantity,5);assert.equal(report.data.wages.total,60);
 assert.deepEqual(report.data.production.daily.map(d=>d.date),[ago(1),today()]);
 for(const [kind,id,expected] of [['product','material-3',5],['worker',worker.user.id,5],['day',ago(1),3]]){
  const detail=await f.req('/api/admin/reports/detail?'+new URLSearchParams({...range,kind,id}),admin.token);
  assert.equal(detail.status,200);assert.equal(detail.data.quantity,expected);assert.ok(detail.data.records.every(r=>r.date>=range.from&&r.date<=range.to));
 }
 const wages=await f.req('/api/admin/reports/detail?'+new URLSearchParams({...range,kind:'wage-worker',id:worker.user.id}),admin.token);
 assert.equal(wages.status,200);assert.equal(wages.data.wages.total,60);
 assert.equal((await f.req('/api/admin/reports?'+query,worker.token)).status,403);
 for(const invalid of [{from:today(),to:ago(1)},{to:ago(-1)},{from:ago(367)}])assert.equal((await f.req('/api/admin/reports?'+new URLSearchParams({...range,...invalid}),admin.token)).status,400);
 assert.equal((await f.req('/api/admin/reports/detail?'+new URLSearchParams({...range,kind:'day',id:ago(2)}),admin.token)).status,400);
});
test('预制块折重、班组均分、发货库存明细及两个Excel导出',async t=>{
 const f=await fixture(t),admin=await f.login(phones.admin),leader=await f.login(phones.leader),worker=await f.login(phones.worker);
 const r=await f.req('/api/records/leader',leader.token,'POST',{date:today(),groupId:'g1',requestId:randomUUID(),entries:[{workerId:worker.user.id,productId:'test-precast',quantity:4},{workerId:leader.user.id,productId:'test-precast',quantity:2}]});assert.equal(r.status,201);
 const wages=(await f.req('/api/wages',worker.token)).data;assert.equal(wages.total,3);
 const root=f.person(phones.admin);f.inventory.setOpening(root,{productId:'test-precast',startDate:today(),quantity:10,version:0});
 const shipment=f.inventory.saveShipment(f.person(phones.leader),{date:today(),customer:'测试客户',requestId:randomUUID(),entries:[{productId:'test-precast',quantity:3}]});assert.ok(shipment.id);
 const stock=f.inventory.summary(root,{from:today(),to:today()}).rows.find(r=>r.product.id==='test-precast');assert.equal(stock.balance,13);
 const flow=f.inventory.movements(root,'test-precast',{from:today(),to:today()});assert.ok(flow);
 for(const category of ['预制块','浇注料']){const output=await f.req('/api/export-template?'+new URLSearchParams({category,month:today().slice(0,7)}),admin.token);assert.equal(output.status,200);assert.equal(output.data.subarray(0,2).toString(),'PK');}
});
test('没有私有数据也能初始化空系统，缺少模板明确提示',async t=>{
 const before=process.env.PRIVATE_DATA_DIR;process.env.PRIVATE_DATA_DIR=path.join(folder,'empty');
 let f;try{f=createApp(config(),{sendSms:async()=>{}});assert.equal(f.db.prepare('SELECT count(*) n FROM products').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM records').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,1);}finally{f?.db.close();process.env.PRIVATE_DATA_DIR=before;}
 const {exportTemplatePath}=await import('../server/private-data.js');assert.throws(()=>exportTemplatePath('missing.xlsx'),/尚未配置本地/);
});

test('预制块多产品多人录入：班组合计不重复，实时均分工资、库存和个人参与量一致',async t=>{
 const f=await fixture(t),admin=await f.login(phones.admin),leader=await f.login(phones.leader),worker=await f.login(phones.worker),other=await f.login(phones.other);
 f.db.prepare("INSERT INTO products (id,name,spec,category,unit,precision,weight_kg,group_id) VALUES ('test-precast-2','测试预制块乙','100公斤/块','预制块','块',0,100,'g1')").run();
 const input={date:today(),groupId:'g1',requestId:randomUUID(),memberIds:[leader.user.id,worker.user.id],products:[{productId:'test-precast',quantity:10},{productId:'test-precast-2',quantity:5}]};
 const result=await f.req('/api/records/precast',leader.token,'POST',input);assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.records.length,2);assert.ok(result.data.records.every(r=>r.members.length===2));
 const again=await f.req('/api/records/precast',leader.token,'POST',{...input,memberIds:input.memberIds.slice().reverse(),products:input.products.slice().reverse()});assert.equal(again.status,201);assert.deepEqual(again.data.records.map(r=>r.id).sort(),result.data.records.map(r=>r.id).sort());
 assert.equal((await f.req('/api/records/precast',leader.token,'POST',{...input,products:[{productId:'test-precast',quantity:20}]})).status,409);
 assert.equal((await f.req('/api/wages',worker.token)).data.total,10);assert.equal((await f.req('/api/wages',leader.token)).data.total,10);assert.equal((await f.req('/api/wages',admin.token)).data.total,20);
 const root=f.person(phones.admin);f.inventory.setOpening(root,{productId:'test-precast',startDate:today(),quantity:20,version:0});
 const stock=f.inventory.summary(root,{from:today(),to:today()}).rows.find(r=>r.product.id==='test-precast');assert.equal(stock.produced,10);assert.equal(stock.balance,30);
 const own=(await f.req('/api/production-overview',worker.token)).data.metrics.find(m=>m.name==='预制块');assert.equal(own.quantity,0);assert.equal(own.referenceQuantity,15);assert.equal(own.referenceWeightKg,1000);assert.ok(own.items.every(i=>i.isGroupTotal));
 assert.equal((await f.req('/api/records',other.token)).data.records.length,0);
 assert.ok((await f.req('/api/records',worker.token)).data.records.every(r=>!r.canDelete));
 assert.equal((await f.req('/api/records/'+result.data.records[0].id,worker.token,'DELETE',{version:1})).status,403);
 const flows=f.inventory.movements(root,'test-precast',{from:today(),to:today()});assert.equal(flows.flows[0].records.length,1);assert.equal(flows.flows[0].records[0].members.length,2);
 // Replacing one product does not erase other products submitted alongside it.
 const next=await f.req('/api/records/precast',leader.token,'POST',{...input,requestId:randomUUID(),memberIds:[worker.user.id],products:[{productId:'test-precast',quantity:6}]});assert.equal(next.status,201);
 assert.equal(f.inventory.summary(root,{from:today(),to:today()}).rows.find(r=>r.product.id==='test-precast').produced,6);
 const all=(await f.req('/api/records',admin.token)).data.records;assert.equal(all.filter(r=>r.counted).length,2);assert.equal(all.find(r=>r.id===result.data.records[0].id).counted,false);
 assert.equal((await f.req('/api/wages',admin.token)).data.total,16);
 assert.equal((await f.req('/api/production-overview',leader.token)).data.metrics.find(m=>m.name==='预制块').referenceQuantity,5);
 assert.equal((await f.req('/api/records/leader',leader.token,'POST',{date:today(),groupId:'g1',requestId:randomUUID(),entries:[{workerId:worker.user.id,productId:'test-precast',quantity:9}]})).status,409);
 await f.req('/api/records/'+next.data.records[0].id,leader.token,'DELETE',{version:1});assert.equal(f.inventory.summary(root,{from:today(),to:today()}).rows.find(r=>r.product.id==='test-precast').produced,10);
});

test('预制块整单校验与回滚，跨班组代填、历史保护和旧逐人记录兼容',async t=>{
 const f=await fixture(t),leader=await f.login(phones.leader),worker=await f.login(phones.worker),other=await f.login(phones.other),admin=await f.login(phones.admin);
 const input={date:today(),groupId:'g1',requestId:randomUUID(),memberIds:[worker.user.id,other.user.id],products:[{productId:'test-precast',quantity:10}]},post=(body,token=leader.token)=>f.req('/api/records/precast',token,'POST',body);
 assert.equal((await post(input,worker.token)).status,403);
 for(const data of [{memberIds:[]},{memberIds:[worker.user.id,worker.user.id]},{products:[...input.products,...input.products]},{groupId:'g4'},{products:[{productId:'test-precast',quantity:1.5}]},{memberIds:['missing']},{products:[{productId:'material-3',quantity:2}]}])assert.equal((await post({...input,...data})).status,400);
 assert.equal(f.db.prepare('SELECT count(*) n FROM records').get().n,0);
 const mixed=await post({...input,products:[...input.products,{productId:'missing',quantity:2}]});assert.equal(mixed.status,400);assert.equal(f.db.prepare('SELECT count(*) n FROM records').get().n,0);
 const old=await f.req('/api/records/leader',leader.token,'POST',{date:today(),groupId:'g1',requestId:randomUUID(),entries:[{workerId:worker.user.id,productId:'test-precast',quantity:3}]});assert.equal(old.status,201);
 const next=await post(input);assert.equal(next.status,201);const rows=(await f.req('/api/records',admin.token)).data.records;assert.equal(rows.find(r=>r.id===old.data.records[0].id).counted,false);assert.equal(rows.filter(r=>r.counted).reduce((n,r)=>n+r.quantity,0),10);
 const detail=await f.req('/api/production-overview?workerId='+other.user.id,leader.token);assert.equal(detail.status,200);assert.ok(detail.data.people.some(w=>w.id===other.user.id));
 await f.req('/api/records/'+next.data.records[0].id,admin.token,'PATCH',{action:'correct',version:1,quantity:12,memberIds:[leader.user.id,other.user.id],reason:'测试调整参与人员'});
 assert.equal((await f.req('/api/wages',worker.token)).data.total,0);assert.equal((await f.req('/api/wages',other.token)).data.total,6);
 await f.req('/api/records/'+next.data.records[0].id,admin.token,'PATCH',{action:'reject',version:2,reason:'测试恢复旧记录'});assert.equal((await f.req('/api/wages',worker.token)).data.total,3);
 f.db.prepare("UPDATE records SET source_ref='synthetic-history',mode='historical-group' WHERE id=?").run(old.data.records[0].id);
 assert.equal((await post({...input,requestId:randomUUID()})).status,409);
});
