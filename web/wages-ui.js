import {wageDays} from './wage-breakdown-ui.js';
import {fullProductName,productOption} from './product-label.js';
export function wagePanel(state,{esc}){
 const w=state.wages;if(!w)return '';
 const money=v=>v===null?'待核定':'¥ '+Number(v).toFixed(2);
 return `<div class="wage-personal"><div class="summary"><span>工资合计</span><b class="wage-total">${money(w.total)}</b></div>
 <details class="disclosure"><summary>工资明细</summary><div class="disclosure-body wage-breakdown">${wageDays(w,{esc})}</div></details></div>`;
}
export function wageEditor(state,{esc,field,options}){
 const c=state.wageConfig,policy=c.policy;
 return `<form id="wage-policy-form"><h3>班组平均工资</h3><input type="hidden" name="precastMode" value="crew"><p class="small note">预制块基础工资＝班组当日总吨数÷实际参与人数×单价。人数从最新有效记录中的工人去重计算，与填写次数无关。</p>
 ${field('应用日期',`<input name="effectiveDate" type="date" value="${state.boot.today}" required>`)}${field('预制块基础单价（元/吨）',`<input name="precastRate" type="number" min="0" step="0.01" value="${esc(policy.precastRate)}" required>`)}${field('浇注料单价换算倍数',`<input name="materialMultiplier" type="number" min="0.000001" step="any" value="${esc(policy.materialMultiplier??'')}" placeholder="直接按元/吨，填1">`)}
 <p class="small note">二组指定小砖、大砖及各组产量补助自动计算。一组、三组空白补助栏使用下方手工调整。大砖补助按对应型号块数计价，产量补助按平均吨数计价。</p>
 <label class="check-line"><input type="checkbox" name="supplementsConfirmed" ${policy.supplementsConfirmed?'checked':''}>手工补助已核定（不影响实时工资计算）</label><button class="primary space" type="submit">保存计算规则</button></form>
 <form id="wage-rate-form" class="wage-editor-section"><h3>项目单价</h3>${field('应用日期',`<input name="effectiveDate" type="date" value="${state.boot.today}" required>`)}${field('产品 / 项目',`<select name="productId" data-search="true">${options(c.products,'',p=>p.category+' · '+fullProductName(p)+(p.rate?' · 当前'+p.rate.rate+'元/'+(p.rate.basis==='tonne'?'吨':p.unit):' · 单价待设置'))}</select>`)}${field('计价方式','<select name="basis"><option value="tonne">元 / 吨</option><option value="quantity">元 / 填报单位</option></select>')}${field('单价','<input name="rate" type="number" min="0" step="0.01" inputmode="decimal" required placeholder="输入单价">')}<p class="small note">从应用日期（含当天）起重算历史及之后的工资，之前的工资保留原单价。</p><button class="primary" type="submit">保存项目单价</button></form>
 <form id="wage-adjust-form" class="wage-editor-section"><h3>手工补助 / 扣款</h3>${field('工人',`<select name="workerId" data-search="true">${options(c.workers,'')}</select>`)}${field('日期',`<input name="date" type="date" max="${state.boot.today}" value="${state.boot.today}" required>`)}${field('金额（补助正数、扣款负数）','<input name="amount" type="number" step="0.01" inputmode="decimal" required>')}${field('说明','<textarea name="reason" maxlength="300" required placeholder="填写空白补助栏或额外调整的依据"></textarea>')}<p class="small note">手工金额在自动补助之外叠加，请核对是否已包含自动计算的部分。同一人同一天保存时替换之前的手工金额，保留修改历史。</p><button class="primary" type="submit">保存手工调整</button></form>`;
}
