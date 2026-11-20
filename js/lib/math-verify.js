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
    add(o) { return new Rational(this.num * o.den + o.num * this.den, this.den * o.den); }
    sub(o) { return new Rational(this.num * o.den - o.num * this.den, this.den * o.den); }
    mul(o) { return new Rational(this.num * o.num, this.den * o.den); }
    div(o) {
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
    equals(o) { return this.num === o.num && this.den === o.den; }
    toString() { return this.den === 1n ? this.num.toString() : `${this.num}/${this.den}`; }
    toLatex() {
      if (this.den === 1n) return this.num.toString();
      const sign = this.num < 0n ? '-' : '';
      const n = this.num < 0n ? -this.num : this.num;
      return `${sign}\\frac{${n}}{${this.den}}`;
    }
  }

  class MathError extends Error {}

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
    if (k.t === 'cmd' && ['\\frac', '\\dfrac', '\\tfrac', '\\left', '\\{', '\\lbrace', '\\bigl', '\\Bigl'].includes(k.v)) return true;
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

  // 単元ごとの検証モード。null は「自動検証の仕組みが未対応」（手動確認扱い）。
  // 連立方程式・2次方程式・平方根は第2段階以降で対応する。
  function modeForUnit(unit) {
    if (unit === 'equation') return 'equation';
    if (['positive-negative', 'expressions', 'polynomials', 'expansion-factorization'].includes(unit)) return 'expression';
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
  };
});
