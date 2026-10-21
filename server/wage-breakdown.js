// 展示层按日期、项目合并；金额使用计算结果，不重新计价或逐条取到分。
export function wageBreakdown(details, supplements, adjustments) {
 const days=new Map();
 const day=date=>{if(!days.has(date))days.set(date,{date,lines:new Map()});return days.get(date);};
 for(const d of details){
  const key=JSON.stringify([d.workerId,d.productId,d.groupId,d.rate,d.basis,d.headcount]);
  const lines=day(d.date).lines,unit=d.basis==='tonne'?'吨':d.unit,q=d.basis==='tonne'?d.tonnes:d.quantity;
  const line=lines.get(key)||{kind:'production',name:d.productName,quantity:0,unit,rate:d.rate,amount:0,averaged:d.category==='预制块',headcount:d.headcount||1};
  line.quantity=line.quantity===null||q===null?null:line.quantity+q;
  line.amount=line.amount===null||d.amount===null?null:(Math.round(line.amount*1e6)+Math.round(d.amount*1e6))/1e6;
  lines.set(key,line);
 }
 for(const [i,d] of supplements.entries())day(d.date).lines.set('supplement-'+i,{kind:'supplement',name:d.name,quantity:d.quantity/d.divisor,unit:d.unit,rate:d.rate,amount:d.amount,averaged:d.divisor>1,headcount:d.headcount});
 for(const [i,d] of adjustments.entries())day(d.date).lines.set('adjustment-'+i,{kind:'adjustment',name:d.amount<0?'手工扣款':'手工补助',reason:d.reason,quantity:null,unit:'',rate:null,amount:d.amount});
 return [...days.values()].sort((a,b)=>b.date.localeCompare(a.date)).map(d=>{
  const lines=[...d.lines.values()].map(l=>({...l,quantity:l.quantity===null?null:Number(l.quantity.toFixed(6))}));
  return {date:d.date,total:lines.some(l=>l.amount===null)?null:lines.reduce((n,l)=>n+Math.round(l.amount*1e6),0)/1e6,lines};
 });
}
