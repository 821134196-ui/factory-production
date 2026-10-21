export function checkDatabaseMode(db,config){
 const mode=config.demo?'demo':'production',previous=db.prepare("SELECT value FROM app_meta WHERE key='database_mode'").get()?.value;
 const hasDemo=db.prepare("SELECT 1 FROM records WHERE deleted_at='' AND payload_hash='seed' AND version=1 AND id IN ('demo-1','demo-2','demo-material-1','demo-material-2') LIMIT 1").get();
 if((previous&&previous!==mode)||(!config.demo&&hasDemo)){db.close();throw new Error('演示与正式数据库需要分开，请配置独立的DB_PATH。');}
 db.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES ('database_mode',?)").run(mode);
}
export function configureWebServer(app,db,config){
 app.set('trust proxy',config.trustProxy||false);
 app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('X-Frame-Options','DENY');res.set('Referrer-Policy','same-origin');res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");if(req.path.startsWith('/api/')||req.path==='/healthz')res.set('Cache-Control','no-store');next();});
 app.get('/healthz',(req,res)=>{db.prepare('SELECT 1').get();res.json({ok:true});});
}
