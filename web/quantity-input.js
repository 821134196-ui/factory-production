// Some Android WebViews reject IME input in type=number before it reaches the page.
// Keep the editable text intact and validate on submit, with the numeric keyboard.
export function normalizeQuantity(value){
 return String(value??'').trim().replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xff10)).replace(/[．。]/g,'.');
}
export function quantityPattern(precision){
 const digits='[0-9０-９]';
 return precision===0?digits+'+':`(?:${digits}+(?:[.．。]${digits}{0,${precision}})?|[.．。]${digits}{1,${precision}})`;
}
export function quantityInputAttributes(precision=2){
 return `type="text" inputmode="${precision===0?'numeric':'decimal'}" pattern="${quantityPattern(precision)}" title="${precision===0?'请输入大于0的整数':'请输入大于0的数量，最多'+precision+'位小数'}" autocomplete="off" enterkeyhint="next"`;
}
export function setQuantityPrecision(input,precision=2){
 input.inputMode=precision===0?'numeric':'decimal';
 input.pattern=quantityPattern(precision);
 input.title=precision===0?'请输入大于0的整数':'请输入大于0的数量，最多'+precision+'位小数';
}
