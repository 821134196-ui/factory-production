// 产品/项目的“最近使用”排序与预制块罐墙/罐口分类。
// 纯函数便于单测；localStorage 读写只在浏览器里生效。
const PREFIX = 'recent-products-v1';
const LIMIT = 80;

export function storageKey(userId, scope) {
  return `${PREFIX}:${userId}:${scope}`;
}

export function recentIds(userId, scope) {
  try {
    if (typeof localStorage === 'undefined') return [];
    const value = JSON.parse(localStorage.getItem(storageKey(userId, scope)) || '[]');
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}

export function rememberProducts(userId, scope, productIds) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const rest = recentIds(userId, scope).filter((id) => !ids.includes(id));
    localStorage.setItem(storageKey(userId, scope), JSON.stringify([...ids, ...rest].slice(0, LIMIT)));
  } catch {
    /* 本地存储不可用时不影响填报 */
  }
}

// 传入的产品列表里，ids 中的排最前（按 ids 的先后），其余保持原有顺序。
export function orderByRecent(products, ids = []) {
  const rank = new Map(ids.map((id, index) => [id, index]));
  const fallback = ids.length;
  return products
    .map((product, index) => ({ product, index }))
    .sort((a, b) => {
      const ra = rank.has(a.product.id) ? rank.get(a.product.id) : fallback + a.index;
      const rb = rank.has(b.product.id) ? rank.get(b.product.id) : fallback + b.index;
      return ra - rb;
    })
    .map((item) => item.product);
}

export function sortProducts(products, userId, scope) {
  return orderByRecent(products, recentIds(userId, scope));
}

// 该客户常发的产品排在最近使用之前，其余仍按最近使用排序。
export function orderForCustomer(products, customerIds = [], ids = []) {
  return orderByRecent(products, [...new Set([...customerIds, ...ids])]);
}

// 产品名称或型号里带客户名称的排在最前，其余保持传入顺序。
export function prioritizeCustomer(products, customer) {
  const needle = String(customer || '').replace(/\s+/g, '');
  if (!needle) return products;
  const matched = products.filter((product) => `${product.name || ''} ${product.spec || ''}`.replace(/\s+/g, '').includes(needle));
  return matched.length ? [...matched, ...products.filter((product) => !matched.includes(product))] : products;
}

// 同一规格的产品（如各班组分别入库的同一种砖）归为一组。
// “灌口/罐口”按厂里习惯视为同一个字，避免发货时出现两条几乎一样的名称。
export function normalizeProductName(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, '').replace(/灌/g, '罐');
}

export function familyKey(product) {
  return [product?.category, normalizeProductName(product?.name), normalizeProductName(product?.spec), product?.unit, product?.weightKg ?? ''].join('|');
}

export function familyGroups(products) {
  const groups = new Map();
  for (const product of products) {
    const key = familyKey(product);
    const list = groups.get(key) || [];
    list.push(product);
    groups.set(key, list);
  }
  return [...groups.values()];
}

// 按当前库存从多到少分摊发货量；库存不足时余量记到库存最多的一条。
export function allocateByBalance(members, quantity) {
  const total = Number(quantity);
  if (!Number.isFinite(total) || total <= 0 || !members.length) return [];
  const ordered = [...members].sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0));
  const result = [];
  let left = total;
  for (const member of ordered) {
    if (left <= 1e-9) break;
    const available = Math.max(0, Number(member.balance) || 0);
    if (available <= 0) continue;
    const take = Math.min(left, available);
    result.push({ productId: member.id, quantity: Number(take.toFixed(6)) });
    left = Number((left - take).toFixed(6));
  }
  if (left > 1e-9) {
    const target = ordered[0];
    const existing = result.find((item) => item.productId === target.id);
    if (existing) existing.quantity = Number((existing.quantity + left).toFixed(6));
    else result.push({ productId: target.id, quantity: left });
  }
  return result;
}

// 预制块：名称或型号里带“罐口”的算罐口料，其余都算罐墙料。
export function precastTab(product) {
  const text = `${product?.name || ''} ${product?.spec || ''}`;
  return /罐口/.test(text) ? '罐口料' : '罐墙料';
}
