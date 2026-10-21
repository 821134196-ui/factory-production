const { apiBase } = require('../config');
function request(path, method = 'GET', data) {
  return new Promise((resolve, reject) => wx.request({
    url: apiBase + path, method, data, timeout: 15000,
    header: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (wx.getStorageSync('factory-token') || '') },
    success(res) {
      if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data);
      if (res.statusCode === 401) { wx.removeStorageSync('factory-token'); wx.reLaunch({ url: '/pages/login/index' }); }
      const error = new Error(res.data.error || '操作失败，请重试'); error.status = res.statusCode; reject(error);
    },
    fail() { reject(new Error('连接失败，请检查网络或服务地址')); }
  }));
}
function query(q) { return Object.keys(q).filter(k => q[k] !== '' && q[k] != null).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&'); }
async function exportFile(q,route='/export') {
  const file = await new Promise((resolve, reject) => wx.downloadFile({ url: apiBase + route + '?' + query(q), header: { Authorization: 'Bearer ' + wx.getStorageSync('factory-token') }, success: res => res.statusCode === 200 ? resolve(res.tempFilePath) : reject(new Error('导出失败，请重试')), fail: () => reject(new Error('下载失败，请检查网络')) }));
  await new Promise((resolve, reject) => wx.openDocument({ filePath: file, fileType: 'xlsx', showMenu: true, success: resolve, fail: () => reject(new Error('手机未能打开表格，请使用右上角菜单保存文件')) }));
}
async function openAttachment(id,mime){
 const file=await new Promise((resolve,reject)=>wx.downloadFile({url:apiBase+'/shipment-files/'+id,header:{Authorization:'Bearer '+wx.getStorageSync('factory-token')},success:r=>r.statusCode===200?resolve(r.tempFilePath):reject(new Error('泵单读取失败')),fail:()=>reject(new Error('泵单下载失败'))}));
 if(mime==='application/pdf'){await new Promise((resolve,reject)=>wx.openDocument({filePath:file,fileType:'pdf',showMenu:true,success:resolve,fail:()=>reject(new Error('无法打开泵单'))}));return;}
 try{await new Promise((resolve,reject)=>wx.previewImage({urls:[file],success:resolve,fail:reject}));}catch{await new Promise((resolve,reject)=>wx.openDocument({filePath:file,fileType:'pdf',showMenu:true,success:resolve,fail:()=>reject(new Error('无法打开泵单'))}));}
}
module.exports = { request, query, exportFile, openAttachment };
