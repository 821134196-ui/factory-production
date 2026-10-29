import {normalizeQuantity,quantityInputAttributes,setQuantityPrecision} from './quantity-input.js';
import {productOption,fullProductName} from './product-label.js';
import {newRequestId} from './request-id.js';
import {dateOptions} from './date-options.js';
import {chineseNumber} from './chinese-number.js';

export const precastKey=state=>'precast-crew-'+state.user.id;
export function rememberPrecastPeople(state,ids){localStorage.setItem('precast-last-people-'+state.user.id,JSON.stringify(ids));}
function orderedPeople(state,d){let recent=[];try{recent=JSON.parse(localStorage.getItem('precast-last-people-'+state.user.id)||'[]');}catch{}if(!Array.isArray(recent))recent=[];const order=[...new Set([...recent,...d.memberIds])];if(d.memberIds.includes(state.user.id)&&order.indexOf(state.user.id)>=6){order.splice(order.indexOf(state.user.id),1);order.splice(5,0,state.user.id);}return [...state.boot.workers].sort((a,b)=>{const ai=order.indexOf(a.id),bi=order.indexOf(b.id);return (ai<0?order.length:ai)-(bi<0?order.length:bi);});}
export function precastDraft(state){
 let d={};try{d=JSON.parse(localStorage.getItem(precastKey(state))||'{}');}catch{}
 const groupId=state.boot.groups.find(g=>g.id===state.user.groupId&&!['g4','g5'].includes(g.id))?.id||state.boot.groups.find(g=>!['g4','g5'].includes(g.id))?.id||'g3';
 let memberIds=(Array.isArray(d.memberIds)?d.memberIds:[state.user.id]).filter(id=>state.boot.workers.some(w=>w.id===id));if(!d.peopleDefaultVersion&&!memberIds.length&&!d.products?.some(p=>p.productId||p.quantity))memberIds=[state.user.id].filter(id=>state.boot.workers.some(w=>w.id===id));
 return {peopleDefaultVersion:1,date:state.boot.fillDates.includes(d.date)?d.date:state.boot.today,groupId,requestId:d.requestId||newRequestId(),products:d.products?.length?d.products:[{productId:'',quantity:''}],memberIds};
}
export function resetPrecastDate(state){const d=precastDraft(state);if(d.date!==state.boot.today)d.requestId=newRequestId();d.date=state.boot.today;localStorage.setItem(precastKey(state),JSON.stringify(d));}
export function savePrecast(state,form){
 const data=new FormData(form),d={peopleDefaultVersion:1,date:data.get('date'),groupId:data.get('groupId'),requestId:form.dataset.requestId,memberIds:data.getAll('memberIds'),products:[...form.querySelectorAll('[data-precast-product-row]')].map(row=>({productId:row.querySelector('[data-precast-product]').value,quantity:normalizeQuantity(row.querySelector('[data-precast-quantity]').value)}))};
 localStorage.setItem(precastKey(state),JSON.stringify(d));return d;
}
const tonnes=(p,q)=>{q=normalizeQuantity(q);return p?.weightKg&&q!==''&&Number.isFinite(Number(q))?Number((Number(q)*p.weightKg/1000).toFixed(6)).toLocaleString('zh-CN',{maximumFractionDigits:6})+' 吨':'—';};
export function updatePrecastForm(state,form){
 for(const row of form.querySelectorAll('[data-precast-product-row]')){
  const p=state.boot.products.find(p=>p.id===row.querySelector('[data-precast-product]').value),input=row.querySelector('[data-precast-quantity]');
  setQuantityPrecision(input,p?.precision??0);row.querySelector('.input-unit').textContent=p?.unit||'块';row.querySelector('[data-precast-weight]').textContent=p&&!p.weightKg?'单重待设置':tonnes(p,input.value);
 }
 const selected=[...form.querySelectorAll('[name=memberIds]:checked')];form.querySelector('[data-precast-headcount]').textContent='已选'+chineseNumber(selected.length)+'人';
 for(const label of form.querySelectorAll('[data-precast-person]'))label.classList.toggle('selected',label.querySelector('input').checked);
}
export function precastReport(state,{esc,field,options}){
 const d=precastDraft(state),people=orderedPeople(state,d),products=state.boot.products.filter(p=>p.active&&p.category==='预制块'&&(!p.groupId||p.groupId===d.groupId));
 return `<form id="precast-report-form" data-request-id="${esc(d.requestId)}">
 <div class="card report-date-card">${field('日期',`<select name="date">${options(dateOptions(state.boot),d.date)}</select>`)}<input type="hidden" name="groupId" value="${esc(d.groupId)}"></div>
 <section class="card precast-products"><div class="section-heading precast-step-heading"><h2 aria-label="第一步，选择产品"><span class="form-step">一</span>选择产品</h2></div>
 ${d.products.map((e,i)=>{const p=products.find(p=>p.id===e.productId);return `<div class="precast-product-row" data-precast-product-row>${d.products.length>1?`<div class="section-heading"><b>产品${chineseNumber(i+1)}</b><button type="button" class="text-action remove-action" data-action="precast-remove" data-index="${i}">移除</button></div>`:''}${field('产品',`<select data-precast-product data-search="true" required aria-label="产品${chineseNumber(i+1)}"><option value="" ${!p?'selected':''} disabled>请选择</option>${options(products,p?.id,productOption)}</select>`)}${field('生产量',`<span class="quantity-control"><input data-precast-quantity ${quantityInputAttributes(p?.precision??0)} value="${esc(e.quantity)}" required placeholder="请输入块数"><span class="input-unit">${esc(p?.unit||'块')}</span></span>`)}<div class="weight"><span>折合重量</span><b data-precast-weight>${esc(tonnes(p,e.quantity))}</b></div></div>`;}).join('')}
 <button type="button" class="soft" data-action="precast-add">＋ 添加产品</button></section>
 <section class="card precast-people"><div class="section-heading precast-step-heading"><h2 aria-label="第二步，选择生产人员"><span class="form-step">二</span>选择生产人员</h2><span class="small" data-precast-headcount>已选${chineseNumber(d.memberIds.length)}人</span></div><div class="precast-person-list" id="precast-people-list">${people.map((w,i)=>`<label class="precast-person ${d.memberIds.includes(w.id)?'selected':''}" data-precast-person ${i>=6&&!state.precastPeopleExpanded?'hidden':''}><input type="checkbox" name="memberIds" value="${esc(w.id)}" ${d.memberIds.includes(w.id)?'checked':''}><span>${esc(w.name)}</span></label>`).join('')}</div>${people.length>6?`<button class="text-action precast-people-toggle" type="button" data-action="precast-people-toggle" aria-controls="precast-people-list" aria-expanded="${!!state.precastPeopleExpanded}">${state.precastPeopleExpanded?'收起其余人员':'展开其余'+chineseNumber(people.length-6)+'人'}</button>`:''}</section>
 <p class="small form-note">以上人员共同生产，产品数量只计一次。</p><button type="submit" class="primary">确认填报</button></form>`;
}
export function precastConfirmation(state,d,{esc,num}){
 const names=d.memberIds.map(id=>state.boot.workers.find(w=>w.id===id)?.name).filter(Boolean);
 return `<div class="report-confirmation"><dl class="confirmation-meta"><div><dt>生产日期</dt><dd>${esc(d.date)}</dd></div></dl><section class="confirmation-section"><h3>产品与产量</h3><div class="confirmation-items">${d.products.map(e=>{const p=state.boot.products.find(p=>p.id===e.productId);return `<article class="confirmation-item"><b class="confirmation-product">${esc(fullProductName(p))}</b><div class="confirmation-quantity"><span>合计生产量</span><strong>${num(e.quantity)} ${esc(p?.unit)}</strong></div><div class="confirmation-weight"><span>折合重量</span><span>${esc(tonnes(p,e.quantity))}</span></div></article>`;}).join('')}</div></section><section class="confirmation-section confirmation-people"><h3>生产人员 · ${chineseNumber(names.length)}人</h3><div class="confirmation-names">${names.map(name=>`<span>${esc(name)}</span>`).join('')}</div></section><p class="small confirmation-note">同日、同班组、同产品再次填写，将替换之前的产量和人员。工资按班组当日实际人数均分。</p></div>`;
}
