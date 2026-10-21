import {exportPanel} from './history-ui.js';
import {can} from './permissions.js';
import {wagePanel} from './wages-ui.js';
export function dashboardPage(state,{esc,num,group,businessTabs,period,recordCard,field}){
 const s=state.stats,admin=state.user.role==='admin';if(!s)return '<p class="empty">正在加载</p>';
 return `<section class="stats-toolbar">${businessTabs()}${period()}</section>
 <section class="stats-grid"><div class="card hero"><p class="small">${admin?'已确认产量':'我的已确认产量'} · ${s.from===s.to?s.from:s.from+' 至 '+s.to}</p>${s.units.length?s.units.map(u=>`<div class="large"><span class="metric-number">${num(u.quantity)}</span> <span class="metric-unit">${esc(u.unit)}</span></div>`).join(''):'<div class="large">0 <span class="metric-unit">吨</span></div>'}<div class="hero-foot"><span>${s.approvedCount}条已确认</span><span>${s.pendingCount}条待确认</span></div></div>
 <details class="disclosure"><summary>按产品查看 · ${s.products.length}项</summary><div class="disclosure-body product-summary">${s.units.some(u=>u.unit!=='吨')?`<p class="small note">折合 ${num(s.weightKg/1000)} 吨</p>`:''}${s.products.length?s.products.map(p=>`<div class="summary"><span>${esc(p.name)}</span><span class="value">${num(p.quantity)} ${esc(p.unit)}</span></div>`).join(''):'<p class="empty">暂无已确认产量</p>'}</div></details></section>
 ${wagePanel(state,{esc,num})}
 ${s.missing.length?`<details class="disclosure"><summary>尚未填写 · ${s.missing.length}人</summary><div class="disclosure-body"><p class="small">${s.missing.map(u=>esc(u.name)+(group(u.groupId)?'（'+esc(group(u.groupId))+'）':'')).join('、')}</p></div></details>`:''}
 ${can(state.user,'products')&&state.filters.category==='浇注料'&&state.boot.unconfiguredMaterialCount?`<details class="disclosure"><summary>待配置项目 · ${state.boot.unconfiguredMaterialCount}项</summary><div class="disclosure-body"><button class="soft" data-action="material-products">配置浇注料项目</button></div></details>`:''}
 ${can(state.user,'export')?`<details class="disclosure export-tools"><summary>导出报表</summary><div class="disclosure-body">${exportPanel(state,{field})}</div></details>`:''}
 <div class="record-list-heading"><h2>最近记录</h2><button data-action="navigate" data-page="records">全部记录</button></div><div class="record-grid">${state.records.slice(0,3).map(recordCard).join('')||'<p class="empty">暂无生产记录</p>'}</div>`;
}
