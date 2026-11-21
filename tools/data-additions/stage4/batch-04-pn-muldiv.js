/*
 * 第4段階 バッチ04：正負の数「乗法・除法」★★★・★★★★（10問）
 */
'use strict';
const { make, r } = require('./q.js');
const C = '乗法・除法';

module.exports = {
  'j1-positive-negative.json': [
    make({
      id: 'J1-PN-0049', cat: C, d: 3,
      q: r`\frac{7}{12}\div\left(-\frac{14}{9}\right)\times(-8)`,
      a: [r`=-\frac{7}{12}\times\frac{9}{14}\times8`, r`=-\frac{7\times9\times8}{12\times14}`, r`=-3`],
      e: 1, type: '負の数の個数を数えまちがえた符号のミス',
      exp: r`負の数は $-\frac{14}{9}$ と $-8$ の $2$ 個（偶数個）なので、答えの符号は「$+$」です。「$-$」としたところが誤りです。わる数を逆数 $\frac{9}{14}$ にしたところと、絶対値の計算 $\frac{7\times9\times8}{12\times14}=3$ は正しくできています。正しい答えは $3$ です。`,
      sol: [1, r`=\frac{7}{12}\times\frac{9}{14}\times8`, r`=\frac{7\times9\times8}{12\times14}`, r`=3`],
      hint: r`式の中に負の数はいくつありますか？`,
    }),
    make({
      id: 'J1-PN-0050', cat: C, d: 3,
      q: r`(-0.6)\div\frac{3}{4}\times(-5)`,
      a: [r`=-\frac{3}{5}\times\frac{4}{3}\times(-5)`, r`=\frac{3\times4}{5\times3\times5}`, r`=\frac{4}{25}`],
      e: 2, type: '整数のかけ算を分母にかけてしまった誤り',
      exp: r`$\times(-5)$ の $5$ は分子にかけます。$\frac{3}{5}\times\frac{4}{3}\times5=\frac{3\times4\times5}{5\times3}$ なので、答えは $4$ です。$5$ を分母に入れてしまったところが誤りです。$-0.6=-\frac{3}{5}$ と直したところ、逆数 $\frac{4}{3}$、負の数が $2$ 個なので符号を「$+$」にしたところは正しくできています。`,
      sol: [2, r`=\frac{3\times4\times5}{5\times3}`, r`=4`],
      hint: r`整数 $5$ を分数で表すと $\frac{5}{1}$ です。$5$ は分子と分母のどちらに入りますか？`,
    }),
    make({
      id: 'J1-PN-0051', cat: C, d: 3,
      q: r`(-2.5)\times(-0.4)\div(-0.05)`,
      a: [r`=-(2.5\times0.4\div0.05)`, r`=-(1\div0.05)`, r`=-2`],
      e: 3, type: '小数のわり算で位取りを誤った',
      exp: r`$1\div0.05$ は、わる数とわられる数を $100$ 倍して $100\div5=20$ です。$-2$ としたところが誤りです。$0.05$ は $\frac{1}{20}$ なので、$1\div\frac{1}{20}=20$ と考えることもできます。符号（負の数が $3$ 個なので「$-$」）と $2.5\times0.4=1$ は正しくできています。正しい答えは $-20$ です。`,
      sol: [3, r`=-20`],
      hint: r`$1\div0.05$ の答えは、$1$ より大きくなりますか、小さくなりますか？`,
    }),
    make({
      id: 'J1-PN-0052', cat: C, d: 3,
      q: r`(-6)\times\left(-\frac{2}{3}\right)\div(-8)\times(-12)`,
      a: [r`=4\div(-8)\times(-12)`, r`=4\times\left(-\frac{1}{8}\right)\times(-12)`, r`=-\frac{1}{2}\times(-12)`, r`=-6`],
      e: 4, type: '負の数どうしの積の符号ミス',
      exp: r`$-\frac{1}{2}\times(-12)$ は負の数どうしの積なので、答えの符号は「$+$」で $6$ です。$-6$ としたところが誤りです。左から順に計算した $(-6)\times\left(-\frac{2}{3}\right)=4$、$4\times\left(-\frac{1}{8}\right)=-\frac{1}{2}$ はどれも正しくできています。`,
      sol: [4, r`=6`],
      hint: r`最後のかけ算 $-\frac{1}{2}\times(-12)$ の答えの符号はどうなりますか？`,
    }),
    make({
      id: 'J1-PN-0053', cat: C, d: 3,
      q: r`\left(-\frac{3}{8}\right)\div(-0.75)\times(-4)`,
      a: [r`=-\frac{3}{8}\times\left(-\frac{4}{3}\right)\times(-4)`, r`=-\frac{3\times4\times4}{8\times3}`, r`=-2`],
      e: null,
      exp: r`すべての行が正しい計算です。$-0.75=-\frac{3}{4}$ なので、その逆数 $-\frac{4}{3}$ をかけています。負の数が $3$ 個なので符号は「$-$」で、$\frac{3\times4\times4}{8\times3}=\frac{48}{24}=2$ です。`,
      hint: r`$0.75$ を分数に直すといくつですか？ その逆数も確かめましょう。`,
    }),
    make({
      id: 'J1-PN-0054', cat: C, d: 4,
      q: r`\frac{5}{6}\div\left(-\frac{10}{3}\right)\div(-0.25)`,
      a: [r`=\frac{5}{6}\times\left(-\frac{3}{10}\right)\times(-0.25)`, r`=\frac{5}{6}\times\frac{3}{10}\times\frac{1}{4}`, r`=\frac{1}{16}`],
      e: 1, type: '小数でわるときに逆数にしていない',
      exp: r`$\div(-0.25)$ も逆数のかけ算に直します。$-0.25=-\frac{1}{4}$ なので、逆数は $-4$ です。$\times(-0.25)$ としたところが誤りです。$\div\left(-\frac{10}{3}\right)$ を $\times\left(-\frac{3}{10}\right)$ としたところは正しくできています。正しくは $\frac{5}{6}\times\frac{3}{10}\times4=1$ です。`,
      sol: [1, r`=\frac{5}{6}\times\left(-\frac{3}{10}\right)\times(-4)`, r`=\frac{5\times3\times4}{6\times10}`, r`=1`],
      hint: r`2つ目のわり算 $\div(-0.25)$ も、かけ算に直せていますか？ $0.25$ を分数で表してみましょう。`,
    }),
    make({
      id: 'J1-PN-0055', cat: C, d: 4,
      q: r`-0.75\times\left(-\frac{2}{3}\right)\div\left(-\frac{5}{4}\right)`,
      a: [r`=-\frac{3}{4}\times\left(-\frac{2}{3}\right)\times\left(-\frac{4}{5}\right)`, r`=\frac{3\times2\times4}{4\times3\times5}`, r`=\frac{2}{5}`],
      e: 2, type: '先頭の負の数を数え忘れた符号のミス',
      exp: r`負の数は $-\frac{3}{4}$、$-\frac{2}{3}$、$-\frac{4}{5}$ の $3$ 個（奇数個）なので、答えの符号は「$-$」です。先頭の $-\frac{3}{4}$ を数えずに「$+$」としたところが誤りです。小数を分数に直したところと逆数は正しくできています。正しい答えは $-\frac{2}{5}$ です。`,
      sol: [2, r`=-\frac{3\times2\times4}{4\times3\times5}`, r`=-\frac{2}{5}`],
      hint: r`先頭の $-\frac{3}{4}$ も負の数です。負の数は全部でいくつありますか？`,
    }),
    make({
      id: 'J1-PN-0056', cat: C, d: 4,
      q: r`(-48)\div(-6)\div(-2)\div\left(-\frac{1}{3}\right)`,
      a: [r`=48\div6\div2\div\frac{1}{3}`, r`=8\div2\div\frac{1}{3}`, r`=8\div6`, r`=\frac{4}{3}`],
      e: 3, type: 'わり算が続く計算を右から計算した誤り',
      exp: r`わり算が続く式は、左から順に計算します。$8\div2\div\frac{1}{3}$ は、先に $8\div2=4$、次に $4\div\frac{1}{3}=4\times3=12$ です。右側の $2\div\frac{1}{3}=6$ を先に計算して $8\div6$ としたところが誤りです。負の数が $4$ 個なので符号を「$+$」にしたところと、$48\div6=8$ は正しくできています。`,
      sol: [3, r`=4\div\frac{1}{3}`, r`=12`],
      hint: r`$8\div2\div\frac{1}{3}$ は、どちらのわり算から計算しますか？`,
    }),
    make({
      id: 'J1-PN-0057', cat: C, d: 4,
      q: r`0.2\times(-15)\div\left(-\frac{3}{5}\right)\times(-0.1)`,
      a: [r`=-3\div\left(-\frac{3}{5}\right)\times(-0.1)`, r`=-3\times\left(-\frac{5}{3}\right)\times(-0.1)`, r`=5\times(-0.1)`, r`=-5`],
      e: 4, type: '0.1 をかける計算で小数点の位置を誤った',
      exp: r`$5\times(-0.1)$ は $5$ の $\frac{1}{10}$ なので $-0.5$ です。$-5$ としたところが誤りです。$0.2\times(-15)=-3$、逆数 $-\frac{5}{3}$、$-3\times\left(-\frac{5}{3}\right)=5$ はどれも正しくできています。`,
      sol: [4, r`=-0.5`],
      hint: r`$0.1$ をかけると、数の大きさはどうなりますか？`,
    }),
    make({
      id: 'J1-PN-0058', cat: C, d: 4,
      q: r`\left(-\frac{2}{3}\right)\div0.4\times\left(-\frac{3}{10}\right)\div(-5)`,
      a: [r`=-\frac{2}{3}\times\frac{5}{2}\times\frac{3}{10}\times\frac{1}{5}`, r`=-\frac{2\times5\times3}{3\times2\times10\times5}`, r`=-\frac{1}{10}`],
      e: null,
      exp: r`すべての行が正しい計算です。$0.4=\frac{2}{5}$ なので、$\div0.4$ は $\times\frac{5}{2}$、$\div(-5)$ は $\times\left(-\frac{1}{5}\right)$ です。負の数が $3$ 個なので符号は「$-$」で、$\frac{2\times5\times3}{3\times2\times10\times5}=\frac{30}{300}=\frac{1}{10}$ です。`,
      hint: r`$0.4$ の逆数はいくつですか？ 負の数の個数も数えましょう。`,
    }),
  ],
};
