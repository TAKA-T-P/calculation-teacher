/*
 * 第4段階 バッチ09：文字式「文字式の表し方」★・★★（12問）
 * 表し方の誤りは、数学的に等価でない誤り（自動検証で最初の誤り行を確かめられるもの）を中心にしている。
 * 表記ルールそのもの（× の省略・係数の位置など）は自動判定できないため、どの問題も手動確認（MANUAL）の対象になる。
 */
'use strict';
const { make, r } = require('./q.js');
const C = '文字式の表し方';
const I = '次の式を、文字式の表し方にしたがって書きなさい。';

module.exports = {
  'j1-expressions.json': [
    make({
      id: 'J1-EX-0016', cat: C, d: 1, instr: I,
      q: r`a\times a\times a\times b`,
      a: [r`=3ab`],
      e: 1, type: '同じ文字の積を、文字の個数を係数にして表した誤り',
      exp: r`同じ文字の積は指数を使って表します。$a$ を $3$ 回かけているので $a^3$ で、答えは $a^3b$ です。$3a$ は $a+a+a$ のことなので、$a\times a\times a$ を $3a$ と書くのは誤りです。`,
      sol: [r`=a^3b`],
      hint: r`$a\times a\times a$ は $a$ を何回かけていますか？ それは $3a$ と同じですか？`,
    }),
    make({
      id: 'J1-EX-0017', cat: C, d: 1, instr: I,
      q: r`x\div3`,
      a: [r`=\frac{3}{x}`],
      e: 1, type: 'わる数を分子にした誤り',
      exp: r`わり算は、わられる数を分子、わる数を分母にした分数の形で表します。$x\div3=\frac{x}{3}$ です。$\frac{3}{x}$ は $3\div x$ のことなので誤りです。`,
      sol: [r`=\frac{x}{3}`],
      hint: r`$6\div3$ を分数で表すと $\frac{6}{3}$ です。では $x\div3$ はどうなりますか？`,
    }),
    make({
      id: 'J1-EX-0018', cat: C, d: 1, instr: I,
      q: r`y\times(-4)+x\div2`,
      a: [r`=-4y+x\times\frac{1}{2}`, r`=-4y+2x`],
      e: 2, type: '÷2 を ×2 と取り違えた誤り',
      exp: r`$x\times\frac{1}{2}$ は $x$ を $2$ でわることなので、$\frac{x}{2}$ です。$2x$ は $x\times2$ のことなので誤りです。$y\times(-4)=-4y$ と、$\div2$ を $\times\frac{1}{2}$ に直したところは正しくできています。`,
      sol: [1, r`=-4y+\frac{x}{2}`],
      hint: r`$x\times\frac{1}{2}$ は、$x$ を2倍することですか、半分にすることですか？`,
    }),
    make({
      id: 'J1-EX-0019', cat: C, d: 1, instr: I,
      q: r`(x+y)\div4`,
      a: [r`=(x+y)\times\frac{1}{4}`, r`=x+\frac{y}{4}`],
      e: 2, type: 'かっこの式をわるとき、一部の項だけをわった誤り',
      exp: r`$(x+y)\div4$ は、$x+y$ 全体を $4$ でわるので $\frac{x+y}{4}$ です。$x+\frac{y}{4}$ では $y$ だけを $4$ でわったことになり、誤りです。分子の $x+y$ にはかっこをつけなくてもかまいません。`,
      sol: [1, r`=\frac{x+y}{4}`],
      hint: r`$4$ でわるのは、$y$ だけですか、$x+y$ 全体ですか？`,
    }),
    make({
      id: 'J1-EX-0020', cat: C, d: 1, instr: I,
      q: r`x\times x\times(-1)\times y`,
      a: [r`=-x^2y`],
      e: null,
      exp: r`すべての行が正しい計算です。$x\times x=x^2$ と指数で表し、$-1$ をかけることは「$-$」をつけて表します（$-1x^2y$ とは書きません）。文字は数のあとに、アルファベット順に並べています。`,
      hint: r`$\times(-1)$ はどのように表しますか？ 同じ文字の積の表し方も確かめましょう。`,
    }),
    make({
      id: 'J1-EX-0021', cat: C, d: 1, instr: I,
      q: r`a\times5-b\div3`,
      a: [r`=5a-\frac{b}{3}`],
      e: null,
      exp: r`すべての行が正しい計算です。数と文字の積は数を前に書いて $5a$、わり算は分数で表して $\frac{b}{3}$ です。ひき算の記号「$-$」は省略しません。`,
      hint: r`かけ算の記号は省略できますが、ひき算の記号はどうでしょうか？`,
    }),
    make({
      id: 'J1-EX-0022', cat: C, d: 2, instr: I,
      q: r`a\div b\times c`,
      a: [r`=\frac{a}{bc}`],
      e: 1, type: '÷ のあとの × の文字まで分母に入れた誤り',
      exp: r`$a\div b\times c$ は、左から順に $a\div b=\frac{a}{b}$、それに $c$ をかけるので $\frac{a}{b}\times c=\frac{ac}{b}$ です。$c$ を分母に入れた $\frac{a}{bc}$ は $a\div b\div c$ のことなので誤りです。`,
      sol: [r`=a\times\frac{1}{b}\times c`, r`=\frac{ac}{b}`],
      hint: r`$\div b$ を $\times\frac{1}{b}$ に直してみましょう。$c$ は分子と分母のどちらに入りますか？`,
    }),
    make({
      id: 'J1-EX-0023', cat: C, d: 2, instr: I,
      q: r`5\div(x+y)`,
      a: [r`=\frac{5}{x}+y`],
      e: 1, type: 'かっこの式でわるとき、分母にかっこの一部しか入れなかった誤り',
      exp: r`$5\div(x+y)$ は、$5$ を $x+y$ 全体でわるので $\frac{5}{x+y}$ です。$\frac{5}{x}+y$ では $x$ だけでわって、あとで $y$ をたしたことになり、誤りです。`,
      sol: [r`=\frac{5}{x+y}`],
      hint: r`わる数は $x$ だけですか、$x+y$ 全体ですか？`,
    }),
    make({
      id: 'J1-EX-0024', cat: C, d: 2, instr: I,
      q: r`m\times m\times(-3)\div n`,
      a: [r`=-3m^2\div n`, r`=-3m^2n`],
      e: 2, type: '÷ を × と取り違えた誤り',
      exp: r`$\div n$ は分母に $n$ を書いて表すので、$-3m^2\div n=-\frac{3m^2}{n}$ です。$-3m^2n$ は $\times n$ のことなので誤りです。$m\times m\times(-3)=-3m^2$ は正しくできています。`,
      sol: [1, r`=-\frac{3m^2}{n}`],
      hint: r`$\div n$ を省略して書くと、$n$ は分子と分母のどちらに入りますか？`,
    }),
    make({
      id: 'J1-EX-0025', cat: C, d: 2, instr: I,
      q: r`(a-b)\times(-2)`,
      a: [r`=-2\times(a-b)`, r`=-2a-b`],
      e: 2, type: 'かっこをつけ忘れた誤り',
      exp: r`$-2\times(a-b)$ は、かっこをつけたまま $-2(a-b)$ と表します。$-2a-b$ では、$-2$ を $a$ にしかかけていないことになり、誤りです。数をかっこの前に出したところは正しくできています。`,
      sol: [1, r`=-2(a-b)`],
      hint: r`$-2$ をかけているのは、$a$ だけですか、$a-b$ 全体ですか？`,
    }),
    make({
      id: 'J1-EX-0026', cat: C, d: 2, instr: I,
      q: r`x\div2\times y\div3`,
      a: [r`=x\times\frac{1}{2}\times y\times\frac{1}{3}`, r`=\frac{xy}{2\times3}`, r`=\frac{xy}{5}`],
      e: 3, type: '分母の数どうしをたしてしまった誤り',
      exp: r`分母の $2\times3$ はかけ算なので $6$ です。$\frac{xy}{5}$ としたところが誤りで、正しくは $\frac{xy}{6}$ です。わり算を逆数のかけ算に直したところと、$x$ と $y$ を分子に、$2$ と $3$ を分母にまとめたところは正しくできています。`,
      sol: [3, r`=\frac{xy}{6}`],
      hint: r`分母の $2\times3$ を計算するといくつですか？`,
    }),
    make({
      id: 'J1-EX-0027', cat: C, d: 2, instr: I,
      q: r`a\times b\div(-3)`,
      a: [r`=ab\times\left(-\frac{1}{3}\right)`, r`=-\frac{ab}{3}`],
      e: null,
      exp: r`すべての行が正しい計算です。$\div(-3)$ を $\times\left(-\frac{1}{3}\right)$ に直し、符号の「$-$」を分数の前に出して $-\frac{ab}{3}$ と表しています。`,
      hint: r`負の数でわるときの符号を、分数のどこに書くか確かめましょう。`,
    }),
  ],
};
