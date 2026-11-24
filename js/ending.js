/*
 * ending.js
 * エンディング演出（公式タイムアタック・ティーチャー認定試験）の条件・記録・曲の再生。
 *
 * - 公式タイムアタック：すべての単元で最高の称号（time-attack.js の TITLES の先頭「神の赤ペン」）を獲得したとき
 * - 認定試験：すべての単元で最終試験に合格（certification.js の RANKS の最後「マスターティーチャー」）したとき
 * 条件を満たした結果画面で一度だけ自動で流す。一度見たら、単元選択画面の 👑 から何度でも見返せる。
 *
 * 画面（DOM）は app.js が担当する。ここでは条件の判定・表示する内容・「見たか」の保存・曲の再生だけを扱う。
 * 曲：BGMer「21世紀の幕開け」（assets/ending/ending.mp3。tools/build-story-assets.js で変換）。
 *     音量・ON/OFF は「ストーリーBGM」の設定にしたがう（OFF のときは音なしで演出だけ流す）。
 *
 * 保存キー：calcTeacher.ending（ゲームの記録 calcTeacher.records とは別。引継ぎコードには入れない）
 * 保存形式：{ version: 1, seen: { official?: { at, entries }, cert?: { at, entries } } }
 *   entries は初めて見たときの記録（記録を引き継いで条件を満たさなくなっても、見返せるように残す）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./time-attack.js'), require('./certification.js'));
  } else {
    root.Ending = factory(root.TimeAttack, root.Certification);
  }
})(typeof self !== 'undefined' ? self : this, function (TA, C) {
  'use strict';

  const STORAGE_KEY = 'calcTeacher.ending';
  const VERSION = 1;
  const KINDS = { OFFICIAL: 'official', CERT: 'cert' };
  const MUSIC_URL = 'assets/ending/ending.mp3';

  // 演出の時間割（ミリ秒）。曲（約21.8秒）に合わせる
  const TIMELINE = {
    introMs: 2000,    // はじめの「全単元制覇！」
    perUnitMs: 2000,  // 単元ごとの記録・称号（2秒ずつ）
    creditsMs: 4000,  // 最後の「製作　T.TAKEMOTO / KEC Glows」（このあと「とじる」を出す）
    musicFadeMs: 800, // スキップしたときの曲のフェードアウト
  };
  const CREDIT = '製作　T.TAKEMOTO / KEC Glows';

  /** 演出全体の長さ（単元の数で変わる） */
  function totalMs(unitCount) {
    return TIMELINE.introMs + TIMELINE.perUnitMs * unitCount + TIMELINE.creditsMs;
  }

  // ------------------------------------------------------------ 条件
  const topTitle = () => TA.TITLES[0];                    // 神の赤ペン
  const topRank = () => C.RANKS[C.RANKS.length - 1];      // マスターティーチャー
  const finalExam = () => C.EXAMS[C.EXAMS.length - 1];    // 最終試験

  /** その単元で最高の称号・ランクを獲得しているか */
  function isUnitTop(kind, records, unit) {
    if (kind === KINDS.OFFICIAL) {
      const best = records.officialFor(unit).bestScore;
      return best !== null && best !== undefined && TA.titleInfoForScore(best).rank === topTitle().rank;
    }
    return records.certFor(unit).highestCleared >= finalExam().id;
  }

  /** すべての単元で最高の称号・ランクを獲得しているか（単元が1つもなければ false） */
  function isComplete(kind, units, records) {
    return units.length > 0 && units.every((u) => isUnitTop(kind, records, u.unit));
  }

  /** あと unit だけで条件を満たす（ほかの単元はすべて獲得済み・unit はまだ）か。曲を前もって読み込むかの判断に使う */
  function wouldComplete(kind, units, records, unit) {
    return units.some((u) => u.unit === unit) && !isUnitTop(kind, records, unit) &&
      units.every((u) => u.unit === unit || isUnitTop(kind, records, u.unit));
  }

  function formatDate(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  /**
   * 単元ごとに表示する内容（単元の順番どおり）。
   * @returns {{unit:string, label:string, icon:string, title:string, main:string, sub:string}[]}
   */
  function entriesFor(kind, units, records) {
    return units.map((u) => {
      const label = `中${u.grade}・${u.label}`;
      if (kind === KINDS.OFFICIAL) {
        const r = records.officialFor(u.unit);
        const t = TA.titleInfoForScore(r.bestScore || 0);
        return { unit: u.unit, label, icon: t.icon, title: t.name, main: `自己ベスト ${Number(r.bestScore || 0).toLocaleString('ja-JP')}点`, sub: `最大連続 ${r.maxStreak || 0}問` };
      }
      const c = records.certFor(u.unit);
      const rank = C.rankFor(c.highestCleared);
      const fin = c.exams[String(finalExam().id)] || {};
      const date = formatDate(fin.firstClearedAt);
      const attempts = Object.values(c.exams).reduce((n, e) => n + (Number(e.attempts) || 0), 0);
      return { unit: u.unit, label, icon: rank.icon, title: rank.name, main: date ? `${finalExam().name} 合格 ${date}` : `${finalExam().name} 合格`, sub: `挑戦 合計${attempts}回` };
    });
  }

  /** はじめに表示する文 */
  function introFor(kind, unitCount) {
    if (kind === KINDS.OFFICIAL) {
      const t = topTitle();
      return { kicker: '🏅 公式タイムアタック', heading: `全${unitCount}単元 制覇！`, text: `${unitCount}つの単元すべてで\n「${t.icon} ${t.name}」を\n獲得しました！` };
    }
    const r = topRank();
    return { kicker: '🎓 ティーチャー認定試験', heading: `全${unitCount}単元 制覇！`, text: `${unitCount}つの単元すべてで\n「${r.icon} ${r.name}」に\n認定されました！` };
  }

  // ------------------------------------------------------------ 「見たか」の保存
  function normalize(raw) {
    const data = { version: VERSION, seen: {} };
    const seen = raw && typeof raw === 'object' && raw.seen && typeof raw.seen === 'object' ? raw.seen : {};
    Object.values(KINDS).forEach((k) => {
      const s = seen[k];
      if (!s || typeof s !== 'object') return;
      const entries = Array.isArray(s.entries) ? s.entries.filter((e) => e && typeof e === 'object' && typeof e.label === 'string')
        .map((e) => ({ unit: String(e.unit || ''), label: e.label, icon: String(e.icon || ''), title: String(e.title || ''), main: String(e.main || ''), sub: String(e.sub || '') })) : [];
      data.seen[k] = { at: typeof s.at === 'string' ? s.at : null, entries };
    });
    return data;
  }

  /**
   * @param {{storage?: Storage|null, now?: () => Date}} opts
   */
  function createEndingStore(opts = {}) {
    const storage = opts.storage || null;
    const now = opts.now || (() => new Date());
    let data = load();

    function load() {
      try {
        const raw = storage && storage.getItem(STORAGE_KEY);
        return normalize(raw ? JSON.parse(raw) : null);
      } catch (e) {
        return normalize(null); // 壊れていても、ゲームは続ける（見ていない扱い）
      }
    }
    function save() {
      try { if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
    }

    return {
      hasSeen: (kind) => !!data.seen[kind],
      /** 初めて見たときの記録（なければ null） */
      savedEntries: (kind) => (data.seen[kind] ? data.seen[kind].entries.map((e) => ({ ...e })) : null),
      /** 見たことを記録する。2回目以降は、最初に見た日時を残し、記録だけ新しくする */
      markSeen(kind, entries) {
        const prev = data.seen[kind];
        data.seen[kind] = { at: (prev && prev.at) || now().toISOString(), entries: entries.map((e) => ({ ...e })) };
        return save();
      },
      /** 記録をリセットしたとき：見た記録も消す（もう一度すべて獲得すると、また自動で流れる） */
      clear() { data = normalize(null); try { if (storage) storage.removeItem(STORAGE_KEY); } catch (e) { /* 無視 */ } },
      snapshot: () => JSON.parse(JSON.stringify(data)),
      reload: () => { data = load(); },
    };
  }

  // ------------------------------------------------------------ 曲の再生
  /**
   * エンディングの曲を鳴らす。
   * - iPad などの自動再生の制限：prime() をボタンを押したときなどの操作の中で呼んで、AudioContext を作り・再開しておく。
   *   すると、そのあと（タイムアタックの時間切れのあとなど、操作のない場面）でも鳴らせる。
   * - 曲は prime() のときに読み込み始める（起動時には読み込まない）。
   * - 読み込めない・再生できないときも、例外を外に出さない（演出は音なしで進む）。
   * @param {{AudioContextClass?: Function, fetch?: Function, url?: string, getVolume?: () => number}} opts
   *   getVolume：0〜1。0 のときは鳴らさない
   */
  function createMusicPlayer(opts = {}) {
    const AC = opts.AudioContextClass || null;
    const doFetch = opts.fetch || null;
    const url = opts.url || MUSIC_URL;
    const getVolume = opts.getVolume || (() => 1);
    let ctx = null;
    let buffer = null;
    let loading = null;
    let current = null; // { src, gain }
    let lastError = null;

    function ensureContext() {
      if (!AC) return null;
      try {
        if (!ctx) ctx = new AC();
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
          const p = ctx.resume();
          if (p && typeof p.catch === 'function') p.catch(() => { /* 許可されなければ鳴らないだけ */ });
        }
        return ctx;
      } catch (e) {
        lastError = 'context';
        return null;
      }
    }

    function decode(arr) {
      return new Promise((resolve, reject) => {
        try {
          const p = ctx.decodeAudioData(arr, resolve, reject); // 古い Safari はコールバックだけ
          if (p && typeof p.then === 'function') p.then(resolve, reject);
        } catch (e) { reject(e); }
      });
    }

    function load() {
      if (buffer) return Promise.resolve(true);
      if (loading) return loading;
      if (!ctx || !doFetch) return Promise.resolve(false);
      loading = Promise.resolve()
        .then(() => doFetch(url))
        .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.arrayBuffer(); })
        .then(decode)
        .then((b) => { buffer = b; return true; })
        .catch((e) => { lastError = String(e && e.message || e); loading = null; return false; });
      return loading;
    }

    /** 操作の中で呼ぶ：AudioContext を作って再開し、曲の読み込みを始める */
    function prime() {
      ensureContext();
      return load();
    }

    /**
     * 曲の頭から鳴らす。読み込みを最大 waitMs まで待つ（間に合わなければ音なしで false）。
     * @returns {Promise<boolean>} 鳴らせたか
     */
    function play(waitMs = 1500) {
      stop(0);
      const vol = Math.max(0, Math.min(1, Number(getVolume()) || 0));
      if (!ensureContext()) return Promise.resolve(false);
      const ready = load();
      const timeout = new Promise((r) => setTimeout(() => r(false), waitMs));
      return Promise.race([ready, timeout]).then((ok) => {
        if (!ok || !buffer || vol <= 0) return false;
        try {
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          const gain = ctx.createGain();
          gain.gain.value = vol;
          src.connect(gain);
          gain.connect(ctx.destination);
          src.start(0);
          current = { src, gain };
          src.onended = () => { if (current && current.src === src) current = null; };
          return true;
        } catch (e) {
          lastError = 'play';
          return false;
        }
      });
    }

    /** 止める（fadeMs のあいだに小さくしてから止める） */
    function stop(fadeMs = TIMELINE.musicFadeMs) {
      const c = current;
      current = null;
      if (!c || !ctx) return;
      try {
        const t = ctx.currentTime;
        const sec = Math.max(0, fadeMs) / 1000;
        if (sec > 0 && typeof c.gain.gain.linearRampToValueAtTime === 'function') {
          c.gain.gain.cancelScheduledValues(t);
          c.gain.gain.setValueAtTime(c.gain.gain.value, t);
          c.gain.gain.linearRampToValueAtTime(0, t + sec);
          c.src.stop(t + sec + 0.05);
        } else {
          c.src.stop();
        }
      } catch (e) { /* もう止まっている */ }
    }

    return {
      prime, play, stop,
      get debug() { return { loaded: !!buffer, playing: !!current, contextState: ctx ? ctx.state : 'none', lastError }; },
    };
  }

  return {
    STORAGE_KEY, VERSION, KINDS, MUSIC_URL, TIMELINE, CREDIT,
    totalMs, isUnitTop, isComplete, wouldComplete, entriesFor, introFor, normalize, createEndingStore, createMusicPlayer,
  };
});
