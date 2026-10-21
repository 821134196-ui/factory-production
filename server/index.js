import {createApp} from './app.js';
import {configFromEnv} from './config.js';
import {initializeBundledWorkbooks} from './workbook-replacement.js';
const config=configFromEnv(),instance=createApp(config),{app,db}=instance;
try{
 const imported=await initializeBundledWorkbooks(instance,!config.demo&&config.officialRoster&&process.env.IMPORT_BUNDLED_DATA==='true');
 if(imported)console.log(`已初始化${imported.month}表格数据：${imported.records}条生产记录、${imported.extras.shipments}笔发货`);
}catch(error){db.close();throw error;}
const server=app.listen(config.port,config.host,()=>console.log(`生产记工已启动：http://${config.host}:${config.port}（短信登录）`));
function shutdown(){server.close(()=>{db.close();process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
