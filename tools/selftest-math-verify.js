#!/usr/bin/env node
/*
 * math-verify.js の自己テスト。
 * 検証ライブラリ自体が正しく計算できることを確かめる（問題データの検証の前提）。
 *   node tools/selftest-math-verify.js
 */
'use strict';
const path = require('path');
const M = require(path.join(__dirname, '..', 'js', 'lib', 'math-verify.js'));

const R = M.Rational;
const env = { x: R.of(2), a: R.of(-3), b: R.of(5) };
let failed = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${label.padEnd(56)} => ${got}${ok ? '' : `   (期待値 ${want})`}`);
}

console.log('--- 式の評価（x=2, a=-3, b=5）');
const exprs = [
  ['-3^2', '-9'],
  ['(-3)^2', '9'],
  ['-(-7)^3', '343'],
  ['8-6\\div(-2)', '11'],
  ['12\\div(-3)\\times(-2)', '8'],
  ['\\left(-\\frac{3}{4}\\right)\\div\\frac{9}{8}\\times(-6)', '4'],
  ['=\\frac{1}{2}x+3', '4'],
  ['x\\div3x', '1/3'], // 3x をひとかたまりとみなす：2÷6
  ['0.15x-0.3', '0'],
  ['-(-4)^2+3\\times(-4)', '-28'],
  ['2^{3}', '8'],
  ['5-(-3)^2\\times2+12\\div(-4)', '-16'],
  ['\\{1+2\\}\\times3', '9'],
  ['\\left\\{1+2\\right\\}\\times(-1)', '-3'],
  ['a\\times a\\times b\\div3', '15'],
  ['\\frac{a^2b}{3}', '15'],
  ['-\\frac{2}{3}\\times\\left(-\\frac{9}{4}\\right)', '3/2'],
  ['(-12)\\times\\frac{3}{4}-(-12)\\times\\frac{5}{6}+8', '9'],
  ['\\frac{3(3x-1)-2(x-2)}{6}', '5/2'],
  ['\\dfrac{1}{2}\\cdot4', '2'],
];
for (const [s, want] of exprs) {
  const p = M.parseLine(s, 'expression');
  check(s, p.ok ? M.evaluate(p.ast, env).toString() : 'ERR ' + p.error, want);
}

console.log('--- 解析エラーになるべき式');
for (const s of ['2 3', 'x^', '(1+2', '1=2', '\\sqrt{2}', 'x^{-1}']) {
  const p = M.parseLine(s, 'expression');
  check(s, p.ok ? 'parsed' : 'error', 'error');
}

console.log('--- 方程式の解集合');
const eqs = [
  ['3x+5=11', 'x=2'],
  ['x=\\frac{5}{12}\\times\\left(-\\frac{2}{3}\\right)', 'x=-5/18'],
  ['-12=3x', 'x=-4'],
  ['2x=2x', 'すべての数（恒等式）'],
  ['2x=2x+1', '解なし'],
  ['x^2=4', '判定不能'],
  ['\\frac{1}{x}=2', '判定不能'],
  ['0.15x-0.3=0.2x+0.1', 'x=-8'],
  ['x+y=3', '判定不能'],
];
for (const [s, want] of eqs) check(s, M.describeSolution(M.solutionSet(M.parseLine(s, 'equation'))), want);

console.log('--- 等価性');
const cmp = (a, b, mode, sub) => M.compareLines(M.parseLine(a, mode), M.parseLine(b, mode), mode, sub).result;
check('2(x+3) ≡ 2x+6', cmp('2(x+3)', '=2x+6', 'expression'), 'equal');
check('2(x+3) ≢ 2x+3', cmp('2(x+3)', '=2x+3', 'expression'), 'different');
check('3x+5=11 ≡ 3x=6', cmp('3x+5=11', '3x=6', 'equation'), 'equal');
check('3x+5=11 ≢ 3x=16', cmp('3x+5=11', '3x=16', 'equation'), 'different');
check('a=-3 で 2a^2 ≡ 2\\times(-3)^2', cmp('2a^2', '=2\\times(-3)^2', 'expression', { a: R.of(-3) }), 'equal');
check('a=-3 で 2a^2 ≢ 2\\times-9 相当', cmp('2a^2', '=-18', 'expression', { a: R.of(-3) }), 'different');

console.log(failed === 0 ? '\nすべて成功しました。' : `\n${failed} 件失敗しました。`);
process.exit(failed === 0 ? 0 : 1);
