/*
 * time-attack.js
 * 90秒タイムアタックの進行ロジック（出題・即時判定・得点・連続正解・制限時間）。
 * DOM・Web Audio・localStorage には一切ふれない。時計は外から渡せる（テストでは偽の時計を使う）。
 *
 * 時間は「開始した時刻からの経過時間」で判定する（タイマーの呼び出し回数では数えない）。
 * そのため、ブラウザがバックグラウンドになっても、実際の経過時間どおりに残り時間が減る。
 *
 * 依存：game.js（filterPool・shuffle・grade・validateForPlay）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./game.js'), require('./question-variants.js'));
  } else {
    root.TimeAttack = factory(root.Game, root.QuestionVariants);
  }
})(typeof self !== 'undefined' ? self : this, function (G, QV) {
  'use strict';

  // ------------------------------------------------------------ 設定（暫定値。問題を増やしたあとに調整できるよう定数にまとめる）
  const CONFIG = {
    durationMs: 90 * 1000,   // 制限時間
    lossTimeMs: 5 * 1000,    // ロスタイム：残り0秒の時点で表示中の問題だけ、さらにこの時間まで回答できる
    countdownFrom: 3,        // 開始前のカウントダウン（3・2・1・START!）
    feedbackMs: 600,         // 正誤の演出を見せる時間（この間は入力を受け付けない）
    warningAtMs: 10 * 1000,  // 残り10秒で警告
    urgentAtMs: 5 * 1000,    // 残り5秒から強調表示
    maxMisses: 3,            // この回数まちがえたらゲームオーバー（その時点で強制終了）
  };

  // 得点：正解1問ごとに「単元ごとの基礎点 + 連続正解ボーナス」。
  //   連続正解ボーナス：連続 n 問目の正解で step × (n − 1) 点（0, 10, 20, … 。上限 maxBonus 点＝6問目以降は50点）
  //   例：方程式（基礎点250）は 1問目 250点、2問目 260点 … 6問目以降 300点。連立方程式（基礎点400）は 400点〜450点。
  //   不正解は missPenalty 点（100点）の減点で、連続正解数を0に戻す（次の正解のボーナスは0から）。
  //   スコアは0点より下にはしない（0点のときの不正解は0点のまま。減点した点数を結果に残す）。
  //   基礎点表にない単元（新しく追加した単元）は defaultBase 点。
  const SCORE_RULES = {
    step: 10,
    maxBonus: 50,
    missPenalty: 100,
    defaultBase: 200,
    baseByUnit: {
      'positive-negative': 250,       // 正負の数
      expressions: 250,                 // 文字式
      equation: 250,                    // 方程式
      polynomials: 300,                 // 式の計算
      'simultaneous-equations': 400,  // 連立方程式
      'expansion-factorization': 250, // 展開・因数分解
      'square-roots': 200,            // 平方根
      'quadratic-equations': 250,     // 2次方程式
    },
  };

  // 公式タイムアタックの称号（単元ごとの最高スコアで決まる。10段階。高い順に並べる）
  const TITLES = [
    { rank: 10, minScore: 3000, icon: '👑', name: '神の赤ペン' },
    { rank: 9, minScore: 2600, icon: '🌟', name: '伝説のティーチャー' },
    { rank: 8, minScore: 2200, icon: '🎯', name: '赤ペンマスター' },
    { rank: 7, minScore: 1800, icon: '💥', name: 'スーパー添削先生' },
    { rank: 6, minScore: 1500, icon: '🏅', name: 'ベテラン添削先生' },
    { rank: 5, minScore: 1200, icon: '⚡', name: 'スピードティーチャー' },
    { rank: 4, minScore: 900, icon: '📘', name: '一人前ティーチャー' },
    { rank: 3, minScore: 600, icon: '🔍', name: 'ミス発見上手' },
    { rank: 2, minScore: 300, icon: '✏️', name: 'かけだしティーチャー' },
    { rank: 1, minScore: 0, icon: '🔰', name: '見習い添削係' },
  ];

  // 公式タイムアタックの難易度の出題順（1問目から順に）。この並びのあとは「★★★ → ★★★★」をくり返す
  const OFFICIAL_DIFFICULTY_ORDER = [1, 2, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4];
  const OFFICIAL_DIFFICULTY_REPEAT = [3, 4];

  const MODES = { OFFICIAL: 'official', CUSTOM: 'custom' };

  /** 単元の基礎点（正解1問あたりの点。連続正解ボーナスは別） */
  function basePointsFor(unit) {
    const b = SCORE_RULES.baseByUnit[unit];
    return Number.isFinite(b) ? b : SCORE_RULES.defaultBase;
  }

  /** 連続 streak 問目の正解のボーナス（0, 10, 20, … 最大 maxBonus） */
  function streakBonus(streak) {
    if (streak <= 0) return 0;
    return Math.min(SCORE_RULES.maxBonus, SCORE_RULES.step * (streak - 1));
  }

  /** 連続 streak 問目の正解で加算される点（単元ごとの基礎点 + 連続正解ボーナス）。unit を省略すると基礎点 defaultBase */
  function pointsForStreak(streak, unit) {
    if (streak <= 0) return 0;
    return basePointsFor(unit) + streakBonus(streak);
  }

  /** 最高スコアに対応する称号の情報 { rank, minScore, icon, name } */
  function titleInfoForScore(score) {
    return TITLES.find((x) => score >= x.minScore) || TITLES[TITLES.length - 1];
  }

  /** 称号の表示名（アイコンつき。例「👑神の赤ペン」）。記録にもこの文字列を保存する */
  function titleForScore(score) {
    const t = titleInfoForScore(score);
    return `${t.icon}${t.name}`;
  }

  /** 公式タイムアタックで n 問目（0始まり）に出す難易度 */
  function officialDifficultyAt(n) {
    if (n < OFFICIAL_DIFFICULTY_ORDER.length) return OFFICIAL_DIFFICULTY_ORDER[n];
    return OFFICIAL_DIFFICULTY_REPEAT[(n - OFFICIAL_DIFFICULTY_ORDER.length) % OFFICIAL_DIFFICULTY_REPEAT.length];
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
     * @param {{rng?: () => number, variantRng?: () => number, now?: () => number, durationMs?: number, lossTimeMs?: number, maxMisses?: number}} opts
     *   variantRng：答案パターン（正答・誤答）の抽選用。出題順の乱数とは別（省略時は Math.random）
     */
    constructor(questions, config, opts = {}) {
      if (config.mode !== MODES.OFFICIAL && config.mode !== MODES.CUSTOM) throw new TypeError(`モードの指定が不正です: ${config.mode}`);
      this.mode = config.mode;
      this.criteria = criteriaFor(config.mode, config);
      this.pool = G.filterPool(questions, this.criteria);
      if (this.pool.length === 0) throw new RangeError('条件に合う問題がありません');
      this.rng = opts.rng || Math.random;
      this.variantRng = opts.variantRng || Math.random;
      this.now = opts.now || (() => Date.now());
      this.durationMs = opts.durationMs || CONFIG.durationMs;
      this.lossTimeMs = opts.lossTimeMs !== undefined ? opts.lossTimeMs : CONFIG.lossTimeMs;
      this.maxMisses = opts.maxMisses || CONFIG.maxMisses;
      this.misses = 0;              // 不正解の数（maxMisses に達したらゲームオーバー）
      this.endReason = null;        // 'timeup'（時間切れ）または 'gameover'（ミスの上限）
      this.deck = [];
      this.lastId = null;
      this.round = 0;               // 何巡目か（全問題を出し終えたら次の巡へ。カスタム）
      this.drawnCount = 0;          // これまでに出した問題の数（公式の難易度の出題順に使う）
      this.decksByDifficulty = {};  // 公式：難易度ごとの山札（その難易度の問題を出し終えたら並べ直す）
      this.startedAt = null;        // START! の時刻（カウントダウン中は null＝時間は減らない）
      this.endedAt = null;
      this.ended = false;
      this.score = 0;
      this.streak = 0;
      this.maxStreak = 0;
      this.results = [];            // 回答した問題の記録 { question, choice, correct, points, streak, at }
      this.locked = false;          // 正誤の演出中（次の問題を出すまで）は回答を受け付けない
      this.current = null;
      this.currentAnswered = false; // 表示中の問題に回答したか
      this.unanswered = null;       // 時間切れのとき、回答できずに終わった問題 { question, expected, at }（結果の集計には入れない）
    }

    get isOfficial() { return this.mode === MODES.OFFICIAL; }
    get started() { return this.startedAt !== null; }
    get isGameOver() { return this.misses >= this.maxMisses; }
    get livesLeft() { return Math.max(0, this.maxMisses - this.misses); }

    /** START! のときに呼ぶ。ここから制限時間を数える */
    start() {
      if (this.started) return;
      this.startedAt = this.now();
      this.current = this.nextPlayable();
      this.currentAnswered = false;
    }

    elapsed(at = this.now()) {
      if (!this.started) return 0;
      return Math.max(0, Math.min(this.durationMs, (this.ended ? this.endedAt : at) - this.startedAt));
    }

    remaining(at = this.now()) {
      return this.durationMs - this.elapsed(at);
    }

    /** 制限時間（ロスタイムをふくまない）を過ぎたか（時刻 at において） */
    isTimeUp(at = this.now()) {
      return this.started && at - this.startedAt >= this.durationMs;
    }

    /** ロスタイム中か：制限時間は過ぎたが、そのとき表示していた問題にまだ回答できる */
    inLossTime(at = this.now()) {
      return this.isTimeUp(at) && !this.ended && !this.locked && at - this.startedAt < this.durationMs + this.lossTimeMs;
    }

    /** ロスタイムも過ぎたか（表示中の問題に回答しないまま終わる時刻） */
    isLossTimeOver(at = this.now()) {
      return this.started && at - this.startedAt >= this.durationMs + this.lossTimeMs;
    }

    /** 次の問題を選び、答案パターン（正答・誤答）を抽選して出題する答案にする（同じ問題がまた出たときも抽選し直す） */
    nextPlayable() {
      return QV.resolve(this.drawNext(), this.variantRng);
    }

    /**
     * 次の問題を選ぶ。
     * - 公式：難易度を決められた順（officialDifficultyAt）で出す。難易度ごとに問題をシャッフルして順に出し、
     *   その難易度を出し終えたら並べ直す（1巡の中では重複しない）。
     * - カスタム：選んだ条件の全問題をシャッフルして順に出し、出し終えたら並べ直す。
     * どちらも、可能なら直前と同じ問題が続かないようにする。
     */
    drawNext() {
      const n = this.drawnCount++;
      if (this.isOfficial) {
        const d = officialDifficultyAt(n);
        const ofD = this.pool.filter((q) => q.difficulty === d);
        if (ofD.length) {
          let deck = this.decksByDifficulty[d];
          if (!deck || deck.length === 0) {
            deck = G.shuffle(ofD, this.rng);
            if (deck.length > 1 && deck[0].id === this.lastId) [deck[0], deck[1]] = [deck[1], deck[0]];
            this.decksByDifficulty[d] = deck;
          }
          const q = deck.shift();
          this.lastId = q.id;
          return q;
        }
        // その難易度の問題がないとき（問題データが足りないとき）は、全問題の山札から出す
      }
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
     * 回答した時刻が制限時間内なら有効。制限時間を過ぎても、ロスタイム（そのとき表示していた問題）の間は有効。
     * ロスタイムも過ぎていれば無効。ロスタイム中に回答したら、演出のあと（advance）で終了する。
     */
    answer(choice, at = this.now()) {
      if (!this.started || this.ended || this.locked || !this.current) return null;
      if (at - this.startedAt > this.durationMs + this.lossTimeMs) { this.finish(); return null; }
      const q = this.current;
      if (choice && choice.type === 'line' && !(Number.isInteger(choice.index) && choice.index >= 1 && choice.index < q.answerLines.length)) return null;
      const r = G.grade(q, choice);
      let points = 0;
      if (r.correct) {
        this.streak++;
        points = pointsForStreak(this.streak, this.criteria.unit);
        this.score += points;
        this.maxStreak = Math.max(this.maxStreak, this.streak);
      } else {
        // 不正解：減点（スコアは0点より下にしない）。points はマイナスの値（減点した点数）
        const penalty = Math.min(SCORE_RULES.missPenalty, this.score);
        points = penalty > 0 ? -penalty : 0;
        this.score -= penalty;
        this.streak = 0;
        this.misses++;
      }
      const result = { question: q, choice: r.choice, expected: r.expected, correct: r.correct, points, streak: this.streak, misses: this.misses, at: at - this.startedAt, lossTime: at - this.startedAt > this.durationMs };
      this.results.push(result);
      this.currentAnswered = true;
      this.locked = true;
      return result;
    }

    /** 演出のあとに呼ぶ。次の問題へ進む（ゲームオーバー・時間切れなら終了して false） */
    advance(at = this.now()) {
      if (this.ended) return false;
      this.locked = false;
      if (this.isGameOver) { this.finish(at); return false; }
      if (this.isTimeUp(at)) { this.finish(at); return false; }
      this.current = this.nextPlayable();
      this.currentAnswered = false;
      return true;
    }

    /** 終了（ゲームオーバー・時間切れ・途中でやめた）。以後の回答は受け付けない */
    finish(at = this.now()) {
      if (this.ended) return;
      this.ended = true;
      this.locked = true;
      this.endReason = this.isGameOver ? 'gameover' : 'timeup';
      // 時間切れ（ロスタイムも過ぎた）で、表示中の問題に回答していなかった：結果画面で確認できるように残す
      if (this.endReason === 'timeup' && this.started && this.current && !this.currentAnswered && this.isTimeUp(at)) {
        const q = this.current;
        this.unanswered = { question: q, expected: q.errorLine === null ? { type: 'allCorrect' } : { type: 'line', index: q.errorLine }, at: at - this.startedAt };
      }
      this.endedAt = this.started ? Math.min(at, this.startedAt + this.durationMs) : at;
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
        misses: this.misses,
        gameOver: this.endReason === 'gameover',
      };
    }
  }

  return {
    CONFIG, SCORE_RULES, TITLES, MODES, OFFICIAL_DIFFICULTY_ORDER, OFFICIAL_DIFFICULTY_REPEAT,
    pointsForStreak, basePointsFor, streakBonus, titleForScore, titleInfoForScore, officialDifficultyAt, criteriaFor, TimeAttackSession,
  };
});
