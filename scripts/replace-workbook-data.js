import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server/app.js';
import {configFromEnv} from '../server/config.js';
import {prepareWorkbookReplacement,applyWorkbookReplacement} from '../server/workbook-replacement.js';
import {backupDatabase} from './backup.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),config=configFromEnv(),apply=process.argv.includes('--apply'),stamp=new Date().toISOString().replace(/[:.]/g,'-');
if(!fs.existsSync(config.dbPath))throw new Error('请先启动项目初始化数据库');
const storageRoot=process.env.NODE_ENV==='production'?path.dirname(config.dbPath):root;
const rehearsalPath=path.join(storageRoot,'qa','workbook-replacement-'+stamp+'.sqlite');
backupDatabase(config.dbPath,rehearsalPath);
const rehearsal=createApp({...config,dbPath:rehearsalPath});let plan,report;
try{plan=await prepareWorkbookReplacement(rehearsal);report=applyWorkbookReplacement(rehearsal,plan);}finally{rehearsal.db.close();}
if(apply){
 const backup=backupDatabase(config.dbPath,path.join(process.env.BACKUP_DIR||path.join(root,'backups'),'before-workbook-replacement-'+stamp+'.sqlite'));
 const live=createApp(config);try{report=applyWorkbookReplacement(live,plan,{backupFile:backup.file});}finally{live.db.close();}
}
fs.mkdirSync(path.join(storageRoot,'reports'),{recursive:true});
const output=path.join(storageRoot,'reports','2026-10-workbook-replacement-'+(apply?'applied':'preview')+'.json');fs.writeFileSync(output,JSON.stringify({mode:apply?'applied':'preview',...report},null,2)+'\n');
console.log(JSON.stringify({mode:apply?'applied':'preview',month:report.month,records:report.records,production:report.production,extras:report.extras,attendanceDays:report.attendanceDays,wages:{total:report.wages.total,base:report.wages.base,automaticSupplements:report.wages.automaticSupplements},inventory:report.inventory,loadingDifferences:report.loadingDifferences,backupFile:report.backupFile,report:output},null,2));
