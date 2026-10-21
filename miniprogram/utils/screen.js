const api = require('./api');
const permissions = require('./permissions');
const statuses = { pending: '已填写', approved: '已记录', rejected: '已退回' };
function number(value) { return String(Math.round(Number(value || 0) * 1000) / 1000).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function productName(p) { return p.fullName || (p.category==='浇注料'&&p.spec&&p.spec!=='按吨填写'?[p.spec,p.name]:[p.displayName||p.name,p.spec]).filter(Boolean).join(' · '); }
function weight(product, quantity) { const q = Number(quantity); if (quantity === '' || !Number.isFinite(q)) return '—'; if (product.weightKg) return String(Math.round(q * product.weightKg / 1000 * 1e6) / 1e6) + ' 吨'; if(product.category==='预制块')return '单重待设置'; if (product.unit === '公斤') return number(q / 1000) + ' 吨'; if (product.unit === '吨') return number(q) + ' 吨'; return '按' + (product.unit || '单位') + '统计'; }
function record(r, boot) { return Object.assign({}, r, { statusText: statuses[r.status], quantityText: number(r.quantity), weightText: r.product?.category === '预制块' ? weight(r.product, r.quantity) : '', memberNames: r.members.map(m => m.name).join('、'), groupName: boot.groups.find(g => g.id === r.groupId)?.name || '', corrected: r.quantity !== r.originalQuantity }); }
function time(t) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
async function bootstrap(page, gate = false) {
  if (!wx.getStorageSync('factory-token')) { wx.reLaunch({ url: '/pages/login/index' }); return null; }
  const boot = await getApp().bootstrap();
  const allowed=gate==='read'?permissions.canRead(boot.user):gate==='manage'?permissions.canManage(boot.user):gate==='worker'?boot.user.role==='worker':typeof gate==='string'?permissions.can(boot.user,gate):!gate||boot.user.role==='admin';
  if (!allowed) { wx.reLaunch({ url: '/pages/'+permissions.defaultPage(boot.user)+'/index' }); return null; }
  page.boot = boot; page.setData({ fontSize: boot.user.fontSize, user: boot.user, access:permissions.access(boot.user), roleName:permissions.roleName(boot.user), permissionText:boot.user.isSuperAdmin?'全部权限':(boot.user.permissions||[]).map(id=>permissions.labels[id]).join('、')||'暂未分配工作权限，请联系总管理员', demoMode: boot.demoMode, subtitle: boot.user.name + ' · ' + permissions.roleName(boot.user) }); return boot;
}
async function run(page, fn) { if (page.data.busy) return; page.setData({ busy: true }); try { return await fn(); } catch (e) { wx.showModal({ title: '请稍等一下', content: e.message, showCancel: false }); } finally { page.setData({ busy: false }); wx.stopPullDownRefresh(); } }
function confirm(title, content) { return new Promise(resolve => wx.showModal({ title, content, confirmText: '确认', cancelText: '返回修改', success: r => resolve(r.confirm), fail: () => resolve(false) })); }
function toast(title) { wx.showToast({ title, icon: 'none', duration: 2500 }); }
module.exports = { bootstrap, run, confirm, toast, record, number, time, weight, productName, ...permissions };
