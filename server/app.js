import {privatePath,readPrivateJson} from './private-data.js';
import {registerShipmentFiles} from './shipment-files.js';
import {registerMonthlyStocktake} from './monthly-stocktake.js';
import {registerAdminReports} from './admin-reports.js';
import {createAdmin,deleteAdmin} from './admin-accounts.js';
import {initializeSmsLogin} from './login-mode.js';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomInt,randomBytes,randomUUID,createHmac,createHash,timingSafeEqual } from 'node:crypto';
import ExcelJS from 'exceljs';
import {openDatabase,seed,today,now,transaction,insertNotice} from './db.js';
import {ProductionService,fail,text,date,userView,productView} from './service.js';
import {BatchProductionService,earliestFillDate,fillDates} from './batch-service.js';
import {registerWorkbookRoutes} from './workbooks.js';
import {applyFactoryRules,canonicalStaffName} from './factory-rules.js';
import {checkDatabaseMode,configureWebServer} from './deployment.js';
import {createSmsSender,smsFailureInfo} from './sms.js';
import {initializePermissions,permissionCatalog,isSuper,hasPermission,canReadProduction,assertPermission,setAdminPermissions} from './permissions.js';
import {applyOfficialRoster} from './accounts.js';
import {registerWageRoutes} from './wages.js';
import {InventoryService,registerInventoryRoutes,canInventory} from './inventory.js';
import {initializeTeam,sortedWorkers,productionOverview} from './team.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function createApp(config,{sendSms=createSmsSender(config)}={}){
 const db=openDatabase(config.dbPath),catalog=readPrivateJson('catalog.json',[]);checkDatabaseMode(db,config);const roster=readPrivateJson('staff-roster.json',[]);seed(db,config,catalog,roster);
 applyFactoryRules(db,catalog);
 initializePermissions(db,config);applyOfficialRoster(db,config,privatePath('accounts.json'));
 initializeTeam(db);
 const app=express(),service=new BatchProductionService(db),inventory=new InventoryService(db,service),hash=v=>createHmac('sha256',config.secret).update(v).digest('hex');
 initializeSmsLogin(db);
 app.disable('x-powered-by');app.use(express.json({limit:'12mb'}));
 configureWebServer(app,db,config);
 app.get('/api/config',(_,res)=>res.json({factoryName:config.factoryName,demoMode:false,authMode:'sms',today:today(),demoAccounts:[]}));
 const ipRequests=new Map();
 app.post('/api/auth/code',async(req,res)=>{
  const phone=text(req.body.phone,'手机号',11);if(!/^1\d{10}$/.test(phone))fail(400,'请输入11位手机号');
  const user=db.prepare('SELECT id FROM users WHERE phone=? AND active=1').get(phone);if(!user)fail(400,'该手机号未登记，请联系管理员');
  const t=Date.now(),ip=req.ip;for(const [key,value]of ipRequests)if(t-value.start>3600e3)ipRequests.delete(key);const limit=ipRequests.get(ip)||{start:t,count:0};limit.count++;ipRequests.set(ip,limit);if(limit.count>30)fail(429,'获取验证码过于频繁，请稍后再试');
  const last=db.prepare('SELECT sent_at FROM codes WHERE phone=?').get(phone);if(last&&t-last.sent_at<60e3)fail(429,'请60秒后重新获取');
  const code=String(randomInt(100000,1000000));
  try{await sendSms(phone,code);}catch(error){const failure=smsFailureInfo(error);console.error('短信发送失败：',JSON.stringify({provider:config.smsProvider,code:failure.code,requestId:failure.requestId}));return res.status(502).json({error:failure.message});}
  db.prepare('INSERT INTO codes VALUES (?,?,?,?,0,0) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0,consumed=0').run(phone,hash(phone+':'+code),t+300e3,t);
  res.json({sent:true});
 });
 app.post('/api/auth/login',(req,res)=>{
  const phone=text(req.body.phone,'手机号',11),code=text(req.body.code,'验证码',6),entry=db.prepare('SELECT * FROM codes WHERE phone=?').get(phone);
  const universal=!!config.universalLoginCode&&timingSafeEqual(Buffer.from(hash(code)),Buffer.from(hash(config.universalLoginCode)));
  if(!universal){
  if(!entry||entry.consumed||entry.attempts>=5||entry.expires_at<Date.now())fail(400,'验证码失效，请重新获取');
  const actual=hash(phone+':'+code);if(!timingSafeEqual(Buffer.from(actual),Buffer.from(entry.code_hash))){db.prepare('UPDATE codes SET attempts=attempts+1 WHERE phone=?').run(phone);fail(400,'验证码不正确');}
  }
  const user=db.prepare('SELECT * FROM users WHERE phone=? AND active=1').get(phone);if(!user)fail(403,'账号已停用');
  const token=randomBytes(32).toString('hex');db.prepare('UPDATE codes SET consumed=1 WHERE phone=?').run(phone);db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),user.id,Date.now()+30*864e5);res.json({token,user:userView(user)});
 });
 app.use('/api',(req,res,next)=>{
  if(req.path==='/config')return next();const token=req.get('Authorization')?.replace(/^Bearer /,'');if(!token)fail(401,'请先登录');
  const u=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>? AND u.active=1').get(hash(token),Date.now());if(!u)fail(401,'登录已失效，请重新登录');req.user=u;req.token=token;next();
 });
 const permission=id=>(req,res,next)=>{assertPermission(req.user,id);next();};
 const superAdmin=(req,res,next)=>{if(!isSuper(req.user))fail(403,'只有总管理员可以设置管理员权限');next();};
 const staff=(req,res,next)=>{assertPermission(req.user,'staff');next();};
 const worker=(req,res,next)=>{if(req.user.role!=='worker')fail(403,'当前账号没有工人填报权限');next();};
 registerWorkbookRoutes(app,db,service,permission);
 registerShipmentFiles(app,db);
 registerInventoryRoutes(app,inventory);
 registerMonthlyStocktake(app,db,inventory);
 app.get('/api/production-overview',(req,res)=>res.json(productionOverview(db,service,req.user,req.query)));
 app.post('/api/auth/logout',(req,res)=>{db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(req.token));res.json({ok:true});});
 app.get('/api/bootstrap',(req,res)=>{
  const production=req.user.role==='worker'||canReadProduction(req.user),catalog=production||hasPermission(req.user,'products')||canInventory(req.user),people=(req.user.role==='admin'&&production)||!!req.user.is_leader||hasPermission(req.user,'staff')||hasPermission(req.user,'salary');
  res.json({user:userView(req.user),permissionCatalog:isSuper(req.user)?permissionCatalog:[],today:today(),minDate:earliestFillDate(),fillDates:fillDates(),factoryName:config.factoryName,demoMode:false,authMode:'sms',demoAccounts:[],unconfiguredMaterialCount:catalog?db.prepare("SELECT count(*) n FROM products WHERE category='浇注料' AND id NOT LIKE 'material-demo%' AND (active=0 OR unit='')").get().n:0,groups:catalog||people?db.prepare('SELECT * FROM groups').all():[],workers:people?sortedWorkers(db,req.user):req.user.role==='worker'?[{id:req.user.id,name:req.user.name,groupId:req.user.group_id,isLeader:!!req.user.is_leader}]:[],products:catalog?db.prepare('SELECT * FROM products ORDER BY category,name,spec').all().map(productView).filter(p=>hasPermission(req.user,'products')||(p.active&&['浇注料','预制块','装/卸车'].includes(p.category))):[],unreadCount:production?db.prepare('SELECT count(*) n FROM notices WHERE user_id=? AND read_at IS NULL').get(req.user.id).n:0});
 });
 app.patch('/api/me',(req,res)=>{const size=req.body.fontSize;if(![18,22,26].includes(size))fail(400,'字号不正确');db.prepare('UPDATE users SET font_size=? WHERE id=?').run(size,req.user.id);res.json({user:userView(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id))});});
 app.get('/api/records',(req,res)=>res.json({records:service.list(req.user,req.query)}));
 app.post('/api/records',worker,(req,res)=>res.status(201).json({record:service.create(req.user,req.body)}));
 app.post('/api/records/leader',worker,(req,res)=>res.status(201).json({records:service.createLeader(req.user,req.body)}));
 app.post('/api/records/approve-batch',(req,res)=>{const records=service.approveMany(req.user,req.body.records);res.json({approvedCount:records.length});});
 app.get('/api/records/:id',(req,res)=>{const r=service.get(req.user,req.params.id);res.json({record:service.detail(req.user,r.id),history:service.history(req.user,r.id)});});
 app.patch('/api/records/:id',(req,res)=>res.json({record:service.update(req.user,req.params.id,req.body)}));
 app.delete('/api/records/:id',(req,res)=>res.json(service.remove(req.user,req.params.id,req.body)));
 app.post('/api/records/:id/change-requests',worker,(req,res)=>{
  const r=service.get(req.user,req.params.id),reason=text(req.body.reason,'修改申请原因',300);if(r.status!=='approved')fail(400,'待确认或退回记录可由填写人直接修改');
  transaction(db,()=>{if(db.prepare("SELECT 1 FROM change_requests WHERE record_id=? AND user_id=? AND status='open'").get(r.id,req.user.id))fail(409,'已有待处理的修改申请');db.prepare('INSERT INTO change_requests (id,record_id,user_id,reason,created_at) VALUES (?,?,?,?,?)').run(randomUUID(),r.id,req.user.id,reason,now());for(const u of db.prepare("SELECT * FROM users WHERE role='admin' AND active=1").all().filter(u=>hasPermission(u,'edit')||hasPermission(u,'review')))insertNotice(db,u.id,r.id,`${req.user.name}申请修改：${reason}`);});res.status(201).json({ok:true});
 });
 const requests=(req,res,next)=>{if(!hasPermission(req.user,'edit')&&!hasPermission(req.user,'review'))fail(403,'没有处理修改申请权限');next();};
 app.get('/api/change-requests',requests,(req,res)=>res.json({requests:db.prepare("SELECT c.*,u.name FROM change_requests c JOIN users u ON u.id=c.user_id WHERE c.status='open' ORDER BY c.created_at").all()}));
 app.patch('/api/change-requests/:id',requests,(req,res)=>{const r=db.prepare("SELECT * FROM change_requests WHERE id=? AND status='open'").get(req.params.id);if(!r)fail(404,'申请已处理');const reason=text(req.body.reason,'处理说明',300);transaction(db,()=>{db.prepare("UPDATE change_requests SET status='resolved',resolved_at=? WHERE id=?").run(now(),r.id);insertNotice(db,r.user_id,r.record_id,`修改申请已处理：${reason}`);});res.json({ok:true});});
 app.get('/api/stats',(req,res)=>res.json(service.stats(req.user,req.query)));
 const wages=registerWageRoutes(app,db,service);
 const reports=registerAdminReports(app,db,service,wages);
 app.get('/api/attendance',(req,res)=>{if(req.user.role==='admin'&&!canReadProduction(req.user))fail(403,'没有查看生产记录权限');const {from,to}=service.range(req.query);res.json({attendance:db.prepare('SELECT a.*,u.name FROM attendance a JOIN users u ON u.id=a.user_id WHERE production_date BETWEEN ? AND ?').all(from,to).filter(a=>req.user.role==='admin'||a.user_id===req.user.id)});});
 app.put('/api/attendance',worker,(req,res)=>{const d=date(req.body.date),status=req.body.status;if(d>today()||!['rest','stopped'].includes(status))fail(400,'休息或停产信息不正确');if(db.prepare("SELECT 1 FROM records r JOIN members m ON r.id=m.record_id WHERE m.user_id=? AND r.production_date=? AND r.status!='rejected' AND r.deleted_at=''").get(req.user.id,d))fail(400,'当天已有生产记录，不能标记整天休息或停产');db.prepare('INSERT INTO attendance VALUES (?,?,?) ON CONFLICT(user_id,production_date) DO UPDATE SET status=excluded.status').run(req.user.id,d,status);res.json({ok:true});});
 app.delete('/api/attendance/:date',worker,(req,res)=>{db.prepare('DELETE FROM attendance WHERE user_id=? AND production_date=?').run(req.user.id,date(req.params.date));res.json({ok:true});});
 app.get('/api/notices',(req,res)=>res.json({notices:req.user.role==='worker'||canReadProduction(req.user)?db.prepare('SELECT * FROM notices WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id):[]}));
 app.post('/api/notices/read',(req,res)=>{db.prepare('UPDATE notices SET read_at=? WHERE user_id=? AND read_at IS NULL').run(now(),req.user.id);res.json({ok:true});});
 app.get('/api/users',staff,(req,res)=>res.json({users:db.prepare("SELECT * FROM users WHERE deleted_at='' ORDER BY is_super_admin DESC,role,name").all().filter(u=>(isSuper(req.user)||u.role==='worker')&&(config.demo||u.active||!['mw1','mw2'].includes(u.id)||!u.name.endsWith('（演示）'))).map(userView)}));
 app.get('/api/admins',superAdmin,(req,res)=>res.json({admins:db.prepare("SELECT * FROM users WHERE role='admin' AND deleted_at='' ORDER BY is_super_admin DESC,name").all().map(userView),permissionCatalog}));
 app.post('/api/admins',superAdmin,(req,res)=>res.status(201).json({user:createAdmin(db,req.user,req.body)}));
 app.delete('/api/admins/:id',superAdmin,(req,res)=>res.json(deleteAdmin(db,req.user,req.params.id)));
 app.patch('/api/admins/:id/permissions',superAdmin,(req,res)=>res.json({user:userView(setAdminPermissions(db,req.user,req.params.id,req.body.permissions))}));
 app.get('/api/permission-history',superAdmin,(req,res)=>res.json({history:db.prepare('SELECT h.*,a.name actor,u.name target FROM permission_history h JOIN users a ON a.id=h.actor_id JOIN users u ON u.id=h.user_id ORDER BY h.created_at DESC LIMIT 100').all().map(h=>({...h,before:JSON.parse(h.before_json),after:JSON.parse(h.after_json)}))}));
 app.post('/api/users',staff,(req,res)=>saveUser(req,res));
 app.patch('/api/users/:id',staff,(req,res)=>saveUser(req,res));
 function saveUser(req,res){
  const old=req.params.id?db.prepare("SELECT * FROM users WHERE id=? AND deleted_at=''").get(req.params.id):null;if(req.params.id&&!old)fail(404,'员工不存在或已删除');
  const b={...(old?userView(old):{}),...req.body},id=old?.id||randomUUID(),name=canonicalStaffName(text(b.name,'姓名',30)),phone=text(b.phone||'','手机号',11,false),role=b.role||'worker',active=b.active??true,isLeader=b.isLeader??false,groupId=b.groupId||null;
  if(['isSuperAdmin','is_super_admin','permissions','permissions_json'].some(k=>Object.hasOwn(req.body,k)))fail(403,'管理员权限只能在总管理员权限设置中修改');
  if(!isSuper(req.user)&&(old?.role==='admin'||role==='admin'))fail(403,'员工管理权限不能修改或新增管理员');
  if(old&&isSuper(old)&&(role!=='admin'||!active||phone!==old.phone||name!==old.name))fail(403,'总管理员账号不可停用、转让或降级');
  if((phone&&!/^1\d{10}$/.test(phone))||!['admin','worker'].includes(role)||typeof active!=='boolean'||typeof isLeader!=='boolean'||(b.expected!==undefined&&typeof b.expected!=='boolean'))fail(400,'员工信息不正确');
  if(role==='admin'&&!phone)fail(400,'管理员需要绑定手机号');
  if(groupId&&!db.prepare('SELECT 1 FROM groups WHERE id=?').get(groupId))fail(400,'请选择有效班组');
  if(role==='worker'&&isLeader&&(!groupId||groupId==='g4'))fail(400,'组长需选择负责的轮班班组');
  if(req.user.id===id&&(!active||role!=='admin'))fail(400,'不能停用或撤销当前管理员');
  const storedPhone=phone||(old?.phone?.startsWith('unbound:')?old.phone:'unbound:'+id);
  db.prepare('INSERT INTO users (id,name,phone,role,group_id,active,expected,is_leader) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,role=excluded.role,group_id=excluded.group_id,active=excluded.active,expected=excluded.expected,is_leader=excluded.is_leader').run(id,name,storedPhone,role,role==='worker'?groupId:null,active?1:0,role==='worker'&&(b.expected??!!phone)?1:0,role==='worker'&&isLeader?1:0);
  if(role==='worker')db.prepare("UPDATE users SET permissions_json='[]' WHERE id=?").run(id);
  res.status(old?200:201).json({user:userView(db.prepare('SELECT * FROM users WHERE id=?').get(id))});
 }
 app.post('/api/products',permission('products'),(req,res)=>upsertProduct(req,res));app.patch('/api/products/:id',permission('products'),(req,res)=>upsertProduct(req,res));
 function upsertProduct(req,res){const old=req.params.id?db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id):null;if(req.params.id&&!old)fail(404,'产品不存在');const b={...(old?productView(old):{}),...req.body},name=text(b.name,'产品名称',100),unit=text(b.unit||'','单位',10,b.active!==false),spec=text(b.spec||'','规格',100,false),category=b.category,precision=b.precision??0,weight=b.weightKg??null,groupId=b.groupId||null;
  if(category==='浇注料'&&!String(req.params.id||'').startsWith('material-demo')&&(unit!=='吨'||weight!==null))fail(400,'浇注料统一按吨填写，名称中的公斤不作为单重');
  if(!['预制块','浇注料','装/卸车'].includes(category)||!Number.isInteger(precision)||precision<0||precision>3||(unit==='块'&&precision!==0)||(weight!==null&&(typeof weight!=='number'||!Number.isFinite(weight)||weight<=0)))fail(400,'分类、单重或小数位数不正确');if(groupId&&!db.prepare('SELECT 1 FROM groups WHERE id=?').get(groupId))fail(400,'班组不正确');if(category==='预制块'&&b.active!==false&&!weight)fail(400,'预制块需设置每块重量');const id=old?.id||randomUUID();
  db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,spec=excluded.spec,category=excluded.category,unit=excluded.unit,precision=excluded.precision,weight_kg=excluded.weight_kg,group_id=excluded.group_id,active=excluded.active').run(id,name,spec,category,unit,precision,weight,groupId,b.active===false?0:1,old?.source||'管理员配置');res.json({product:productView(db.prepare('SELECT * FROM products WHERE id=?').get(id))});
 }
 app.get('/api/export',permission('export'),async(req,res)=>{
  const rows=service.list(req.user,req.query),stats=service.stats(req.user,req.query,'export'),wb=new ExcelJS.Workbook();wb.creator=config.factoryName;
  const sheet=wb.addWorksheet('生产明细');sheet.columns=[{header:'生产日期',key:'date',width:15},{header:'班组',key:'group',width:20},{header:'产品',key:'product',width:30},{header:'规格',key:'spec',width:25},{header:'单位',key:'unit',width:10},{header:'工人原填',key:'original',width:15},{header:'当前有效数量',key:'qty',width:18},{header:'理论重量(公斤)',key:'weight',width:20},{header:'状态',key:'status',width:12},{header:'填写人',key:'by',width:15},{header:'参与工人',key:'members',width:35},{header:'记录编号',key:'id',width:40},{header:'填写方式',key:'mode',width:18},{header:'班次',key:'shift',width:15},{header:'批次编号',key:'batch',width:20},{header:'计入最终汇总',key:'counted',width:18},{header:'计算来源',key:'source',width:40},{header:'首次填写单位',key:'originalUnit',width:16}];
  for(const r of rows)sheet.addRow({date:r.date,group:db.prepare('SELECT name FROM groups WHERE id=?').get(r.groupId)?.name?.replace(/（个人模块）/g,''),product:r.product.displayName||r.product.name,spec:r.product.spec,unit:r.product.unit,original:r.originalQuantity,qty:r.quantity,weight:r.weightKg,status:{pending:'待确认',approved:'已确认',rejected:'已退回'}[r.status],by:r.submittedName,members:r.members.map(m=>m.name).join('、'),id:r.id,mode:r.mode==='leader'?'组长逐人填写':r.mode==='historical-group'?'历史班组总量':r.mode==='shared'?'旧版班组记录':'个人填写',shift:r.shift,batch:r.batchCode,counted:r.counted?'是':r.excludedReason||'已退回',source:String(r.sourceRef||'').replace(/（个人模块）/g,''),originalUnit:r.originalUnit});
  const summary=wb.addWorksheet('实时生产汇总');summary.addRow(['分类','单位','数量']);for(const u of stats.units)summary.addRow([u.category,u.unit,u.quantity]);summary.addRow([]);summary.addRow(['班组','分类','单位','数量']);for(const g of stats.groups)summary.addRow([g.name,g.category,g.unit,g.quantity]);summary.columns.forEach(c=>c.width=23);
  const history=wb.addWorksheet('修改记录');history.addRow(['记录编号','修改人','时间（北京时间）','操作','修改前数量','修改后数量','原因']);for(const r of rows)for(const h of service.history(req.user,r.id))history.addRow([r.id,h.actor,new Date(h.time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),{submit:'首次填写',worker_edit:'工人修改',approve:'核对确认',correct:'管理员更正',reject:'退回重填'}[h.action],h.before.quantity??null,h.after.quantity??null,h.reason]);history.columns.forEach(c=>c.width=25);
  if(hasPermission(req.user,'salary')){
   const pay=wages.summary(req.user,req.query),sheet=wb.addWorksheet('工资计算');
   sheet.addRow(['生产日期','工人','模块','项目','工资均摊量 / 本人量','单位','工资单价','计价方式','基础工资（元）','依据']);
   for(const d of pay.details)sheet.addRow([d.date,d.workerName,d.category,d.productName,d.quantity,d.unit,d.rate,d.basis==='tonne'?'元/吨':'元/填报单位',d.amount,d.source]);
   sheet.addRow([]);sheet.addRow(['个人工资汇总','姓名','基础工资','自动补助','手工补助 / 扣款','合计']);
   for(const p of pay.people)sheet.addRow(['',p.name,p.base,p.automaticSupplements,p.adjustments,p.total===null?'待核定':p.total]);
   sheet.addRow([]);sheet.addRow(['自动补助','姓名','日期','项目','班组总量','单位','单价','除数','金额','计算说明']);
   for(const a of pay.supplements)sheet.addRow(['',a.workerName,a.date,a.name,a.quantity,a.unit,a.rate,a.divisor,a.amount,a.source]);
   sheet.addRow([]);sheet.addRow(['手工补助 / 扣款','姓名','日期','金额','说明']);
   for(const a of pay.adjustments)sheet.addRow(['',a.name,a.date,a.amount,a.reason]);
   sheet.addRow([]);sheet.addRow(['班组日均依据','日期','班组','总重量（公斤）','实际人数','人均吨数','人均基础工资','人均自动补助']);
   for(const c of pay.crews)sheet.addRow(['',c.date,c.groupName,c.totalKg,c.headcount,c.averageTonnes,c.base??'待核定',c.unknownMembers?'待核定':c.small+c.large+c.tonnage]);
   sheet.addRow(['表格空白型号补助使用手工调整；手工金额在自动补助之外叠加。']);
   if(pay.unpricedCount)sheet.addRow([pay.unpricedCount+'笔记录的单价或参与人数待核定']);sheet.columns.forEach(c=>c.width=24);sheet.getColumn(9).numFmt='0.00';
  }
  for(const s of wb.worksheets){s.views=[{state:'frozen',ySplit:1}];s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF203C55'}};s.getRow(1).height=26;}
  res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.set('Content-Disposition',`attachment; filename="production-${stats.from}-${stats.to}.xlsx"`);res.send(Buffer.from(await wb.xlsx.writeBuffer()));
 });
 app.use(express.static(path.join(root,'web'),{setHeaders:res=>res.set('Cache-Control','no-cache')}));
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);const duplicate=/UNIQUE constraint failed/.test(err.message);const malformed=err.type==='entity.parse.failed';const status=duplicate?409:malformed?400:err.status||500;if(status>=500)console.error('服务错误：',err.message);res.status(status).json({error:duplicate?'手机号或名称已存在':malformed?'请求格式不正确':status>=500?'服务暂时不可用，请重试':err.message});});
 return {app,db,service,wages,inventory,reports};
}
