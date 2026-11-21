/*
 * records.js
 * 記録の保存と読み込み（公式タイムアタック・カスタムタイムアタック・ティーチャー認定）。
 * localStorage は外から渡す（テストでは偽の保存場所を使う）。DOM には一切ふれない。
 *
 * 保存キー：calcTeacher.records（効果音の設定 calcTeacher.sound とは別）
 * 保存形式：{ version: 1, timeAttack: { official: {単元: {...}}, custom: [...] }, certification: {単元: {...}} }
 *
 * 安全対策：
 *  - 保存データがない → 空の記録で始める
 *  - JSON が壊れている → 元の文字列を calcTeacher.records.backup に退避してから、空の記録で始める（消さない）
 *  - 新しい版のアプリが保存したデータ（version が大きい）→ 上書きしないよう読み取り専用にする
 *  - localStorage が使えない・容量がいっぱい → 保存に失敗しても例外を出さず、ゲームは続ける
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Records = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'calcTeacher.records';
  const BACKUP_KEY = 'calcTeacher.records.backup';
  const VERSION = 1;
  const CUSTOM_HISTORY_LIMIT = 20;

  function emptyData() {
    return { version: VERSION, timeAttack: { official: {}, custom: [] }, certification: {} };
  }

  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const str = (v) => (typeof v === 'string' ? v : null);

  /** 読み込んだデータを、想定した形にそろえる（足りない項目は補い、おかしな値は捨てる） */
  function normalize(raw) {
    const data = emptyData();
    if (!raw || typeof raw !== 'object') return data;
    const ta = raw.timeAttack || {};
    Object.entries(ta.official || {}).forEach(([unit, r]) => {
      if (!r || typeof r !== 'object') return;
      data.timeAttack.official[unit] = {
        bestScore: r.bestScore === null || r.bestScore === undefined ? null : num(r.bestScore),
        bestDate: str(r.bestDate),
        maxStreak: num(r.maxStreak),
        plays: num(r.plays),
        title: str(r.title),
      };
    });
    if (Array.isArray(ta.custom)) {
      data.timeAttack.custom = ta.custom.filter((e) => e && typeof e === 'object' && typeof e.unit === 'string')
        .slice(0, CUSTOM_HISTORY_LIMIT)
        .map((e) => ({
          playedAt: str(e.playedAt),
          unit: e.unit,
          categories: Array.isArray(e.categories) ? e.categories.filter((c) => typeof c === 'string') : null,
          difficulties: Array.isArray(e.difficulties) ? e.difficulties.map(Number).filter((d) => d >= 1 && d <= 4) : [1, 2, 3, 4],
          score: num(e.score), correct: num(e.correct), wrong: num(e.wrong), maxStreak: num(e.maxStreak),
        }));
    }
    Object.entries(raw.certification || {}).forEach(([unit, c]) => {
      if (!c || typeof c !== 'object') return;
      const exams = {};
      Object.entries(c.exams || {}).forEach(([id, e]) => {
        if (!e || typeof e !== 'object') return;
        exams[id] = { cleared: !!e.cleared, attempts: num(e.attempts), firstClearedAt: str(e.firstClearedAt) };
      });
      data.certification[unit] = { highestCleared: Math.max(0, Math.min(5, num(c.highestCleared))), exams };
    });
    return data;
  }

  /**
   * 記録の保存場所を作る。
   * @param {{storage?: Storage|null, now?: () => Date}} opts
   */
  function createRecordStore(opts = {}) {
    const storage = opts.storage === undefined ? null : opts.storage;
    const now = opts.now || (() => new Date());
    const status = { available: !!storage, readOnly: false, recovered: false, lastError: null };
    let data = load();

    function load() {
      if (!storage) return emptyData();
      let raw;
      try {
        raw = storage.getItem(STORAGE_KEY);
      } catch (e) {
        status.available = false;
        status.lastError = 'unavailable';
        return emptyData();
      }
      if (raw === null || raw === undefined) return emptyData();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        // 壊れている：元の文字列を退避してから、空の記録で始める（元のデータは消さない）
        try { if (storage.getItem(BACKUP_KEY) === null) storage.setItem(BACKUP_KEY, raw); } catch (e2) { /* 退避できなくても続ける */ }
        status.recovered = true;
        status.lastError = 'corrupt';
        return emptyData();
      }
      const v = parsed && Number(parsed.version);
      if (v > VERSION) {
        // 新しい版のアプリが保存したデータ：形式がわからないので上書きしない
        status.readOnly = true;
        status.lastError = 'newer-version';
        return normalize(parsed);
      }
      // 古い版（version がない・小さい）：今は変換が必要な違いがないので、そろえて読み込む
      return normalize(parsed);
    }

    function save() {
      if (!storage || status.readOnly) return false;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(data));
        status.lastError = null;
        return true;
      } catch (e) {
        status.lastError = e && (e.name === 'QuotaExceededError' || e.code === 22) ? 'quota' : 'save-failed';
        return false; // 保存に失敗してもゲームは続ける
      }
    }

    const isoNow = () => now().toISOString();

    // ------------------------------------------------------------ 公式タイムアタック
    function officialFor(unit) {
      return data.timeAttack.official[unit] || { bestScore: null, bestDate: null, maxStreak: 0, plays: 0, title: null };
    }

    /**
     * 公式タイムアタックを最後までプレイした結果を記録する（途中でやめた回は呼ばない）。
     * @param {string} unit
     * @param {{score:number, maxStreak:number}} summary
     * @param {(score:number) => string} titleFor 最高スコア → 称号
     */
    function recordOfficial(unit, summary, titleFor) {
      const prev = officialFor(unit);
      const isBest = prev.bestScore === null || summary.score > prev.bestScore;
      const bestScore = isBest ? summary.score : prev.bestScore;
      const next = {
        bestScore,
        bestDate: isBest ? isoNow() : prev.bestDate,
        maxStreak: Math.max(prev.maxStreak || 0, summary.maxStreak || 0),
        plays: (prev.plays || 0) + 1,
        title: titleFor ? titleFor(bestScore) : prev.title,
      };
      data.timeAttack.official[unit] = next;
      const saved = save();
      return { isBest, firstPlay: prev.bestScore === null, prevBest: prev.bestScore, prevTitle: prev.title, record: { ...next }, saved };
    }

    // ------------------------------------------------------------ カスタムタイムアタック
    function addCustom(entry) {
      const e = {
        playedAt: isoNow(),
        unit: entry.unit,
        categories: entry.categories ? entry.categories.slice() : null,
        difficulties: entry.difficulties ? entry.difficulties.slice() : [1, 2, 3, 4],
        score: entry.score, correct: entry.correct, wrong: entry.wrong, maxStreak: entry.maxStreak,
      };
      data.timeAttack.custom.unshift(e); // 新しいものを先頭に
      data.timeAttack.custom = data.timeAttack.custom.slice(0, CUSTOM_HISTORY_LIMIT); // 21件目以降（古いもの）は消す
      const saved = save();
      return { entry: { ...e }, saved };
    }

    function customHistory() {
      return data.timeAttack.custom.map((e) => ({ ...e }));
    }

    // ------------------------------------------------------------ 認定試験
    function certFor(unit) {
      const c = data.certification[unit];
      return c ? { highestCleared: c.highestCleared, exams: { ...c.exams } } : { highestCleared: 0, exams: {} };
    }

    /**
     * 合否が決まった試験を記録する（途中でやめた試験は呼ばない）。
     * 不合格でも、クリア済みの記録・ランクは下がらない。
     */
    function recordExam(unit, examId, passed) {
      const prev = certFor(unit);
      const id = String(examId);
      const e = prev.exams[id] || { cleared: false, attempts: 0, firstClearedAt: null };
      const firstClear = !!passed && !e.cleared;
      const nextExam = { cleared: e.cleared || !!passed, attempts: e.attempts + 1, firstClearedAt: e.firstClearedAt || (passed ? isoNow() : null) };
      const exams = { ...prev.exams, [id]: nextExam };
      const highestCleared = Math.max(prev.highestCleared, passed ? Number(examId) : 0);
      data.certification[unit] = { highestCleared, exams };
      const saved = save();
      return { firstClear, prevHighest: prev.highestCleared, highestCleared, rankUp: highestCleared > prev.highestCleared, saved };
    }

    return {
      status,
      officialFor, recordOfficial,
      addCustom, customHistory,
      certFor, recordExam,
      /** 自動テスト・不具合調査用 */
      snapshot: () => JSON.parse(JSON.stringify(data)),
      reload: () => { data = load(); },
    };
  }

  return { STORAGE_KEY, BACKUP_KEY, VERSION, CUSTOM_HISTORY_LIMIT, createRecordStore, normalize, emptyData };
});
