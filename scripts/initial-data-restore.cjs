// Generated data scripts are private files. Only this empty runtime belongs in Git.
function restoreInitialData(encoded,expectedHash,args=process.argv.slice(2)){
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
 const options={docker:false,target:null};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--docker'&&!options.docker)options.docker=true;
  else if(args[i]==='--target'&&!options.target&&args[i+1]&&!args[i+1].startsWith('--'))options.target=args[++i];
  else if(args[i]==='--help'){
   console.log('用法：node 恢复初始化数据.cjs [--docker] [--target 项目目录]');
   console.log('Linux + Docker：node 恢复初始化数据.cjs --docker，然后执行 docker compose up -d --build --wait。');
   return;
  }else throw new Error('用法：node 恢复初始化数据.cjs [--docker] [--target 项目目录]');
 }
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major<22||major===22&&minor<13)throw new Error('请安装Node.js 22.13或以上版本');
 const {DatabaseSync}=require('node:sqlite');
 const root=path.resolve(options.target||process.cwd()),packageFile=path.join(root,'package.json');
 if(!fs.existsSync(packageFile)||JSON.parse(fs.readFileSync(packageFile,'utf8')).name!=='factory-production')throw new Error('请在拉取后的factory-production项目根目录执行');
 if(options.docker&&process.platform==='linux'&&![0,1000].includes(process.getuid()))throw new Error('Linux Docker恢复请使用sudo node执行，以设置容器用户UID 1000的读写权限');
 const assertParents=dest=>{
  for(let dir=dest;;dir=path.dirname(dir)){
   if(fs.existsSync(dir)&&fs.lstatSync(dir).isSymbolicLink())throw new Error('恢复目录不能包含符号链接');
   if(dir===path.dirname(dir))break;
  }
 };
 assertParents(root);
 for(const name of ['private-data','data']){
  const dir=path.join(root,name);assertParents(dir);
  if(fs.existsSync(dir)&&(!fs.statSync(dir).isDirectory()||fs.readdirSync(dir).length))throw new Error('目标已有'+name+'资料，已停止以免覆盖。请在新拉取且未启动的项目中执行');
 }
 const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex'),compressed=Buffer.from(encoded,'base64');
 if(hash(compressed)!==expectedHash)throw new Error('脚本数据校验失败，请重新复制完整脚本');
 const payload=JSON.parse(zlib.brotliDecompressSync(compressed,{maxOutputLength:256*1024*1024}).toString('utf8'));
 if(payload.format!==1||!Array.isArray(payload.files)||!payload.files.length||!payload.blobs)throw new Error('初始化数据格式不正确');
 const names=new Set(),files=payload.files.map(entry=>{
  const name=entry.name;
  if(typeof name!=='string'||name.includes('\\')||name.includes('\0')||name.split('/').some(part=>!part||part==='.'||part==='..')||!(/^(?:\.env|private-data\/(?:accounts|staff-roster|catalog|shipping-customers|wage-source|opening-stock-2026-10|business-rules)\.json|private-data\/(?:templates|source-data)\/[\w./-]+\.(?:json|xlsx)|data\/production\.sqlite)$/.test(name))||names.has(name))throw new Error('初始化数据包含非法或重复路径');
  names.add(name);
  if(typeof payload.blobs[entry.sha256]!=='string')throw new Error('初始化数据不完整');
  const buffer=Buffer.from(payload.blobs[entry.sha256],'base64');
  if(hash(buffer)!==entry.sha256)throw new Error('初始化文件校验失败');
  return {name,buffer};
 });
 if(!names.has('data/production.sqlite'))throw new Error('初始化数据缺少业务数据库');
 if(options.docker&&!names.has('.env'))throw new Error('Docker初始化需要短信配置，请在有本地.env的电脑重新生成初始化脚本');
 const configFiles=[...(names.has('.env')?['.env']:[]),...(options.docker?['.env.docker','compose.override.yaml']:[])];
 for(const name of configFiles){
  const dest=path.join(root,name);assertParents(dest);
  if(fs.existsSync(dest))throw new Error('目标已有'+name+'配置，已停止以免覆盖。请在新拉取且未配置的项目中执行');
 }
 const stage=fs.mkdtempSync(path.join(root,'.initial-data-restore-')),moved=[];
 try{
  const serialize=config=>Object.entries(config).map(([key,value])=>{
   // Single quotes preserve literal dollar signs when Compose reads env files.
   if(/['\r\n\0]/.test(value))throw new Error('配置包含不支持的单引号或换行：'+key);
   return key+"='"+value+"'";
  }).join('\n')+'\n';
  for(const {name,buffer}of files){
   const file=path.join(stage,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
   // Each restored installation gets its own session-signing secret.
   let content=buffer;
   if(name==='.env'){
    const config=require('node:util').parseEnv(buffer.toString('utf8'));
    config.APP_SECRET=crypto.randomBytes(32).toString('hex');
    if(process.platform==='linux'||options.docker)config.HOST='0.0.0.0';
    if(options.docker){
     const dockerConfig={...config,HOST:'0.0.0.0',PORT:'3188',DB_PATH:'/app/data/production.sqlite',PRIVATE_DATA_DIR:'/app/private-data',BACKUP_DIR:'/app/backups'};
     fs.writeFileSync(path.join(stage,'.env.docker'),serialize(dockerConfig),{flag:'wx',mode:0o600});
     Object.assign(config,{APP_ENV_FILE:'.env.docker',WEB_BIND:'0.0.0.0',WEB_PORT:'8080'});
    }
    content=serialize(config);
   }
   fs.writeFileSync(file,content,{flag:'wx',mode:0o600});
  }
  if(options.docker){
   const override='services:\n  app:\n    volumes:\n      - type: bind\n        source: ./data\n        target: /app/data\n        bind:\n          create_host_path: false\n';
   fs.writeFileSync(path.join(stage,'compose.override.yaml'),override,{flag:'wx',mode:0o600});
  }
  const db=new DatabaseSync(path.join(stage,'data','production.sqlite'),{readOnly:true});
  let records=0;
  try{
   if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('业务数据库校验失败');
   records=db.prepare('SELECT count(*) n FROM records').get().n;
   for(const table of ['codes','sessions'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)&&db.prepare('SELECT count(*) n FROM '+table).get().n)throw new Error('初始化数据不应包含登录会话或验证码');
  }finally{db.close();}
  if(process.platform==='linux'){
   const permissions=dir=>{
    for(const item of fs.readdirSync(dir,{withFileTypes:true})){
     const file=path.join(dir,item.name);if(item.isDirectory())permissions(file);else{
      fs.chmodSync(file,0o600);if(options.docker&&process.getuid()===0)fs.chownSync(file,1000,1000);
     }
    }
    fs.chmodSync(dir,0o700);if(options.docker&&process.getuid()===0)fs.chownSync(dir,1000,1000);
   };
   for(const name of ['data','private-data'])permissions(path.join(stage,name));
  }
  try{
   for(const name of ['private-data','data']){
    const dest=path.join(root,name);assertParents(dest);
    if(fs.existsSync(dest))fs.rmdirSync(dest); // Only an empty directory can be removed.
    fs.renameSync(path.join(stage,name),dest);moved.push(name);
   }
   for(const name of configFiles){
    assertParents(path.join(root,name));
    fs.copyFileSync(path.join(stage,name),path.join(root,name),fs.constants.COPYFILE_EXCL);moved.push(name);
   }
  }catch(error){
   for(const name of moved.reverse()){
    if(configFiles.includes(name))fs.unlinkSync(path.join(root,name));
    else fs.renameSync(path.join(root,name),path.join(stage,name));
   }
   throw error;
  }
  console.log('初始化完成：已恢复'+records+'条生产记录及人员、产品、发货、库存、工资和表格模板。');
  if(options.docker){
   console.log('Docker配置和文件权限已准备好，已设置使用恢复出的数据库。');
   console.log('下一步：docker compose up -d --build --wait');
   console.log('手机访问：http://服务器IP:8080');
  }else console.log(names.has('.env')?'短信登录配置也已恢复，可运行npm ci和npm start。':'本地.env短信配置需单独配置；配置好后运行npm start。');
  return {files:files.length+configFiles.filter(name=>!names.has(name)).length,records,docker:options.docker};
 }finally{
  if(stage&&path.dirname(stage)===root&&path.basename(stage).startsWith('.initial-data-restore-'))fs.rmSync(stage,{recursive:true,force:true});
 }
}
module.exports={restoreInitialData};
