import {privatePath,readPrivateJson} from './private-data.js';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {transaction,now,today} from './db.js';
import {date,quantity,fail} from './service.js';
import {isSuper} from './permissions.js';

export const openingImportKey='opening_stock_2026_10_v1';
export function readOpeningSnapshot(){return JSON.parse(fs.readFileSync(privatePath('opening-stock-2026-10.json'),'utf8'));}

// 只结转余额，9月生产和发货不重复入账；按原表项目编号保留同名产品。
export function planOpeningImport(inventory,user,snapshot){
 if(!isSuper(user))fail(403,'只有总管理员可以导入9月期初库存');
 if(snapshot?.month!=='2026-09'||date(snapshot.startDate)!=='2026-10-01'||snapshot.startDate>today())fail(400,'期初来源必须为2026年9月底账面库存，起算日为10月1日');
 const catalog=readPrivateJson('catalog.json',[]);
 const expected=new Map(catalog.filter(p=>p.category==='预制块'||(/^material-\d+$/.test(p.id)&&Number(p.id.split('-')[1])<=72)).map(p=>[p.id,p]));
 if(!Array.isArray(snapshot.rows)||snapshot.rows.length!==expected.size||new Set(snapshot.rows.map(r=>r?.productId)).size!==expected.size)fail(400,'期初项目缺失或重复');
 if(!Array.isArray(snapshot.sources)||snapshot.sources.length!==2||snapshot.sources.some(s=>typeof s.file!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256)))fail(400,'期初缺少原表来源校验');
 const files=new Set(snapshot.sources.map(s=>s.file));
 for(const r of snapshot.rows){
  const source=expected.get(r.productId);if(!source||r.name!==source.name||r.unit!==source.unit||r.category!==source.category||r.groupId!==source.groupId||!files.has(r.file)||!r.sheet)fail(400,'期初项目与原表目录不一致：'+r.productId);
  const p=inventory.product(r.productId);if(p.unit!==r.unit||p.category!==r.category||p.groupId!==r.groupId)fail(400,'现有产品单位或班组已变化：'+r.name);
  const row=p.category==='预制块'?Number(source.source.match(/B(\d+):/)[1]):641;
  const column=p.category==='预制块'?(p.groupId==='g1'?'CJ':'BY'):null;
  const letters=source.id.startsWith('material-')?(()=>{let n=Number(source.id.split('-')[1]),s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;})():column;
  if(r.cell!==letters+row)fail(400,'期初原表位置不一致：'+r.name);
  if(r.quantity===null){if(r.formula!==null||r.savedValue!==null||r.issue!=='原表期末库存空白')fail(400,'缺失库存必须保留原表空白');}
  else quantity(r.quantity,p,true);
 }
 const fingerprint=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
 const previous=inventory.db.prepare('SELECT value FROM app_meta WHERE key=?').get(openingImportKey);
 if(previous&&JSON.parse(previous.value).fingerprint!==fingerprint)fail(409,'该月份已结转，不能用其他版本覆盖');
 const existing=new Set(inventory.db.prepare('SELECT product_id FROM inventory_openings').all().map(r=>r.product_id));
 return {key:openingImportKey,fingerprint,month:snapshot.month,startDate:snapshot.startDate,alreadyApplied:!!previous,
  toImport:previous?[]:snapshot.rows.filter(r=>r.quantity!==null&&!existing.has(r.productId)),
  preserved:snapshot.rows.filter(r=>existing.has(r.productId)).map(r=>r.productId),
  missing:snapshot.rows.filter(r=>r.quantity===null).map(r=>r.productId),
  recalculated:snapshot.rows.filter(r=>r.issue==='公式保存值与复算不一致').map(r=>r.productId)};
}

export function importOpeningStock(inventory,user,snapshot){
 return transaction(inventory.db,()=>{
  const plan=planOpeningImport(inventory,user,snapshot);if(plan.alreadyApplied)return {...plan,imported:0};
  for(const r of plan.toImport){
   inventory.setOpening(user,{productId:r.productId,startDate:plan.startDate,quantity:r.quantity,version:0,
    reason:`9月底账面结转；${r.file} / ${r.sheet}!${r.cell}${r.issue==='公式保存值与复算不一致'?'；采用原公式复算值':''}`});
  }
  const result={...plan,toImport:undefined,imported:plan.toImport.length,actorId:user.id,createdAt:now(),sources:snapshot.sources};
  inventory.db.prepare('INSERT INTO app_meta VALUES (?,?)').run(openingImportKey,JSON.stringify(result));
  return result;
 });
}
