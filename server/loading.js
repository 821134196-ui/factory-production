import {productFields} from '../web/product-label.js';
// 装卸项目保留原表名称和编号，显示时明确所属作业。
export function loadingFields(product) {
  if (product.category !== '装/卸车') return productFields(product);
  const unloading = ['material-74', 'material-75', 'material-76'].includes(product.id);
  const operation = product.id === 'material-73' ? '装车' : unloading ? '卸车' : /卸车/.test(product.name + ' ' + product.spec) ? '卸车' : /装车/.test(product.name + ' ' + product.spec) ? '装车' : '';
  const fields={loadingOperation: operation, displayName: operation && !product.name.startsWith(operation) ? operation + ' · ' + product.name : product.name};
  return {...fields,...productFields({...product,...fields})};
}
