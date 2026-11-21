/*
 * math-verify.js
 * 計算ティーチャー！ 数式検証ライブラリ（Node.js / ブラウザ 共用）
 *
 * - 中学数学で使う LaTeX のサブセットを構文解析し、BigInt による厳密な有理数で評価する。
 * - 式どうしの等価性（無作為な有理数点での一致）と、1次方程式の解集合の一致を判定する。
 * - 判定できないもの（解析不能・非線形の方程式など）は "unknown" を返し、合格扱いにしない。
 *
 * 対応する記法：
 *   数（整数・小数）, 1文字の変数 a〜z, + - \times \div \cdot, 暗黙の積（3x, 2(x+1), \frac{1}{2}x）,
 *   ( ) [ ] \{ \} \left( \right) 等, \frac{..}{..} / \dfrac / \tfrac, 累乗 ^n（0以上の整数指数）, =
 *
 * 演算の優先順位（中学校の慣習に合わせる）：
 *   累乗 > 暗黙の積（3y や 2(x+1) をひとかたまりとみなす） > \times・\div（左から） > + −
 *   先頭の単項マイナスは累乗の外側にかかる（-3^2 = -(3^2) = -9）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MathVerify = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- 有理数
  function gcd(a, b) {
    if (a < 0n) a = -a;
    if (b < 0n) b = -b;
    while (b !== 0n) { const t = a % b; a = b; b = t; }
    return a;
  }

  class Rational {
    constructor(num, den = 1n) {
      if (den === 0n) throw new MathError('0 でわる計算が含まれています');
      if (den < 0n) { num = -num; den = -den; }
      const g = gcd(num, den) || 1n;
      this.num = num / g;
      this.den = den / g;
    }
    static of(n, d = 1) { return new Rational(BigInt(n), BigInt(d)); }
    static fromDecimalString(s) {
      if (!/^\d+(\.\d+)?$/.test(s)) throw new MathError('数の形式が不正です: ' + s);
      const [ip, fp = ''] = s.split('.');
      return new Rational(BigInt(ip + fp), 10n ** BigInt(fp.length));
    }
    // 相手が根号をふくむ数（Surd）のときは、Surd として計算する（中1の有理数だけの計算は従来どおり）
    add(o) { if (o instanceof Surd) return Surd.from(this).add(o); return new Rational(this.num * o.den + o.num * this.den, this.den * o.den); }
    sub(o) { if (o instanceof Surd) return Surd.from(this).sub(o); return new Rational(this.num * o.den - o.num * this.den, this.den * o.den); }
    mul(o) { if (o instanceof Surd) return Surd.from(this).mul(o); return new Rational(this.num * o.num, this.den * o.den); }
    div(o) {
      if (o instanceof Surd) return Surd.from(this).div(o);
      if (o.num === 0n) throw new MathError('0 でわる計算が含まれています');
      return new Rational(this.num * o.den, this.den * o.num);
    }
    neg() { return new Rational(-this.num, this.den); }
    pow(n) {
      let r = Rational.of(1);
      for (let i = 0; i < n; i++) r = r.mul(this);
      return r;
    }
    isZero() { return this.num === 0n; }
    isNegative() { return this.num < 0n; }
    equals(o) { if (o instanceof Surd) return Surd.from(this).equals(o); return this.num === o.num && this.den === o.den; }
    toString() { return this.den === 1n ? this.num.toString() : `${this.num}/${this.den}`; }
    toLatex() {
      if (this.den === 1n) return this.num.toString();
      const sign = this.num < 0n ? '-' : '';
      const n = this.num < 0n ? -this.num : this.num;
      return `${sign}\\frac{${n}}{${this.den}}`;
    }
  }

  class MathError extends Error {}

  // ---------------------------------------------------------------- 根号をふくむ数（厳密な計算）
  // 有理数 × √(平方因子をふくまない正の整数) の和で表す：  c1 + c2√2 + c3√3 + c4√6 …
  // 近似値（小数）は使わない。√(a^2) は |a| になり、負の数の平方根は「実数の範囲にない」として扱う。
  const MAX_RADICAND = 10n ** 12n;

  /** n = outer^2 × inner（inner は平方因子をふくまない）に分ける */
  function splitSquare(n) {
    if (n > MAX_RADICAND) throw new MathError('根号の中の数が大きすぎます');
    let outer = 1n;
    let inner = 1n;
    let m = n;
    for (let p = 2n; p * p <= m; p += (p === 2n ? 1n : 2n)) {
      while (m % (p * p) === 0n) { outer *= p; m /= p * p; }
      if (m % p === 0n) { inner *= p; m /= p; }
    }
    inner *= m;
    return [outer, inner];
  }
  function primeFactors(n) {
    const ps = [];
    let m = n;
    for (let p = 2n; p * p <= m; p += (p === 2n ? 1n : 2n)) {
      if (m % p === 0n) { ps.push(p); while (m % p === 0n) m /= p; }
    }
    if (m > 1n) ps.push(m);
    return ps;
  }

  class Surd {
    /** @param {Map<bigint, Rational>} terms 根号の中の数（平方因子なし）→ 係数 */
    constructor(terms) {
      this.terms = new Map();
      for (const [r, c] of terms) if (!c.isZero()) this.terms.set(r, c);
    }
    static from(x) { return x instanceof Surd ? x : new Surd(new Map([[1n, x]])); }
    /** 有理数 r の正の平方根（r < 0 は実数の範囲にない） */
    static sqrtOf(r) {
      if (r instanceof Surd) {
        const q = r.toRationalOrNull();
        if (q === null) throw new MathError('根号の中に根号をふくむ式は自動判定の対象外です');
        r = q;
      }
      if (r.isNegative()) throw new MathError('負の数の平方根は実数の範囲にありません');
      if (r.isZero()) return Rational.of(0);
      const [o, i] = splitSquare(r.num * r.den);
      return new Surd(new Map([[i, new Rational(o, r.den)]])).simplify();
    }
    get(r) { return this.terms.get(r) || Rational.of(0); }
    add(o) {
      const s = Surd.from(o);
      const m = new Map(this.terms);
      for (const [r, c] of s.terms) m.set(r, (m.get(r) || Rational.of(0)).add(c));
      return new Surd(m).simplify();
    }
    neg() { return new Surd(new Map([...this.terms].map(([r, c]) => [r, c.neg()]))); }
    sub(o) { return this.add(Surd.from(o).neg()); }
    mul(o) {
      const s = Surd.from(o);
      const m = new Map();
      for (const [r1, c1] of this.terms) {
        for (const [r2, c2] of s.terms) {
          const [outer, inner] = splitSquare(r1 * r2);
          m.set(inner, (m.get(inner) || Rational.of(0)).add(c1.mul(c2).mul(new Rational(outer))));
        }
      }
      return new Surd(m).simplify();
    }
    /** わり算：分母の根号は、共役（√p の項の符号を変えたもの）を順にかけて消す（分母の有理化） */
    div(o) {
      let d = Surd.from(o);
      if (d.isZero()) throw new MathError('0 でわる計算が含まれています');
      let n = Surd.from(this);
      const primes = new Set();
      for (const r of d.terms.keys()) primeFactors(r).forEach((p) => primes.add(p));
      for (const p of primes) {
        const conj = new Surd(new Map([...d.terms].map(([r, c]) => [r, r % p === 0n ? c.neg() : c])));
        n = Surd.from(n.mul(conj));
        d = Surd.from(d.mul(conj));
      }
      const q = d.toRationalOrNull();
      if (q === null) throw new MathError('分母の有理化ができません');
      return Surd.from(n).mulRational(Rational.of(1).div(q)).simplify();
    }
    mulRational(q) { return new Surd(new Map([...this.terms].map(([r, c]) => [r, c.mul(q)]))); }
    pow(n) {
      let r = Rational.of(1);
      for (let i = 0; i < n; i++) r = r.mul(this);
      return r;
    }
    isZero() { return this.terms.size === 0; }
    equals(o) { return Surd.from(this.sub(o)).isZero(); }
    toRationalOrNull() {
      if (this.terms.size === 0) return Rational.of(0);
      if (this.terms.size === 1 && this.terms.has(1n)) return this.terms.get(1n);
      return null;
    }
    /** 根号が残らなければ有理数にもどす（中1の計算と同じ型で比べられるように） */
    simplify() { const q = this.toRationalOrNull(); return q === null ? this : q; }
    toString() {
      if (this.terms.size === 0) return '0';
      return [...this.terms].sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([r, c]) => (r === 1n ? c.toString() : `${c.toString()}√${r}`)).join(' + ');
    }
  }

  // ---------------------------------------------------------------- 字句解析
  const IGNORED_COMMANDS = new Set(['\\,', '\\;', '\\:', '\\!', '\\quad', '\\qquad', '\\displaystyle', '\\ ']);
  const OPEN = { '(': ')', '[': ']', '\\{': '\\}', '\\lbrace': '\\rbrace' };

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] || ''))) {
        let j = i;
        while (j < src.length && /[\d.]/.test(src[j])) j++;
        tokens.push({ t: 'num', v: src.slice(i, j) });
        i = j;
        continue;
      }
      if (/[a-zA-Z]/.test(c)) { tokens.push({ t: 'var', v: c }); i++; continue; }
      if (c === '\\') {
        // \{ \} \, \; \! などの1文字コマンド
        if (/[{}\s,;:!]/.test(src[i + 1] || '')) {
          const cmd = '\\' + src[i + 1];
          i += 2;
          if (!IGNORED_COMMANDS.has(cmd)) tokens.push({ t: 'cmd', v: cmd });
          continue;
        }
        let j = i + 1;
        while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
        const cmd = src.slice(i, j);
        i = j;
        if (cmd === '\\') throw new MathError('不明なコマンドです');
        if (IGNORED_COMMANDS.has(cmd)) continue;
        tokens.push({ t: 'cmd', v: cmd });
        continue;
      }
      if ('+-=^(){}[]'.includes(c)) { tokens.push({ t: 'sym', v: c }); i++; continue; }
      throw new MathError(`解析できない文字があります: "${c}"`);
    }
    return tokens;
  }

  // ---------------------------------------------------------------- 構文解析（AST）
  // ノード: {k:'num', v:Rational} {k:'var', v:'x'} {k:'add', a, b} {k:'sub', a, b}
  //         {k:'mul', a, b} {k:'div', a, b} {k:'neg', a} {k:'pow', a, n}
  function Parser(tokens) {
    this.tk = tokens;
    this.p = 0;
  }
  Parser.prototype.peek = function () { return this.tk[this.p]; };
  Parser.prototype.next = function () { return this.tk[this.p++]; };
  Parser.prototype.is = function (t, v) {
    const k = this.peek();
    return !!k && k.t === t && (v === undefined || k.v === v);
  };
  Parser.prototype.expect = function (t, v) {
    if (!this.is(t, v)) {
      const k = this.peek();
      throw new MathError(`"${v || t}" が必要な位置に ${k ? '"' + k.v + '"' : '式の終わり'} があります`);
    }
    return this.next();
  };

  // expr := [+|-] mul ( (+|-) mul )*
  Parser.prototype.parseExpr = function () {
    let node;
    if (this.is('sym', '-')) { this.next(); node = { k: 'neg', a: this.parseMul() }; }
    else if (this.is('sym', '+')) { this.next(); node = this.parseMul(); }
    else node = this.parseMul();
    while (this.is('sym', '+') || this.is('sym', '-')) {
      const op = this.next().v;
      const rhs = this.parseMul();
      node = { k: op === '+' ? 'add' : 'sub', a: node, b: rhs };
    }
    return node;
  };

  // mul := implicit ( (\times|\cdot|\div) implicit )*
  Parser.prototype.parseMul = function () {
    let node = this.parseImplicit();
    while (this.is('cmd', '\\times') || this.is('cmd', '\\cdot') || this.is('cmd', '\\div')) {
      const op = this.next().v;
      const rhs = this.parseImplicit();
      node = { k: op === '\\div' ? 'div' : 'mul', a: node, b: rhs };
    }
    return node;
  };

  Parser.prototype.startsAtom = function () {
    const k = this.peek();
    if (!k) return false;
    if (k.t === 'num' || k.t === 'var') return true;
    if (k.t === 'sym' && (k.v === '(' || k.v === '[' || k.v === '{')) return true;
    if (k.t === 'cmd' && ['\\frac', '\\dfrac', '\\tfrac', '\\left', '\\{', '\\lbrace', '\\bigl', '\\Bigl', '\\sqrt'].includes(k.v)) return true;
    return false;
  };

  // implicit := power power*
  Parser.prototype.parseImplicit = function () {
    let node = this.parsePower();
    while (this.startsAtom()) {
      // 数の直後に数が並ぶ（"2 3"）のは暗黙の積として不自然なので拒否する
      const k = this.peek();
      if (k.t === 'num' && node.k === 'num') throw new MathError('数が連続しています');
      node = { k: 'mul', a: node, b: this.parsePower(), implicit: true };
    }
    return node;
  };

  // power := atom ( ^ exponent )?
  Parser.prototype.parsePower = function () {
    const base = this.parseAtom();
    if (this.is('sym', '^')) {
      this.next();
      let expTok;
      if (this.is('sym', '{')) {
        this.next();
        expTok = this.expect('num');
        this.expect('sym', '}');
      } else {
        expTok = this.expect('num');
      }
      // 指数が複数桁で中かっこがない場合（x^23）、LaTeX は x^2 3 と解釈するため拒否する
      if (!/^\d+$/.test(expTok.v)) throw new MathError('指数は0以上の整数のみ対応しています');
      const n = Number(expTok.v);
      if (n > 12) throw new MathError('指数が大きすぎます');
      return { k: 'pow', a: base, n };
    }
    return base;
  };

  Parser.prototype.parseGroup = function (open) {
    const close = OPEN[open];
    const inner = this.parseExpr();
    if (this.is('cmd', '\\right')) {
      this.next();
      const k = this.next();
      if (!k || (k.v !== close && !(close === '\\}' && k.v === '\\rbrace'))) throw new MathError('かっこの対応が正しくありません');
    } else {
      const k = this.next();
      if (!k || k.v !== close) throw new MathError('かっこが閉じていません');
    }
    return { k: 'group', a: inner, bracket: open };
  };

  Parser.prototype.parseAtom = function () {
    const k = this.next();
    if (!k) throw new MathError('式が途中で終わっています');
    if (k.t === 'num') return { k: 'num', v: Rational.fromDecimalString(k.v), raw: k.v };
    if (k.t === 'var') return { k: 'var', v: k.v };
    if (k.t === 'sym' && k.v === '{') {
      const inner = this.parseExpr();
      this.expect('sym', '}');
      return inner;
    }
    if (k.t === 'sym' && (k.v === '(' || k.v === '[')) return this.parseGroup(k.v);
    if (k.t === 'cmd' && (k.v === '\\{' || k.v === '\\lbrace')) return this.parseGroup('\\{');
    if (k.t === 'cmd' && (k.v === '\\left' || k.v === '\\bigl' || k.v === '\\Bigl')) {
      const o = this.next();
      if (!o || !OPEN[o.v]) throw new MathError('\\left の後のかっこが不正です');
      return this.parseGroup(o.v);
    }
    if (k.t === 'cmd' && (k.v === '\\frac' || k.v === '\\dfrac' || k.v === '\\tfrac')) {
      this.expect('sym', '{');
      const n = this.parseExpr();
      this.expect('sym', '}');
      this.expect('sym', '{');
      const d = this.parseExpr();
      this.expect('sym', '}');
      return { k: 'div', a: n, b: d, frac: true };
    }
    if (k.t === 'cmd' && k.v === '\\sqrt') {
      // \sqrt{...} または \sqrt2 のような1文字。\sqrt[3]{} などの累乗根は対象外
      if (this.is('sym', '[')) throw new MathError('累乗根（\\sqrt[n]）は対象外です');
      if (this.is('sym', '{')) {
        this.next();
        const inner = this.parseExpr();
        this.expect('sym', '}');
        return { k: 'sqrt', a: inner };
      }
      const t = this.next();
      if (!t) throw new MathError('\\sqrt のあとに式がありません');
      if (t.t === 'num') {
        if (t.v.length !== 1) throw new MathError('\\sqrt のあとの2桁以上の数は {} で囲んでください');
        return { k: 'sqrt', a: { k: 'num', v: Rational.fromDecimalString(t.v), raw: t.v } };
      }
      if (t.t === 'var') return { k: 'sqrt', a: { k: 'var', v: t.v } };
      throw new MathError('\\sqrt の使い方が正しくありません');
    }
    throw new MathError(`"${k.v}" はこの位置では使えません`);
  };

  function parseExpression(src) {
    const tokens = tokenize(src);
    if (tokens.length === 0) throw new MathError('式が空です');
    const p = new Parser(tokens);
    const node = p.parseExpr();
    if (p.p < tokens.length) throw new MathError(`余分な記号があります: "${tokens[p.p].v}"`);
    return node;
  }

  // 最上位の "=" で分割する（かっこの内側の = は考慮不要だが、念のため深さを数える）
  function splitTopLevelEquals(src) {
    const parts = [];
    let depth = 0, last = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') depth--;
      else if (c === '=' && depth === 0) { parts.push(src.slice(last, i)); last = i + 1; }
    }
    parts.push(src.slice(last));
    return parts;
  }

  // ---------------------------------------------------------------- 評価
  function evaluate(node, env) {
    switch (node.k) {
      case 'num': return node.v;
      case 'var':
        if (!(node.v in env)) throw new MathError(`変数 ${node.v} の値がありません`);
        return env[node.v];
      case 'group': return evaluate(node.a, env);
      case 'neg': return evaluate(node.a, env).neg();
      case 'add': return evaluate(node.a, env).add(evaluate(node.b, env));
      case 'sub': return evaluate(node.a, env).sub(evaluate(node.b, env));
      case 'mul': return evaluate(node.a, env).mul(evaluate(node.b, env));
      case 'div': return evaluate(node.a, env).div(evaluate(node.b, env));
      case 'pow': return evaluate(node.a, env).pow(node.n);
      case 'sqrt': return Surd.sqrtOf(evaluate(node.a, env));
      default: throw new MathError('未知のノードです: ' + node.k);
    }
  }

  function collectVars(node, set = new Set()) {
    if (!node) return set;
    if (node.k === 'var') set.add(node.v);
    ['a', 'b'].forEach((key) => { if (node[key]) collectVars(node[key], set); });
    return set;
  }

  // 決定的な疑似乱数（検証結果を毎回同じにするため）
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function samplePoints(vars, count, seed = 12345) {
    const rng = makeRng(seed);
    const pts = [];
    for (let i = 0; i < count; i++) {
      const env = {};
      vars.forEach((v) => {
        let n = 0;
        while (n === 0) n = Math.floor(rng() * 41) - 20;
        const d = Math.floor(rng() * 7) + 1;
        env[v] = Rational.of(n, d);
      });
      pts.push(env);
    }
    return pts;
  }

  // ---------------------------------------------------------------- 行の解析
  /**
   * 1行を解析する。
   * mode: 'expression'（式の計算・式の値） | 'equation'（方程式）
   * 戻り値: { ok, kind:'expression'|'equation', ast|lhs,rhs, vars, error }
   */
  function parseLine(line, mode) {
    if (mode === 'quadratic') return parseQuadraticLine(line);
    if (mode === 'system') return parseSystemLine(line);
    try {
      let src = line.trim();
      if (mode === 'expression') {
        if (src.startsWith('=')) src = src.slice(1);
        const parts = splitTopLevelEquals(src);
        if (parts.length !== 1) throw new MathError('式の計算の行に "=" が2つ以上あります（1行に1つの式を書いてください）');
        const ast = parseExpression(src);
        return { ok: true, kind: 'expression', ast, vars: [...collectVars(ast)].sort() };
      }
      const parts = splitTopLevelEquals(src);
      if (parts.length !== 2) throw new MathError('方程式の行には "=" がちょうど1つ必要です');
      const lhs = parseExpression(parts[0]);
      const rhs = parseExpression(parts[1]);
      const vars = new Set([...collectVars(lhs), ...collectVars(rhs)]);
      return { ok: true, kind: 'equation', lhs, rhs, vars: [...vars].sort() };
    } catch (e) {
      if (e instanceof MathError) return { ok: false, error: e.message };
      throw e;
    }
  }

  // ---------------------------------------------------------------- 等価性の判定
  /**
   * 2つの式の等価性。
   *  - substitution（{a: Rational}）があれば、その値を代入した値の一致で判定（式の値の問題）。
   *  - なければ、無作為な有理数点 8 か所で一致するかを判定。
   * 戻り値: 'equal' | 'different' | 'unknown'
   */
  function compareExpressions(p1, p2, substitution) {
    if (!p1.ok || !p2.ok) return { result: 'unknown', reason: '解析できない行があります' };
    try {
      if (substitution) {
        const v1 = evaluate(p1.ast, substitution);
        const v2 = evaluate(p2.ast, substitution);
        return { result: v1.equals(v2) ? 'equal' : 'different', values: [v1, v2] };
      }
      const vars = [...new Set([...p1.vars, ...p2.vars])].sort();
      const pts = samplePoints(vars, vars.length === 0 ? 1 : 8);
      let evaluated = 0;
      for (const env of pts) {
        let v1, v2;
        try {
          v1 = evaluate(p1.ast, env);
          v2 = evaluate(p2.ast, env);
        } catch (e) {
          if (e instanceof MathError) continue; // 0 でわる点は飛ばす
          throw e;
        }
        evaluated++;
        if (!v1.equals(v2)) return { result: 'different', at: env, values: [v1, v2] };
      }
      if (evaluated < Math.min(pts.length, 5)) return { result: 'unknown', reason: '評価できる点が不足しています' };
      return { result: 'equal' };
    } catch (e) {
      if (e instanceof MathError) return { result: 'unknown', reason: e.message };
      throw e;
    }
  }

  /**
   * 1変数の1次方程式（または恒等式・不能）の解集合を求める。
   * 戻り値: {type:'unique', value:Rational, variable} | {type:'all'} | {type:'none'} | {type:'unknown', reason}
   */
  function solutionSet(p) {
    if (!p.ok) return { type: 'unknown', reason: p.error };
    if (p.vars.length > 1) return { type: 'unknown', reason: '文字が2種類以上あります' };
    const v = p.vars[0];
    const f = (t) => {
      const env = v ? { [v]: Rational.of(t) } : {};
      return evaluate(p.lhs, env).sub(evaluate(p.rhs, env));
    };
    try {
      if (!v) {
        return f(0).isZero() ? { type: 'all' } : { type: 'none' };
      }
      // 7 点で値を取り、1次関数であることを確かめる（分母に文字があるなどの場合は unknown）
      const ts = [0, 1, 2, 3, -1, 5, -7];
      const vals = ts.map(f);
      const a = vals[1].sub(vals[0]);
      const b = vals[0];
      for (let i = 0; i < ts.length; i++) {
        const predicted = a.mul(Rational.of(ts[i])).add(b);
        if (!predicted.equals(vals[i])) return { type: 'unknown', reason: '1次方程式ではありません（自動判定の対象外）' };
      }
      if (a.isZero()) return b.isZero() ? { type: 'all' } : { type: 'none' };
      return { type: 'unique', value: b.neg().div(a), variable: v };
    } catch (e) {
      if (e instanceof MathError) return { type: 'unknown', reason: e.message };
      throw e;
    }
  }

  function describeSolution(s) {
    if (s.type === 'unique') return `${s.variable}=${s.value.toString()}`;
    if (s.type === 'all') return 'すべての数（恒等式）';
    if (s.type === 'none') return '解なし';
    return '判定不能';
  }

  function compareEquations(p1, p2) {
    const s1 = solutionSet(p1);
    const s2 = solutionSet(p2);
    if (s1.type === 'unknown' || s2.type === 'unknown') {
      return { result: 'unknown', reason: s1.reason || s2.reason, solutions: [s1, s2] };
    }
    let same = s1.type === s2.type;
    if (same && s1.type === 'unique') same = s1.value.equals(s2.value) && s1.variable === s2.variable;
    return { result: same ? 'equal' : 'different', solutions: [s1, s2] };
  }

  function compareLines(p1, p2, mode, substitution) {
    if (mode === 'quadratic') {
      const s1 = lineSolutionSet(p1);
      const s2 = lineSolutionSet(p2);
      if (s1.type === 'unknown' || s2.type === 'unknown') return { result: 'unknown', reason: s1.reason || s2.reason, sets: [s1, s2] };
      return { result: sameSolutionSet(s1, s2) ? 'equal' : 'different', sets: [s1, s2] };
    }
    return mode === 'equation' ? compareEquations(p1, p2) : compareExpressions(p1, p2, substitution);
  }

  // 方程式の最終行が「x=数」の形になっているか
  function isSolvedForm(p) {
    if (!p.ok || p.kind !== 'equation') return false;
    const isVar = (n) => n.k === 'var';
    const isConst = (n) => collectVars(n).size === 0;
    return (isVar(p.lhs) && isConst(p.rhs)) || (isVar(p.rhs) && isConst(p.lhs));
  }

  function parseSubstitution(obj) {
    if (!obj) return null;
    const env = {};
    for (const [k, latex] of Object.entries(obj)) {
      const p = parseLine(String(latex), 'expression');
      if (!p.ok || p.vars.length) throw new MathError(`代入値 ${k}=${latex} を数として解析できません`);
      env[k] = evaluate(p.ast, {});
    }
    return env;
  }

  /**
   * 答案の各行を順に検証する。
   * 戻り値: {
   *   steps: [{ index, parse, vsPrev:'equal'|'different'|'unknown'|null, vsFirst, detail }],
   *   firstDifferent: 直前の行と等価でない最初の行（なければ null）,
   *   unknown: 判定不能な行があったか
   * }
   */
  function analyzeLines(lines, mode, substitution) {
    if (mode === 'system') return analyzeSystem(lines);
    const parsed = lines.map((l) => parseLine(l, mode));
    const steps = parsed.map((p, i) => {
      if (i === 0) return { index: 0, parse: p, vsPrev: null };
      const c = compareLines(parsed[i - 1], p, mode, substitution);
      return { index: i, parse: p, vsPrev: c.result, detail: c };
    });
    let firstDifferent = null;
    let unknown = parsed.some((p) => !p.ok);
    for (const s of steps) {
      if (s.vsPrev === 'unknown') unknown = true;
      if (s.vsPrev === 'different' && firstDifferent === null) firstDifferent = s.index;
    }
    return { steps, parsed, firstDifferent, unknown };
  }

  // ================================================================ 第6段階：1行に複数の式がある行
  /**
   * 1行を「式のかたまり」に分ける。
   *  - \begin{cases}…\end{cases}・\begin{array}…・\begin{aligned}… の各行（\\ で区切る）
   *  - 最上位の「,」（x=3,\ y=-2 など）
   *  - 「または」（\text{または}）
   * 加減法の筆算の「+)」「-)」の印、\hline、& は取り除く。
   * 戻り値：文字列の配列（各要素は1つの等式、または「-2」のような値だけ）
   */
  function splitSegments(src) {
    let s = src
      .replace(/\\begin\{(cases|aligned|array|gathered)\}(\{[^}]*\})?/g, ' ')
      .replace(/\\end\{(cases|aligned|array|gathered)\}/g, ' ')
      .replace(/\\hline/g, ' ')
      .replace(/&/g, ' ')
      .replace(/\\text\{\s*または\s*\}|または/g, ',');
    const rows = s.split(/\\\\/);
    const out = [];
    rows.forEach((row) => {
      const r = row.trim().replace(/^[+\-−]\)\s*(\\\s|\\,|\\;|\\quad)*/, '');
      let depth = 0;
      let last = 0;
      for (let i = 0; i < r.length; i++) {
        const c = r[i];
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') depth--;
        else if ((c === ',' || c === '，') && depth === 0) {
          // "\," は空白なので区切りにしない
          if (r[i - 1] === '\\') continue;
          out.push(r.slice(last, i));
          last = i + 1;
        }
      }
      out.push(r.slice(last));
    });
    return out.map((x) => x.replace(/^(\s|\\\s|\\,|\\;|\\quad|\\qquad)+|(\s|\\\s|\\,|\\;|\\quad|\\qquad)+$/g, '').trim()).filter(Boolean);
  }

  /** \pm・\mp をふくむ式を、+ と - の2通りに分ける（いくつあっても、すべての組み合わせ。\mp は \pm と逆の符号） */
  function expandPlusMinus(src) {
    const idx = src.search(/\\(pm|mp)(?![a-zA-Z])/);
    if (idx < 0) return [src];
    const isMp = src.slice(idx, idx + 3) === '\\mp';
    const rest = src.slice(idx + 3);
    // 同じ式の中の \pm・\mp は同じ順番の符号（複号同順）にする
    const plus = (src.slice(0, idx) + (isMp ? '-' : '+') + rest).replace(/\\pm(?![a-zA-Z])/g, '+').replace(/\\mp(?![a-zA-Z])/g, '-');
    const minus = (src.slice(0, idx) + (isMp ? '+' : '-') + rest).replace(/\\pm(?![a-zA-Z])/g, '-').replace(/\\mp(?![a-zA-Z])/g, '+');
    return [plus, minus];
  }

  // ---------------------------------------------------------------- 2次方程式（解の集合）
  const lessThan = (a, b) => (a.num * b.den < b.num * a.den);

  /**
   * 1つの文字についての2次以下の方程式の、実数の解の集合を厳密に求める。
   * 係数に根号がふくまれていてもよい（x=1+\sqrt{3} など）。判別式が有理数でない場合などは unknown。
   * 戻り値：{type:'set', values:[Rational|Surd], variable} | {type:'all'} | {type:'unknown', reason}
   *         （解なし・実数解なしは values が空の set）
   */
  function quadraticSolutionSet(p) {
    if (!p.ok) return { type: 'unknown', reason: p.error };
    if (p.vars.length > 1) return { type: 'unknown', reason: '文字が2種類以上あります' };
    const v = p.vars[0];
    const f = (t) => {
      const env = v ? { [v]: t } : {};
      return evaluate(p.lhs, env).sub(evaluate(p.rhs, env));
    };
    try {
      if (!v) return Surd.from(f(Rational.of(0))).isZero() ? { type: 'all' } : { type: 'set', values: [], variable: null };
      const candidates = [0, 1, 2, 3, -1, 5, -2, 7, -4, 11].map((n) => Rational.of(n)).concat([Rational.of(1, 2), Rational.of(-3, 7)]);
      const pts = [];
      for (const t of candidates) {
        try { pts.push([t, f(t)]); } catch (e) { if (!(e instanceof MathError)) throw e; }
      }
      if (pts.length < 6) return { type: 'unknown', reason: '評価できる点が不足しています' };
      // 3点で2次式 a t^2 + b t + c を決め、残りの点で確かめる（分母に文字があるなどは 2次以下の多項式ではない）
      const [[t0, y0], [t1, y1], [t2, y2]] = pts;
      const l = (ta, tb, tc) => ({ den: ta.sub(tb).mul(ta.sub(tc)), tb, tc });
      const L = [l(t0, t1, t2), l(t1, t0, t2), l(t2, t0, t1)];
      const ys = [y0, y1, y2];
      let a = Rational.of(0); let b = Rational.of(0); let c = Rational.of(0);
      L.forEach((li, i) => {
        const k = ys[i].div(li.den);
        a = a.add(k);
        b = b.sub(k.mul(li.tb.add(li.tc)));
        c = c.add(k.mul(li.tb.mul(li.tc)));
      });
      for (const [t, y] of pts.slice(3)) {
        if (!Surd.from(a.mul(t.mul(t)).add(b.mul(t)).add(c).sub(y)).isZero()) return { type: 'unknown', reason: '2次以下の方程式ではありません（自動判定の対象外）' };
      }
      const isZero = (x) => Surd.from(x).isZero();
      if (isZero(a)) {
        if (isZero(b)) return isZero(c) ? { type: 'all' } : { type: 'set', values: [], variable: v };
        return { type: 'set', values: [c.neg().div(b)], variable: v };
      }
      const D = b.mul(b).sub(Rational.of(4).mul(a).mul(c));
      const Dq = D instanceof Surd ? D.toRationalOrNull() : D;
      if (Dq === null) return { type: 'unknown', reason: '判別式に根号がふくまれています（自動判定の対象外）' };
      if (Dq.isNegative()) return { type: 'set', values: [], variable: v };
      const two_a = Rational.of(2).mul(a);
      if (Dq.isZero()) return { type: 'set', values: [b.neg().div(two_a)], variable: v };
      const sq = Surd.sqrtOf(Dq);
      return { type: 'set', values: [b.neg().add(sq).div(two_a), b.neg().sub(sq).div(two_a)], variable: v };
    } catch (e) {
      if (e instanceof MathError) return { type: 'unknown', reason: e.message };
      throw e;
    }
  }

  function uniqueValues(values) {
    const out = [];
    values.forEach((x) => { if (!out.some((y) => y.equals(x))) out.push(x); });
    return out;
  }

  /**
   * 2次方程式の単元の1行を解析する。「,」「または」「±」で並んだ式は「どれかが成り立つ」（解の和集合）。
   * 「x=3,\ -2」の「-2」のように値だけの部分は、前の式と同じ文字の値とみなす。
   */
  function parseQuadraticLine(line) {
    try {
      const segs = splitSegments(line);
      if (!segs.length) throw new MathError('式がありません');
      const eqs = [];
      let lastVar = null;
      for (const seg of segs) {
        for (const variant of expandPlusMinus(seg)) {
          const parts = splitTopLevelEquals(variant);
          let p;
          if (parts.length === 1) {
            if (!lastVar) throw new MathError('「=」のない部分があります');
            p = { ok: true, kind: 'equation', lhs: { k: 'var', v: lastVar }, rhs: parseExpression(parts[0]) };
          } else if (parts.length === 2) {
            p = { ok: true, kind: 'equation', lhs: parseExpression(parts[0]), rhs: parseExpression(parts[1]) };
          } else {
            throw new MathError('1つの式に「=」が2つ以上あります');
          }
          p.vars = [...new Set([...collectVars(p.lhs), ...collectVars(p.rhs)])].sort();
          if (p.lhs.k === 'var' && p.vars.length === 1) lastVar = p.lhs.v;
          else if (p.vars.length === 1) lastVar = p.vars[0];
          eqs.push(p);
        }
      }
      const vars = [...new Set(eqs.flatMap((e) => e.vars))].sort();
      return { ok: true, kind: 'alternatives', eqs, vars, hasPm: /\\(pm|mp)(?![a-zA-Z])/.test(line) };
    } catch (e) {
      if (e instanceof MathError) return { ok: false, error: e.message };
      throw e;
    }
  }

  /** 行の解の集合（各式の解の和集合） */
  function lineSolutionSet(p) {
    if (!p.ok) return { type: 'unknown', reason: p.error };
    if (p.vars.length > 1) return { type: 'unknown', reason: '文字が2種類以上あります' };
    let values = [];
    for (const e of p.eqs) {
      const s = quadraticSolutionSet(e);
      if (s.type === 'unknown') return s;
      if (s.type === 'all') return { type: 'all' };
      values = values.concat(s.values);
    }
    return { type: 'set', values: uniqueValues(values), variable: p.vars[0] || null };
  }

  function sameSolutionSet(s1, s2) {
    if (s1.type !== s2.type) return false;
    if (s1.type !== 'set') return true;
    if (s1.values.length && s2.values.length && s1.variable !== s2.variable) return false;
    return s1.values.length === s2.values.length && s1.values.every((x) => s2.values.some((y) => y.equals(x)));
  }

  function describeSet(s) {
    if (s.type === 'all') return 'すべての数';
    if (s.type !== 'set') return '判定不能';
    if (!s.values.length) return '実数の解なし';
    return `${s.variable}=${s.values.map((x) => x.toString()).join(', ')}`;
  }

  /** 2次方程式の最終行が「x=数（, x=数）」の形か（± をふくむ x=\frac{-3\pm\sqrt{13}}{2} も可） */
  function isQuadraticSolvedForm(p) {
    if (!p.ok || !p.eqs.length) return false;
    return p.eqs.every((e) => e.lhs.k === 'var' && collectVars(e.rhs).size === 0);
  }

  // ---------------------------------------------------------------- 連立方程式
  /** 連立方程式の単元の1行を解析する。行の中の式はすべて同時に成り立つ（cases・array の各行、「,」で並んだ式） */
  function parseSystemLine(line) {
    try {
      const segs = splitSegments(line);
      if (!segs.length) throw new MathError('式がありません');
      const eqs = segs.flatMap((seg) => {
        if (/\\(pm|mp)(?![a-zA-Z])/.test(seg)) throw new MathError('連立方程式で ± は使えません');
        const parts = splitTopLevelEquals(seg);
        // A=B=C の形は、A=C と B=C の2つの式として扱う（中2の教科書の形）
        if (parts.length !== 2 && parts.length !== 3) throw new MathError('連立方程式の各式には「=」が1つ（A=B=C の形なら2つ）必要です');
        const sides = parts.map(parseExpression);
        const make = (lhs, rhs) => ({ lhs, rhs, vars: [...new Set([...collectVars(lhs), ...collectVars(rhs)])].sort() });
        return parts.length === 2 ? [make(sides[0], sides[1])] : [make(sides[0], sides[2]), make(sides[1], sides[2])];
      });
      return { ok: true, kind: 'system', eqs, vars: [...new Set(eqs.flatMap((e) => e.vars))].sort() };
    } catch (e) {
      if (e instanceof MathError) return { ok: false, error: e.message };
      throw e;
    }
  }

  /** 点 env で、行のすべての式が成り立つか（評価できなければ null） */
  function systemHoldsAt(p, env) {
    if (!p.eqs) return null; // 読めない行は判定できない（手動確認）
    try {
      return p.eqs.every((e) => Surd.from(evaluate(e.lhs, env).sub(evaluate(e.rhs, env))).isZero());
    } catch (e) {
      if (e instanceof MathError) return null;
      throw e;
    }
  }

  /**
   * 1行目（問題の連立方程式）のただ1つの解を求める。2文字の1次方程式2本（以上）で、解が1組に決まる場合だけ。
   * 戻り値：{type:'unique', env:{x:Rational, y:Rational}} | {type:'unknown', reason}
   */
  function systemSolution(p) {
    if (!p.ok) return { type: 'unknown', reason: p.error };
    if (p.vars.length !== 2) return { type: 'unknown', reason: '文字が2種類の連立方程式ではありません' };
    const [u, w] = p.vars;
    try {
      // 各式を a u + b w = c の形にする（1次式であることを、別の点でも確かめる）
      const rows = p.eqs.map((e) => {
        const f = (x, y) => evaluate(e.lhs, { [u]: x, [w]: y }).sub(evaluate(e.rhs, { [u]: x, [w]: y }));
        const R = (n, d = 1) => Rational.of(n, d);
        const c0 = f(R(0), R(0));
        const a = f(R(1), R(0)).sub(c0);
        const b = f(R(0), R(1)).sub(c0);
        [[R(3), R(-2)], [R(-5, 3), R(7, 2)], [R(11), R(13)]].forEach(([x, y]) => {
          if (!Surd.from(f(x, y).sub(a.mul(x).add(b.mul(y)).add(c0))).isZero()) throw new MathError('1次方程式ではありません');
        });
        return { a, b, c: c0.neg() };
      });
      if (rows.some((r) => r.a instanceof Surd || r.b instanceof Surd || r.c instanceof Surd)) return { type: 'unknown', reason: '係数に根号があります' };
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const det = rows[i].a.mul(rows[j].b).sub(rows[j].a.mul(rows[i].b));
          if (det.isZero()) continue;
          const x = rows[i].c.mul(rows[j].b).sub(rows[j].c.mul(rows[i].b)).div(det);
          const y = rows[i].a.mul(rows[j].c).sub(rows[j].a.mul(rows[i].c)).div(det);
          const env = { [u]: x, [w]: y };
          if (systemHoldsAt(p, env) !== true) return { type: 'unknown', reason: '式がたがいに矛盾しています（解がありません）' };
          return { type: 'unique', env };
        }
      }
      return { type: 'unknown', reason: '解が1組に決まりません' };
    } catch (e) {
      if (e instanceof MathError) return { type: 'unknown', reason: e.message };
      throw e;
    }
  }

  /** 連立方程式の最終行が「x=数, y=数」の形か。値を返す（形が違えば null） */
  function systemSolvedValues(p, vars) {
    if (!p.ok) return null;
    const env = {};
    for (const e of p.eqs) {
      if (e.lhs.k !== 'var' || collectVars(e.rhs).size) return null;
      try { env[e.lhs.v] = evaluate(e.rhs, {}); } catch (err) { if (err instanceof MathError) return null; throw err; }
    }
    return vars.every((v) => v in env) && Object.keys(env).length === vars.length ? env : null;
  }

  const describeEnv = (env) => Object.entries(env).map(([k, v]) => `${k}=${v.toString()}`).join(', ');

  /**
   * 連立方程式の答案を検証する。
   * 加減法で文字を消した式や代入した式は、元の連立方程式と同値ではないので、「直前の行との同値」では判定しない。
   *  - 正しい行：その行のすべての式が、元の連立方程式の解で成り立つ
   *    （2文字の1次方程式で解が1組のとき、元の2式から導ける1次の式は、その解で成り立つ式と一致する）
   *  - 最初の誤り行：元の解で成り立たない最初の行
   *  - 誤りのあとの行：生徒の最終行の答え（誤った答え）で成り立つか（成り立たなければ、別の独立した誤り）
   */
  function analyzeSystem(lines) {
    const parsed = lines.map(parseSystemLine);
    const sol = systemSolution(parsed[0]);
    const steps = parsed.map((p, i) => ({ index: i, parse: p, vsPrev: null }));
    const result = { steps, parsed, firstDifferent: null, unknown: parsed.some((p) => !p.ok), solution: sol, finalValues: null };
    if (sol.type !== 'unique') {
      steps.slice(1).forEach((s) => { s.vsPrev = 'unknown'; s.detail = { reason: sol.reason }; });
      result.unknown = true;
      return result;
    }
    const vars = Object.keys(sol.env).sort();
    for (let i = 1; i < parsed.length; i++) {
      const ok = systemHoldsAt(parsed[i], sol.env);
      if (ok === null) { steps[i].vsPrev = 'unknown'; steps[i].detail = { reason: '解を代入して確かめられません' }; result.unknown = true; continue; }
      if (!ok) { result.firstDifferent = i; break; }
      steps[i].vsPrev = 'equal';
      steps[i].detail = { system: `正しい解（${describeEnv(sol.env)}）で成り立つ` };
    }
    const last = parsed[parsed.length - 1];
    result.finalValues = systemSolvedValues(last, vars);
    if (result.firstDifferent !== null) {
      const e = result.firstDifferent;
      steps[e].vsPrev = 'different';
      steps[e].detail = { system: `正しい解（${describeEnv(sol.env)}）で成り立たない` };
      const S = result.finalValues;
      for (let i = e; i < parsed.length; i++) {
        if (!S) { if (i > e) { steps[i].vsPrev = 'unknown'; steps[i].detail = { reason: '最終行が「x=数, y=数」の形ではないため、誤りのあとの計算を確かめられません' }; result.unknown = true; } continue; }
        if (i === e) {
          // 誤り行のうち、正しい解で成り立たない式（＝誤った式）だけが、生徒の答えで成り立てばよい
          // （加減法のかたまりの中に、正しく書き写した元の式が並んでいる場合があるため）
          const wrongEqs = parsed[i].eqs.filter((eq) => systemHoldsAt({ eqs: [eq] }, sol.env) === false);
          steps[i].consistentWithFinal = systemHoldsAt({ eqs: wrongEqs }, S) === true;
          continue;
        }
        const ok = systemHoldsAt(parsed[i], S);
        steps[i].vsPrev = ok === null ? 'unknown' : ok ? 'equal' : 'different';
        steps[i].detail = { system: ok ? `生徒の答え（${describeEnv(S)}）で成り立つ` : `生徒の答え（${describeEnv(S)}）でも成り立たない` };
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- 答えの形（等価性とは別に確かめる）
  // 戻り値：{ ok: true } | { ok: false, reason } | { ok: null, reason }（判定できない＝手動確認）

  /** 式の木に、指定した種類のノードがあるか */
  function hasNodeKind(n, kind) { return !!n && (n.k === kind || hasNodeKind(n.a, kind) || hasNodeKind(n.b, kind)); }
  /** 式の木を比べるための文字列（数は文字列にする） */
  function astKey(n) { return JSON.stringify(n, (k, v) => (v instanceof Rational ? v.toString() : typeof v === 'bigint' ? v.toString() : v)); }

  /** 式を + − で区切った項の一覧（符号つき）。最上位の \frac{和}{数} はそのまま1項 */
  function topTerms(node, sign = 1, out = []) {
    if (node.k === 'add') { topTerms(node.a, sign, out); topTerms(node.b, sign, out); }
    else if (node.k === 'sub') { topTerms(node.a, sign, out); topTerms(node.b, -sign, out); }
    else if (node.k === 'neg' && out.length === 0) topTerms(node.a, -sign, out);
    else out.push({ sign, node });
    return out;
  }
  const isNumNode = (n) => n.k === 'num' || (n.k === 'div' && n.frac && n.a.k === 'num' && n.b.k === 'num');
  const hasSum = (n) => n && (n.k === 'add' || n.k === 'sub' || (n.k === 'group' && hasSum(n.a)) || (n.k === 'neg' && hasSum(n.a)));

  /**
   * 単項式（数・文字・累乗の積。分数の形も可）を調べる。
   * 戻り値：{ ok, key（文字と指数。同類項の判定用）, nums（数の因数の数）, reason }
   */
  function monomialInfo(node) {
    const exps = {};
    const nums = { 1: 0, [-1]: 0 }; // 分子・分母それぞれの数の因数の個数（\frac{5a}{18} は分子1・分母1でよい）
    let bad = null;
    let denomVars = false;
    const walk = (n, sgn) => {
      if (bad) return;
      if (isNumNode(n)) { nums[sgn]++; return; }
      switch (n.k) {
        case 'var': exps[n.v] = (exps[n.v] || 0) + sgn; if (Object.prototype.hasOwnProperty.call(walk.seen, n.v)) bad = `文字 ${n.v} が2回以上出てくる（累乗にまとめていない）`; walk.seen[n.v] = true; return;
        case 'pow':
          if (n.a.k === 'var') { exps[n.a.v] = (exps[n.a.v] || 0) + sgn * n.n; if (Object.prototype.hasOwnProperty.call(walk.seen, n.a.v)) bad = `文字 ${n.a.v} が2回以上出てくる`; walk.seen[n.a.v] = true; return; }
          if (isNumNode(n.a)) { bad = '数の累乗が計算されていない'; return; }
          bad = 'かっこの累乗が残っている'; return;
        case 'mul':
          if (!n.implicit) { bad = '× が残っている'; return; }
          walk(n.a, sgn); walk(n.b, sgn); return;
        case 'div':
          if (!n.frac) { bad = '÷ が残っている'; return; }
          walk(n.a, sgn); if (collectVars(n.b).size) denomVars = true; walk(n.b, -sgn); return;
        case 'group': bad = 'かっこが残っている'; return;
        case 'neg': walk(n.a, sgn); return;
        default: bad = `${n.k} をふくむ`;
      }
    };
    walk.seen = {};
    walk(node, 1);
    if (bad) return { ok: false, reason: bad };
    if (nums[1] > 1 || nums[-1] > 1) return { ok: false, reason: '数の部分が計算されていない' };
    const key = Object.keys(exps).filter((v) => exps[v] !== 0).sort().map((v) => `${v}^${exps[v]}`).join('');
    return { ok: true, key, denomVars };
  }

  /** 整理された多項式（同類項をまとめた単項式の和）か。最上位が \frac{多項式}{整数} の形も可 */
  function checkPolynomialForm(ast) {
    let node = ast;
    if (node.k === 'neg') node = node.a;
    if (node.k === 'div' && node.frac && hasSum(node.a) && node.b.k === 'num') {
      const inner = checkPolynomialForm(node.a);
      if (!inner.ok) return inner;
      return { ok: true };
    }
    const terms = topTerms(ast);
    const seen = new Set();
    for (const t of terms) {
      if (hasNodeKind(t.node, 'sqrt')) return { ok: null, reason: '根号をふくむ' };
      const m = monomialInfo(t.node);
      if (!m.ok) return { ok: false, reason: m.reason };
      if (seen.has(m.key)) return { ok: false, reason: '同類項がまとめられていない' };
      seen.add(m.key);
    }
    return { ok: true };
  }

  // ---- 多項式（係数は有理数。分母に文字がない式だけ）
  function polyFromAst(node) {
    const P = {
      add(a, b) { const r = new Map(a); for (const [k, c] of b) r.set(k, (r.get(k) || Rational.of(0)).add(c)); return P.clean(r); },
      neg(a) { return new Map([...a].map(([k, c]) => [k, c.neg()])); },
      mul(a, b) {
        const r = new Map();
        for (const [k1, c1] of a) for (const [k2, c2] of b) {
          const e = {};
          [k1, k2].forEach((k) => k && k.split(',').forEach((part) => { const [v, n] = part.split('^'); e[v] = (e[v] || 0) + Number(n); }));
          const key = Object.keys(e).sort().map((v) => `${v}^${e[v]}`).join(',');
          r.set(key, (r.get(key) || Rational.of(0)).add(c1.mul(c2)));
        }
        return P.clean(r);
      },
      clean(m) { for (const [k, c] of m) if (c.isZero()) m.delete(k); return m; },
    };
    const go = (n) => {
      switch (n.k) {
        case 'num': return new Map([['', n.v]]);
        case 'var': return new Map([[`${n.v}^1`, Rational.of(1)]]);
        case 'group': return go(n.a);
        case 'neg': return P.neg(go(n.a));
        case 'add': return P.add(go(n.a), go(n.b));
        case 'sub': return P.add(go(n.a), P.neg(go(n.b)));
        case 'mul': return P.mul(go(n.a), go(n.b));
        case 'pow': { let r = new Map([['', Rational.of(1)]]); const b = go(n.a); for (let i = 0; i < n.n; i++) r = P.mul(r, b); return r; }
        case 'div': {
          if (collectVars(n.b).size) throw new MathError('分母に文字がある');
          const d = evaluate(n.b, {});
          if (d instanceof Surd) throw new MathError('根号をふくむ');
          return new Map([...go(n.a)].map(([k, c]) => [k, c.div(d)]));
        }
        default: throw new MathError(`${n.k} をふくむ`);
      }
    };
    return go(node);
  }
  const bigAbs = (x) => (x < 0n ? -x : x);
  function isPerfectSquareRational(q) {
    if (q.isNegative()) return false;
    const sq = (n) => { if (n < 2n) return true; let x = BigInt(Math.floor(Math.sqrt(Number(n)))); while (x * x > n) x--; while ((x + 1n) * (x + 1n) <= n) x++; return x * x === n; };
    return sq(q.num) && sq(q.den);
  }

  /** 因数分解が最後までできているか（よく出る形だけ判定し、判定できない形は ok:null） */
  function checkFactoredForm(ast) {
    let node = ast;
    if (node.k === 'neg') node = node.a;
    // かけ算の因数に分ける
    const factors = [];
    const collect = (n) => {
      if (n.k === 'mul') { if (!n.implicit) { factors.push({ bad: '× が残っている' }); return; } collect(n.a); collect(n.b); return; }
      factors.push(n);
    };
    collect(node);
    if (factors.some((f) => f.bad)) return { ok: false, reason: '× が残っている' };
    const sumFactors = [];
    for (const f of factors) {
      const base = f.k === 'pow' ? f.a : f;
      if (base.k === 'group' && hasSum(base.a)) sumFactors.push({ node: base.a, raw: base });
      else if (hasSum(base)) return { ok: false, reason: '因数分解されていない（和の形のまま）' };
    }
    if (!sumFactors.length) return { ok: null, reason: 'かっこの因数がない（単項式など）' };
    // 同じ因数を2回書いている（累乗にまとめていない）
    const keys = sumFactors.map((f) => astKey(f.node));
    if (new Set(keys).size !== keys.length) return { ok: false, reason: '同じ因数を累乗にまとめていない' };
    let unknownReason = null;
    for (const f of sumFactors) {
      let poly;
      try { poly = polyFromAst(f.node); } catch (e) { if (e instanceof MathError) return { ok: null, reason: e.message }; throw e; }
      const entries = [...poly];
      // 係数が整数なら、共通の数の因数が残っていないか
      if (entries.every(([, c]) => c.den === 1n)) {
        let g = 0n;
        entries.forEach(([, c]) => { g = gcd(g, c.num); });
        if (bigAbs(g) > 1n) return { ok: false, reason: `かっこの中に共通な因数 ${bigAbs(g)} が残っている` };
      }
      // すべての項に共通な文字が残っていないか
      const varsIn = (k) => (k ? k.split(',').map((p) => p.split('^')[0]) : []);
      const common = entries.reduce((acc, [k]) => acc.filter((v) => varsIn(k).includes(v)), varsIn(entries[0][0]));
      if (common.length) return { ok: false, reason: `かっこの中に共通な文字 ${common.join('')} が残っている` };
      // 次数を調べる
      const degOf = (k) => (k ? k.split(',').reduce((s, p) => s + Number(p.split('^')[1]), 0) : 0);
      const deg = Math.max(...entries.map(([k]) => degOf(k)));
      if (deg <= 1) continue;
      if (deg === 2) {
        const vs = [...new Set(entries.flatMap(([k]) => varsIn(k)))].sort();
        const coef = (k) => (poly.get(k) || Rational.of(0));
        let A; let B; let Cc;
        if (vs.length === 1) {
          const v = vs[0];
          A = coef(`${v}^2`); B = coef(`${v}^1`); Cc = coef('');
        } else if (vs.length === 2 && entries.every(([k]) => degOf(k) === 2)) {
          const [u, w] = vs;
          A = coef(`${u}^2`); B = coef(`${u}^1,${w}^1`); Cc = coef(`${w}^2`);
        } else { unknownReason = '2次の因数の形が複雑'; continue; }
        if (A.isZero() || Cc.isZero()) { unknownReason = '2次の因数の形が複雑'; continue; }
        const disc = B.mul(B).sub(Rational.of(4).mul(A).mul(Cc));
        if (isPerfectSquareRational(disc)) return { ok: false, reason: 'まだ因数分解できる2次式が残っている' };
        continue;
      }
      unknownReason = '3次以上の因数がある';
    }
    return unknownReason ? { ok: null, reason: unknownReason } : { ok: true };
  }

  /** 根号をふくむ数の答えが、いちばん簡単な形か（根号の中は平方因子なし・分母に根号なし・同類の根号はまとめる・約分） */
  function checkRadicalForm(ast) {
    if (collectVars(ast).size) return { ok: null, reason: '文字をふくむ' };
    const radicand = (n) => {
      if (n.k !== 'num' || n.v.den !== 1n) return { bad: '根号の中が整数ではない' };
      const [o, i] = splitSquare(n.v.num);
      if (o > 1n) return { bad: `√${n.v.num} の中に平方数 ${o * o} の因数が残っている` };
      if (i === 1n) return { bad: '根号の中が平方数' };
      return { r: i };
    };
    // 項：整数・分数・（整数）√n・\frac{整数√n}{整数}
    const termInfo = (n) => {
      let node = n;
      let den = 1n;
      if (node.k === 'div' && node.frac) {
        if (hasNodeKind(node.b, 'sqrt')) return { bad: '分母に根号が残っている（有理化していない）' };
        if (node.b.k !== 'num' || node.b.v.den !== 1n) return { bad: '分母が整数ではない' };
        den = node.b.v.num;
        node = node.a;
      }
      let coef = 1n;
      let rad = 1n;
      const parts = [];
      const flat = (m) => { if (m.k === 'mul' && m.implicit) { flat(m.a); flat(m.b); } else parts.push(m); };
      flat(node);
      for (const p of parts) {
        if (p.k === 'num') { if (p.v.den !== 1n) return { bad: '小数が残っている' }; coef *= p.v.num; continue; }
        if (p.k === 'sqrt') { const r = radicand(p.a); if (r.bad) return r; if (rad !== 1n) return { bad: '根号どうしのかけ算が残っている' }; rad = r.r; continue; }
        return { bad: 'かけ算・かっこが残っている' };
      }
      return { coef, rad, den };
    };
    let node = ast;
    const terms = [];
    // 最上位が \frac{a+b√c}{d} の形
    if (node.k === 'div' && node.frac && hasSum(node.a)) {
      if (hasNodeKind(node.b, 'sqrt')) return { ok: false, reason: '分母に根号が残っている（有理化していない）' };
      if (node.b.k !== 'num' || node.b.v.den !== 1n) return { ok: null, reason: '分母が整数ではない' };
      const d = node.b.v.num;
      let g = d;
      for (const t of topTerms(node.a)) {
        const info = termInfo(t.node);
        if (info.bad) return { ok: false, reason: info.bad };
        if (info.den !== 1n) return { ok: false, reason: '分数の中に分数がある' };
        g = gcd(g, info.coef);
        terms.push(info);
      }
      if (bigAbs(g) > 1n) return { ok: false, reason: '約分できる' };
      if (d === 1n) return { ok: false, reason: '分母が1' };
    } else {
      for (const t of topTerms(node)) {
        const info = termInfo(t.node);
        if (info.bad) return { ok: false, reason: info.bad };
        if (info.den !== 1n && gcd(info.coef, info.den) > 1n) return { ok: false, reason: '約分できる' };
        terms.push(info);
      }
    }
    const rads = terms.map((t) => t.rad.toString());
    if (new Set(rads).size !== rads.length) return { ok: false, reason: '同じ根号（または数の項）がまとめられていない' };
    return { ok: true };
  }

  /**
   * 答えの形を確かめる。
   *  kind: 'polynomial'（整理された多項式）| 'expanded'（展開した形）| 'factored'（因数分解した形）| 'radical'（根号の簡単な形）
   */
  function checkForm(latex, kind) {
    let src = latex.trim();
    if (src.startsWith('=')) src = src.slice(1);
    let ast;
    try { ast = parseExpression(src); } catch (e) { if (e instanceof MathError) return { ok: null, reason: e.message }; throw e; }
    try {
      if (kind === 'factored') return checkFactoredForm(ast);
      if (kind === 'radical') return checkRadicalForm(ast);
      return checkPolynomialForm(ast);
    } catch (e) {
      if (e instanceof MathError) return { ok: null, reason: e.message };
      throw e;
    }
  }

  /** 2次方程式の答え（x=…）の値が簡単な形か（根号の簡単化・約分） */
  function checkQuadraticAnswerForm(line) {
    const segs = splitSegments(line);
    for (const seg of segs) {
      const parts = splitTopLevelEquals(seg);
      const rhs = (parts.length === 2 ? parts[1] : parts[0]);
      // ± はそのまま（a\pm b√c の形として）調べるため、+ に置きかえて形だけ確かめる
      const r = checkForm(rhs.replace(/\\(pm|mp)(?![a-zA-Z])/g, '+'), 'radical');
      if (r.ok === false) return r;
      if (r.ok === null && /文字/.test(r.reason || '')) return r;
    }
    return { ok: true };
  }

  // 単元ごとの検証モード。null は「自動検証の仕組みが未対応」（手動確認扱い）。
  function modeForUnit(unit) {
    if (unit === 'equation') return 'equation';
    if (unit === 'quadratic-equations') return 'quadratic';
    if (unit === 'simultaneous-equations') return 'system';
    if (['positive-negative', 'expressions', 'polynomials', 'expansion-factorization', 'square-roots'].includes(unit)) return 'expression';
    return null;
  }

  /** 単元・指示文から、最終行に求める「答えの形」を決める（中1の単元は従来どおり確かめない） */
  function formKindFor(unit, instruction) {
    if (unit === 'polynomials') return 'polynomial';
    if (unit === 'expansion-factorization') return /因数分解/.test(instruction || '') ? 'factored' : 'expanded';
    if (unit === 'square-roots') return 'radical';
    return null;
  }

  return {
    Rational,
    MathError,
    tokenize,
    parseExpression,
    parseLine,
    evaluate,
    collectVars,
    compareLines,
    compareExpressions,
    compareEquations,
    solutionSet,
    describeSolution,
    isSolvedForm,
    parseSubstitution,
    analyzeLines,
    modeForUnit,
    // 第6段階
    Surd,
    splitSegments,
    expandPlusMinus,
    parseQuadraticLine,
    quadraticSolutionSet,
    lineSolutionSet,
    sameSolutionSet,
    describeSet,
    isQuadraticSolvedForm,
    parseSystemLine,
    systemSolution,
    systemSolvedValues,
    analyzeSystem,
    checkForm,
    checkQuadraticAnswerForm,
    formKindFor,
    polyFromAst,
  };
});
