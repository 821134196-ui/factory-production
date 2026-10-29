import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeQuantity,quantityPattern,setQuantityPrecision} from '../web/quantity-input.js';

test('手机输入法数量保留末尾小数点，并兼容全角数字和中文小数点',()=>{
 for(const [input,expected] of [['12.','12.'],['１２．３４','12.34'],['０。５','0.5'],['.5','.5'],['',''],['.','.']]){
  assert.equal(normalizeQuantity(input),expected);
 }
 assert.equal(normalizeQuantity('错误'),'错误');
});

test('吨数允许两位小数、块数只允许整数，无效文本不可通过数量格式校验',()=>{
 const decimal=new RegExp('^(?:'+quantityPattern(2)+')$','u'),integer=new RegExp('^(?:'+quantityPattern(0)+')$','u');
 for(const value of ['1','1.','1.25','.25','１２．３４','０。５'])assert.equal(decimal.test(value),true,value);
 for(const value of ['','1.234','１．２３４','1e2','-1','+2','1,23','1.2.3','.','NaN','12吨'])assert.equal(decimal.test(value),false,value);
 for(const value of ['1','１２'])assert.equal(integer.test(value),true,value);
 for(const value of ['1.5','１．５','.5','1.','-1'])assert.equal(integer.test(value),false,value);
});

test('切换产品只更新数量精度和键盘，不改写正在输入的内容',()=>{
 const input={value:'１２．',selectionStart:3,selectionEnd:3};
 setQuantityPrecision(input,0);assert.equal(input.inputMode,'numeric');assert.equal(new RegExp('^(?:'+input.pattern+')$','u').test('1.2'),false);
 setQuantityPrecision(input,3);assert.equal(input.inputMode,'decimal');assert.equal(new RegExp('^(?:'+input.pattern+')$','u').test('1.234'),true);
 assert.equal(input.value,'１２．');assert.equal(input.selectionStart,3);assert.equal(input.selectionEnd,3);
});
