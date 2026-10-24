function dateLabel(id,today){if(id===today)return id.slice(5)+' 今天';const yesterday=new Date(today+'T00:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);return id===yesterday.toISOString().slice(0,10)?id.slice(5)+' 昨天':id;}
function dateOptions(boot,current){const dates=[...(boot.fillDates||[])];if(current&&!dates.includes(current))dates.push(current);return dates.map(id=>({id,name:dateLabel(id,boot.today)}));}
module.exports=dateOptions;module.exports.dateLabel=dateLabel;
