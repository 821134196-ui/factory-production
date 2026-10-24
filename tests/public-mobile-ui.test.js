import test from 'node:test';
import assert from 'node:assert/strict';
import {installKeyboardNavigation} from '../web/keyboard-navigation.js';
import {precastDraft,precastKey} from '../web/precast-ui.js';
import {inventoryDateSelection,inventoryDateRange} from '../web/inventory-ui.js';
import {stockFlowDetail} from '../web/stock-flow-ui.js';

function keyboardScreen({touch=true,visual=true,width=360}={}){
 const classes=new Set(),styles=new Map(),timers=new Map();let timerId=0;
 const events=()=>{const handlers=new Map();return{addEventListener(name,fn){const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);},emit(name){for(const fn of handlers.get(name)||[])fn();}};};
 const doc={...events(),activeElement:{tagName:'BODY'},documentElement:{classList:{toggle(name,on){on?classes.add(name):classes.delete(name);}},style:{setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)}}};
 const view={...events(),height:800,scale:1};
 const win={...events(),innerWidth:width,innerHeight:800,visualViewport:visual?view:null,matchMedia:()=>({matches:touch}),setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);}};
 const sync=installKeyboardNavigation(win,doc);
 return{doc,win,view,sync,styles,open:()=>classes.has('keyboard-open'),focus(type='number'){doc.activeElement={tagName:'INPUT',type};doc.emit('focusin');},blur(){doc.activeElement={tagName:'BODY'};doc.emit('focusout');},timers(){const batch=[...timers.values()];timers.clear();for(const fn of batch)fn();},resize(height){view.height=height;if(!visual)win.innerHeight=height;(visual?view:win).emit('resize');}};
}

test('手机键盘弹出隐藏导航，使用可见高度；直接收起键盘但输入框仍聚焦时恢复导航',()=>{
 const s=keyboardScreen();s.focus();assert.equal(s.open(),true);s.resize(490);s.timers();assert.equal(s.open(),true);assert.equal(s.styles.get('--app-viewport-height'),'490px');
 s.resize(800);assert.equal(s.doc.activeElement.tagName,'INPUT');assert.equal(s.open(),false);assert.equal(s.styles.has('--app-viewport-height'),false);
});

test('手机失焦关闭键盘时不提前露出导航；无可见视口API也能处理键盘改变窗口高度',()=>{
 for(const visual of [true,false]){const s=keyboardScreen({visual});s.focus('text');s.resize(470);s.timers();s.blur();s.timers();assert.equal(s.open(),true);s.resize(800);assert.equal(s.open(),false);}
});

test('复选框、硬件键盘、缩放及横屏切换不会留下隐藏的导航',()=>{
 const mobile=keyboardScreen();mobile.focus('checkbox');assert.equal(mobile.open(),false);mobile.focus();mobile.timers();assert.equal(mobile.open(),false);
 mobile.view.scale=2;mobile.view.height=400;mobile.view.emit('resize');assert.equal(mobile.open(),false);
 mobile.view.scale=1;mobile.win.innerWidth=800;mobile.win.innerHeight=360;mobile.resize(360);assert.equal(mobile.open(),false);
 const desktop=keyboardScreen({touch:false,width:1200});desktop.focus();desktop.resize(480);desktop.timers();assert.equal(desktop.open(),false);
 const tablet=keyboardScreen({width:1024});tablet.focus();tablet.resize(480);tablet.timers();assert.equal(tablet.open(),true);tablet.resize(800);assert.equal(tablet.open(),false);
});

test('预制块新草稿及旧空草稿默认本人，明确取消与正在填写的人员名单会保留',()=>{
 const saved=globalThis.localStorage,store=new Map();globalThis.localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)};
 try{
  const state={user:{id:'leader',groupId:'g1'},boot:{today:'2026-10-24',fillDates:['2026-10-24'],workers:[{id:'leader'},{id:'worker'}],groups:[{id:'g1'}]}};
  assert.deepEqual(precastDraft(state).memberIds,['leader']);store.set(precastKey(state),JSON.stringify({memberIds:[],products:[{productId:'',quantity:''}]}));assert.deepEqual(precastDraft(state).memberIds,['leader']);
  store.set(precastKey(state),JSON.stringify({peopleDefaultVersion:1,memberIds:[]}));assert.deepEqual(precastDraft(state).memberIds,[]);
  store.set(precastKey(state),JSON.stringify({memberIds:['worker']}));assert.deepEqual(precastDraft(state).memberIds,['worker']);
 }finally{if(saved===undefined)delete globalThis.localStorage;else globalThis.localStorage=saved;}
});

test('库存本月范围在日期选择中完整显示，并能切回相同截止日期的单日查询',()=>{
 const period=inventoryDateSelection('2026-10-24','2026-10-01','2026-10-24');
 assert.equal(period.items.find(item=>item.id===period.value).name,'10-01 至 10-24');
 assert.deepEqual(inventoryDateRange(period.value),{from:'2026-10-01',to:'2026-10-24'});
 const today=period.items.find(item=>item.id==='2026-10-24');assert.equal(today.name,'10-24 今天');
 assert.deepEqual(inventoryDateRange(today.id),{from:'2026-10-24',to:'2026-10-24'});
 const day=inventoryDateSelection('2026-10-24','2026-10-23','2026-10-23');assert.equal(day.value,'2026-10-23');assert.equal(day.items.find(item=>item.id===day.value).name,'10-23 昨天');
});

test('库存流水按最近日期分组优先展示，保持原流水结存和同日顺序',()=>{
 const flows=[{date:'2026-10-21',kind:'production',quantity:5,balance:105},{date:'2026-10-23',kind:'shipment',quantity:1,balance:104,customer:'另一测试客户'},{date:'2026-10-24',kind:'production',quantity:8,balance:112},{date:'2026-10-24',kind:'shipment',quantity:3,balance:109,customer:'测试客户'}];
 const original=structuredClone(flows),html=stockFlowDetail({product:{name:'测试材料',unit:'吨'},from:'2026-10-21',to:'2026-10-24',opening:100,produced:13,shipped:4,balance:109,flows},{esc:s=>String(s??''),num:n=>String(n)});
 assert.ok(html.indexOf('<h4>2026-10-24</h4>')<html.indexOf('<h4>2026-10-23</h4>'));
 assert.ok(html.indexOf('<h4>2026-10-23</h4>')<html.indexOf('<h4>2026-10-21</h4>'));
 const latest=html.slice(html.indexOf('<h4>2026-10-24</h4>'),html.indexOf('<h4>2026-10-23</h4>'));
 assert.ok(latest.indexOf('结存</span><b>112 吨')<latest.indexOf('结存</span><b>109 吨'));
 assert.deepEqual(flows,original);
});
