/*
 * time-attack.js
 * 60秒タイムアタックの進行ロジック（出題・即時判定・得点・連続正解・制限時間）。
 * DOM・Web Audio・localStorage には一切ふれない。時計は外から渡せる（テストでは偽の時計を使う）。
 *
 * 時間は「開始した時刻からの経過時間」で判定する（タイマーの呼び出し回数では数えない）。
 * そのため、ブラウザがバックグラウンドになっても、実際の経過時間どおりに残り時間が減る。
 *
 * 依存：game.js（filterPool・shuffle・grade・validateForPlay）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./game.js'));
  } else {
    root.TimeAttack = factory(root.Game);
  }
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  // ------------------------------------------------------------ 設定（暫定値。問題を増やしたあとに調整できるよう定数にまとめる）
  const CONFIG = {
    durationMs: 60 * 1000,   // 制限時間
    countdownFrom: 3,        // 開始前のカウントダウン（3・2・1・START!）
    feedbackMs: 300,         // 正誤の演出を見せる時間（この間は入力を受け付けない）
    warningAtMs: 10 * 1000,  // 残り10秒で警告
    urgentAtMs: 5 * 1000,    // 残り5秒から強調表示
  };

  // 得点：正解したときの連続正解数（その問題を含む）に応じて加算する。不正解は0点で、連続正解数を0に戻す
  const SCORE_RULES = [
    { minStreak: 5, points: 150 },
    { minStreak: 3, points: 120 },
    { minStreak: 1, points: 100 },
  ];

  // 公式タイムアタックの称号（単元ごとの最高スコアで決まる）
  const TITLES = [
    { minScore: 2000, name: '神の赤ペン' },
    { minScore: 1500, name: 'スーパー添削先生' },
    { minScore: 1000, name: 'スピードティーチャー' },
    { minScore: 500, name: 'ミス発見名人' },
    { minScore: 0, name: '見習い添削係' },
  ];

  const MODES = { OFFICIAL: 'official', CUSTOM: 'custom' };

  function pointsForStreak(streak) {
    if (streak <= 0) return 0;
    const rule = SCORE_RULES.find((r) => streak >= r.minStreak);
    return rule ? rule.points : 0;
  }

  function titleForScore(score) {
    const t = TITLES.find((x) => score >= x.minScore);
    return t ? t.name : TITLES[TITLES.length - 1].name;
  }

  /**
   * 出題条件を決める。公式は「単元のすべてのカテゴリ・すべての難易度」に固定する。
   * カスタムで偶然すべてを選んでも、公式にはならない（mode で明確に区別する）。
   */
  function criteriaFor(mode, { unit, categories, difficulties }) {
    if (mode === MODES.OFFICIAL) return { unit, categories: null, difficulties: G.DIFFICULTIES.slice() };
    return {
      unit,
      categories: categories && categories.length ? categories.slice().sort() : null,
      difficulties: (difficulties && difficulties.length ? difficulties : G.DIFFICULTIES).slice().sort(),
    };
  }

  class TimeAttackSession {
    /**
     * @param {object[]} questions 全問題
     * @param {{mode:'official'|'custom', unit:string, categories?:string[], difficulties?:number[]}} config
     * @param {{rng?: () => number, now?: () => number, durationMs?: number}} opts
     */
    constructor(questions, config, opts = {}) {
      if (config.mode !== MODES.OFFICIAL && config.mode !== MODES.CUSTOM) throw new TypeError(`モードの指定が不正です: ${config.mode}`);
      this.mode = config.mode;
      this.criteria = criteriaFor(config.mode, config);
      this.pool = G.filterPool(questions, this.criteria);
      if (this.pool.length === 0) throw new RangeError('条件に合う問題がありません');
      this.rng = opts.rng || Math.random;
      this.now = opts.now || (() => Date.now());
      this.durationMs = opts.durationMs || CONFIG.durationMs;
      this.deck = [];
      this.lastId = null;
      this.round = 0;               // 何巡目か（全問題を出し終えたら次の巡へ）
      this.startedAt = null;        // START! の時刻（カウントダウン中は null＝時間は減らない）
      this.endedAt = null;
      this.ended = false;
      this.score = 0;
      this.streak = 0;
      this.maxStreak = 0;
      this.results = [];            // 回答した問題の記録 { question, choice, correct, points, streak, at }
      this.locked = false;          // 正誤の演出中（次の問題を出すまで）は回答を受け付けない
      this.current = null;
    }

    get isOfficial() { return this.mode === MODES.OFFICIAL; }
    get started() { return this.startedAt !== null; }

    /** START! のときに呼ぶ。ここから制限時間を数える */
    start() {
      if (this.started) return;
      this.startedAt = this.now();
      this.current = this.drawNext();
    }

    elapsed(at = this.now()) {
      if (!this.started) return 0;
      return Math.max(0, Math.min(this.durationMs, (this.ended ? this.endedAt : at) - this.startedAt));
    }

    remaining(at = this.now()) {
      return this.durationMs - this.elapsed(at);
    }

    /** 制限時間を過ぎたか（時刻 at において） */
    isTimeUp(at = this.now()) {
      return this.started && at - this.startedAt >= this.durationMs;
    }

    /** 全問題を出し終えたら並べ直して続ける。可能なら直前と同じ問題が続かないようにする */
    drawNext() {
      if (this.deck.length === 0) {
        this.deck = G.shuffle(this.pool, this.rng);
        this.round++;
        if (this.pool.length > 1 && this.deck[0].id === this.lastId) {
          // 新しい巡の最初が直前の問題と同じなら、2番目と入れかえる
          [this.deck[0], this.deck[1]] = [this.deck[1], this.deck[0]];
        }
      }
      const q = this.deck.shift();
      this.lastId = q.id;
      return q;
    }

    /**
     * 回答する（タップした時点で即時判定）。
     * 受け付けないとき（カウントダウン中・演出中・時間切れ後・終了後）は null を返す。
     * 回答した時刻が制限時間内なら有効、制限時間を過ぎていれば無効。
     */
    answer(choice, at = this.now()) {
      if (!this.started || this.ended || this.locked || !this.current) return null;
      if (at - this.startedAt > this.durationMs) { this.finish(); return null; }
      const q = this.current;
      if (choice && choice.type === 'line' && !(Number.isInteger(choice.index) && choice.index >= 1 && choice.index < q.answerLines.length)) return null;
      const r = G.grade(q, choice);
      let points = 0;
      if (r.correct) {
        this.streak++;
        points = pointsForStreak(this.streak);
        this.score += points;
        this.maxStreak = Math.max(this.maxStreak, this.streak);
      } else {
        this.streak = 0;
      }
      const result = { question: q, choice: r.choice, expected: r.expected, correct: r.correct, points, streak: this.streak, at: at - this.startedAt };
      this.results.push(result);
      this.locked = true;
      return result;
    }

    /** 演出のあとに呼ぶ。次の問題へ進む（時間切れなら終了して false） */
    advance(at = this.now()) {
      if (this.ended) return false;
      this.locked = false;
      if (this.isTimeUp(at)) { this.finish(); return false; }
      this.current = this.drawNext();
      return true;
    }

    /** 時間切れ・終了。以後の回答は受け付けない */
    finish() {
      if (this.ended) return;
      this.ended = true;
      this.locked = true;
      this.endedAt = this.started ? Math.min(this.now(), this.startedAt + this.durationMs) : this.now();
    }

    summary() {
      const answered = this.results.length;
      const correct = this.results.filter((r) => r.correct).length;
      return {
        mode: this.mode,
        criteria: this.criteria,
        score: this.score,
        answered,
        correct,
        wrong: answered - correct,
        rate: answered ? Math.round((correct / answered) * 100) : 0,
        maxStreak: this.maxStreak,
      };
    }
  }

  return { CONFIG, SCORE_RULES, TITLES, MODES, pointsForStreak, titleForScore, criteriaFor, TimeAttackSession };
});
