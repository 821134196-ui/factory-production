import {fullProductName,productOption} from './product-label.js';
import {newRequestId} from './request-id.js';
import {dateOptions} from './date-options.js';
export function reportPage(state,d,{esc,field,options}){
 const category=state.reportCategory,loading=category==='装/卸车',operation=state.loadingOperation||'装车',title=loading?operation:category,precast=category==='预制块',canSelect=state.user.isLeader,groups=state.boot.groups.filter(g=>!['g4','g5'].includes(g.id));
 const groupId=precast?(groups.find(g=>g.id===d.groupId)?.id||groups.find(g=>g.id===state.user.groupId)?.id||'g3'):category==='装/卸车'?'g5':'g4';
 const workers=state.boot.workers,workerId=canSelect&&workers.some(u=>u.id===d.workerId)?d.workerId:state.user.id;
 const products=state.boot.products.filter(p=>p.active&&p.category===category&&(!p.groupId||p.groupId===groupId)&&(!loading||!p.loadingOperation||p.loadingOperation===operation)),selected=products.find(p=>p.id===d.productId)?.id||'',p=products.find(p=>p.id===selected);
 return `<div class="module-picker" role="group" aria-label="生产类型">${['浇注料','预制块','装/卸车'].map(name=>`<button class="module-choice ${category===name?'selected':''}" aria-pressed="${category===name}" data-action="report-module" data-value="${name}">${name==='装/卸车'?'装卸车':name}</button>`).join('')}</div>
 ${loading?`<div class="loading-switch" role="group" aria-label="装卸作业">${['装车','卸车'].map(value=>`<button type="button" class="${operation===value?'active':''}" aria-pressed="${operation===value}" data-action="report-loading" data-value="${value}">${value}</button>`).join('')}</div>`:''}
 ${canSelect?'<div class="tabs filling-mode"><button class="active" data-action="report-batch" data-value="false">本人填写</button><button data-action="report-batch" data-value="true">批量填写</button></div>':''}
 <form id="report-form" data-category="${category}" data-request-id="${esc(d.requestId||newRequestId())}"><input type="hidden" name="category" value="${category}">${loading?`<input type="hidden" name="loadingOperation" value="${operation}">`:''}
 <div class="card report-card">
 ${field('生产日期',`<select name="date" id="report-date">${options(dateOptions(state.boot),state.boot.fillDates.includes(d.date)?d.date:state.boot.today)}</select>`)}
 ${canSelect?field('姓名',`<select name="workerId" id="report-worker" data-search="true">${options(workers,workerId,u=>u.name+(u.id===state.user.id?' · 自己':''))}</select>`):`<input type="hidden" name="workerId" value="${state.user.id}">`}
 ${precast?field('生产班组',`<select name="groupId" id="report-group">${options(groups,groupId)}</select>`):`<input type="hidden" name="groupId" value="${groupId}">`}
 ${field(precast?'产品':'项目',`<select name="productId" id="product-select" data-search="true" required><option value="" ${!selected?'selected':''} disabled>请选择</option>${options(products,selected,productOption)}</select>`)}${!products.length?'<p class="small">请联系管理员启用项目。</p>':''}
 ${field('生产量',`<span class="quantity-control"><input type="number" name="quantity" id="quantity" class="quantity-input" inputmode="decimal" min="${p?10**-p.precision:1}" step="${p?10**-p.precision:1}" value="${esc(d.quantity??'')}" placeholder="请输入" required><span class="input-unit">${esc(p?.unit||'')}</span></span>`)}<div class="weight" ${precast?'':'hidden'}><span>折合重量</span><b id="report-weight">—</b></div></div>
 <button class="primary" type="submit">提交填写</button>
 <details class="form-help"><summary>填写说明</summary><p>可填写最近7天的数据。${canSelect?'可选择一人填写，或切换批量填写。':''}重新填写后立即更新产量和工资。</p></details></form>`;
}
export function batchInfo(r,{esc,num}){return (!r.batchCode&&r.product.category==='预制块'?`<p class="small">当天该产品总量：${num(r.dailyQuantity)}${esc(r.product.unit)}（参考）</p>`:'')+(r.batchCode?`<p class="small">${esc(r.shift)} · 批次 ${esc(r.batchCode)}</p><p class="small">本批总量：${num(r.batchQuantity)}${esc(r.product.unit)}（参考）</p>`:'')+(r.excludedReason?`<div class="correction">${esc(r.excludedReason)}，这条数量不重复计入汇总。</div>`:'');}
export function adminFields(r,state,{esc,field,options}){
 const products=state.boot.products.filter(p=>['预制块','浇注料','装/卸车'].includes(p.category)),groups=state.boot.groups;
 state.editWorkers=[...state.boot.workers,...r.members.filter(m=>!state.boot.workers.some(w=>w.id===m.id))];
 return `${field('生产日期',`<select name="date">${options(dateOptions(state.boot,r.date,{historical:true}),r.date)}</select>`)}${field('生产班组',`<select name="groupId">${options(groups,r.groupId)}</select>`)}${field('产品',`<select name="productId" id="edit-product" data-search="true">${options(products,r.product.id,p=>fullProductName(p)+' · '+p.category+' · '+(state.boot.groups.find(g=>g.id===p.groupId)?.name||'通用'))}</select>`)}${['shared','historical-group','crew'].includes(r.mode)?`<p class="small">实际参与生产人员</p>${state.editWorkers.map(u=>`<label class="member"><input name="memberIds" type="checkbox" value="${u.id}" ${r.members.some(m=>m.id===u.id)?'checked':''}>${esc(u.name)}</label>`).join('')}`:field('归属工人',`<select name="memberIds">${options(state.editWorkers,r.members[0]?.id)}</select>`)}${field('备注',`<textarea name="remark" maxlength="300" rows="2">${esc(r.remark)}</textarea>`)}`;
}
export function historyChanges(h,state,{num}){
 const changes=[];if(h.before.quantity===undefined)return '首次填写 '+num(h.after.quantity);
 if(h.before.quantity!==h.after.quantity)changes.push('数量 '+num(h.before.quantity)+' → '+num(h.after.quantity));
 for(const [key,label] of [['date','生产日期'],['shift','班次'],['batchCode','批次']])if(h.before[key]!==undefined&&h.before[key]!==h.after[key])changes.push(label+' '+h.before[key]+' → '+h.after[key]);
 if(h.before.product&&h.before.product.id!==h.after.product?.id)changes.push('产品 '+fullProductName(h.before.product)+' → '+fullProductName(h.after.product));
 if(h.before.memberIds&&JSON.stringify(h.before.memberIds)!==JSON.stringify(h.after.memberIds))changes.push('归属工人已调整');
 if(h.before.groupId&&h.before.groupId!==h.after.groupId)changes.push('生产班组已调整');
 return changes.join('；')||'数量核对 '+num(h.after.quantity);
}
