import {fullProductName,productFields} from './product-label.js';
import {icon} from './icons.js';
import {stockFlowDetail} from './stock-flow-ui.js';

export const stocktakeStatus={pending:'待盘点',confirmed:'已确认',error:'错误'};
const statusIcons={pending:'clock',confirmed:'checkCircle',error:'alertCircle'};
const statusBadge=status=>`<span class="stocktake-badge ${status}">${icon(statusIcons[status])}${stocktakeStatus[status]}</span>`;
const reviewTime=value=>value?new Date(value).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false}).slice(0,16):'';
function reviewed(row,esc){
 if(row.status==='pending'||!row.reviewedBy)return '';
 return `<div class="stocktake-reviewed"><span>${row.status==='confirmed'?'确认人':'标记人'}：${esc(row.reviewedBy)}</span><time datetime="${esc(row.reviewedAt)}">${esc(reviewTime(row.reviewedAt))}</time></div>`;
}
export function stocktakePage(state,{esc,num}){
 const report=state.stocktake;if(!report)return '<p class="empty">正在加载</p>';
 if(!report.currentRange?.from||!report.currentRange?.to||report.rows.some(r=>!r.current))return '<button class="text-action" data-action="navigate" data-page="records">返回生产记录</button><div class="card"><p class="empty">库存数据尚未更新完整，请刷新后重试。</p><button class="primary" data-action="navigate" data-page="stocktake">重新加载</button></div>';
 const status=stocktakeStatus[state.stocktakeStatus]?state.stocktakeStatus:'pending';
 const counts={pending:report.rows.length-report.confirmedCount-report.errorCount,confirmed:report.confirmedCount,error:report.errorCount};
 const rows=report.rows.filter(r=>r.status===status&&(!state.stocktakeCategory||r.product.category===state.stocktakeCategory)&&(!state.stocktakeKeyword||fullProductName(r.product).includes(state.stocktakeKeyword)));
 const empty=state.stocktakeCategory||state.stocktakeKeyword?'没有符合筛选条件的产品':{pending:'暂无待盘点产品',confirmed:'暂无已确认产品',error:'暂无标记错误的产品'}[status];
 return `<button class="text-action" data-action="navigate" data-page="records">返回生产记录</button>
 <p class="small period-caption">${esc(report.month)}</p>
 <div class="stocktake-summary" role="group" aria-label="盘点状态">${Object.entries(stocktakeStatus).map(([key,label])=>`<button class="stocktake-state ${key}${status===key?' active':''}" data-action="stocktake-status" data-value="${key}" aria-pressed="${status===key}" aria-label="${label} ${counts[key]}项"><span class="stocktake-state-name">${label}</span><b>${num(counts[key])}</b>${status===key?`<span class="stocktake-selected" aria-hidden="true">${icon('checkCircle')}</span>`:''}</button>`).join('')}</div>
 <div class="tabs">${['','预制块','浇注料'].map(c=>`<button data-action="stocktake-category" data-value="${c}" class="${(state.stocktakeCategory||'')===c?'active':''}">${c||'全部'}</button>`).join('')}</div>
 <form id="stocktake-search-form" class="stock-search"><input name="keyword" type="search" placeholder="查找产品" aria-label="查找盘点产品" value="${esc(state.stocktakeKeyword||'')}"><button type="submit" class="soft">查找</button></form>
 <p class="small stocktake-period-note">当月库存＝本月生产－发货<br>${esc(report.currentRange.from)} 至 ${esc(report.currentRange.to)}</p>
 <div class="stocktake-list">${rows.map(r=>{
  const p=productFields(r.product);
  return `<article class="card stocktake-card is-${r.status}"><div class="stocktake-card-head">${statusBadge(r.status)}${r.stale?'<span class="stocktake-updated">数据已更新，需重新盘点</span>':''}</div>
  <button class="stocktake-product stocktake-card-product" data-action="stocktake-detail" data-id="${esc(r.product.id)}" aria-label="查看${esc(fullProductName(r.product))}盘点明细"><span class="stocktake-product-copy"><b>${esc(p.productTitle)}</b>${p.productDetail?`<small>${esc(p.productDetail)}</small>`:''}</span></button>
  <div class="stocktake-balances">${[['previous','上月剩余库存',r.balance,r.issue],['month','当月库存',r.current.change,r.current.issue],['current','当前剩余库存',r.current.balance,r.current.issue]].map(([view,label,value,issue])=>`<button class="stocktake-balance${view==='current'?' stocktake-current':''}" data-action="stocktake-detail" data-id="${esc(r.product.id)}" data-view="${view}" aria-label="查看${esc(fullProductName(r.product))}${label}明细"><span>${label}</span><b>${value===null?(issue==='历史单位需核对'?'待核对':'待设置'):num(value)+` <span>${esc(r.product.unit)}</span>`}${icon('right')}</b></button>`).join('')}</div>
  ${reviewed(r,esc)}${r.status==='pending'?`<div class="stocktake-actions"><button class="stocktake-error" data-action="stocktake-mark" data-id="${esc(r.product.id)}" data-value="error">${icon('alertCircle')}标记错误</button><button class="primary stocktake-confirm" data-action="stocktake-mark" data-id="${esc(r.product.id)}" data-value="confirmed" ${r.balance===null?'disabled':''}>${icon('checkCircle')}确认无误</button></div>`:''}</article>`;
 }).join('')||`<p class="empty">${empty}</p>`}</div>`;
}
export function requireStocktakeView(data,view){
 if(view!=='previous'&&data.view!==view)throw new Error('库存明细尚未更新，请刷新后重试。');
 return data;
}
export function stocktakeDetail(data,{esc,num}){
 const row=data.review,previous=!data.view||data.view==='previous';
 return `${previous?`<div class="stocktake-detail-head">${statusBadge(row.status)}</div>${reviewed(row,esc)}${row.stale?'<p class="stocktake-updated">数据已更新，请重新盘点</p>':''}`:''}${stockFlowDetail(data,{esc,num})}${previous&&row.status!=='pending'?`<button class="secondary stocktake-reopen" data-action="stocktake-reopen" data-id="${esc(data.product.id)}">${icon('restart')}重新盘点</button>`:''}`;
}
