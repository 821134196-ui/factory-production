import {fullProductName,productOption} from './product-label.js';
import {can} from './permissions.js';
export const reviewLimit=200;
export function pendingReviews(state){return state.records.filter(r=>r.status==='pending');}
export function pruneReviews(state){
 const current=new Map(pendingReviews(state).map(r=>[r.id,r.version]));
 for(const [id,version] of state.reviewSelection)if(current.get(id)!==version)state.reviewSelection.delete(id);
 if(!can(state.user,'review')||!current.size){state.batchReview=false;state.reviewSelection.clear();}
}
export function reviewToolbar(state){
 const pending=pendingReviews(state);if(!can(state.user,'review')||!pending.length)return '';
 if(!state.batchReview)return `<div class="list-toolbar"><span class="small">${pending.length}条待确认</span><button class="text-action" data-action="review-mode">批量核对</button></div>`;
 return `<section class="batch-review-bar" aria-label="批量核对"><div class="batch-review-heading"><span id="review-count" aria-live="polite">已选 ${state.reviewSelection.size} 条</span><button class="text-action" data-action="review-exit">退出批量</button></div><div class="batch-review-actions"><button class="soft" data-action="review-all">全选</button><button class="primary" data-action="confirm-review-selection" ${state.reviewSelection.size?'':'disabled'}>确认选中</button></div></section>`;
}
export function reviewCheckbox(state,r,{esc,num}){
 if(state.page!=='records'||!state.batchReview||!can(state.user,'review')||r.status!=='pending')return '';
 const name=r.members.map(m=>m.name).join('、')+' '+(fullProductName(r.product))+' '+num(r.quantity)+r.product.unit;
 return `<input type="checkbox" data-review-record="${esc(r.id)}" data-version="${r.version}" aria-label="选择 ${esc(name)}" ${state.reviewSelection.has(r.id)?'checked':''}>`;
}
export function syncReviewSelection(state){
 const count=document.querySelector('#review-count');if(count)count.textContent='已选 '+state.reviewSelection.size+' 条';
 const submit=document.querySelector('[data-action=confirm-review-selection]');if(submit)submit.disabled=!state.reviewSelection.size;
 const all=document.querySelector('[data-action=review-all]');if(all)all.textContent=state.reviewSelection.size===Math.min(pendingReviews(state).length,reviewLimit)?'取消全选':'全选';
 document.querySelectorAll('[data-review-record]').forEach(input=>input.checked=state.reviewSelection.has(input.dataset.reviewRecord));
}
export function reviewConfirmation(state,{esc,num}){
 const selected=state.records.filter(r=>state.reviewSelection.get(r.id)===r.version&&r.status==='pending');
 return `<p class="small">核对以下 ${selected.length} 条记录，核对前后的产量与工资均实时计算。</p><div class="review-preview">${selected.map(r=>`<div class="review-preview-row"><b>${esc(r.members.map(m=>m.name).join('、'))} · ${num(r.quantity)} ${esc(r.product.unit)}</b><p class="small">${esc(fullProductName(r.product))} · ${r.date}</p></div>`).join('')}</div>`;
}
