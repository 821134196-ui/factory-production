function dateOptions(boot,current){const dates=[...boot.fillDates];if(current&&!dates.includes(current))dates.push(current);return dates.map((id,i)=>{const d=new Date(id+'T00:00:00Z');return {id,name:id===boot.today?'今天':i===1?'昨天':id,detail:Number(id.slice(5,7))+'月'+Number(id.slice(8))+'日 '+['周日','周一','周二','周三','周四','周五','周六'][d.getUTCDay()]};});}
module.exports=dateOptions;
