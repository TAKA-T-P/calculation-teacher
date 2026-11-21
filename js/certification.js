/*
 * certification.js
 * ティーチャー認定試験のルール（試験の定義・出題・合否判定・解放条件・ランク）。
 * DOM・Web Audio・localStorage には一切ふれない（Node.js から自動テストできる）。
 *
 * 依存：game.js（filterPool・shuffle・TrainingSession）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./game.js'));
  } else {
    root.Certification = factory(root.Game);
  }
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  // ------------------------------------------------------------ 設定（暫定値。あとから変えやすいよう、ここにまとめる）
  // distribution：難易度ごとの出題数（合計が maxQuestions）
  const EXAMS = [
    { id: 1, name: '第1試験', maxQuestions: 5, requiredCorrect: 3, distribution: { 1: 5, 2: 0, 3: 0, 4: 0 } },
    { id: 2, name: '第2試験', maxQuestions: 6, requiredCorrect: 4, distribution: { 1: 3, 2: 3, 3: 0, 4: 0 } },
    { id: 3, name: '第3試験', maxQuestions: 7, requiredCorrect: 5, distribution: { 1: 2, 2: 2, 3: 3, 4: 0 } },
    { id: 4, name: '第4試験', maxQuestions: 8, requiredCorrect: 6, distribution: { 1: 1, 2: 2, 3: 3, 4: 2 } },
    { id: 5, name: '最終試験', maxQuestions: 10, requiredCorrect: 10, distribution: { 1: 1, 2: 2, 3: 3, 4: 4 } },
  ];

  // ランク：いちばん上のクリア済み試験（0 = 未認定）で決まる
  const RANKS = [
    { cleared: 0, name: 'ティーチャー見習い', icon: '🔰', color: '#7b8798' },
    { cleared: 1, name: '新人ティーチャー', icon: '✏️', color: '#2f9e6a' },
    { cleared: 2, name: '一人前ティーチャー', icon: '📘', color: '#2f6fdf' },
    { cleared: 3, name: 'ベテランティーチャー', icon: '🏅', color: '#c27c0e' },
    { cleared: 4, name: 'エキスパートティーチャー', icon: '🎖️', color: '#9b3dd1' },
    { cleared: 5, name: 'マスターティーチャー', icon: '👑', color: '#d93a3f' },
  ];

  const OUTCOME = { PASS: 'pass', FAIL: 'fail' };

  function examById(id) {
    const e = EXAMS.find((x) => x.id === Number(id));
    if (!e) throw new RangeError(`試験が見つかりません: ${id}`);
    return e;
  }

  function rankFor(highestCleared) {
    const n = Math.max(0, Math.min(RANKS.length - 1, Number(highestCleared) || 0));
    return RANKS[n];
  }

  /** 試験を受けられるか：最初は第1試験だけ。クリアすると次が解放される（クリア済みはいつでも再挑戦できる） */
  function isUnlocked(highestCleared, examId) {
    return Number(examId) <= (Number(highestCleared) || 0) + 1;
  }

  /**
   * 合否の判定。
   *  合格：正解数 >= 必要正解数
   *  不合格：不正解数 > 最大問題数 - 必要正解数（残りを全部正解しても届かない）
   *  それ以外は null（まだ決まっていない）
   */
  function judge(exam, correctCount, wrongCount) {
    if (correctCount >= exam.requiredCorrect) return OUTCOME.PASS;
    if (wrongCount > exam.maxQuestions - exam.requiredCorrect) return OUTCOME.FAIL;
    return null;
  }

  /** 何問まちがえると不合格になるか（例：第1〜第4試験は3問、最終試験は1問） */
  function failAt(exam) {
    return exam.maxQuestions - exam.requiredCorrect + 1;
  }

  /** 試験に必要な、難易度ごとの問題が足りているか。足りなければ shortages に不足を入れる */
  function checkAvailability(questions, unit, exam) {
    const shortages = [];
    G.DIFFICULTIES.forEach((d) => {
      const need = exam.distribution[d] || 0;
      if (!need) return;
      const have = G.filterPool(questions, { unit, difficulties: [d] }).length;
      if (have < need) shortages.push({ difficulty: d, need, have, missing: need - have });
    });
    return { ok: shortages.length === 0, shortages };
  }

  function shortageMessage(shortages) {
    return shortages.map((s) => `${'★'.repeat(s.difficulty)}の問題が${s.missing}問不足`).join('、') +
      'しているため、現在この試験には挑戦できません。';
  }

  class ShortageError extends RangeError {
    constructor(shortages) {
      super(shortageMessage(shortages));
      this.shortages = shortages;
    }
  }

  /**
   * 試験の問題を選ぶ。
   *  - 難易度ごとの必要数を必ず満たす（足りなければ ShortageError。低い難易度で埋めたり、重複させたりしない）
   *  - 難易度の中では、なるべくカテゴリが偏らないように選ぶ（それまでに選んだ数が少ないカテゴリから順に）
   *  - 選んだ問題は、難易度順に固めず、ランダムな順番に並べる
   */
  function buildExamQuestions(questions, unit, exam, rng = Math.random) {
    const avail = checkAvailability(questions, unit, exam);
    if (!avail.ok) throw new ShortageError(avail.shortages);
    const picked = [];
    const catCount = new Map();
    // 難易度の高いものから選ぶ（問題数の少ない難易度でカテゴリの偏りを先に調整するため）
    [...G.DIFFICULTIES].reverse().forEach((d) => {
      const need = exam.distribution[d] || 0;
      if (!need) return;
      const byCat = new Map();
      G.shuffle(G.filterPool(questions, { unit, difficulties: [d] }), rng).forEach((q) => {
        if (!byCat.has(q.category)) byCat.set(q.category, []);
        byCat.get(q.category).push(q);
      });
      for (let i = 0; i < need; i++) {
        const cats = G.shuffle([...byCat.keys()].filter((c) => byCat.get(c).length), rng);
        cats.sort((a, b) => (catCount.get(a) || 0) - (catCount.get(b) || 0)); // 安定ソート：同数ならシャッフル順
        const cat = cats[0];
        picked.push(byCat.get(cat).shift());
        catCount.set(cat, (catCount.get(cat) || 0) + 1);
      }
    });
    return G.shuffle(picked, rng);
  }

  /**
   * 認定試験の1回分。トレーニングの TrainingSession（行を選ぶ→添削する！・解説）をそのまま使い、
   * 合否が決まったら残りの問題を出題しない・ヒントを使えない、という試験のルールだけを足す。
   */
  class CertificationSession extends G.TrainingSession {
    constructor(questions, { unit, examId }, rng = Math.random, opts = {}) {
      const exam = examById(examId);
      const list = opts.fixedQuestions || buildExamQuestions(questions, unit, exam, rng);
      super(questions, { unit, count: list.length }, rng, { fixedQuestions: list });
      this.exam = exam;
      this.unit = unit;
      this.outcome = null;
    }

    get wrongCount() { return this.results.length - this.correctCount; }
    get decided() { return this.outcome !== null; }

    // 試験ではヒントを使えない
    toggleHint() { this.hintOpen = false; return false; }

    submit() {
      const r = super.submit();
      if (this.outcome === null) this.outcome = judge(this.exam, this.correctCount, this.wrongCount);
      return r;
    }

    /** 合否が決まったら残りは出題しない（false を返して終了） */
    next() {
      if (!this.isGraded) throw new Error('添削してから次の問題へ進んでください');
      if (this.decided) {
        this.index = this.total;
        this.resetQuestionState();
        return false;
      }
      return super.next();
    }

    summary() {
      return {
        ...super.summary(),
        examId: this.exam.id,
        examName: this.exam.name,
        requiredCorrect: this.exam.requiredCorrect,
        maxQuestions: this.exam.maxQuestions,
        outcome: this.outcome,
      };
    }
  }

  return {
    EXAMS, RANKS, OUTCOME,
    examById, rankFor, isUnlocked, judge, failAt,
    checkAvailability, shortageMessage, ShortageError, buildExamQuestions, CertificationSession,
  };
});
