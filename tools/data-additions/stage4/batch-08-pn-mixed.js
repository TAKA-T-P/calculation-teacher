/*
 * 第4段階 バッチ08：正負の数「四則混合」★★★・★★★★（10問）
 */
'use strict';
const { make, r } = require('./q.js');
const C = '四則混合';

module.exports = {
  'j1-positive-negative.json': [
    make({
      id: 'J1-PN-0091', cat: C, d: 3,
      q: r`\left(\frac{2}{3}-\frac{3}{4}\right)\times(-12)`,
      a: [r`=\frac{2}{3}\times(-12)-\frac{3}{4}\times(-12)`, r`=-8-9`, r`=-17`],
      e: 2, type: '分配法則を使うときの符号ミス',
      exp: r`$-\frac{3}{4}\times(-12)$ は負の数どうしの積なので $+9$ です。$-9$ としたところが誤りです。分配法則で $-12$ をかっこの中の両方の項にかけたところと、$\frac{2}{3}\times(-12)=-8$ は正しくできています。正しくは $-8+9=1$ です。`,
      sol: [2, r`=-8+9`, r`=1`],
      hint: r`$-\frac{3}{4}\times(-12)$ の答えの符号はどうなりますか？`,
    }),
    make({
      id: 'J1-PN-0092', cat: C, d: 3,
      q: r`-1.5\times4-3.6\div(-1.2)+0.5`,
      a: [r`=-6-3.6\div(-1.2)+0.5`, r`=-6+3+0.5`, r`=-6+3.5`, r`=2.5`],
      e: 4, type: '異符号の2数の和の符号ミス',
      exp: r`$-6+3.5$ は、絶対値の大きい $-6$ の符号になるので $-2.5$ です。$2.5$ としたところが誤りです。$-1.5\times4=-6$、$-3.6\div(-1.2)=+3$、$3+0.5=3.5$ はどれも正しくできています。`,
      sol: [4, r`=-2.5`],
      hint: r`$-6+3.5$ は、正の数と負の数のどちらになりますか？`,
    }),
    make({
      id: 'J1-PN-0093', cat: C, d: 3,
      q: r`\frac{5}{6}\div\left(-\frac{5}{3}\right)-\left(-\frac{1}{2}\right)^2`,
      a: [r`=\frac{5}{6}\times\left(-\frac{3}{5}\right)-\frac{1}{4}`, r`=-\frac{1}{2}-\frac{1}{4}`, r`=-\frac{1}{4}`],
      e: 3, type: '分数で、負の数どうしの和を差で計算した誤り',
      exp: r`$-\frac{1}{2}-\frac{1}{4}$ は負の数どうしの和と同じなので、通分して $-\frac{2}{4}-\frac{1}{4}=-\frac{3}{4}$ です。差を求めて $-\frac{1}{4}$ としたところが誤りです。わる数の逆数 $-\frac{3}{5}$、$\left(-\frac{1}{2}\right)^2=\frac{1}{4}$ は正しくできています。`,
      sol: [3, r`=-\frac{2}{4}-\frac{1}{4}`, r`=-\frac{3}{4}`],
      hint: r`$-\frac{1}{2}-\frac{1}{4}$ の答えは、$-\frac{1}{2}$ より大きくなりますか、小さくなりますか？`,
    }),
    make({
      id: 'J1-PN-0094', cat: C, d: 3,
      q: r`(-2)^2\times3-(8-14)\div\frac{3}{2}`,
      a: [r`=4\times3-(-6)\div\frac{3}{2}`, r`=12-(-6)\times\frac{2}{3}`, r`=12-(-9)`, r`=21`],
      e: 3, type: '分数のかけ算で分母と分子を取り違えた',
      exp: r`$(-6)\times\frac{2}{3}$ は、$6$ に分子の $2$ をかけて分母の $3$ でわるので $-4$ です。$-9$ としたのは $\frac{3}{2}$ をかけた計算になっていて、誤りです。逆数に直した $\times\frac{2}{3}$ までは正しくできています。正しくは $12-(-4)=16$ です。`,
      sol: [3, r`=12+4`, r`=16`],
      hint: r`$(-6)\times\frac{2}{3}$ を計算し直してみましょう。`,
    }),
    make({
      id: 'J1-PN-0095', cat: C, d: 3,
      q: r`-3\times\left(\frac{1}{3}-\frac{1}{2}\right)\div\frac{1}{4}`,
      a: [r`=-3\times\left(-\frac{1}{6}\right)\div\frac{1}{4}`, r`=\frac{1}{2}\times4`, r`=2`],
      e: null,
      exp: r`すべての行が正しい計算です。かっこの中を通分して $\frac{2}{6}-\frac{3}{6}=-\frac{1}{6}$ です。$-3\times\left(-\frac{1}{6}\right)=\frac{1}{2}$、$\div\frac{1}{4}$ は $\times4$ なので、答えは $2$ です。`,
      hint: r`かっこの中の計算、負の数どうしの積の符号、わる数の逆数を順に確かめましょう。`,
    }),
    make({
      id: 'J1-PN-0096', cat: C, d: 4,
      q: r`\left\{(-3)^2-\left(-\frac{1}{2}\right)\right\}\div\left(-\frac{19}{4}\right)`,
      a: [r`=\left(9+\frac{1}{2}\right)\div\left(-\frac{19}{4}\right)`, r`=\frac{10}{2}\div\left(-\frac{19}{4}\right)`, r`=5\times\left(-\frac{4}{19}\right)`, r`=-\frac{20}{19}`],
      e: 2, type: '整数と分数のたし算で、整数を分子にたした誤り',
      exp: r`$9+\frac{1}{2}$ は、$9$ を $\frac{18}{2}$ に直して $\frac{18}{2}+\frac{1}{2}=\frac{19}{2}$ です。$9$ をそのまま分子にたして $\frac{10}{2}$ としたところが誤りです。かっこの中の $(-3)^2=9$、$-\left(-\frac{1}{2}\right)=+\frac{1}{2}$ は正しくできています。正しくは $\frac{19}{2}\times\left(-\frac{4}{19}\right)=-2$ です。`,
      sol: [2, r`=\frac{19}{2}\div\left(-\frac{19}{4}\right)`, r`=\frac{19}{2}\times\left(-\frac{4}{19}\right)`, r`=-2`],
      hint: r`$9+\frac{1}{2}$ を計算するとき、$9$ はどんな分数に直せばよいですか？`,
    }),
    make({
      id: 'J1-PN-0097', cat: C, d: 4,
      q: r`2.5\times\left(-\frac{4}{5}\right)^2-\frac{3}{2}\div0.75`,
      a: [r`=\frac{5}{2}\times\frac{16}{25}-\frac{3}{2}\div\frac{3}{4}`, r`=\frac{8}{5}-\frac{3}{2}\times\frac{4}{3}`, r`=\frac{8}{5}-2`, r`=\frac{6}{5}`],
      e: 4, type: '分数から整数をひくとき、分子だけからひいた誤り',
      exp: r`$\frac{8}{5}-2$ は、$2$ を $\frac{10}{5}$ に直して $\frac{8}{5}-\frac{10}{5}=-\frac{2}{5}$ です。分子の $8$ から $2$ をひいて $\frac{6}{5}$ としたところが誤りです。小数を分数に直したところ（$2.5=\frac{5}{2}$、$0.75=\frac{3}{4}$）、$\left(-\frac{4}{5}\right)^2=\frac{16}{25}$、$\frac{3}{2}\times\frac{4}{3}=2$ はどれも正しくできています。`,
      sol: [4, r`=-\frac{2}{5}`],
      hint: r`$\frac{8}{5}-2$ を計算するとき、$2$ はどんな分数に直せばよいですか？`,
    }),
    make({
      id: 'J1-PN-0098', cat: C, d: 4,
      q: r`-\frac{3}{8}\times\left\{\frac{2}{3}-(-2)^2\right\}`,
      a: [r`=-\frac{3}{8}\times\left(\frac{2}{3}-4\right)`, r`=-\frac{3}{8}\times\left(\frac{2}{3}-\frac{12}{3}\right)`, r`=-\frac{3}{8}\times\frac{10}{3}`, r`=-\frac{5}{4}`],
      e: 3, type: '分数のひき算で答えの符号を誤った',
      exp: r`$\frac{2}{3}-\frac{12}{3}$ は、ひく数のほうが大きいので答えは負の数になり、$-\frac{10}{3}$ です。$\frac{10}{3}$ としたところが誤りです。$(-2)^2=4$、$4=\frac{12}{3}$ は正しくできています。正しくは $-\frac{3}{8}\times\left(-\frac{10}{3}\right)=\frac{5}{4}$ です。`,
      sol: [3, r`=-\frac{3}{8}\times\left(-\frac{10}{3}\right)`, r`=\frac{5}{4}`],
      hint: r`$\frac{2}{3}-\frac{12}{3}$ の答えの符号を確かめましょう。`,
    }),
    make({
      id: 'J1-PN-0099', cat: C, d: 4,
      q: r`\left(\frac{1}{4}-\frac{5}{6}\right)\times(-24)+(-2)^3`,
      a: [r`=\frac{1}{4}\times(-24)-\frac{5}{6}\times(-24)+(-8)`, r`=-6+20-8`, r`=6`],
      e: null,
      exp: r`すべての行が正しい計算です。かっこの中を通分せずに、分配法則で $-24$ を両方の項にかけています。$\frac{1}{4}\times(-24)=-6$、$-\frac{5}{6}\times(-24)=+20$、$(-2)^3=-8$ なので、$-6+20-8=6$ です。かっこの中を先に計算して $-\frac{7}{12}\times(-24)=14$ としても、同じ答えになります。`,
      hint: r`分配法則を使った解き方も正しい方法です。それぞれの積の符号を確かめましょう。`,
    }),
    make({
      id: 'J1-PN-0100', cat: C, d: 4,
      q: r`-1.2\div\left(-\frac{3}{5}\right)^2\times0.3`,
      a: [r`=-\frac{6}{5}\div\frac{9}{25}\times\frac{3}{10}`, r`=-\frac{6}{5}\times\frac{25}{9}\times\frac{3}{10}`, r`=-\frac{6\times25\times3}{5\times9\times10}`, r`=-1`],
      e: null,
      exp: r`すべての行が正しい計算です。小数を分数に直し（$1.2=\frac{6}{5}$、$0.3=\frac{3}{10}$）、累乗を先に計算して $\left(-\frac{3}{5}\right)^2=\frac{9}{25}$ です。わり算を逆数のかけ算に直すと、負の数は $-\frac{6}{5}$ の $1$ 個なので符号は「$-$」、$\frac{450}{450}=1$ なので答えは $-1$ です。`,
      hint: r`累乗を先に計算しましょう。$\left(-\frac{3}{5}\right)^2$ の符号はどうなりますか？`,
    }),
  ],
};
