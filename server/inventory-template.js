import {InventoryService,canInventory} from './inventory.js';
import {round,fail} from './service.js';
import {quantityToKg} from './material-units.js';
import {shippingHeaderRows} from './workbook-layout.js';

// Monthly stock uses the same product rows and units as the source workbooks.
export function patchInventoryTemplate(db,production,user,{wb,month,days,category,groupSpecs,patch,cellName}){
 // Customer names in the source are business data too; never retain last month's text.
 if(category==='预制块'&&wb.worksheets[4])for(let row=26;row<=51;row++)for(let col=2;col<=wb.worksheets[4].columnCount;col++)patch(wb.worksheets[4].name,cellName(col,row),null);
 if(category==='预制块')for(let i=0;i<groupSpecs.length;i++){const headers=shippingHeaderRows(wb.worksheets[i],i);for(let col=i===0?52:41;col<=(i===0?85:74);col++){patch(wb.worksheets[i].name,cellName(col,headers.dateRow),null);patch(wb.worksheets[i].name,cellName(col,headers.customerRow),null);}}
 else for(let row=604;row<=639;row++)patch(wb.worksheets[0].name,'B'+row,null);
 if(!canInventory(user))return;
 const inventory=new InventoryService(db,production),from=month+'-01',to=month+'-'+String(days).padStart(2,'0'),report=inventory.summary(user,{from,to,category}),shipments=inventory.list(user,{from,to,category}).reverse();
 const weight=(p,q)=>q===null?null:round(quantityToKg(p,q),6);
 const sum=(items,key)=>items.some(r=>r[key]===null)?null:round(items.reduce((n,r)=>n+r[key],0),6);
 if(category==='浇注料'){
  const s=wb.worksheets[0];if(shipments.length>36)fail(400,'本月浇注料发货超过原表36行，请导出库存明细');
  patch(s.name,'B4','期初库存（吨）');
  for(let row=604;row<=639;row++)patch(s.name,'B'+row,null);
  for(const r of report.rows){const col=Number(r.product.id.replace('material-',''));if(!Number.isInteger(col)||col<3||col>72)continue;patch(s.name,cellName(col,4),r.opening===null?'待设置':r.opening);patch(s.name,cellName(col,640),r.shipped);patch(s.name,cellName(col,641),r.balance===null?'待设置':r.balance);patch(s.name,cellName(col,642),r.physical);patch(s.name,cellName(col,643),r.difference);}
  for(const [i,shipment]of shipments.entries()){const row=604+i;patch(s.name,'B'+row,Number(shipment.date.slice(-2))+'日 '+shipment.customer);for(const e of shipment.entries.filter(e=>e.product.category===category)){const col=Number(e.product.id.replace('material-',''));if(!Number.isInteger(col)||col<3||col>72)fail(400,'发货项目没有原表位置，请导出库存明细');patch(s.name,cellName(col,row),e.quantity);}}
  patch(s.name,'B643','差异（账面－实盘）');return;
 }
 const segmentData=[];
 for(const [index,spec]of groupSpecs.entries()){
  const sheet=wb.worksheets[index],rows=report.rows.filter(r=>r.product.groupId===spec.groupId),byRow=new Map(rows.map(r=>[Number(r.product.source?.match(/B(\d+):C\d+$/)?.[1]),r])),ship=shipments.filter(s=>s.entries.some(e=>e.product.category==='预制块'&&e.product.groupId===spec.groupId)),first=index===0?52:41,last=index===0?85:74,{dateRow,customerRow}=shippingHeaderRows(sheet,index),sales=index===0?86:75,stock=index===0?88:77;
  if(ship.length>last-first+1)fail(400,'本月预制块发货超过原表列数，请导出库存明细');
  for(let col=first;col<=last;col++){patch(sheet.name,cellName(col,dateRow),null);patch(sheet.name,cellName(col,customerRow),null);}
  for(const r of rows){const row=Number(r.product.source?.match(/B(\d+):C\d+$/)?.[1]);if(!row)continue;patch(sheet.name,'D'+row,r.opening===null?'待设置':r.opening);patch(sheet.name,'E'+row,weight(r.product,r.opening));patch(sheet.name,cellName(sales,row),r.shipped);patch(sheet.name,cellName(sales+1,row),weight(r.product,r.shipped));patch(sheet.name,cellName(stock,row),r.balance===null?'待设置':r.balance);patch(sheet.name,cellName(stock+1,row),weight(r.product,r.balance));patch(sheet.name,cellName(stock+2,row),r.physical);patch(sheet.name,cellName(stock+3,row),r.difference);}
  for(const [i,s]of ship.entries()){const col=first+i;patch(sheet.name,cellName(col,dateRow),Number(s.date.slice(-2)));patch(sheet.name,cellName(col,customerRow),s.customer);for(const e of s.entries.filter(e=>e.product.category==='预制块'&&e.product.groupId===spec.groupId)){const row=Number(e.product.source?.match(/B(\d+):C\d+$/)?.[1]);if(!row||!byRow.has(row))fail(400,'发货产品没有原表位置，请导出库存明细');patch(sheet.name,cellName(col,row),e.quantity);}}
  const segments=spec.segments.map(([start,end,qtyRow,kgRow])=>{const part=rows.filter(r=>{const sourceRow=Number(r.product.source?.match(/B(\d+):C\d+$/)?.[1]);return sourceRow>=start&&sourceRow<=end;});const kg=key=>part.some(r=>r[key]===null)?null:round(part.reduce((n,r)=>n+(weight(r.product,r[key])||0),0),6);patch(sheet.name,'D'+qtyRow,sum(part,'opening'));patch(sheet.name,'E'+kgRow,kg('opening'));for(const [key,col]of [['shipped',sales],['balance',stock]]){patch(sheet.name,cellName(col,qtyRow),sum(part,key));patch(sheet.name,cellName(col+1,kgRow),kg(key));}patch(sheet.name,cellName(stock+2,qtyRow),sum(part,'physical'));patch(sheet.name,cellName(stock+3,qtyRow),sum(part,'difference'));for(const [i,s]of ship.entries()){const entries=s.entries.filter(e=>e.product.category==='预制块'&&e.product.groupId===spec.groupId&&Number(e.product.source?.match(/B(\d+):C\d+$/)?.[1])>=start&&Number(e.product.source?.match(/B(\d+):C\d+$/)?.[1])<=end);patch(sheet.name,cellName(first+i,qtyRow),round(entries.reduce((n,e)=>n+e.quantity,0),6));patch(sheet.name,cellName(first+i,kgRow),round(entries.reduce((n,e)=>n+weight(e.product,e.quantity),0),6));}return {opening:kg('opening'),produced:kg('produced'),shipped:kg('shipped'),balance:kg('balance')};});segmentData.push(segments);
  for(const [key,col]of [['opening',4],['shipped',sales],['balance',stock]]){patch(sheet.name,cellName(col,spec.totals[0]),sum(rows,key));patch(sheet.name,cellName(col+1,spec.totals[1]),rows.some(r=>r[key]===null)?null:round(rows.reduce((n,r)=>n+weight(r.product,r[key]),0),6));}
  for(const [i,s]of ship.entries()){const entries=s.entries.filter(e=>e.product.category==='预制块'&&e.product.groupId===spec.groupId);patch(sheet.name,cellName(first+i,spec.totals[0]),round(entries.reduce((n,e)=>n+e.quantity,0),6));patch(sheet.name,cellName(first+i,spec.totals[1]),round(entries.reduce((n,e)=>n+weight(e.product,e.quantity),0),6));}
 }
 const summary=wb.worksheets[4];if(!summary)return;
 const add=values=>values.some(v=>v===null)?'待设置':round(values.reduce((n,v)=>n+v,0),6);
 for(const [key,col]of [['opening','D'],['produced','E'],['shipped','F'],['balance','G']]){
  for(let i=0;i<3;i++){const start=[4,8,12][i];for(const [j,offset]of [0,2,1].entries())patch(summary.name,col+(start+offset),segmentData[i][j][key]??'待设置');patch(summary.name,col+(start+3),add(segmentData[i].map(v=>v[key])));}
  for(const [j,row]of [16,18,17].entries())patch(summary.name,col+row,add(segmentData.map(v=>v[j][key])));patch(summary.name,col+'19',add(segmentData.flat().map(v=>v[key])));
 }
 // Align all three groups by shipment, rather than adding unrelated source columns.
 // A whole-truck weighbridge figure cannot be split across product sections.
 const historicalIds=new Set(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='history_source_rows'").get()?db.prepare("SELECT target_id FROM history_source_rows WHERE kind='shipment'").all().map(r=>r.target_id):[]),historicalGroups=new Map(),summaryShipments=[];
 for(const shipment of shipments){if(!historicalIds.has(shipment.id)){summaryShipments.push(shipment);continue;}const key=shipment.date+'|'+shipment.customer;let combined=historicalGroups.get(key);if(!combined){combined={...shipment,entries:[]};historicalGroups.set(key,combined);summaryShipments.push(combined);}for(const entry of shipment.entries){const old=combined.entries.find(e=>e.product.id===entry.product.id);if(old)old.quantity=round(old.quantity+entry.quantity,6);else combined.entries.push({...entry});}}
 for(const [segment,base,capacity,totalCol]of [[0,26,24,26],[2,40,16,18]]){
  const inSegment=e=>{if(e.product.category!=='预制块')return false;const spec=groupSpecs.find(g=>g.groupId===e.product.groupId),row=Number(e.product.source?.match(/B(\d+):C\d+$/)?.[1]);return spec&&row>=spec.segments[segment][0]&&row<=spec.segments[segment][1];},items=summaryShipments.filter(s=>s.entries.some(inSegment)),effectiveCapacity=historicalGroups.size?Math.max(capacity,summary.columnCount-2):capacity,finalCol=Math.max(totalCol,items.length+2);
  if(items.length>effectiveCapacity)fail(400,'本月发货超过原表合计区容量，请导出发货与库存明细');
  if(finalCol!==totalCol)for(let row=base;row<=base+11;row++)for(let col=totalCol;col<=finalCol;col++)summary.getCell(row,col).style={...summary.getCell(row,totalCol-1).style};
  let totalKg=0,totalWeighed=0,complete=true;
  for(const [i,s]of items.entries()){
   const col=i+2;patch(summary.name,cellName(col,base),s.customer);let kg=0;
   for(const [j,spec]of groupSpecs.entries()){const entries=s.entries.filter(e=>inSegment(e)&&e.product.groupId===spec.groupId),dateRow=base+[1,3,6][j];patch(summary.name,cellName(col,dateRow),entries.length?Number(s.date.slice(-2)):null);if(j)patch(summary.name,cellName(col,dateRow+1),entries.length?s.customer:null);const own=round(entries.reduce((n,e)=>n+weight(e.product,e.quantity),0),6);patch(summary.name,cellName(col,base+2+j*3),own);kg+=own;}
   const weighed=s.entries.every(inSegment)?s.weighedTonnes:null;patch(summary.name,cellName(col,base+9),round(kg,6));patch(summary.name,cellName(col,base+10),weighed);patch(summary.name,cellName(col,base+11),weighed===null?null:round(kg/1000-weighed,6));totalKg+=kg;if(weighed===null)complete=false;else totalWeighed+=weighed;
  }
  patch(summary.name,cellName(finalCol,base),'合计');patch(summary.name,cellName(finalCol,base+9),round(totalKg,6));patch(summary.name,cellName(finalCol,base+10),complete?round(totalWeighed,6):null);patch(summary.name,cellName(finalCol,base+11),complete?round(totalKg/1000-totalWeighed,6):null);
 }
 patch(summary.name,'A38','整单过磅及混装清单见发货与库存明细');
}
