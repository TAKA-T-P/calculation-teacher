/*
 * 答案パターン（第7段階）：1つの問題IDに、正しい答案と誤った答案を登録し、出題のたびに切り替える。
 *
 * 問題データとの対応（既存の項目はそのまま使う）
 *  - 誤答の問題（errorLine が数）
 *      誤答パターン「wrong-1」＝ answerLines・errorLine・errorType・explanation（これまでどおり）
 *      正答パターン「correct-1」＝ correctSolution をそのまま答案にしたもの（errorLine=null）。
 *        解説は correctExplanation があればそれ、なければ errorType から作った「計算のポイント」
 *  - 正しい答案の問題で、答案が模範解答（correctSolution）と同じもの
 *      正答パターン「correct-1」＝ answerLines（これまでどおり）
 *      誤答パターン ＝ variants に登録したもの（例：「wrong-1」。答案・errorLine・errorType・explanation）
 *  - 正しい答案の問題で、模範解答と違う解き方（別解）のもの
 *      正答パターン「correct-1」だけ（従来どおり、いつも正しい答案として出題）
 *
 * 出題：問題IDを選んだあと、正答パターンと誤答パターンの両方があれば、
 *   CORRECT_VARIANT_RATE（25%）で正答、残り（75%）で誤答を出す。問題ごと・出題ごとに独立に抽選する。
 * 出題した答案（playable）は、問題の項目を答案パターンの内容で上書きしたコピー。採点・解説・結果画面・解き直しは
 *   すべてこのコピーを使うので、表示した答案と採点・解説の対象が必ず一致する。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QuestionVariants = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 正答パターンと誤答パターンの両方がある問題で、正答パターンを出す確率（全単元共通） */
  const CORRECT_VARIANT_RATE = 0.25;
  const TYPES = { INCORRECT: 'incorrect', CORRECT: 'correct' };
  /** 問題の分類 */
  const KINDS = {
    SWITCHABLE: 'switchable',       // 正答・誤答を切り替える
    ALTERNATIVE: 'alternative',     // 別解の正答（いつも正答）
    CORRECT_PENDING: 'correct-pending', // 模範解答と同じ正答だが、誤答パターンがまだない（いつも正答）
  };

  const norm = (line) => String(line).replace(/\s+/g, '').replace(/\\left|\\right/g, '');

  /** 答案が模範解答（correctSolution）と同じ途中式か（空白・\left \right の違いは無視） */
  function sameAsModel(q) {
    return q.answerLines.length === q.correctSolution.length
      && q.answerLines.every((l, i) => norm(l) === norm(q.correctSolution[i]));
  }

  /** 誤答の問題を正答として出すときの「計算のポイント」（データに correctExplanation があればそれを使う） */
  function correctExplanationFor(q) {
    if (typeof q.correctExplanation === 'string' && q.correctExplanation.trim()) return q.correctExplanation;
    return `すべての行が正しい計算です。この問題でよくある間違いは「${q.errorType}」です。どの行も、その間違いをせずに正しく変形できています。`;
  }

  /**
   * 問題の答案パターンの一覧（共通の形にそろえたもの）。
   * { id, type, answerLines, errorLine, errorType, explanation, source }
   *   source：'data'（answerLines など既存の項目）/ 'model'（correctSolution から作った正答）/ 'variants'（variants に登録）
   */
  function variantsOf(q) {
    const list = [];
    if (q.errorLine === null) {
      list.push({ id: 'correct-1', type: TYPES.CORRECT, answerLines: q.answerLines, errorLine: null, errorType: null, explanation: q.explanation, source: 'data' });
      (q.variants || []).forEach((v) => list.push({
        id: v.id,
        type: v.errorLine === null || v.errorLine === undefined ? TYPES.CORRECT : TYPES.INCORRECT,
        answerLines: v.answerLines,
        errorLine: v.errorLine === undefined ? null : v.errorLine,
        errorType: v.errorType === undefined ? null : v.errorType,
        explanation: v.explanation,
        source: 'variants',
      }));
    } else {
      list.push({ id: 'wrong-1', type: TYPES.INCORRECT, answerLines: q.answerLines, errorLine: q.errorLine, errorType: q.errorType, explanation: q.explanation, source: 'data' });
      list.push({ id: 'correct-1', type: TYPES.CORRECT, answerLines: q.correctSolution, errorLine: null, errorType: null, explanation: correctExplanationFor(q), source: 'model' });
    }
    return list;
  }

  /** 問題の分類（切替できるか・別解か・誤答の追加待ちか） */
  function kindOf(q) {
    const vs = variantsOf(q);
    const hasCorrect = vs.some((v) => v.type === TYPES.CORRECT);
    const hasIncorrect = vs.some((v) => v.type === TYPES.INCORRECT);
    if (hasCorrect && hasIncorrect) return KINDS.SWITCHABLE;
    return sameAsModel(q) ? KINDS.CORRECT_PENDING : KINDS.ALTERNATIVE;
  }

  /**
   * 答案パターンを1つ選ぶ。u は [0,1) の乱数1つ。
   * 両方あるとき：u < CORRECT_VARIANT_RATE なら正答、それ以外は誤答（複数あれば u の残りの区間で等分）。
   */
  function pickVariant(q, u, rate = CORRECT_VARIANT_RATE) {
    const vs = variantsOf(q);
    const correct = vs.filter((v) => v.type === TYPES.CORRECT);
    const incorrect = vs.filter((v) => v.type === TYPES.INCORRECT);
    if (!correct.length) return incorrect[Math.min(incorrect.length - 1, Math.floor(u * incorrect.length))];
    if (!incorrect.length) return correct[Math.min(correct.length - 1, Math.floor(u * correct.length))];
    if (u < rate) return correct[Math.min(correct.length - 1, Math.floor((u / rate) * correct.length))];
    return incorrect[Math.min(incorrect.length - 1, Math.floor(((u - rate) / (1 - rate)) * incorrect.length))];
  }

  /** 正答パターンが出る理論上の確率（その問題1問について） */
  function correctProbability(q, rate = CORRECT_VARIANT_RATE) {
    const k = kindOf(q);
    return k === KINDS.SWITCHABLE ? rate : 1;
  }

  /** 問題に答案パターンの内容を当てはめた「出題した答案」（元の問題データは変更しない） */
  function toPlayable(q, variant) {
    const p = { ...q };
    delete p.variants;
    p.answerLines = variant.answerLines.slice();
    p.errorLine = variant.errorLine;
    p.errorType = variant.errorType;
    p.explanation = variant.explanation;
    p.variantId = variant.id;
    p.variantType = variant.type;
    return p;
  }

  /** すでに答案パターンが決まっている（出題した答案）か */
  function isResolved(q) {
    return !!q && typeof q.variantId === 'string';
  }

  /**
   * 出題する答案を決める。すでに決まっている答案（結果画面からの解き直しなど）は、そのまま返す（再抽選しない）。
   * @param {() => number} rng 答案パターン用の乱数（出題順の乱数とは別にする）
   */
  function resolve(q, rng = Math.random) {
    if (isResolved(q)) return q;
    return toPlayable(q, pickVariant(q, rng()));
  }

  /** 答案パターンを ID で指定して出題データにする（開発者用プレビュー・テスト用） */
  function resolveById(q, variantId) {
    const v = variantsOf(q).find((x) => x.id === variantId);
    if (!v) throw new RangeError(`答案パターン ${variantId} がありません（${q.id}）`);
    return toPlayable(q, v);
  }

  /**
   * 出題順の乱数とは別の、答案パターン用の乱数を作る（?seed= のときは再現できる）。
   * seed がなければ Math.random。
   */
  function createVariantRng(seed, createRng) {
    if (seed === undefined || seed === null || seed === '') return Math.random;
    // 出題順の乱数と同じ列にならないよう、seed をずらす
    return createRng(((Number(seed) >>> 0) ^ 0x5bd1e995) >>> 0 || 7);
  }

  return {
    CORRECT_VARIANT_RATE, TYPES, KINDS,
    sameAsModel, correctExplanationFor, variantsOf, kindOf, pickVariant, correctProbability,
    toPlayable, isResolved, resolve, resolveById, createVariantRng,
  };
});
