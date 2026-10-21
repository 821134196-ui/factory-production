const ui=require('./screen');
const clean=s=>String(s||'').replace(/原表/g,'').replace(/原公式/g,'计算规则');
const money=v=>v===null?'待核定':'¥ '+Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:6});
exports.days=(w,supplementsOnly=false)=>(w.days||[]).map(d=>({...d,totalText:money(d.total),lines:d.lines.filter(l=>!supplementsOnly||l.kind!=='production').map(l=>({...l,name:clean(l.name),reason:clean(l.reason),quantityLabel:l.averaged?'均摊量':l.kind==='production'?'数量':'补助量',quantityText:l.quantity===null?'待核定':ui.number(l.quantity)+' '+l.unit,rateText:l.rate===null?'待设置':ui.number(l.rate)+' 元/'+l.unit,amountText:money(l.amount)}))})).filter(d=>d.lines.length);
