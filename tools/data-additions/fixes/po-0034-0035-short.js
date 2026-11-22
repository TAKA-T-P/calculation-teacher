/*
 * J2-PO-0034・J2-PO-0035 の置きかえ（スマートフォン縦画面で式が長く、横スクロールになっていたため）。
 * カテゴリ・難易度・最初の誤り行・誤りの種類は変えず、式を短くした。
 *   node tools/data-additions/stage6/replace-questions.js tools/data-additions/fixes/po-0034-0035-short.js J2-PO-0034 J2-PO-0035 --note "…"
 */
'use strict';
module.exports = {
  'j2-polynomials.json': [
    {
      id: 'J2-PO-0034',
      grade: 2,
      unit: 'polynomials',
      category: '多項式の加法・減法',
      difficulty: 3,
      question: '(x^2-4x)-(3x^2-2x)+x^2',
      answerLines: [
        '(x^2-4x)-(3x^2-2x)+x^2',
        '=x^2-4x-3x^2+2x+x^2',
        '=x^2-3x^2+x^2-4x-2x',
        '=-x^2-6x',
      ],
      errorLine: 2,
      errorType: '項を並べかえるときの符号ミス',
      explanation: '2行目の $+2x$ を並べかえるとき、$-2x$ としたところが誤りです。並べかえても項の符号は変わらないので、正しくは $x^2-3x^2+x^2-4x+2x$ です。かっこのはずし方は正しくできています。正しく計算すると $-x^2-2x$ です。',
      correctSolution: [
        '(x^2-4x)-(3x^2-2x)+x^2',
        '=x^2-4x-3x^2+2x+x^2',
        '=x^2-3x^2+x^2-4x+2x',
        '=-x^2-2x',
      ],
      hint: '2行目と3行目で、$x$ の項の符号が変わっていないか比べてみましょう。',
    },
    {
      id: 'J2-PO-0035',
      grade: 2,
      unit: 'polynomials',
      category: '多項式の加法・減法',
      difficulty: 3,
      question: '(5x-2y)-(2x-3y)-(x+y)',
      answerLines: [
        '(5x-2y)-(2x-3y)-(x+y)',
        '=5x-2y-2x+3y-x+y',
        '=5x-2x-x-2y+3y+y',
        '=2x+2y',
      ],
      errorLine: 1,
      errorType: 'ひく式のかっこをはずすとき、うしろの項の符号を変え忘れた誤り',
      explanation: '3つ目のかっこも、ひく式なので $-(x+y)=-x-y$ です。$+y$ としたところが誤りです。2つ目のかっこ $-(2x-3y)=-2x+3y$ は正しくはずせています。正しく計算すると $2x$ です。',
      correctSolution: [
        '(5x-2y)-(2x-3y)-(x+y)',
        '=5x-2y-2x+3y-x-y',
        '=5x-2x-x-2y+3y-y',
        '=2x',
      ],
      hint: '$-(x+y)$ のかっこをはずすと、$y$ の符号はどうなりますか？',
    },
  ],
};
