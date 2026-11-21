/*
 * question-schema.js
 * 問題データの共通定義（Node.js / ブラウザ 共用）。
 * 単元・カテゴリ・ID 接頭辞などを1か所で管理し、検証スクリプトと画面の両方から参照する。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QuestionSchema = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;

  // 単元の定義。categories はその単元で使ってよいカテゴリ名。
  const UNITS = {
    'positive-negative': {
      grade: 1, label: '正負の数', idCode: 'PN',
      categories: ['加法・減法', '乗法・除法', '累乗', '四則混合'],
    },
    expressions: {
      grade: 1, label: '文字式', idCode: 'EX',
      categories: ['文字式の表し方', '式の値', '同類項の計算', '分配法則など'],
    },
    equation: {
      grade: 1, label: '方程式', idCode: 'EQ',
      categories: ['移項', 'かっこを含む方程式', '小数を含む方程式', '分数を含む方程式'],
    },
    // ---- 中2・中3（第6段階で追加）
    polynomials: {
      grade: 2, label: '式の計算', idCode: 'PO',
      categories: ['多項式の加法・減法', '単項式の乗法・除法', '多項式と単項式の計算', '式の計算の総合'],
    },
    'simultaneous-equations': {
      grade: 2, label: '連立方程式', idCode: 'SE',
      categories: ['加減法（基本）', '加減法（応用）', '代入法', '連立方程式の総合'],
    },
    'expansion-factorization': {
      grade: 3, label: '展開・因数分解', idCode: 'EF',
      categories: ['分配法則・多項式の積', '乗法公式', '共通因数・基本の因数分解', '因数分解の総合'],
    },
    'square-roots': {
      grade: 3, label: '平方根', idCode: 'SR',
      categories: ['根号の基本計算', '根号の簡単化・有理化', '根号を含む加法・減法', '平方根の式の計算'],
    },
    'quadratic-equations': {
      grade: 3, label: '2次方程式', idCode: 'QE',
      categories: ['因数分解による解法', '平方根を利用する解法', '解の公式', '2次方程式の総合'],
    },
  };

  // instruction が省略されたときに表示する指示文
  function defaultInstruction(unit) {
    if (unit === 'equation' || unit === 'quadratic-equations') return '次の方程式を解きなさい。';
    if (unit === 'simultaneous-equations') return '次の連立方程式を解きなさい。';
    return '次の計算をしなさい。';
  }

  const DIFFICULTY = { min: 1, max: 4 };

  // 答案の行数（1行目＝問題の再掲を含む）。原則 3〜5 行、簡単な問題は 2 行も可。
  const LINE_COUNT = { min: 2, max: 6, recommendedMax: 5 };
  // 単元ごとの例外：連立方程式は「問題・加減の計算・x・代入・y・答え」で行が多くなるため、7行まで
  const LINE_COUNT_BY_UNIT = {
    'simultaneous-equations': { min: 2, max: 7, recommendedMax: 7 },
    'quadratic-equations': { min: 2, max: 6, recommendedMax: 6 },
  };
  const lineCountFor = (unit) => LINE_COUNT_BY_UNIT[unit] || LINE_COUNT;

  const REQUIRED_FIELDS = {
    id: 'string',
    grade: 'number',
    unit: 'string',
    category: 'string',
    difficulty: 'number',
    question: 'string',
    answerLines: 'array',
    errorLine: 'number|null',
    errorType: 'string|null',
    explanation: 'string',
    correctSolution: 'array',
    hint: 'string',
  };

  // 任意項目
  //  instruction  : 問題の指示文（例「a=-3 のとき、次の式の値を求めなさい。」）。$...$ で数式を書ける。
  //  substitution : 式の値の問題で代入する値（{"a": "-3"}）。LaTeX の数で書く。自動検証に使う。
  //  verification : {"mode": "manual", "reason": "..."} 自動検証を行わず手動確認とする場合に指定。
  const OPTIONAL_FIELDS = {
    variants: 'array',            // 第7段階：正しい答案の問題に追加する誤答パターン（question-variants.js）
    correctExplanation: 'string', // 第7段階：誤答の問題を正答版で出すときの「計算のポイント」（省略時は errorType から作る）
    instruction: 'string',
    substitution: 'object',
    verification: 'object',
  };

  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (Number.isInteger(v)) return 'number';
    return typeof v;
  }

  // キー順をそろえた JSON（レビュー記録のハッシュ計算に使う）
  function canonicalJson(value) {
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  // 説明文・ヒント中の $...$ を数式として分割する
  function splitInlineMath(text) {
    const parts = [];
    const re = /\$([^$]+)\$/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
      parts.push({ type: 'math', value: m[1] });
      last = re.lastIndex;
    }
    if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
    return parts;
  }

  return {
    SCHEMA_VERSION, UNITS, DIFFICULTY, LINE_COUNT, LINE_COUNT_BY_UNIT, lineCountFor, REQUIRED_FIELDS, OPTIONAL_FIELDS,
    typeOf, canonicalJson, splitInlineMath, defaultInstruction,
  };
});
