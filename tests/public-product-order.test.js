import test from 'node:test';
import assert from 'node:assert/strict';
import {orderByRecent, orderForCustomer, precastTab, storageKey, familyKey, allocateByBalance, prioritizeCustomer, normalizeProductName, skuKey, collapseSkuMembers} from '../web/product-order.js';
import {groupInventoryRows, pickShipmentProduct} from '../web/inventory-ui.js';
import {resolvePrecastGroup} from '../web/precast-ui.js';

const products = [{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'd'}];

test('最近使用的产品排在最前，其余保持原有顺序', () => {
  assert.deepEqual(orderByRecent(products, ['c', 'a']).map((p) => p.id), ['c', 'a', 'b', 'd']);
});

test('没有使用记录时保持原顺序', () => {
  assert.deepEqual(orderByRecent(products, []).map((p) => p.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(orderByRecent(products).map((p) => p.id), ['a', 'b', 'c', 'd']);
});

test('最近记录里已下架的产品不影响其余排序', () => {
  assert.deepEqual(orderByRecent(products, ['gone', 'd']).map((p) => p.id), ['d', 'a', 'b', 'c']);
});

test('客户常发产品优先于最近使用，再按最近使用排列', () => {
  assert.deepEqual(orderForCustomer(products, ['c'], ['d', 'a']).map((p) => p.id), ['c', 'd', 'a', 'b']);
});

test('预制块按罐口/罐墙分类，名称或型号带罐口即为罐口料', () => {
  assert.equal(precastTab({name: '样例罐口1#', spec: '197公斤/块'}), '罐口料');
  assert.equal(precastTab({name: '样例直砖', spec: '62公斤/块'}), '罐墙料');
  assert.equal(precastTab({name: '特制砖', spec: '罐口料'}), '罐口料');
  assert.equal(precastTab({}), '罐墙料');
});

test('最近使用记录按用户和场景隔离', () => {
  assert.notEqual(storageKey('u1', 'report:预制块'), storageKey('u2', 'report:预制块'));
  assert.notEqual(storageKey('u1', 'report:预制块'), storageKey('u1', 'ship:预制块'));
});

test('不同班组的同规格预制块是不同 SKU，同班组才合并', () => {
  const base = {category: '预制块', name: '样例砖', spec: '62公斤/块', unit: '块', weightKg: 62, groupId: 'g1'};
  assert.notEqual(familyKey(base), familyKey({...base, groupId: 'g2'}));
  assert.equal(familyKey(base), familyKey({...base, id: 'other'}));
  assert.notEqual(familyKey(base), familyKey({...base, weightKg: 60}));
});

test('灌口与罐口视为同一名称，空格忽略（仅限同一班组）', () => {
  const base = {category: '预制块', name: '样例罐口1#', spec: '197公斤/块', unit: '块', weightKg: 197, groupId: 'g3'};
  assert.equal(familyKey(base), familyKey({...base, name: '样例灌口1#'}));
  assert.notEqual(familyKey(base), familyKey({...base, name: '样例灌口1#', groupId: 'g1'}));
  assert.equal(normalizeProductName(' 样例 灌口 1# '), '样例罐口1#');
});

test('产品名称或型号带客户名称的排在最前', () => {
  const list = [
    {id: 'a', name: '样例砖', spec: '62公斤/块'},
    {id: 'b', name: '示例客户甲罐口1#', spec: '197公斤/块'},
    {id: 'c', name: '示例客户乙卡砖1#', spec: '64公斤/块'},
    {id: 'd', name: '0-1', spec: '破碎示例客户甲废砖料'},
  ];
  assert.deepEqual(prioritizeCustomer(list, '示例客户甲').map((p) => p.id), ['b', 'd', 'a', 'c']);
  assert.deepEqual(prioritizeCustomer(list, '示例客户乙').map((p) => p.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(prioritizeCustomer(list, '').map((p) => p.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(prioritizeCustomer(list, '不存在的客户').map((p) => p.id), ['a', 'b', 'c', 'd']);
});

test('发货量按库存从多到少分摊，库存不足时余量记到库存最多的一条', () => {
  const members = [{id: 'a', balance: 10}, {id: 'b', balance: 30}];
  assert.deepEqual(allocateByBalance(members, 25), [{productId: 'b', quantity: 25}]);
  assert.deepEqual(allocateByBalance(members, 35), [{productId: 'b', quantity: 30}, {productId: 'a', quantity: 5}]);
  assert.deepEqual(allocateByBalance(members, 50), [{productId: 'b', quantity: 40}, {productId: 'a', quantity: 10}]);
  assert.deepEqual(allocateByBalance([], 5), []);
});

test('填报班组优先上次选择，其次登录人班组，最后第一个预制块班组', () => {
  const groups = [{id: 'g1', name: '一班'}, {id: 'g2', name: '二班'}, {id: 'g3', name: '三班'}, {id: 'g4', name: '浇注料'}, {id: 'g5', name: '装卸'}];
  assert.equal(resolvePrecastGroup(groups, 'g1', 'g2'), 'g2');
  assert.equal(resolvePrecastGroup(groups, 'g1', 'g4'), 'g1');
  assert.equal(resolvePrecastGroup(groups, 'g3', ''), 'g3');
  assert.equal(resolvePrecastGroup(groups, null, ''), 'g1');
  assert.equal(resolvePrecastGroup([], null, ''), 'g3');
});

test('发货产品按名称规格跨班组合并成一个选项，班组单独选', () => {
  const base = {category: '预制块', name: '样例砖', spec: '62公斤/块', unit: '块', weightKg: 62, groupId: 'g1'};
  assert.equal(skuKey(base), skuKey({...base, groupId: 'g2'}));
  assert.notEqual(familyKey(base), familyKey({...base, groupId: 'g2'}));
});

test('发货 SKU 按班组去重，同班组灌/罐写法只保留一条', () => {
  const base = {category: '预制块', name: '样例罐口1#', spec: '197公斤/块', unit: '块', weightKg: 197};
  const products = [{...base, id: 'a', groupId: 'g1'}, {...base, id: 'b', groupId: 'g2'}, {...base, id: 'c', groupId: 'g1', name: '样例灌口1#'}];
  const members = [...collapseSkuMembers(products).values()][0];
  assert.equal(members.length, 2);
  assert.equal(members.find((member) => member.groupId === 'g1').id, 'a');
});

test('发货班组解析：优先所选班组，其次登录人班组，最后第一个', () => {
  const members = [{id: 'x', groupId: 'g1'}, {id: 'y', groupId: 'g2'}];
  assert.equal(pickShipmentProduct(members, 'g2', 'g1').id, 'y');
  assert.equal(pickShipmentProduct(members, '', 'g1').id, 'x');
  assert.equal(pickShipmentProduct(members, '', 'g3').id, 'x');
  assert.equal(pickShipmentProduct([], 'g1', 'g1'), null);
});

test('库存统计只合并同班组的同规格记录，不同班组保持分开', () => {
  const product = {category: '预制块', name: '样例砖', spec: '62公斤/块', unit: '块', weightKg: 62};
  const rows = [
    {product: {...product, id: 'a', groupId: 'g1', name: '样例罐口1#'}, balance: 10, opening: 5, produced: 5, shipped: 0, weightTonnes: 0.62, physical: null, difference: null, issue: ''},
    {product: {...product, id: 'b', groupId: 'g1', name: '样例灌口1#'}, balance: 20, opening: 0, produced: 20, shipped: 0, weightTonnes: 1.24, physical: null, difference: null, issue: ''},
    {product: {...product, id: 'c', groupId: 'g2'}, balance: 7, opening: 0, produced: 7, shipped: 0, weightTonnes: 0.434, physical: null, difference: null, issue: ''},
  ];
  const state = {boot: {groups: [{id: 'g1', name: '一班'}, {id: 'g2', name: '二班'}]}};
  const grouped = groupInventoryRows(rows, state);
  assert.equal(grouped.length, 2);
  const merged = grouped.find((row) => row.members);
  assert.equal(merged.balance, 30);
  assert.equal(merged.opening, 5);
  assert.equal(merged.produced, 25);
  assert.equal(merged.members.length, 2);
  assert.match(merged.issue, /合并显示/);
  assert.equal(grouped.find((row) => row.product.groupId === 'g2').balance, 7);
});
