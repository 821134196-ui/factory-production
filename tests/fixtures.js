import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

// Deliberately synthetic identities and business figures; never copied from a factory.
export const phones={admin:'10000000001',leader:'10000000002',worker:'10000000003',other:'10000000004'};
export async function writeFixtures(folder,{templates=false}={}){
 fs.mkdirSync(folder,{recursive:true});
 const put=(file,data)=>fs.writeFileSync(path.join(folder,file),JSON.stringify(data,null,2));
 put('accounts.json',[
  {name:'测试管理员',phone:phones.admin,role:'admin',isSuperAdmin:true},
  {name:'测试组长',phone:phones.leader,role:'worker',isLeader:true,groupId:'g1'},
  {name:'测试员工甲',phone:phones.worker,role:'worker',groupId:'g1'},
  {name:'测试员工乙',phone:phones.other,role:'worker',groupId:'g2'}
 ]);
 put('catalog.json',[
  {id:'test-precast',name:'测试预制块',spec:'50公斤/块',category:'预制块',unit:'块',precision:0,weightKg:50,groupId:'g1',active:true,source:'测试预制块.xlsx / 一组 / B27:C27'},
  {id:'material-3',name:'测试浇注料',spec:'测试型号',category:'浇注料',unit:'吨',precision:2,groupId:'g4',active:true,source:'测试浇注料.xlsx / 记工 / C6'},
  ...[73,74].map((col,i)=>({id:'material-'+col,name:i?'卸车测试材料':'装车',spec:'按吨填写',category:'装/卸车',unit:'吨',precision:2,groupId:'g5',active:true,source:'测试浇注料.xlsx / 记工 / '+(i?'BV':'BU')+'6'}))
 ]);
 put('staff-roster.json',[]);
 put('shipping-customers.json',{customers:[{id:'test-customer',name:'测试客户'}]});
 put('wage-source.json',{'material-3':{rawRate:12,sourceCell:'C7'},'material-73':{rawRate:3,sourceCell:'BU7'},'material-74':{rawRate:4,sourceCell:'BV7'}});
 put('business-rules.json',{crewLeaders:[['g1','测试组长']],wagePolicy:{precastMode:'crew',precastRate:20,materialMultiplier:1,supplementsConfirmed:true},supplementRates:{small:0,tonnage:0}});
 if(templates){
  const destination=path.join(folder,'templates');fs.mkdirSync(destination,{recursive:true});
  const precast=new ExcelJS.Workbook();for(const name of ['一组','二组','三组','汇总','装卸']){const sheet=precast.addWorksheet(name);for(let row=1;row<=360;row++)sheet.getCell(row,1).value='';}
  const s=precast.worksheets[0];s.getCell('B27').value='测试预制块';s.getCell('C27').value=50;s.getCell('E2').value='测试组长';s.getCell('E3').value='测试员工甲';s.getCell('F27').numFmt='0';
  await precast.xlsx.writeFile(path.join(destination,'precast.xlsx'));
  const material=new ExcelJS.Workbook(),m=material.addWorksheet('记工');for(let row=1;row<=650;row++)m.getCell(row,1).value='';m.getCell('C6').value='测试浇注料';m.getCell('C7').value=12;m.getCell('B8').value='测试组长';m.getCell('B9').value='测试员工甲';
  await material.xlsx.writeFile(path.join(destination,'material.xlsx'));
 }
}
