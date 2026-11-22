/*
 * J3-EF-0040・J3-SR-0097 の置きかえ（スマートフォン縦画面で途中の式が長く、横スクロールになっていたため）。
 * カテゴリ・難易度・最初の誤り行・誤りの種類は変えず、途中の式を短くした。
 *   node tools/data-additions/stage6/replace-questions.js tools/data-additions/fixes/ef-0040-sr-0097-short.js J3-EF-0040 J3-SR-0097 --note "…"
 */
'use strict';
module.exports = {
  'j3-expansion-factorization.json': [
    {
      id: 'J3-EF-0040',
      grade: 3,
      unit: 'expansion-factorization',
      category: '分配法則・多項式の積',
      difficulty: 4,
      instruction: '次の式を展開しなさい。',
      question: '(2x+1)(x-3)+x(x+5)',
      answerLines: [
        '(2x+1)(x-3)+x(x+5)',
        '=2x^2-6x+x-3+x^2+5x',
        '=2x^2+x^2-6x+x+5x-3',
        '=3x^2-6x+x+5x-3',
        '=3x^2-10x-3',
      ],
      errorLine: 4,
      errorType: '3つ以上の同類項をまとめるときの符号ミス',
      explanation: '$-6x+x+5x$ は $(-6+1+5)x=0$ です。$+5x$ を $-5x$ として計算し、$-10x$ としたところが誤りです。展開と、同類項を集めた3行目・$x^2$ の項をまとめた4行目は正しくできています。正しくは $3x^2-3$ です。',
      correctSolution: [
        '(2x+1)(x-3)+x(x+5)',
        '=2x^2-6x+x-3+x^2+5x',
        '=2x^2+x^2-6x+x+5x-3',
        '=3x^2-6x+x+5x-3',
        '=3x^2-3',
      ],
      hint: '4行目の $-6x+x+5x$ を計算し直してみましょう。',
    },
  ],
  'j3-square-roots.json': [
    {
      id: 'J3-SR-0097',
      grade: 3,
      unit: 'square-roots',
      category: '平方根の式の計算',
      difficulty: 4,
      instruction: '$x=\\sqrt3+\\sqrt2$、$y=\\sqrt3-\\sqrt2$ のとき、次の式の値を求めなさい。',
      substitution: {
        x: '\\sqrt3+\\sqrt2',
        y: '\\sqrt3-\\sqrt2',
      },
      question: 'x^2-y^2',
      answerLines: [
        'x^2-y^2',
        '=(x+y)(x-y)',
        '=2\\sqrt3(x-y)',
        '=2\\sqrt3\\times2\\sqrt2',
        '=2\\sqrt6',
      ],
      errorLine: 4,
      errorType: '係数どうしのかけ算を忘れた誤り',
      explanation: '$2\\sqrt3\\times2\\sqrt2$ は、係数どうし $2\\times2=4$、根号どうし $\\sqrt3\\times\\sqrt2=\\sqrt6$ をかけて $4\\sqrt6$ です。係数を $2$ のままにしたところが誤りです。因数分解してから、$x+y=2\\sqrt3$、$x-y=2\\sqrt2$ を順に代入したところまでは正しくできています。',
      correctSolution: [
        'x^2-y^2',
        '=(x+y)(x-y)',
        '=2\\sqrt3(x-y)',
        '=2\\sqrt3\\times2\\sqrt2',
        '=4\\sqrt6',
      ],
      hint: '$2\\sqrt3\\times2\\sqrt2$ の係数は、いくつになりますか？',
    },
  ],
};
