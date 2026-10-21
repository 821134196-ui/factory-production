export function reportDateOptions(today,period,selected){
 const iso=d=>d.toISOString().slice(0,10),start=value=>{const d=new Date(value+'T00:00:00Z');if(period==='week')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);if(period==='month')d.setUTCDate(1);return d;};
 const name=value=>{const d=new Date(value+'T00:00:00Z'),year=d.getUTCFullYear(),month=d.getUTCMonth()+1,day=d.getUTCDate();if(period==='month')return month+'月 · '+year+'年';if(period==='week')return month+'月'+day+'日 · '+year+'年当周';return value===today?'今天 · '+month+'月'+day+'日':month+'月'+day+'日 · '+year+'年';};
 const current=start(today),count=period==='month'?24:period==='week'?52:92,options=Array.from({length:count},(_,i)=>{const d=new Date(current);if(period==='month')d.setUTCMonth(d.getUTCMonth()-i);else d.setUTCDate(d.getUTCDate()-i*(period==='week'?7:1));const id=iso(d);return {id,name:name(id)};});
 const bucket=iso(start(selected)),match=options.find(o=>o.id===bucket);if(match)match.id=selected;else options.push({id:selected,name:name(bucket)});return options;
}
