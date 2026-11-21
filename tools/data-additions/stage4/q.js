/*
 * 第4段階の問題原稿を短く書くための補助関数。
 * - answerLines・correctSolution の1行目（問題の再掲）は question から自動で入れる。
 * - correctSolution は、答案と同じ前半を書かずにすむよう [k, ...残り] の形でも書ける
 *   （答案の index 0〜k-1 をそのまま使い、そのあとに残りの行を続ける）。
 * - 全部正しい答案（e: null）で sol を省略すると、correctSolution は答案と同じになる。
 * 出力する項目と順番は、既存の data/*.json と同じ。
 */
'use strict';

const UNIT_BY_CODE = {
  'J1-PN': 'positive-negative', 'J1-EX': 'expressions', 'J1-EQ': 'equation',
  'J2-PO': 'polynomials', 'J2-SE': 'simultaneous-equations',
  'J3-EF': 'expansion-factorization', 'J3-SR': 'square-roots', 'J3-QE': 'quadratic-equations',
};

function make({ id, cat, d, instr, sub, q, a, e, type, exp, sol, hint }) {
  const code = id.split('-').slice(0, 2).join('-');
  if (!UNIT_BY_CODE[code]) throw new Error(`${id}: 単元の記号が不明です`);
  const answerLines = [q, ...a];
  let correctSolution;
  if (sol === undefined || sol === null) {
    if (e !== null) throw new Error(`${id}: 誤答なのに sol（正しい計算過程）がありません`);
    correctSolution = answerLines.slice();
  } else if (typeof sol[0] === 'number') {
    correctSolution = [...answerLines.slice(0, sol[0]), ...sol.slice(1)];
  } else {
    correctSolution = [q, ...sol];
  }
  const out = { id, grade: Number(id[1]), unit: UNIT_BY_CODE[code], category: cat, difficulty: d };
  if (instr) out.instruction = instr;
  if (sub) out.substitution = sub;
  Object.assign(out, {
    question: q,
    answerLines,
    errorLine: e,
    errorType: e === null ? null : type,
    explanation: exp,
    correctSolution,
    hint,
  });
  return out;
}

module.exports = { make, r: String.raw };
