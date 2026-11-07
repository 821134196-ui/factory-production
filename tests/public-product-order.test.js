import test from 'node:test';
import assert from 'node:assert/strict';
import {orderByRecent, orderForCustomer, precastTab, storageKey, familyKey, allocateByBalance, prioritizeCustomer, normalizeProductName} from '../web/product-order.js';
import {groupInventoryRows} from '../web/inventory-ui.js';

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

test('同一规格跨班组视为同一产品，规格不同则不合并', () => {
  const base = {category: '预制块', name: '样例砖', spec: '62公斤/块', unit: '块', weightKg: 62};
  assert.equal(familyKey({...base, groupId: 'g1'}), familyKey({...base, groupId: 'g2'}));
  assert.notEqual(familyKey(base), familyKey({...base, weightKg: 60}));
});

test('灌口与罐口视为同一名称，空格忽略', () => {
  const base = {category: '预制块', name: '样例罐口1#', spec: '197公斤/块', unit: '块', weightKg: 197};
  assert.equal(familyKey(base), familyKey({...base, name: '样例灌口1#', groupId: 'g3'}));
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

test('库存统计把同一规格的多个班组记录合并成一条并求和', () => {
  const product = {category: '预制块', name: '样例砖', spec: '62公斤/块', unit: '块', weightKg: 62};
  const rows = [
    {product: {...product, id: 'a', groupId: 'g1'}, balance: 10, opening: 5, produced: 5, shipped: 0, weightTonnes: 0.62, physical: null, difference: null, issue: ''},
    {product: {...product, id: 'b', groupId: 'g2'}, balance: 20, opening: 0, produced: 20, shipped: 0, weightTonnes: 1.24, physical: null, difference: null, issue: ''},
  ];
  const state = {boot: {groups: [{id: 'g1', name: '一班'}, {id: 'g2', name: '二班'}]}};
  const grouped = groupInventoryRows(rows, state);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].balance, 30);
  assert.equal(grouped[0].opening, 5);
  assert.equal(grouped[0].produced, 25);
  assert.equal(grouped[0].members.length, 2);
  assert.match(grouped[0].issue, /合并显示/);
});
