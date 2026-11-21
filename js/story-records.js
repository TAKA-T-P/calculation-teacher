/*
 * story-records.js
 * ストーリーモードの記録：累積正解数・既読の話・登場人物の名前。
 * ゲームの記録（records.js の calcTeacher.records）とは別のキーに保存し、互いに影響しない。
 *
 * 保存キー：calcTeacher.story
 * 保存形式：{ version: 1, totalCorrect: 120, readEpisodes: [1, 2], teacherName: "田中", boyName: "ケイ", girlName: "シホ" }
 *  - 解放済みの話は累積正解数から計算する（保存しない）。
 *  - 累積正解数は、ストーリーモードを入れた時点の 0 から数える（過去の記録から推測しない）。
 *
 * 安全対策（records.js と同じ考え方）：
 *  - 保存データがない → 初期状態で始める
 *  - JSON が壊れている → 元の文字列を calcTeacher.story.backup に退避してから、初期状態で始める
 *  - 新しい版のアプリが保存したデータ → 上書きしない（この画面を開いている間だけメモリ上で数える）
 *  - localStorage が使えない・容量がいっぱい → 例外を出さず、ゲームの採点・記録には影響させない
 * DOM にはふれない（Node.js から自動テストできる）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StoryRecords = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'calcTeacher.story';
  const BACKUP_KEY = 'calcTeacher.story.backup';
  const VERSION = 1;
  const NAME_MAX = 10; // 名前の最大文字数（会話の見出しが崩れないように）
  const DEFAULT_NAMES = { teacher: '', kei: 'ケイ', shiho: 'シホ' };
  // 解放に必要な累積正解数（data/story/episodes.json と同じ。テストで一致を確かめる）
  const DEFAULT_THRESHOLDS = [0, 20, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
  const NAME_FIELDS = { teacher: 'teacherName', kei: 'boyName', shiho: 'girlName' };
  // 名前から取り除く文字：制御文字・ゼロ幅文字・方向制御文字など（見えない文字で表示が崩れないように）
  const INVISIBLE_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]];
  const isInvisible = (ch) => {
    const c = ch.codePointAt(0);
    return INVISIBLE_RANGES.some(([a, b]) => c >= a && c <= b);
  };

  function emptyData() {
    return { version: VERSION, totalCorrect: 0, readEpisodes: [], teacherName: '', boyName: DEFAULT_NAMES.kei, girlName: DEFAULT_NAMES.shiho };
  }

  /**
   * 名前の入力をととのえる：前後の空白を除き、制御文字を消し、連続した空白を1つにし、最大文字数で切る。
   * HTML として解釈しないので、< や & もそのまま文字として残す（表示側で必ず文字として表示する）。
   */
  function sanitizeName(value) {
    if (typeof value !== 'string') return '';
    const s = Array.from(value.normalize('NFC')).filter((ch) => !isInvisible(ch) || /[\t\n\r]/.test(ch)).join('')
      .replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, NAME_MAX).join('');
  }

  /** 先生の表示名：名前のうしろに「先生」をつける（末尾がすでに「先生」なら付けない。空欄は「先生」） */
  function teacherDisplayName(name) {
    const n = sanitizeName(name);
    if (!n) return '先生';
    return /先生$/.test(n) ? n : `${n}先生`;
  }

  /**
   * 生徒の表示名：敬称（くん・さん など）は本文の側で付けるので、名前の末尾の敬称は外す（「ケイくんくん」を防ぐ）。
   * 空欄（敬称だけを含む）は初期名。
   */
  function studentDisplayName(name, defaultName) {
    const n = sanitizeName(name).replace(/\s*(くん|クン|君|さん|サン|ちゃん|チャン|様|さま)$/u, '').trim();
    return n || defaultName;
  }

  /** 累積正解数で読める話の数（thresholds は話の順の必要正解数） */
  function unlockedCount(total, thresholds = DEFAULT_THRESHOLDS) {
    const t = Math.max(0, Math.floor(Number(total) || 0));
    return thresholds.filter((need) => t >= need).length;
  }

  function normalize(raw) {
    const data = emptyData();
    if (!raw || typeof raw !== 'object') return data;
    const t = Number(raw.totalCorrect);
    data.totalCorrect = Number.isFinite(t) && t > 0 ? Math.floor(t) : 0;
    if (Array.isArray(raw.readEpisodes)) {
      data.readEpisodes = [...new Set(raw.readEpisodes.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 99))].sort((a, b) => a - b);
    }
    data.teacherName = sanitizeName(raw.teacherName);
    data.boyName = sanitizeName(raw.boyName) || DEFAULT_NAMES.kei;
    data.girlName = sanitizeName(raw.girlName) || DEFAULT_NAMES.shiho;
    if (raw.unlockAll === true) data.unlockAll = true;
    return data;
  }

  /**
   * ストーリーの記録を作る。
   * @param {{storage?: Storage|null, thresholds?: number[]}} opts
   */
  function createStoryStore(opts = {}) {
    const storage = opts.storage === undefined ? null : opts.storage;
    const thresholds = (opts.thresholds || DEFAULT_THRESHOLDS).slice();
    const status = { available: !!storage, readOnly: false, recovered: false, lastError: null };
    const counted = new WeakSet(); // 一度数えた正解（同じ判定を二重に数えない）
    const listeners = new Set();
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
        try { if (storage.getItem(BACKUP_KEY) === null) storage.setItem(BACKUP_KEY, raw); } catch (e2) { /* 退避できなくても続ける */ }
        status.recovered = true;
        status.lastError = 'corrupt';
        return emptyData();
      }
      if (parsed && Number(parsed.version) > VERSION) {
        status.readOnly = true;
        status.lastError = 'newer-version';
      }
      return normalize(parsed);
    }

    function save() {
      let ok = false;
      if (storage && !status.readOnly) {
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify(data));
          status.lastError = null;
          ok = true;
        } catch (e) {
          status.lastError = e && (e.name === 'QuotaExceededError' || e.code === 22) ? 'quota' : 'save-failed';
        }
      }
      listeners.forEach((fn) => { try { fn(); } catch (e) { /* 画面側の失敗は無視 */ } });
      return ok;
    }

    // 裏ワザで全話を解放したとき（unlockAll）は、累積正解数にかかわらず全話を読める（正解数は書きかえない）
    const unlocked = () => (data.unlockAll ? thresholds.length : unlockedCount(data.totalCorrect, thresholds));

    /**
     * 正解を1つ数える。正解が確定した時点で呼ぶ（結果画面まで待たない）。
     * @param {object} [token] 採点結果のオブジェクトなど。同じものを2回渡しても1回しか数えない
     * @returns {{added:boolean, total:number, newlyUnlocked:number[], saved:boolean}}
     */
    function addCorrectAnswer(token) {
      if (token && typeof token === 'object') {
        if (counted.has(token)) return { added: false, total: data.totalCorrect, newlyUnlocked: [], saved: false };
        counted.add(token);
      }
      const before = unlocked();
      data.totalCorrect += 1;
      const after = unlocked();
      const newlyUnlocked = [];
      for (let n = before + 1; n <= after; n++) newlyUnlocked.push(n);
      const saved = save();
      return { added: true, total: data.totalCorrect, newlyUnlocked, saved };
    }

    function isUnlocked(no) { return no >= 1 && no <= unlocked(); }
    function isRead(no) { return data.readEpisodes.includes(no); }

    /** 最後のセリフまで読んだ話を既読にする（解放されていない話は既読にしない） */
    function markRead(no) {
      if (!isUnlocked(no) || isRead(no)) return false;
      data.readEpisodes = [...data.readEpisodes, no].sort((a, b) => a - b);
      save();
      return true;
    }

    /** 解放済みで、まだ読んでいない話（NEW） */
    function unreadUnlocked() {
      const list = [];
      for (let n = 1; n <= unlocked(); n++) if (!isRead(n)) list.push(n);
      return list;
    }

    /** 次の話の解放まであと何問か（全話解放済みなら null） */
    function nextUnlock() {
      const n = unlocked();
      if (n >= thresholds.length) return null;
      return { no: n + 1, need: thresholds[n], remaining: thresholds[n] - data.totalCorrect };
    }

    function remainingFor(no) {
      if (data.unlockAll) return 0;
      return Math.max(0, thresholds[no - 1] - data.totalCorrect);
    }

    /** 名前を変える（すぐに保存する。進行度・既読は変えない） */
    function setName(role, value) {
      const field = NAME_FIELDS[role];
      if (!field) return false;
      const v = sanitizeName(value);
      data[field] = role === 'teacher' ? v : (v || DEFAULT_NAMES[role]);
      return save();
    }

    function names() {
      return { teacher: data.teacherName, kei: data.boyName, shiho: data.girlName };
    }

    /** 本文・見出しで使う名前（先生は「○○先生」、生徒は敬称なし） */
    function displayNames() {
      return {
        teacher: teacherDisplayName(data.teacherName),
        kei: studentDisplayName(data.boyName, DEFAULT_NAMES.kei),
        shiho: studentDisplayName(data.girlName, DEFAULT_NAMES.shiho),
      };
    }

    /** 進行度（累積正解数・既読）だけを初期化する。名前は残す */
    function resetProgress() {
      if (status.readOnly) return { ok: false, reason: 'newer-version' };
      data = { ...data, totalCorrect: 0, readEpisodes: [] };
      delete data.unlockAll;
      if (!storage) { save(); return { ok: true }; }
      return save() ? { ok: true } : { ok: false, reason: 'save-failed' };
    }

    return {
      status,
      thresholds: thresholds.slice(),
      get totalCorrect() { return data.totalCorrect; },
      unlockedCount: unlocked,
      addCorrectAnswer,
      isUnlocked, isRead, markRead, unreadUnlocked, nextUnlock, remainingFor,
      setName, names, displayNames,
      resetProgress,
      /** 裏ワザ：全話を解放する（累積正解数は変えない。ストーリーのリセットで元に戻る） */
      unlockAllEpisodes: () => { data = { ...data, unlockAll: true }; return save(); },
      get allUnlockedBySecret() { return !!data.unlockAll; },
      onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      /** 自動テスト・不具合調査用 */
      snapshot: () => JSON.parse(JSON.stringify(data)),
      reload: () => { data = load(); },
    };
  }

  return {
    STORAGE_KEY, BACKUP_KEY, VERSION, NAME_MAX, DEFAULT_NAMES, DEFAULT_THRESHOLDS,
    createStoryStore, normalize, emptyData, sanitizeName, teacherDisplayName, studentDisplayName, unlockedCount,
  };
});
