import {randomUUID} from 'node:crypto';
import {fail,text} from './service.js';
import {now} from './db.js';
import {canReadShipping,canWriteShipping} from './inventory.js';

export function registerShipmentFiles(app,db){
 db.exec(`CREATE TABLE IF NOT EXISTS shipment_files (id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL)`);
 app.post('/api/shipment-files',(req,res)=>{
  if(!canWriteShipping(req.user))fail(403,'没有上传泵单权限');
  const name=text(req.body.name,'文件名',160),base64=req.body.base64;
  if(typeof base64!=='string'||!base64.length||base64.length>8*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))fail(400,'请选择不超过6MB的图片或PDF');
  const data=Buffer.from(base64,'base64');if(!data.length||data.length>6*1024*1024)fail(400,'文件不能超过6MB');
  const mime=data.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'?'image/webp':data.toString('ascii',0,5)==='%PDF-'?'application/pdf':'';
  if(!mime)fail(400,'泵单只支持JPG、PNG、WebP图片或PDF');
  const id=randomUUID();db.prepare('INSERT INTO shipment_files VALUES (?,?,?,?,?,?)').run(id,name,mime,data,req.user.id,now());res.status(201).json({file:{id,name,mime}});
 });
 app.get('/api/shipment-files/:id',(req,res)=>{
  if(!canReadShipping(req.user))fail(403,'没有查看泵单权限');
  const file=db.prepare('SELECT * FROM shipment_files WHERE id=?').get(req.params.id);if(!file)fail(404,'泵单不存在');
  const linked=db.prepare("SELECT 1 FROM shipments WHERE pump_file_id=? AND deleted_at='' LIMIT 1").get(file.id);
  if(!linked&&file.created_by!==req.user.id)fail(403,'不能查看未保存的泵单');
  res.type(file.mime).set('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`).send(Buffer.from(file.data));
 });
}
