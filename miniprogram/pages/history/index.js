const api=require('../../utils/api'),ui=require('../../utils/screen');
Page({data:{fontSize:22,busy:false,month:'',categories:['预制块','浇注料'],categoryIndex:0,imports:[],preview:null,entries:[],offset:0,selectedCount:0},
 onShow(){ui.run(this,async()=>{const b=await ui.bootstrap(this,'history');if(!b)return;this.setData({month:this.data.month||b.today.slice(0,7),todayMonth:b.today.slice(0,7)});await this.list();});},
 async list(){this.setData({imports:(await api.request('/imports')).imports});},
 month(e){this.setData({month:e.detail.value});},category(e){this.setData({categoryIndex:Number(e.detail.value)});},
 async showPreview(id,keep=false){this.preview=await api.request('/imports/'+id);if(!keep)this.selected=new Set();this.selected=this.selected||new Set();this.setData({preview:this.preview,offset:keep?this.data.offset:0});this.renderEntries();},
 renderEntries(){this.setData({entries:this.preview.entries.slice(this.data.offset,this.data.offset+30).map(e=>Object.assign({},e,{checked:this.selected.has(e.sourceRef),disabled:!e.ready||!!e.recordId})),selectedCount:this.selected.size,end:Math.min(this.data.offset+30,this.preview.total)});},
 upload(){ui.run(this,async()=>{const file=await new Promise((resolve,reject)=>wx.chooseMessageFile({count:1,type:'file',extension:['xlsx'],success:r=>resolve(r.tempFiles[0]),fail:()=>reject(new Error('未选择表格'))}));if(file.size>9e6)throw new Error('表格超过大小限制');const base64=await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:file.path,encoding:'base64',success:r=>resolve(r.data),fail:()=>reject(new Error('无法读取表格'))}));const result=await api.request('/imports/preview','POST',{month:this.data.month,category:this.data.categories[this.data.categoryIndex],fileName:file.name,base64});await this.showPreview(result.id);await this.list();});},
 open(e){ui.run(this,()=>this.showPreview(e.currentTarget.dataset.id));},refresh(){ui.run(this,()=>this.preview?this.showPreview(this.preview.id,true):this.list());},
 select(e){for(const entry of this.data.entries)this.selected.delete(entry.sourceRef);for(const ref of e.detail.value)this.selected.add(ref);this.renderEntries();},
 all(){for(const entry of this.preview.entries)if(entry.ready&&!entry.recordId)this.selected.add(entry.sourceRef);this.renderEntries();},clear(){this.selected.clear();this.renderEntries();},
 page(e){this.setData({offset:Math.max(0,this.data.offset+Number(e.currentTarget.dataset.delta))});this.renderEntries();},
 commit(){ui.run(this,async()=>{if(!this.selected?.size)throw new Error('请选择已核准的历史记录');if(!await ui.confirm('核准历史数据','已逐项核对选中'+this.selected.size+'条记录，导入后计入已确认生产汇总？'))return;await api.request('/imports/'+this.preview.id+'/commit','POST',{sourceRefs:[...this.selected],confirmed:true});await this.showPreview(this.preview.id);await this.list();ui.toast('历史数据已核准导入');});},
 back(){wx.navigateBack();},onPullDownRefresh(){this.refresh();}
});
