// Read literal input cells only. Cached spreadsheet totals may be stale.
export function inputValue(cell){
 const value=cell.value;
 if(value&&typeof value==='object')return value.richText?.map(t=>t.text).join('')??null;
 return value;
}
export const attendanceMarked=value=>typeof value==='string'&&/^[.\s*＊]+$/.test(value)&&/[*＊]/.test(value);

export function shippingHeaderRows(sheet,index){
 const first=index===0?52:41,last=index===0?85:74,start=[27,25,22][index];
 let best={dateRow:[26,21,18][index],customerRow:[25,22,19][index],score:0};
 for(let dateRow=start-1;dateRow>=start-7;dateRow--)for(const customerRow of [dateRow-1,dateRow+1]){
  if(customerRow>=start)continue;
  let score=0;
  for(let col=first;col<=last;col++){
   const day=inputValue(sheet.getCell(dateRow,col)),customer=inputValue(sheet.getCell(customerRow,col));
   if(Number.isInteger(day)&&day>=1&&day<=31&&typeof customer==='string'&&customer.trim()&&!/发货记录|重量|数量|块数|产量|当月|库存/.test(customer.replace(/\s/g,'')))score++;
  }
  if(score>best.score)best={dateRow,customerRow,score};
 }
 return best;
}
