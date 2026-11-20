/*
 * game.js
 * トレーニングモードのゲーム進行（出題順・選択状態・採点・正解数）。
 * 画面（DOM）には一切ふれない純粋なロジックなので、Node.js から自動テストできる。
 * 第3段階以降のタイムアタック・認定試験でも、このモジュールを土台に使う想定。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Game = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIFFICULTIES = [1, 2, 3, 4];
  const COUNT_OPTIONS = [5, 10, 'all'];
  const DEFAULT_COUNT = 5;

  class GameDataError extends Error {}

  // ------------------------------------------------------------ 乱数
  /** 再現可能な乱数（テスト・不具合調査用）。seed を省略すると Math.random を使う。 */
  function createRng(seed) {
    if (seed === undefined || seed === null || seed === '') return Math.random;
    let s = (Number(seed) >>> 0) || 1;
    return function () {
      // mulberry32
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Fisher–Yates シャッフル（元の配列は変更しない） */
  function shuffle(list, rng = Math.random) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ------------------------------------------------------------ データの最低限の確認
  /**
   * 出題・採点に必要な項目がそろっているかを確認する（数学的な検証は事前に済んでいる前提）。
   * 戻り値はエラーメッセージの配列。空なら出題してよい。
   */
  function validateForPlay(q) {
    const errs = [];
    if (!q || typeof q !== 'object') return ['問題データがオブジェクトではありません'];
    if (typeof q.id !== 'string' || !q.id) errs.push('id がありません');
    if (typeof q.question !== 'string' || !q.question) errs.push('question がありません');
    if (!Array.isArray(q.answerLines) || q.answerLines.length < 2 || !q.answerLines.every((l) => typeof l === 'string')) {
      errs.push('answerLines が不正です');
    }
    if (!Array.isArray(q.correctSolution) || q.correctSolution.length < 1) errs.push('correctSolution が不正です');
    if (typeof q.explanation !== 'string') errs.push('explanation がありません');
    if (!DIFFICULTIES.includes(q.difficulty)) errs.push('difficulty が不正です');
    if (q.errorLine !== null) {
      const n = Array.isArray(q.answerLines) ? q.answerLines.length : 0;
      if (!Number.isInteger(q.errorLine) || q.errorLine < 1 || q.errorLine >= n) errs.push(`errorLine=${q.errorLine} が答案の範囲外です`);
    }
    return errs;
  }

  // ------------------------------------------------------------ 出題対象
  /** 単元・難易度で絞り込む（出題できない問題は除く） */
  function filterPool(questions, { unit, difficulties }) {
    const diffs = new Set(difficulties && difficulties.length ? difficulties : DIFFICULTIES);
    return questions.filter((q) => q && q.unit === unit && diffs.has(q.difficulty) && validateForPlay(q).length === 0);
  }

  /** 単元内で、難易度ごとに出題できる問題数 */
  function countByDifficulty(questions, unit) {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    questions.forEach((q) => {
      if (q && q.unit === unit && DIFFICULTIES.includes(q.difficulty) && validateForPlay(q).length === 0) counts[q.difficulty]++;
    });
    return counts;
  }

  /** 実際に出題する問題数（対象が足りなければ対象の数。重複で埋めない） */
  function resolveCount(count, available) {
    if (count === 'all') return available;
    const n = Number(count);
    if (!Number.isInteger(n) || n <= 0) throw new RangeError(`問題数の指定が不正です: ${count}`);
    return Math.min(n, available);
  }

  // ------------------------------------------------------------ 採点
  /**
   * 採点。choice は {type:'line', index} または {type:'allCorrect'}。
   * 登録済みの正解データ（errorLine）との比較だけで判定する。
   */
  function grade(question, choice) {
    const errs = validateForPlay(question);
    if (errs.length) throw new GameDataError(`問題 ${question && question.id} のデータに不整合があります：${errs.join(' / ')}`);
    if (!choice || (choice.type !== 'line' && choice.type !== 'allCorrect')) throw new TypeError('選択がありません');
    const expected = question.errorLine === null ? { type: 'allCorrect' } : { type: 'line', index: question.errorLine };
    const correct = choice.type === 'allCorrect'
      ? question.errorLine === null
      : question.errorLine !== null && choice.index === question.errorLine;
    return { correct, choice: { ...choice }, expected };
  }

  // ------------------------------------------------------------ 1回分のトレーニング
  class TrainingSession {
    /**
     * @param {object[]} questions 全問題
     * @param {{unit:string, difficulties:number[], count:5|10|'all'}} config
     * @param {() => number} rng
     */
    constructor(questions, config, rng = Math.random) {
      this.config = {
        unit: config.unit,
        difficulties: (config.difficulties && config.difficulties.length ? config.difficulties : DIFFICULTIES).slice().sort(),
        count: config.count === undefined ? DEFAULT_COUNT : config.count,
      };
      const pool = filterPool(questions, this.config);
      if (pool.length === 0) throw new RangeError('条件に合う問題がありません');
      const n = resolveCount(this.config.count, pool.length);
      // 対象の問題をシャッフルして先頭から n 問。1回のプレイで同じ問題は出ない。
      this.questions = shuffle(pool, rng).slice(0, n);
      this.questionIds = this.questions.map((q) => q.id);
      this.available = pool.length;
      this.index = 0;
      this.correctCount = 0;
      this.results = []; // 各問題の採点結果
      this.resetQuestionState();
    }

    resetQuestionState() {
      this.selection = null;   // {type:'line', index} | {type:'allCorrect'} | null
      this.graded = null;      // 採点結果（確定後）
      this.hintOpen = false;
    }

    get total() { return this.questions.length; }
    get current() { return this.questions[this.index] || null; }
    get number() { return this.index + 1; }            // 1 始まりの問題番号
    get isLast() { return this.index === this.total - 1; }
    get finished() { return this.index >= this.total; }
    get isGraded() { return this.graded !== null; }

    /** 選択できる行か（1行目＝問題の再掲は選べない） */
    isSelectableLine(i) {
      const q = this.current;
      return !!q && Number.isInteger(i) && i >= 1 && i < q.answerLines.length;
    }

    /** 答案の行を選ぶ（「全部正しい！」の選択は解除される）。同じ行をもう一度選ぶと解除。 */
    selectLine(i) {
      if (this.isGraded) return false;
      if (!this.isSelectableLine(i)) return false;
      if (this.selection && this.selection.type === 'line' && this.selection.index === i) this.selection = null;
      else this.selection = { type: 'line', index: i };
      return true;
    }

    /** 「全部正しい！」を選ぶ（行の選択は解除される）。もう一度選ぶと解除。 */
    selectAllCorrect() {
      if (this.isGraded) return false;
      this.selection = this.selection && this.selection.type === 'allCorrect' ? null : { type: 'allCorrect' };
      return true;
    }

    clearSelection() {
      if (!this.isGraded) this.selection = null;
    }

    get canSubmit() {
      return !this.finished && !this.isGraded && this.selection !== null;
    }

    /** 添削（採点）する。1問につき1回だけ。2回目以降は最初の結果を返し、正解数は増えない。 */
    submit() {
      if (this.isGraded) return this.graded;
      if (!this.canSubmit) throw new Error('答案の行か「全部正しい！」を選んでから添削してください');
      const result = grade(this.current, this.selection);
      result.questionId = this.current.id;
      this.graded = result;
      this.results.push(result);
      if (result.correct) this.correctCount++;
      return result;
    }

    toggleHint() {
      this.hintOpen = !this.hintOpen;
      return this.hintOpen;
    }

    /** 次の問題へ（採点前には進めない） */
    next() {
      if (!this.isGraded) throw new Error('添削してから次の問題へ進んでください');
      this.index++;
      this.resetQuestionState();
      return !this.finished;
    }

    summary() {
      const answered = this.results.length;
      const correct = this.correctCount;
      return {
        total: this.total,
        answered,
        correct,
        wrong: answered - correct,
        rate: answered ? Math.round((correct / answered) * 100) : 0,
      };
    }
  }

  /** 正解率に応じた短い評価コメント */
  function evaluationComment(rate) {
    if (rate === 100) return 'パーフェクト！ 計算ミスを見抜く目は、もう先生レベル！';
    if (rate >= 80) return 'いい調子！ 計算ミスを見抜く力がついてきたね！';
    if (rate >= 60) return 'なかなかの添削力！ 解説を読み返すと、もっと伸びるよ。';
    if (rate >= 40) return 'あと一歩！ 符号やかっこの処理に注目してみよう。';
    return 'まずはヒントを使いながら、1行ずつ確かめてみよう！';
  }

  return {
    DIFFICULTIES, COUNT_OPTIONS, DEFAULT_COUNT,
    GameDataError, TrainingSession,
    createRng, shuffle, validateForPlay, filterPool, countByDifficulty, resolveCount, grade, evaluationComment,
  };
});
