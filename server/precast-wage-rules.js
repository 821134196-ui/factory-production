import {businessRules} from './private-data.js';
// 原始预制块工作簿底部公式；行号是产品来源坐标，不能按名称关键词猜补助。
export const precastWageRules = businessRules.precastWageRules||{"g1":{"sheet":"一组","countRow":12,"totalKgRow":336,"averageKgRow":338,"baseRow":339,"smallRow":341,"complexRow":342,"largeRow":343,"tonnageRow":345,"supplementRow":346,"small":[],"large":[]},"g2":{"sheet":"二组","countRow":13,"totalKgRow":197,"averageKgRow":199,"baseRow":200,"smallRow":202,"complexRow":203,"largeRow":204,"tonnageRow":206,"supplementRow":207,"small":[],"large":[]},"g3":{"sheet":"三组","countRow":11,"totalKgRow":136,"averageKgRow":138,"baseRow":139,"smallRow":141,"complexRow":142,"largeRow":143,"tonnageRow":145,"supplementRow":146,"small":[],"large":[]}};
export function sourceProductRow(product){return Number(product.source?.match(/B(\d+):C\d+$/)?.[1])||null;}
export function precastSupplements(records,headcount){
 const rule=precastWageRules[records[0]?.groupId];if(!rule||!headcount)return [];
 const quantity=row=>records.filter(r=>sourceProductRow(r.product)===row).reduce((n,r)=>n+r.quantity,0);
 const tonnes=records.reduce((n,r)=>n+(r.weightKg??0)/1000,0),items=[];
 if(rule.small.length)items.push({kind:'small',name:'小砖补助',quantity:rule.small.reduce((n,row)=>n+quantity(row),0),rate:businessRules.supplementRates?.small??0,divisor:headcount,source:rule.sheet+'!F'+rule.smallRow+'：指定型号块数×1元÷当日人数'});
 if(rule.large.length)for(const [row,rate] of rule.large){const matching=records.find(r=>sourceProductRow(r.product)===row);if(matching)items.push({kind:'large',name:'大砖补助 · '+(matching.product.fullName||matching.product.name),quantity:quantity(row),rate,divisor:1,source:rule.sheet+'!F'+rule.largeRow+'：该型号块数×'+rate+'元（原公式未除以人数）'});}
 items.push({kind:'tonnage',name:'产量补助',quantity:tonnes,rate:businessRules.supplementRates?.tonnage??0,divisor:headcount,source:rule.sheet+'!F'+rule.tonnageRow+'：当日总吨数×10元÷当日人数；原公式无2.8吨条件'});
 return items.map(item=>({...item,unit:item.kind==='tonnage'?'吨':'块',amount:item.quantity*item.rate/item.divisor}));
}
