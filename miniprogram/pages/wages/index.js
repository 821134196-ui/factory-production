const api=require('../../utils/api'),ui=require('../../utils/screen'),wageView=require('../../utils/wage-view');
Page({data:{fontSize:22,busy:false,ready:false,form:{},bases:[{id:'tonne',name:'元 / 吨'},{id:'quantity',name:'元 / 填报单位'}],modes:[{id:'crew',name:'当日班组按参与人数均分'}]},
 onLoad(q){this.query=q.from&&q.to?{from:q.from,to:q.to}:null;},
 toggle(e){const key=e.currentTarget.dataset.key;this.setData({[key]:!this.data[key]});} ,
 onShow(){ui.run(this,async()=>{const b=await ui.bootstrap(this);if(!b)return;if(!b.user.isSuperAdmin){if(b.user.role==='worker'||ui.can(b.user,'salary')){await this.loadPersonal();return;}wx.reLaunch({url:'/pages/home/index'});return;}const c=await api.request('/wages/config');this.setData({ready:true,today:b.today,month:c.month,policy:c.policy,products:c.products.map(p=>({...p,name:p.productTitle,detail:p.category+(p.productDetail?' · '+p.productDetail:'')+(p.rate?' · '+p.rate.rate+'元/'+(p.rate.basis==='tonne'?'吨':p.unit):' · 单价待设置')})),workers:c.workers,form:{productId:c.products[0]?.id||'',workerId:c.workers[0]?.id||'',date:b.today,effectiveDate:b.today,month:c.month,rate:'',basis:'tonne',amount:'',reason:''}});});},
 async loadPersonal(){
 const w=await api.request('/wages?'+api.query(this.query||{from:this.boot.today,to:this.boot.today}));
 this.setData({personal:true,ready:true,wages:w,totalText:w.total===null?'待核定':'¥ '+w.total.toFixed(2),days:wageView.days(w),supplementDays:wageView.days(w,true),supplementText:'¥ '+(w.automaticSupplementTotal+w.adjustmentTotal).toFixed(2)});
 },
 input(e){this.setData({['form.'+e.currentTarget.dataset.key]:e.detail.value});},choice(e){this.setData({['form.'+e.currentTarget.dataset.key]:e.detail.value});},policyChoice(e){this.setData({'policy.precastMode':e.detail.value});},policyInput(e){this.setData({['policy.'+e.currentTarget.dataset.key]:e.detail.value});},confirmed(e){this.setData({'policy.supplementsConfirmed':e.detail.value});},
 savePolicy(){ui.run(this,async()=>{const p=this.data.policy;await api.request('/wages/policy','PUT',{...p,effectiveDate:this.data.form.effectiveDate,precastRate:Number(p.precastRate),materialMultiplier:p.materialMultiplier===''?null:Number(p.materialMultiplier)});ui.toast('规则已保存');});},
 saveRate(){ui.run(this,async()=>{const f=this.data.form;if(f.rate==='')throw new Error('请输入单价');await api.request('/wages/rates','PUT',{productId:f.productId,effectiveDate:f.effectiveDate,rate:Number(f.rate),basis:f.basis});ui.toast('单价已保存');});},
 saveAdjustment(){ui.run(this,async()=>{const f=this.data.form;if(f.amount==='')throw new Error('请输入金额');await api.request('/wages/adjustments','PUT',{workerId:f.workerId,date:f.date,amount:Number(f.amount),reason:f.reason});ui.toast('补助已保存');});},
 closeChoices(e){this.selectAllComponents('.wage-select').forEach(c=>{if(c.id!==e.target.id)c.close();});}
});
