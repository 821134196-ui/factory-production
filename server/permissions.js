import {randomUUID} from 'node:crypto';
import {transaction,now} from './db.js';
export const permissionCatalog=[
 {id:'shipping',name:'填写发货清单',description:'填写、更正和作废发货清单，查看库存'},
 {id:'inventory',name:'库存管理',description:'查看库存，设置期初和登记实盘数量'},
 {id:'records',name:'查看生产记录',description:'查看全厂生产记录'},
 {id:'review',name:'月度盘点',description:'按产品盘点上月库存流转，确认时同步确认对应生产记录'},
 {id:'edit',name:'修改生产记录',description:'修改数量、日期、产品和归属工人，实时更新统计'},
 {id:'stats',name:'查看全厂统计',description:'查看实时产量和汇总'},
 {id:'salary',name:'查看工资',description:'查看全厂工资与工资明细；单价和补助由总管理员设置'},
 {id:'export',name:'Excel导出',description:'导出原表月报、明细和修改记录'},
 {id:'history',name:'历史表格导入',description:'预览历史月份；核准导入还需审核权限'},
 {id:'staff',name:'员工管理',description:'管理员工手机号、班组、组长和在岗状态'},
 {id:'products',name:'产品管理',description:'维护产品、单位、单重和启用状态'}
];
export const allPermissions=permissionCatalog.map(p=>p.id);
export function isSuper(user){return user?.role==='admin'&&!!(user.is_super_admin??user.isSuperAdmin);}
export function permissionsOf(user){if(user?.role!=='admin')return [];if(isSuper(user))return [...allPermissions];const values=user.permissions??JSON.parse(user.permissions_json||'[]');return Array.isArray(values)?allPermissions.filter(id=>values.includes(id)):[];}
export const hasPermission=(user,id)=>permissionsOf(user).includes(id);
export const canReadProduction=user=>user?.role==='admin'&&['records','review','edit','stats','export','history','inventory'].some(id=>hasPermission(user,id));
export const canManage=user=>isSuper(user)||['staff','products','history','edit','review'].some(id=>hasPermission(user,id));
function denied(message){const error=new Error(message);error.status=403;throw error;}
export function assertPermission(user,id){if(!hasPermission(user,id))denied('没有'+(permissionCatalog.find(p=>p.id===id)?.name||'此操作')+'权限，请联系总管理员');}
export function assertProductionRead(user){if(user.role==='admin'&&!canReadProduction(user))denied('没有查看生产记录权限，请联系总管理员');}
export function assertRecordAction(user,action){if(user.role==='admin')assertPermission(user,action==='correct'?'edit':['approve','reject'].includes(action)?'review':'invalid');}
export function initializePermissions(db,config){
 if(db.prepare("SELECT 1 FROM app_meta WHERE key='admin_permissions_v1'").get())return;
 transaction(db,()=>{const admin=db.prepare("SELECT * FROM users WHERE role='admin' AND phone=?").get(config.adminPhone)||db.prepare("SELECT * FROM users WHERE id='admin' AND role='admin'").get();if(!admin)throw new Error('未找到初始总管理员');db.prepare('UPDATE users SET is_super_admin=1 WHERE id=?').run(admin.id);db.prepare("INSERT INTO app_meta VALUES ('admin_permissions_v1','done')").run();});
}
export function setAdminPermissions(db,actor,id,values){
 if(!isSuper(actor))denied('只有总管理员可以设置管理员权限');
 const target=db.prepare("SELECT * FROM users WHERE id=? AND deleted_at=''").get(id);
 if(!target||target.role!=='admin'){const error=new Error('请选择管理员账号');error.status=400;throw error;}
 if(isSuper(target))denied('总管理员权限固定，不可撤销');
 if(!Array.isArray(values)||new Set(values).size!==values.length||values.some(id=>!allPermissions.includes(id))){const error=new Error('权限选项不正确');error.status=400;throw error;}
 return transaction(db,()=>{const before=permissionsOf(target),after=allPermissions.filter(id=>values.includes(id));db.prepare('UPDATE users SET permissions_json=? WHERE id=?').run(JSON.stringify(after),id);db.prepare('INSERT INTO permission_history (id,actor_id,user_id,before_json,after_json,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(),actor.id,id,JSON.stringify(before),JSON.stringify(after),now());return db.prepare('SELECT * FROM users WHERE id=?').get(id);});
}
