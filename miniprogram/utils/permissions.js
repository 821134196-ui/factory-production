const labels={shipping:'填写发货清单',inventory:'库存管理',records:'查看生产记录',review:'月度盘点',edit:'修改生产记录',stats:'查看全厂统计',salary:'查看工资',export:'Excel导出',history:'历史表格导入',staff:'员工管理',products:'产品管理'};
const can=(user,id)=>user?.role==='admin'&&!!(user.isSuperAdmin||user.permissions?.includes(id));
const canRead=user=>user?.role==='worker'||['records','review','edit','stats','export','history','inventory'].some(id=>can(user,id));
const roleName=user=>user?.isSuperAdmin?'总管理员':user?.role==='admin'?'管理员':user?.isLeader?'组长':'员工';
function tabs(user){return [['users','员工','staff'],['products','产品','products'],['permissions','管理员权限',null]].filter(([id,name,p])=>p?can(user,p):user?.isSuperAdmin).map(([id,name])=>({id,name}));}
const canManage=user=>tabs(user).length>0;
const defaultPage=user=>user?.role==='worker'?'home':(can(user,'shipping')||can(user,'inventory'))&&!canRead(user)&&!canManage(user)?'inventory':can(user,'stats')?'home':canRead(user)?'records':canManage(user)?'manage':'home';
function nav(user){if(user?.role==='worker')return [...(user.isLeader?[{id:'report',label:'填报',icon:'＋'},{id:'inventory',label:'发货与库存',icon:'□'}]:[]),{id:'records',label:'记录',icon:'≡'},{id:'home',label:'我的',icon:'○'}];return [...((can(user,'shipping')||can(user,'inventory'))?[{id:'inventory',label:'库存',icon:'□'}]:[]),...(canRead(user)?[{id:'records',label:'记录',icon:'≡'}]:[]),...(canManage(user)?[{id:'manage',label:'管理',icon:'⊞'}]:[]),{id:'home',label:'我的',icon:'○'}];}
const access=user=>Object.fromEntries(Object.keys(labels).map(id=>[id,can(user,id)]));
module.exports={can,canRead,canManage,tabs,nav,defaultPage,roleName,access,labels};
