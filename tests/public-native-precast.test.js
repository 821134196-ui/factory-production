import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('原生预制块页先选多种产品再选多人，折叠保留选择并记住上次人员，提交共同产量而非逐人重复',async()=>{
 const storage=new Map(),requests=[];let definition;
 const screen={number:String,weight:(p,q)=>q===''?'—':Number(q)*p.weightKg/1000+' 吨',toast:()=>{},confirm:async()=>true,run:async(page,fn)=>fn()};
 vm.runInNewContext(fs.readFileSync(new URL('../miniprogram/pages/report/index.js',import.meta.url),'utf8'),{
  Page:value=>definition=value,require:name=>name.includes('/api')?{request:async(...args)=>requests.push(args)}:name.includes('date-options')?()=>[]:screen,
  wx:{getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,structuredClone(value)),removeStorageSync:key=>storage.delete(key)}
 });
 const page={...definition,data:structuredClone(definition.data),setData(values){for(const [path,value] of Object.entries(values)){const parts=path.replace(/\[(\d+)\]/g,'.$1').split('.');let current=this.data;for(const key of parts.slice(0,-1))current=current[key];current[parts.at(-1)]=value;}}};
 page.boot={today:'2026-10-24',user:{id:'leader',groupId:'g1',isLeader:true},groups:[{id:'g1',name:'一班（测试组长）'}],workers:[{id:'leader',name:'测试组长'},{id:'worker',name:'测试员工'},...Array.from({length:6},(_,i)=>({id:'extra-'+i,name:'测试人员'+i}))],products:[{id:'p1',category:'预制块',groupId:'g1',active:true,name:'测试甲',fullName:'测试甲 · 型号甲',weightKg:50,unit:'块'},{id:'p2',category:'预制块',groupId:'g1',active:true,name:'测试乙',fullName:'测试乙 · 型号乙',weightKg:100,unit:'块'}]};
 page.data.category='预制块';page.data.batch=true;storage.set('draft-leader-预制块-crew',{groupId:'old-group'});page.loadDraft();
 assert.equal(page.data.crewProducts.length,1);assert.equal(page.data.crewWorkers.length,8);assert.equal(page.data.crewWorkers.filter(w=>w.visible).length,6);assert.equal(page.data.form.groupId,'g1');assert.equal(page.data.crewHeadcount,1);assert.equal(page.data.crewWorkers.find(w=>w.id==='leader').checked,true);page.crewMembers({detail:{value:[]}});page.loadDraft();assert.equal(page.data.crewHeadcount,0);
 page.crewProduct({currentTarget:{dataset:{index:0}},detail:{value:'p1'}});page.crewQuantity({currentTarget:{dataset:{index:0}},detail:{value:'10'}});page.crewAdd();page.crewProduct({currentTarget:{dataset:{index:1}},detail:{value:'p2'}});page.crewQuantity({currentTarget:{dataset:{index:1}},detail:{value:'5'}});
 page.crewToggle();page.crewMembers({detail:{value:['leader','extra-5']}});page.crewToggle();assert.equal(page.data.crewHeadcount,2);assert.equal(page.data.crewWorkers.find(w=>w.id==='extra-5').checked,true);assert.equal(page.data.crewWorkers.find(w=>w.id==='extra-5').visible,false);page.crewMembers({detail:{value:['leader']}});assert.equal(page.data.crewHeadcount,2);
 assert.equal(page.data.crewProducts[0].weight,'0.5 吨');assert.equal(page.data.crewProducts[1].weight,'0.5 吨');await page.submit();
 assert.equal(requests.length,1);assert.equal(requests[0][0],'/records/precast');assert.equal(requests[0][2].products.length,2);assert.equal(requests[0][2].memberIds.length,2);assert.equal(requests[0][2].products.reduce((n,p)=>n+p.quantity,0),15);assert.equal(page.data.crewProducts.length,1);assert.deepEqual(Array.from(page.data.crewMemberIds),['leader']);assert.equal(page.data.form.date,page.boot.today);assert.deepEqual(Array.from(page.data.crewWorkers.slice(0,2),w=>w.id),['extra-5','leader']);assert.equal(page.data.crewWorkers.filter(w=>w.visible).length,6);
});
