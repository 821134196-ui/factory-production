const api=require('../../utils/api'),ui=require('../../utils/screen');
Page({data:{fontSize:22,busy:false,sizes:[{value:18,name:'标准'},{value:22,name:'大字'},{value:26,name:'特大'}]},
 onShow(){ui.run(this,async()=>{const b=await ui.bootstrap(this);if(b)this.setData({initial:b.user.name.slice(0,1),unread:b.unreadCount});});},
 font(e){ui.run(this,async()=>{const r=await api.request('/me','PATCH',{fontSize:Number(e.currentTarget.dataset.size)});this.setData({fontSize:r.user.fontSize,user:r.user});ui.toast('字体已调整');});},
 notices(){wx.navigateTo({url:'/pages/notices/index'});},
 logout(){ui.run(this,async()=>{if(!await ui.confirm('退出登录','下次使用需重新登录'))return;await api.request('/auth/logout','POST');wx.removeStorageSync('factory-token');getApp().globalData.boot=null;wx.reLaunch({url:'/pages/login/index'});});},
 onPullDownRefresh(){this.onShow();}
});
