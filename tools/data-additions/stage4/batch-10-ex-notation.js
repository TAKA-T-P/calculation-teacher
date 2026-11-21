/*
 * 第4段階 バッチ10：文字式「文字式の表し方」★★★・★★★★（11問）
 */
'use strict';
const { make, r } = require('./q.js');
const C = '文字式の表し方';
const I = '次の式を、文字式の表し方にしたがって書きなさい。';

module.exports = {
  'j1-expressions.json': [
    make({
      id: 'J1-EX-0028', cat: C, d: 3, instr: I,
      q: r`x\div y\div z\times2`,
      a: [r`=\frac{2xz}{y}`],
      e: 1, type: 'わり算が続くとき、2つ目のわる数を分子にした誤り',
      exp: r`わり算が続くときは、どちらのわる数も分母に入ります。$x\div y\div z\times2=x\times\frac{1}{y}\times\frac{1}{z}\times2=\frac{2x}{yz}$ です。$z$ を分子に入れたところが誤りです。`,
      sol: [r`=x\times\frac{1}{y}\times\frac{1}{z}\times2`, r`=\frac{2x}{yz}`],
      hint: r`$\div z$ を逆数のかけ算に直すと、$z$ は分子と分母のどちらに入りますか？`,
    }),
    make({
      id: 'J1-EX-0029', cat: C, d: 3, instr: I,
      q: r`a-b\div2\times c`,
      a: [r`=\frac{(a-b)c}{2}`],
      e: 1, type: 'ひき算の項まで分子に入れた誤り（計算の順序）',
      exp: r`わり算とかけ算は、ひき算より先に計算します。$b\div2\times c=\frac{bc}{2}$ なので、答えは $a-\frac{bc}{2}$ です。$a-b$ を先にひとまとまりにして $\frac{(a-b)c}{2}$ としたところが誤りです。`,
      sol: [r`=a-\frac{bc}{2}`],
      hint: r`$a-b\div2\times c$ では、ひき算とわり算・かけ算のどちらを先に計算しますか？`,
    }),
    make({
      id: 'J1-EX-0030', cat: C, d: 3, instr: I,
      q: r`0.1\times x\times y\div(-1)`,
      a: [r`=0.1xy\div(-1)`, r`=0.1xy`],
      e: 2, type: '-1 でわるときの符号ミス',
      exp: r`$-1$ でわると符号が変わるので、$0.1xy\div(-1)=-0.1xy$ です。符号を変えずに $0.1xy$ としたところが誤りです。$0.1$ は省略せずに $0.1xy$ と書くので、$0.1\times x\times y=0.1xy$ は正しくできています（$0.1$ の $1$ を省略して $0.xy$ とは書きません）。`,
      sol: [1, r`=-0.1xy`],
      hint: r`$\div(-1)$ をすると、式の符号はどうなりますか？`,
    }),
    make({
      id: 'J1-EX-0031', cat: C, d: 3, instr: I,
      q: r`(x+1)\div3-y\times y\times4`,
      a: [r`=(x+1)\times\frac{1}{3}-4\times y\times y`, r`=\frac{x+1}{3}-4y\times y`, r`=\frac{x+1}{3}-(4y)^2`],
      e: 3, type: '係数まで2乗した表し方の誤り',
      exp: r`$4y\times y$ で2乗になるのは $y$ だけなので、$4y^2$ と表します。$(4y)^2$ は $4y\times4y=16y^2$ のことなので誤りです。$(x+1)\div3=\frac{x+1}{3}$ は正しくできています。`,
      sol: [3, r`=\frac{x+1}{3}-4y^2`],
      hint: r`$(4y)^2$ と $4y^2$ は同じですか？ 2乗しているのはどの部分でしょうか。`,
    }),
    make({
      id: 'J1-EX-0032', cat: C, d: 3, instr: I,
      q: r`(a+b)\times(a+b)\div2`,
      a: [r`=\frac{(a+b)^2}{2}`],
      e: null,
      exp: r`すべての行が正しい計算です。同じ式 $(a+b)$ を $2$ 回かけているので、かっこのまま指数を使って $(a+b)^2$ と表します。$\div2$ は分母に $2$ を書いて表しています。`,
      hint: r`かっこの式どうしの積も、同じ文字の積と同じように指数で表せます。`,
    }),
    make({
      id: 'J1-EX-0033', cat: C, d: 3, instr: I,
      q: r`x\times(-0.3)-y\div\frac{1}{2}`,
      a: [r`=-0.3x-y\times2`, r`=-0.3x-2y`],
      e: null,
      exp: r`すべての行が正しい計算です。$x\times(-0.3)=-0.3x$ です。$\div\frac{1}{2}$ は逆数の $2$ をかけることなので、$y\div\frac{1}{2}=2y$ になります。`,
      hint: r`$\frac{1}{2}$ でわることは、どんな数をかけることと同じですか？`,
    }),
    make({
      id: 'J1-EX-0034', cat: C, d: 4, instr: I,
      q: r`a\div\frac{2}{3}\times b`,
      a: [r`=\frac{2ab}{3}`],
      e: 1, type: '分数でわるとき逆数にしていない',
      exp: r`分数でわるときは、逆数をかけます。$\div\frac{2}{3}$ は $\times\frac{3}{2}$ なので、$a\times\frac{3}{2}\times b=\frac{3ab}{2}$ です。$\frac{2}{3}$ をそのままかけて $\frac{2ab}{3}$ としたところが誤りです。`,
      sol: [r`=a\times\frac{3}{2}\times b`, r`=\frac{3ab}{2}`],
      hint: r`$\frac{2}{3}$ でわることは、どんな数をかけることと同じですか？`,
    }),
    make({
      id: 'J1-EX-0035', cat: C, d: 4, instr: I,
      q: r`(x-y)\div(-2)\times z`,
      a: [r`=(x-y)\times\left(-\frac{1}{2}\right)\times z`, r`=-\frac{x-y}{2z}`],
      e: 2, type: 'わり算を逆数のかけ算に直したあと、かける文字を分母に入れた誤り',
      exp: r`$\times z$ の $z$ は分子に入るので、$-\frac{(x-y)z}{2}$ です。$z$ を分母に入れた $-\frac{x-y}{2z}$ は $(x-y)\div(-2)\div z$ のことなので誤りです。$\div(-2)$ を $\times\left(-\frac{1}{2}\right)$ に直したところは正しくできています。`,
      sol: [1, r`=-\frac{(x-y)z}{2}`],
      hint: r`$\times z$ の $z$ は、分子と分母のどちらに入りますか？`,
    }),
    make({
      id: 'J1-EX-0036', cat: C, d: 4, instr: I,
      q: r`a\times(-1)\div b\div b+c\times0.5`,
      a: [r`=-a\div b\div b+0.5c`, r`=-\frac{a}{2b}+0.5c`],
      e: 2, type: '同じ文字の積を係数で表した誤り',
      exp: r`$\div b\div b$ は $b$ で $2$ 回わるので、分母は $b\times b=b^2$ になり、$-\frac{a}{b^2}$ です。$2b$ は $b+b$ のことなので、分母を $2b$ としたところが誤りです。$a\times(-1)=-a$、$c\times0.5=0.5c$ は正しくできています。`,
      sol: [1, r`=-\frac{a}{b^2}+0.5c`],
      hint: r`$b$ で $2$ 回わると、分母は $b$ を何回かけたものになりますか？`,
    }),
    make({
      id: 'J1-EX-0037', cat: C, d: 4, instr: I,
      q: r`x\div\left(-\frac{1}{4}\right)-3\div y\times x`,
      a: [r`=x\times(-4)-3\times\frac{1}{y}\times x`, r`=-4x-\frac{3}{y}\times x`, r`=-4x-\frac{3}{xy}`],
      e: 3, type: '分数にかける文字を分母に入れた誤り',
      exp: r`$\frac{3}{y}\times x$ は、$x$ を分子にかけるので $\frac{3x}{y}$ です。$x$ を分母に入れた $\frac{3}{xy}$ は誤りです。$\div\left(-\frac{1}{4}\right)$ を $\times(-4)$ に直して $-4x$ としたところは正しくできています。`,
      sol: [3, r`=-4x-\frac{3x}{y}`],
      hint: r`$\frac{3}{y}\times x$ で、$x$ は分子と分母のどちらにかかりますか？`,
    }),
    make({
      id: 'J1-EX-0038', cat: C, d: 4, instr: I,
      q: r`a\times b\div c\times(-2)\div d`,
      a: [r`=ab\times\frac{1}{c}\times(-2)\times\frac{1}{d}`, r`=-\frac{2ab}{cd}`],
      e: null,
      exp: r`すべての行が正しい計算です。わり算を逆数のかけ算に直すと、$c$ と $d$ は分母、$a$、$b$、$2$ は分子に入ります。負の数は $-2$ だけなので、符号は「$-$」です。`,
      hint: r`わる文字はすべて分母に入ります。かける数・文字は分子です。`,
    }),
  ],
};
