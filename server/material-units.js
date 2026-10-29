const BAGGED = new Map([
  ['material-3', 50],
  ['material-4', 50],
  ['material-9', 50],
  ['material-10', 50],
  ['material-13', 50],
  ['material-14', 50],
  ['material-16', 25],
  ['material-17', 5],
  ['material-18', 5],
  ['material-19', 1000],
  ['material-20', 40],
  ['material-23', 376 / 100],
  ['material-24', 2.6],
  ['material-30', 50],
  ['material-31', 50],
  ['material-32', 50],
  ['material-33', 50],
  ['material-34', 50],
  ['material-41', 50],
  ['material-42', 50],
  ['material-44', 50],
]);

const KG = new Set(Array.from({length: 20}, (_, index) => `material-${48 + index}`));

export function materialUnitSpec(productOrId) {
  const id = typeof productOrId === 'string' ? productOrId : productOrId?.id;
  if (BAGGED.has(id)) return { unit: '袋', precision: 0, weightKg: BAGGED.get(id) };
  if (KG.has(id)) return { unit: 'kg', precision: 3, weightKg: null };
  return null;
}

export function unitKg(product) {
  if (!product) return null;
  if (product.unit === '吨') return 1000;
  if (product.unit === 'kg' || product.unit === '公斤') return 1;
  if (product.unit === '袋') return product.weightKg == null ? null : Number(product.weightKg);
  if (product.unit === '块') return product.weightKg == null ? null : Number(product.weightKg);
  return product.weightKg == null ? null : Number(product.weightKg);
}

export function quantityToKg(product, quantity) {
  const perUnit = unitKg(product);
  if (perUnit == null || quantity == null || !Number.isFinite(Number(quantity))) return null;
  return Number(quantity) * perUnit;
}

export function quantityToTonnes(product, quantity) {
  const kg = quantityToKg(product, quantity);
  return kg == null ? null : kg / 1000;
}

export function wageBasisForProduct(product) {
  if (product?.unit === '袋' || product?.unit === 'kg' || product?.unit === '公斤') return 'quantity';
  return 'tonne';
}

export function isConfiguredMaterial(productOrId) {
  return !!materialUnitSpec(productOrId);
}

export const configuredMaterialIds = () => [...BAGGED.keys(), ...KG.keys()];
