const api=require('../../utils/api'),ui=require('../../utils/screen');
Page({ data:{fontSize:22,phone:'',code:'',busy:false,seconds:0,help:''},
  onLoad(){ui.run(this,async()=>{const c=await api.request('/config');this.setData({...c,help:''});if(wx.getStorageSync('factory-token')){const b=await getApp().bootstrap();wx.reLaunch({url:'/pages/'+ui.defaultPage(b.user)+'/index'});}});},
  onUnload(){clearInterval(this.timer);}, input(e){this.setData({[e.currentTarget.dataset.key]:e.detail.value});},
  send(){ui.run(this,async()=>{if(this.data.seconds)return;await api.request('/auth/code','POST',{phone:this.data.phone});this.setData({seconds:60,help:'验证码已发送，5分钟内有效'});clearInterval(this.timer);this.timer=setInterval(()=>{this.setData({seconds:this.data.seconds-1});if(this.data.seconds<=0)clearInterval(this.timer);},1000);});},
  async signIn(phone,code){const r=await api.request('/auth/login','POST',{phone,code});wx.setStorageSync('factory-token',r.token);wx.reLaunch({url:'/pages/'+ui.defaultPage(r.user)+'/index'});},
  login(){ui.run(this,()=>this.signIn(this.data.phone,this.data.code));},
  onPullDownRefresh(){wx.stopPullDownRefresh();}
});
