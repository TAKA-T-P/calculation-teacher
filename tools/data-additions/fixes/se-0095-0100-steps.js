/*
 * J2-SE-0095・J2-SE-0100 の途中式の調整。
 * 分数・小数をふくむ式を整数に直した直後（かっこが残っている形）の行を2行目に加え、
 * 暗算で正しさを判断しやすくした。かわりに、下から2行目（最後の答えの直前の行）は削除した。
 * カテゴリ・難易度・誤りの種類は変えず、誤り行は1行下にずれる（行が1つ加わるため）。
 *   node tools/data-additions/stage6/replace-questions.js tools/data-additions/fixes/se-0095-0100-steps.js J2-SE-0095 J2-SE-0100 --note "…"
 */
'use strict';
const r = String.raw;
const sys = (a, b) => r`\begin{cases}${a}\\${b}\end{cases}`;
const col = (a, op, b, c) => r`\begin{array}{r}${a}\\${op})\ ${b}\\\hline ${c}\end{array}`;

const q95 = sys(r`\frac{x+y}{3}-\frac{x-y}{2}=1`, 'x+y=6');
const q100 = sys(r`\frac{x-1}{2}+\frac{y+2}{3}=3`, '0.2x-0.1(y-4)=0.6');

module.exports = {
  'j2-simultaneous-equations.json': [
    {
      id: 'J2-SE-0095',
      grade: 2,
      unit: 'simultaneous-equations',
      category: '連立方程式の総合',
      difficulty: 3,
      question: q95,
      answerLines: [
        q95,
        sys('2(x+y)-3(x-y)=6', 'x+y=6'),
        sys('-x+5y=6', 'x+y=6'),
        col('-x+5y=6', '+', 'x+y=6', '6y=0'),
        'y=0',
        r`x=6,\ y=0`,
      ],
      errorLine: 3,
      errorType: '式どうしをたすとき、右辺をひいてしまった誤り',
      explanation: '2つの式をたすときは、右辺もたすので $6+6=12$ です。$6-6=0$ としたところが誤りです。上の式を $6$ 倍して $2(x+y)-3(x-y)=6$、$-x+5y=6$ と整理したところは正しくできています。正しくは $6y=12$ で、$y=2$、$x=4$ です。',
      correctSolution: [
        q95,
        sys('2(x+y)-3(x-y)=6', 'x+y=6'),
        sys('-x+5y=6', 'x+y=6'),
        col('-x+5y=6', '+', 'x+y=6', '6y=12'),
        'y=2',
        'x+2=6',
        r`x=4,\ y=2`,
      ],
      hint: '式どうしをたすとき、右辺はどう計算しますか？',
    },
    {
      id: 'J2-SE-0100',
      grade: 2,
      unit: 'simultaneous-equations',
      category: '連立方程式の総合',
      difficulty: 4,
      question: q100,
      answerLines: [
        q100,
        sys('3(x-1)+2(y+2)=18', '2x-(y-4)=6'),
        sys('3x+2y=17', '2x-y=2'),
        col('3x+2y=17', '+', '4x-2y=4', '7x=21'),
        'x=3',
        '-y=8',
        r`x=3,\ y=-8`,
      ],
      errorLine: 5,
      errorType: '代入したあと移項するときの符号ミス',
      explanation: '$x=3$ を $2x-y=2$ に代入すると $6-y=2$ です。$6$ を右辺に移項すると $-6$ になるので、$-y=2-6=-4$ です。$2+6=8$ としたところが誤りです。2つの式の整理（$3(x-1)+2(y+2)=18$、$2x-(y-4)=6$）と、$x=3$ を求めたところまでは正しくできています。正しくは $y=4$ です。',
      correctSolution: [
        q100,
        sys('3(x-1)+2(y+2)=18', '2x-(y-4)=6'),
        sys('3x+2y=17', '2x-y=2'),
        col('3x+2y=17', '+', '4x-2y=4', '7x=21'),
        'x=3',
        '-y=-4',
        r`x=3,\ y=4`,
      ],
      hint: '$6-y=2$ で、$6$ を移項すると符号はどうなりますか？',
    },
  ],
};
