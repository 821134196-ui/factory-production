// 表格字段保持不变，仅统一网页、小程序和历史记录的展示顺序。
export function productFields(p={}){
 const name=String(p.name||'').trim(),spec=String(p.spec||'').trim();
 let productTitle=name,productDetail=spec==='按吨填写'?'':spec;
 if(p.category==='浇注料'&&spec&&spec!=='按吨填写'){
  productTitle=spec;productDetail=name;
 }
 if(p.category==='装/卸车'){
  productTitle=p.displayName||name;
  productDetail=spec.split(/\s*[·|]\s*/).filter(s=>s&&!/^(装车|卸车|按吨填写)$/.test(s)).join(' · ');
 }
 if(productDetail===productTitle)productDetail='';
 return {productTitle,productDetail,fullName:[productTitle,productDetail].filter(Boolean).join(' · ')};
}
export const fullProductName=p=>productFields(p).fullName;
export function productLabel(p){
 if(p.loadingOperation==='卸车')return p.name.replace(/卸车\s*[·：:]?\s*/g,'').trim()||p.spec.replace(/卸车\s*[·：:]?\s*/g,'').trim();
 return p.productTitle||productFields(p).productTitle;
}
export const productOption=p=>p.loadingOperation==='卸车'?productLabel(p):fullProductName(p);
