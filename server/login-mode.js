import {transaction,now} from './db.js';

// Retire codes and sessions issued before SMS became the only login method.
export function initializeSmsLogin(db){
 if(db.prepare("SELECT 1 FROM app_meta WHERE key='sms_login_only_v1'").get())return;
 transaction(db,()=>{
  db.exec('DELETE FROM codes; DELETE FROM sessions');
  db.prepare("INSERT INTO app_meta (key,value) VALUES ('sms_login_only_v1',?)").run(now());
 });
}
