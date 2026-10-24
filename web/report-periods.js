import {dateLabel} from './date-options.js';
export function reportDateOptions(today,period,selected){
 const iso=d=>d.toISOString().slice(0,10),start=value=>{const d=new Date(value+'T00:00:00Z');if(period==='week')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);if(period==='month')d.setUTCDate(1);return d;};
 const name=value=>period==='month'?value.slice(0,7):period==='day'?dateLabel(value,today):value;
 const current=start(today),count=period==='month'?24:period==='week'?52:92,options=Array.from({length:count},(_,i)=>{const d=new Date(current);if(period==='month')d.setUTCMonth(d.getUTCMonth()-i);else d.setUTCDate(d.getUTCDate()-i*(period==='week'?7:1));const id=iso(d);return {id,name:name(id)};});
 const bucket=iso(start(selected)),match=options.find(o=>o.id===bucket);if(match)match.id=selected;else options.push({id:selected,name:name(bucket)});return options;
}
