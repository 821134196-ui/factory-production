export const displayWageText=value=>String(value||'').replace(/原表/g,'').replace(/原公式/g,'计算规则');
export function wageDays(w,{esc},supplementsOnly=false){
 const number=v=>v===null?'待核定':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:6});
 const money=v=>v===null?'待核定':'¥ '+Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:6});
 const days=(w.days||[]).map(d=>({...d,lines:d.lines.filter(l=>!supplementsOnly||l.kind!=='production')})).filter(d=>d.lines.length);
 return days.map(d=>`<section class="wage-day"><div class="wage-day-heading"><h3>${esc(d.date)}</h3>${supplementsOnly?'':`<b>${money(d.total)}</b>`}</div><div class="wage-day-lines">${d.lines.map(l=>`<article class="wage-item"><h4>${esc(displayWageText(l.name))}</h4><dl class="wage-item-values">${l.kind==='adjustment'?'':`<div><dt>${l.averaged?'均摊量':l.kind==='production'?'数量':'补助量'}</dt><dd>${number(l.quantity)} ${esc(l.unit)}</dd></div><div><dt>单价</dt><dd>${l.rate===null?'待设置':number(l.rate)+' 元/'+esc(l.unit)}</dd></div>`}<div class="wage-item-amount"><dt>金额</dt><dd>${money(l.amount)}</dd></div></dl>${l.reason?`<p class="small">${esc(displayWageText(l.reason))}</p>`:''}</article>`).join('')}</div></section>`).join('')||'<p class="empty">暂无明细</p>';
}
