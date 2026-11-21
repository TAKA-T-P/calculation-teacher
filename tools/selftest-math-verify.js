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
for (const s of ['2 3', 'x^', '(1+2', '1=2', '\\sqrt[3]{2}', 'x^{-1}']) { // \sqrt{2} は第6段階から対応（累乗根は対象外）
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

// ================================================================ 第6段階（中2・中3）
const r = String.raw;
const val = (s) => { try { return M.evaluate(M.parseExpression(s), {}).toString(); } catch (e) { return `エラー:${e.message}`; } };
const eqv = (a, b) => cmp(a, b, 'expression');

console.log('--- 中2 式の計算（複数の文字・指数・分数係数・分配法則）');
check('3a^2b\\times(-2ab^3) ≡ -6a^3b^4', eqv(r`3a^2b\times(-2ab^3)`, r`=-6a^3b^4`), 'equal');
check('3a^2b\\times(-2ab^3) ≢ -6a^2b^3（指数をかけた誤り）', eqv(r`3a^2b\times(-2ab^3)`, r`=-6a^2b^3`), 'different');
check('12x^2y\\div4xy ≡ 3x', eqv(r`12x^2y\div4xy`, r`=3x`), 'equal');
check('(3x-y)-(x-4y) ≡ 2x+3y', eqv(r`(3x-y)-(x-4y)`, r`=2x+3y`), 'equal');
check('(3x-y)-(x-4y) ≢ 2x-5y（符号の誤り）', eqv(r`(3x-y)-(x-4y)`, r`=2x-5y`), 'different');
check('\\frac{x-y}{2}-\\frac{x+3y}{4} ≡ \\frac{x-5y}{4}', eqv(r`\frac{x-y}{2}-\frac{x+3y}{4}`, r`=\frac{x-5y}{4}`), 'equal');
check('-2(a-3b)+3(2a-b) ≡ 4a+3b', eqv(r`-2(a-3b)+3(2a-b)`, r`=4a+3b`), 'equal');
check('形：6a^2b-3ab は整理された式', M.checkForm('6a^2b-3ab', 'polynomial').ok, true);
check('形：x^2+2x+x は同類項が残る', M.checkForm('x^2+2x+x', 'polynomial').ok, false);
check('形：\\frac{5a}{18} は整理された式（分子と分母に数が1つずつ）', M.checkForm('\\frac{5a}{18}', 'polynomial').ok, true);
check('形：3a\\times2 は × が残る', M.checkForm('3a\\times2', 'polynomial').ok, false);

console.log('--- 中2 連立方程式（加減法・代入法・途中の式）');
const sysQ = r`\begin{cases}2x+3y=13\\3x-2y=0\end{cases}`;
const runSys = (lines) => { const a = M.analyzeSystem([sysQ, ...lines]); return `${a.firstDifferent}|${a.steps.map((s) => s.vsPrev || '-').join(',')}`; };
check('連立方程式の解', M.systemSolution(M.parseSystemLine(sysQ)).env.x.toString() + ',' + M.systemSolution(M.parseSystemLine(sysQ)).env.y.toString(), '2,3');
check('加減法の正しい変形', runSys([r`\begin{cases}4x+6y=26\\9x-6y=0\end{cases}`, '13x=26', 'x=2', r`2\times2+3y=13`, 'y=3', r`x=2,\ y=3`]), 'null|-,equal,equal,equal,equal,equal,equal');
check('加減法の符号ミス（6y-(-6y) を 0 とした）', runSys([r`\begin{array}{r}4x+6y=26\\-)\ 9x-6y=0\\\hline-5x=26\end{array}`, r`x=-\frac{26}{5}`, r`2\times\left(-\frac{26}{5}\right)+3y=13`, r`y=\frac{39}{5}`, r`x=-\frac{26}{5},\ y=\frac{39}{5}`]), '1|-,different,equal,equal,equal,equal');
check('代入法の正しい変形', M.analyzeSystem([r`\begin{cases}y=2x-1\\3x+2y=12\end{cases}`, '3x+2(2x-1)=12', '7x=14', 'x=2', r`y=2\times2-1`, r`x=2,\ y=3`]).firstDifferent, null);
check('代入時のかっこ忘れ', M.analyzeSystem([r`\begin{cases}y=2x-1\\3x+2y=12\end{cases}`, '3x+2\\times2x-1=12', '7x=13', r`x=\frac{13}{7}`, r`y=\frac{19}{7}`, r`x=\frac{13}{7},\ y=\frac{19}{7}`]).firstDifferent, 1);
check('正しい解の組', M.systemSolvedValues(M.parseSystemLine(r`x=2,\ y=3`), ['x', 'y']).y.toString(), '3');
check('誤った解の組は元の式で成り立たない', String(M.analyzeSystem([sysQ, r`x=3,\ y=2`]).firstDifferent), '1');
check('消去した式は元の連立方程式と同値ではないが、解で成り立てば正しい', M.analyzeSystem([sysQ, '13x=26']).steps[1].vsPrev, 'equal');
check('A=B=C の形は A=C と B=C の連立方程式として解く', M.systemSolution(M.parseSystemLine('x+2y=3x-y=7')).env.x.toString(), '3');
check('A=B=C の形から立てた連立方程式の誤りを検出', String(M.analyzeSystem(['x+2y=3x-y=7', r`\begin{cases}x+2y=7\\3x-y=6\end{cases}`]).firstDifferent), '1');
check('読めない行があっても例外にならず、手動確認になる', M.analyzeSystem([sysQ, 'x+=', r`x=2,\ y=3`]).unknown, true);
check('誤りのあとの別の誤りを検出', runSys([r`\begin{cases}4x+6y=26\\9x-6y=0\end{cases}`, '13x=24', r`x=\frac{24}{13}`, r`2\times\frac{24}{13}+3y=13`, 'y=1', r`x=\frac{24}{13},\ y=1`]), '2|-,equal,different,equal,different,equal,equal');

console.log('--- 中3 展開・因数分解（等価性と答えの形）');
check('(x+3)(x-5) ≡ x^2-2x-15', eqv('(x+3)(x-5)', '=x^2-2x-15'), 'equal');
check('(a-2b)^2 ≢ a^2-4b^2（乗法公式の誤り）', eqv('(a-2b)^2', '=a^2-4b^2'), 'different');
check('x^2-9 ≡ (x+3)(x-3)', eqv('x^2-9', '=(x+3)(x-3)'), 'equal');
check('形：(x+3)(x-3) は因数分解の完了形', M.checkForm('(x+3)(x-3)', 'factored').ok, true);
check('形：2(x^2-4) は等価だが因数分解が途中', M.checkForm('2(x^2-4)', 'factored').ok, false);
check('形：(2x+4)(x-1) は共通因数が残る', M.checkForm('(2x+4)(x-1)', 'factored').ok, false);
check('形：(x+1)(x+2) は展開した形ではない', M.checkForm('(x+1)(x+2)', 'expanded').ok, false);
check('形：3a(a-2b) は完了形', M.checkForm('3a(a-2b)', 'factored').ok, true);

console.log('--- 中3 平方根（厳密な計算）');
check('2\\sqrt3+\\sqrt3', val(r`2\sqrt3+\sqrt3`), '3√3');
check('\\sqrt{12}', val(r`\sqrt{12}`), '2√3');
check('\\sqrt2\\times\\sqrt8', val(r`\sqrt2\times\sqrt8`), '4');
check('\\frac{6}{\\sqrt3}（有理化）', val(r`\frac{6}{\sqrt3}`), '2√3');
check('\\frac{1}{\\sqrt3-\\sqrt2}', val(r`\frac{1}{\sqrt3-\sqrt2}`), '1√2 + 1√3');
check('(\\sqrt5+\\sqrt2)(\\sqrt5-\\sqrt2)', val(r`(\sqrt5+\sqrt2)(\sqrt5-\sqrt2)`), '3');
check('\\sqrt{(-3)^2} = 3（|-3|）', val(r`\sqrt{(-3)^2}`), '3');
check('\\sqrt{-4} は実数の範囲にない', val(r`\sqrt{-4}`).startsWith('エラー'), true);
check('\\sqrt2+\\sqrt3 ≢ \\sqrt5（根号の加法の誤り）', eqv(r`\sqrt2+\sqrt3`, r`=\sqrt5`), 'different');
check('\\sqrt{a^2} ≢ a（定義域を無視した変形）', eqv(r`\sqrt{a^2}`, '=a'), 'different');
check('形：\\sqrt{12} は簡単にできる', M.checkForm(r`\sqrt{12}`, 'radical').ok, false);
check('形：\\frac{2}{\\sqrt3} は有理化していない', M.checkForm(r`\frac{2}{\sqrt3}`, 'radical').ok, false);
check('形：\\frac{\\sqrt6}{3} は簡単な形', M.checkForm(r`\frac{\sqrt6}{3}`, 'radical').ok, true);

console.log('--- 中3 2次方程式（解の集合）');
const qs = (s) => M.describeSet(M.lineSolutionSet(M.parseQuadraticLine(s)));
const qcmp = (a, b) => M.compareLines(M.parseLine(a, 'quadratic'), M.parseLine(b, 'quadratic'), 'quadratic').result;
check('因数分解：(x-3)(x+2)=0', qs('(x-3)(x+2)=0'), 'x=3, -2');
check('平方根：x^2=9', qs('x^2=9'), 'x=3, -3');
check('x=\\pm3', qs(r`x=\pm3`), 'x=3, -3');
check('重解：x^2-6x+9=0', qs('x^2-6x+9=0'), 'x=3');
check('解の公式：x^2+3x-1=0', qs('x^2+3x-1=0'), 'x=-3/2 + 1/2√13, -3/2 + -1/2√13');
check('2つの解の順序違いは同じ', qcmp(r`x=3,\ x=-2`, r`x=-2,\ x=3`), 'equal');
check('解の欠落（x^2=9 → x=3）', qcmp('x^2=9', 'x=3'), 'different');
check('余分な解（x^2-6x+9=0 → x=3, -3）', qcmp('x^2-6x+9=0', r`x=3,\ -3`), 'different');
check('誤った符号（x^2+x-6=0 → x=-3, -2）', qcmp('x^2+x-6=0', r`x=-3,\ -2`), 'different');
check('両辺を x でわる（解を失う）', qcmp('x^2=5x', 'x=5'), 'different');
check('解の公式の分母の誤り', qcmp('2x^2+3x-1=0', r`x=\frac{-3\pm\sqrt{17}}{2}`), 'different');
check('根号をふくむ解：x+1=\\pm\\sqrt5', qs(r`x+1=\pm\sqrt5`), 'x=-1 + 1√5, -1 + -1√5');
check('「または」でつないだ式', qs(r`x-1=0\ \text{または}\ x+4=0`), 'x=1, -4');
check('実数解なし：x^2+1=0', qs('x^2+1=0'), '実数の解なし');
check('答えの形：約分できる', M.checkQuadraticAnswerForm(r`x=\frac{4\pm2\sqrt3}{2}`).ok, false);
check('答えの形：-2\\pm\\sqrt3', M.checkQuadraticAnswerForm(r`x=-2\pm\sqrt3`).ok, true);

console.log(failed === 0 ? '\nすべて成功しました。' : `\n${failed} 件失敗しました。`);
process.exit(failed === 0 ? 0 : 1);
