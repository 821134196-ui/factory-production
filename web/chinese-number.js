export function chineseNumber(n){const a=['零','一','二','三','四','五','六','七','八','九'];if(n<10)return a[n];if(n===100)return '一百';return (n<20?'':a[Math.floor(n/10)])+'十'+(n%10?a[n%10]:'');}
