import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function screen(file,{component=false}={}){
 const calls=[],messages=[];let definition;
 const api={query:q=>new URLSearchParams(q).toString(),request:url=>new Promise(resolve=>calls.push({url,resolve}))};
 const ui={can:()=>true,number:String,toast:message=>messages.push(message)};
 vm.runInNewContext(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{
  [component?'Component':'Page']:value=>definition=value,
  require:name=>name.endsWith('/api')?api:name.endsWith('/screen')?ui:name.endsWith('/report-periods')?{reportDateOptions:()=>[]}:{}
 });
 const page={...(definition.methods||definition),data:structuredClone(definition.data),properties:{today:'2026-10-24',user:{id:'admin',role:'admin'},groups:[]},setData(values){Object.assign(this.data,values);}};
 return {page,calls,messages};
}

test('管理员进入自定义默认查询本月至今，旧日期和旧响应不会遮住本月数据',async()=>{
 const {page,calls}=screen('../miniprogram/components/admin-reports/index.js',{component:true});
 Object.assign(page.data,{from:'2026-10-23',to:'2026-10-23'});
 const first=page.load();assert.equal(page.data.busy,true);
 const latest=page.period({currentTarget:{dataset:{value:'custom'}}});
 assert.equal(page.data.period,'custom');assert.equal(page.data.from,'2026-10-01');assert.equal(calls.length,2);
 assert.ok(calls[1].url.includes('period=custom'));assert.ok(calls[1].url.includes('from=2026-10-01'));
 calls[1].resolve({period:'custom',date:'2026-10-24',from:'2026-10-01',to:'2026-10-24',production:{units:[{unit:'吨',quantity:5}],weightTonnes:5,recordCount:1,workers:[],products:[{id:'test',name:'测试物料',units:[{unit:'吨',quantity:5}]}],daily:[]},wages:null});await latest;
 calls[0].resolve({period:'day',date:'2026-10-24',from:'2026-10-24',to:'2026-10-24',production:null,wages:null});await first;
 assert.equal(page.data.report.period,'custom');assert.equal(page.data.report.from,'2026-10-01');assert.equal(page.data.busy,false);
 assert.equal(page.data.report.production.quantityText,'5 吨');assert.equal(page.data.report.production.products[0].quantityText,'5 吨');
 const changed=page.range({currentTarget:{dataset:{key:'from'}},detail:{value:'2026-10-23'}});
 assert.equal(calls.length,3);assert.ok(calls[2].url.includes('from=2026-10-23'));
 calls[2].resolve({period:'custom',date:'2026-10-24',from:'2026-10-23',to:'2026-10-24',production:null,wages:null});await changed;
 assert.equal(page.data.report.from,'2026-10-23');assert.equal(page.data.busy,false);
});

test('员工自定义日期变更自动查询，产量工资一起更新，连续改日期保留最后一次结果',async()=>{
 const {page,calls,messages}=screen('../miniprogram/pages/home/index.js');
 page.boot={user:{id:'worker',role:'worker'},today:'2026-10-24'};
 Object.assign(page.data,{workerPeriod:'custom',customFrom:'2026-10-01',customTo:'2026-10-24',busy:true});
 const first=page.customDate({currentTarget:{dataset:{key:'customFrom'}},detail:{value:'2026-10-23'}});
 const latest=page.customDate({currentTarget:{dataset:{key:'customTo'}},detail:{value:'2026-10-23'}});
 assert.equal(calls.length,4);assert.ok(calls[2].url.includes('to=2026-10-23'));assert.ok(calls[3].url.includes('to=2026-10-23'));
 calls[2].resolve({from:'2026-10-23',to:'2026-10-23',metrics:[],people:[]});calls[3].resolve({total:12});await latest;
 calls[0].resolve({from:'2026-10-23',to:'2026-10-24',metrics:[],people:[]});calls[1].resolve({total:30});await first;
 assert.equal(page.data.overview.to,'2026-10-23');assert.equal(page.data.wages.total,12);assert.equal(page.data.busy,false);
 await page.customDate({currentTarget:{dataset:{key:'customFrom'}},detail:{value:'2026-10-24'}});
 assert.equal(calls.length,4);assert.equal(messages.length,1);
});
