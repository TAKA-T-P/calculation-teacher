/*
 * record-transfer.js
 * 引継ぎコード（公式タイムアタックとティーチャー認定試験の記録を、別の端末へ移すための短い文字列）の
 * 作成と読み込み。DOM・localStorage にはふれない（Node.js からテストできる）。
 *
 * ■ コードの形式（CT1）
 *   "CT1-" + Base64URL( 記録のバイト列 + CRC32(4バイト) )
 *   - CRC32 は「"CT1" の文字 + 記録のバイト列」から計算する（形式のバージョンもチェックの対象に含める）。
 *   - 暗号化ではない。コードを持っている人は記録を読み込める。
 *
 * ■ 記録のバイト列（項目名は書かず、決まった順に数を並べる。数は可変長整数 varint）
 *   公式の単元数 n
 *     n 回： 単元, 最高スコア+1（0 は記録なし）, 達成日時, 最大連続正解数, プレイ回数
 *   認定の単元数 m
 *     m 回： 単元, 最高クリア試験 h（0〜5）,
 *            第1〜第h試験について（クリア済み）： 挑戦回数, 初クリア日時
 *            クリアしていない試験の記録の数 k
 *            k 回： 試験番号, 挑戦回数
 *   - 単元：固定の番号表（UNIT_CODES。番号は今後も変えない）にあれば番号、なければ 0 + 文字数 + 単元IDの文字。
 *   - 日時：ミリ秒の精度で保存する。0 は日時なし。それ以外は「ひとつ前に書いた日時との差（ミリ秒）」を
 *     符号つき整数にして +1 したもの（最初は基準日 2026-01-01 からの差）。記録の日時は近いことが多いので短くなる。
 *   - 称号名・ティーチャーランク名・試験のクリア状況（最高クリア試験から決まる）は入れない（読み込んだ側で計算する）。
 *   - カスタムタイムアタックの履歴と効果音の設定は入れない。
 *   - 単元は ID の順に並べるので、同じ記録からはいつも同じコードになる。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RecordTransfer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PREFIX = 'CT';
  const FORMAT_VERSION = 1;
  const TAG = `${PREFIX}${FORMAT_VERSION}`;      // "CT1"
  const BASE_MS = Date.UTC(2026, 0, 1);         // 日時の基準（2026-01-01）
  const MAX_EXAM = 5;                           // 認定試験の数（certification.js の EXAMS と同じ。テストで一致を確かめる）

  // 単元の番号表。番号は一度決めたら変えない（並べかえ・削除をしない。新しい単元は末尾に足す）。
  // 番号表にない単元は、単元IDの文字のままコードに入れる（古いアプリで作ったコードも、新しい単元のコードも読める）。
  const UNIT_CODES = {
    'positive-negative': 1,
    expressions: 2,
    equation: 3,
    polynomials: 4,
    'simultaneous-equations': 5,
    'expansion-factorization': 6,
    'square-roots': 7,
    'quadratic-equations': 8,
  };
  const UNIT_BY_CODE = Object.fromEntries(Object.entries(UNIT_CODES).map(([u, c]) => [c, u]));
  // 単元ID として受け付ける形（英小文字で始まり、英小文字・数字・ハイフン。40文字まで）。危険な名前は拒否する
  const UNIT_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
  const UNSAFE_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'tostring', 'valueof', 'hasownproperty']);

  // 上限（偶然や悪意のある巨大なデータを拒否する）
  const LIMITS = {
    inputChars: 20000,   // 貼り付けられた文字列（空白・改行を含む）
    codeChars: 4000,     // 空白を除いたコードの長さ
    bytes: 3000,         // 復元したバイト列の長さ
    units: 64,           // 公式・認定それぞれの単元数
    score: 10000000,
    count: 10000000,     // プレイ回数・挑戦回数・最大連続正解数
  };
  const DATE_MIN = Date.UTC(2020, 0, 1);
  const DATE_MAX = Date.UTC(2100, 0, 1);

  /** 読み込みのエラー。reason：format（形式が違う）/ truncated（途中で切れた）/ version（非対応）/ corrupt（壊れている） */
  class TransferError extends Error {
    constructor(reason, detail) {
      super(detail || reason);
      this.reason = reason;
    }
  }

  // ------------------------------------------------------------ CRC32
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ------------------------------------------------------------ Base64URL（btoa/atob や Buffer に頼らず、どの環境でも同じ結果）
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const B64_INDEX = Object.fromEntries([...B64].map((ch, i) => [ch, i]));
  function toBase64Url(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
      for (let k = 0; k < chars; k++) out += B64[(n >> (18 - 6 * k)) & 63];
    }
    return out;
  }
  function fromBase64Url(text) {
    if (text.length % 4 === 1) throw new TransferError('truncated', 'Base64 の長さが正しくありません');
    const bytes = [];
    for (let i = 0; i < text.length; i += 4) {
      const chunk = text.slice(i, i + 4);
      let n = 0;
      for (let k = 0; k < 4; k++) {
        const v = k < chunk.length ? B64_INDEX[chunk[k]] : 0;
        if (v === undefined) throw new TransferError('format', '使えない文字があります');
        n = n * 64 + v;
      }
      const count = chunk.length - 1;
      for (let k = 0; k < count; k++) bytes.push(Math.floor(n / 2 ** (16 - 8 * k)) % 256);
    }
    return Uint8Array.from(bytes);
  }

  // ------------------------------------------------------------ バイト列の書き出し・読み取り（varint は 2^53 まで扱える）
  class Writer {
    constructor() { this.bytes = []; }
    uint(n) {
      if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`整数ではない値: ${n}`);
      do {
        let b = n % 128;
        n = Math.floor(n / 128);
        if (n > 0) b += 128;
        this.bytes.push(b);
      } while (n > 0);
    }
    sint(n) { this.uint(n >= 0 ? n * 2 : -n * 2 - 1); }   // 符号つき（zigzag）
    text(s) { this.uint(s.length); for (let i = 0; i < s.length; i++) this.bytes.push(s.charCodeAt(i)); }
  }
  class Reader {
    constructor(bytes) { this.bytes = bytes; this.pos = 0; }
    get done() { return this.pos >= this.bytes.length; }
    byte() {
      if (this.pos >= this.bytes.length) throw new TransferError('truncated', 'データが途中で終わっています');
      return this.bytes[this.pos++];
    }
    uint() {
      let n = 0;
      let mul = 1;
      for (let i = 0; i < 8; i++) {
        const b = this.byte();
        n += (b % 128) * mul;
        if (b < 128) return n;
        mul *= 128;
      }
      throw new TransferError('corrupt', '数が大きすぎます');
    }
    sint() { const z = this.uint(); return z % 2 === 0 ? z / 2 : -(z + 1) / 2; }
    text(max) {
      const len = this.uint();
      if (len > max) throw new TransferError('corrupt', '文字列が長すぎます');
      let s = '';
      for (let i = 0; i < len; i++) s += String.fromCharCode(this.byte());
      return s;
    }
  }

  // ------------------------------------------------------------ 日時
  function parseIso(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(s)) return null;
    const t = Date.parse(s);
    return Number.isFinite(t) && t >= DATE_MIN && t < DATE_MAX ? t : null;
  }
  const isoOf = (ms) => new Date(ms).toISOString();

  // ------------------------------------------------------------ 単元
  function isSafeUnitId(u) {
    return typeof u === 'string' && UNIT_ID_RE.test(u) && !UNSAFE_NAMES.has(u.toLowerCase());
  }
  function writeUnit(w, unit) {
    if (UNIT_CODES[unit]) { w.uint(UNIT_CODES[unit]); return; }
    w.uint(0);
    w.text(unit);
  }
  function readUnit(r) {
    const code = r.uint();
    if (code === 0) {
      const u = r.text(40);
      if (!isSafeUnitId(u)) throw new TransferError('corrupt', `単元IDの形式が正しくありません: ${JSON.stringify(u)}`);
      if (UNIT_CODES[u]) throw new TransferError('corrupt', '番号表にある単元が文字で書かれています');
      return u;
    }
    const u = UNIT_BY_CODE[code];
    // 番号表にない番号＝新しいアプリでつくったコード（この版では読めない）
    if (!u) throw new TransferError('version', `知らない単元の番号: ${code}`);
    return u;
  }

  // ------------------------------------------------------------ 記録から引継ぎデータを取り出す
  /**
   * records.js の記録（snapshot() など）から、引継ぎに使う部分だけを取り出す。
   * 結果：{ official: {単元: {bestScore, bestDate, maxStreak, plays}}, certification: {単元: {highestCleared, exams: {id: {cleared, attempts, firstClearedAt}}}} }
   * 単元IDとして安全でないもの・日時として正しくないものは含めない（その単元・その日時だけ）。
   */
  function extract(records) {
    const out = { official: {}, certification: {} };
    const ta = (records && records.timeAttack) || {};
    Object.keys(ta.official || {}).sort().forEach((unit) => {
      const r = ta.official[unit];
      if (!isSafeUnitId(unit) || !r) return;
      const bestScore = Number.isSafeInteger(r.bestScore) && r.bestScore >= 0 && r.bestScore <= LIMITS.score ? r.bestScore : null;
      const plays = Number.isSafeInteger(r.plays) && r.plays >= 0 ? Math.min(r.plays, LIMITS.count) : 0;
      if (bestScore === null && plays === 0) return; // 記録として意味のないもの
      out.official[unit] = {
        bestScore,
        bestDate: bestScore === null || parseIso(r.bestDate) === null ? null : isoOf(parseIso(r.bestDate)),
        maxStreak: Number.isSafeInteger(r.maxStreak) && r.maxStreak >= 0 ? Math.min(r.maxStreak, LIMITS.count) : 0,
        // 最高スコアがあれば、少なくとも1回はプレイしている（アプリはいつもそうなるが、念のためそろえる）
        plays: bestScore === null ? plays : Math.max(1, plays),
      };
    });
    const cert = (records && records.certification) || {};
    Object.keys(cert).sort().forEach((unit) => {
      const c = cert[unit];
      if (!isSafeUnitId(unit) || !c) return;
      const h = Math.max(0, Math.min(MAX_EXAM, Math.floor(Number(c.highestCleared) || 0)));
      const exams = {};
      for (let id = 1; id <= MAX_EXAM; id++) {
        const e = c.exams && c.exams[String(id)];
        const attempts = e && Number.isSafeInteger(e.attempts) && e.attempts >= 0 ? Math.min(e.attempts, LIMITS.count) : 0;
        if (id <= h) {
          // クリア済み（第1〜第h試験）。クリアしたなら少なくとも1回は挑戦している
          exams[String(id)] = {
            cleared: true,
            attempts: Math.max(1, attempts),
            firstClearedAt: e && parseIso(e.firstClearedAt) !== null ? isoOf(parseIso(e.firstClearedAt)) : null,
          };
        } else if (id === h + 1 && attempts > 0) {
          // まだクリアしていない「次の試験」の挑戦回数（それより先の試験は挑戦できないので記録はない）
          exams[String(id)] = { cleared: false, attempts, firstClearedAt: null };
        }
      }
      if (h === 0 && Object.keys(exams).length === 0) return; // まだ1回も挑戦していない（記録なしと同じ）
      out.certification[unit] = { highestCleared: h, exams };
    });
    return out;
  }

  // ------------------------------------------------------------ コードを作る
  function encode(transfer) {
    const w = new Writer();
    let last = BASE_MS;
    const date = (iso) => {
      const t = parseIso(iso);
      if (t === null) { w.uint(0); return; }
      w.uint(t - last >= 0 ? (t - last) * 2 + 1 : (last - t) * 2);   // zigzag(差)+1（0 は「日時なし」）
      last = t;
    };
    const official = Object.keys(transfer.official || {}).sort();
    w.uint(official.length);
    official.forEach((unit) => {
      const r = transfer.official[unit];
      writeUnit(w, unit);
      w.uint(r.bestScore === null || r.bestScore === undefined ? 0 : r.bestScore + 1);
      date(r.bestDate);
      w.uint(r.maxStreak || 0);
      w.uint(r.plays || 0);
    });
    const cert = Object.keys(transfer.certification || {}).sort();
    w.uint(cert.length);
    cert.forEach((unit) => {
      const c = transfer.certification[unit];
      const h = c.highestCleared;
      writeUnit(w, unit);
      w.uint(h);
      for (let id = 1; id <= h; id++) {
        const e = c.exams[String(id)] || { attempts: 0, firstClearedAt: null };
        w.uint(e.attempts);
        date(e.firstClearedAt);
      }
      const rest = Object.keys(c.exams || {}).map(Number).filter((id) => id > h).sort((a, b) => a - b);
      w.uint(rest.length);
      rest.forEach((id) => { w.uint(id); w.uint(c.exams[String(id)].attempts); });
    });
    const payload = Uint8Array.from(w.bytes);
    const crc = crc32(Uint8Array.from([...TAG].map((ch) => ch.charCodeAt(0)).concat([...payload])));
    const all = Uint8Array.from([...payload, (crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]);
    return `${TAG}-${toBase64Url(all)}`;
  }

  /** 記録（records.js の形）から、そのまま引継ぎコードを作る */
  function createCode(records) {
    return encode(extract(records));
  }

  // ------------------------------------------------------------ コードを読む
  /** 貼り付けられた文字列を整える（前後や途中の空白・改行・見えない文字を取り除く） */
  function cleanInput(text) {
    if (typeof text !== 'string') throw new TransferError('format', '文字列ではありません');
    if (text.length > LIMITS.inputChars) throw new TransferError('format', '長すぎます');
    return text.replace(/[\s​-‍﻿]+/g, '');
  }

  /**
   * 引継ぎコードを読んで検証する。記録は変更しない。
   * 成功：{ ok: true, data: 引継ぎデータ（extract と同じ形）, summary }
   * 失敗：{ ok: false, reason: 'format' | 'truncated' | 'version' | 'corrupt', detail }
   */
  function decode(text) {
    try {
      const code = cleanInput(text);
      const m = /^([A-Za-z]{2})(\d{1,3})-([A-Za-z0-9_-]*)$/.exec(code);
      if (!m || m[1].toUpperCase() !== PREFIX) throw new TransferError('format', '「CT1-」で始まる引継ぎコードではありません');
      if (Number(m[2]) !== FORMAT_VERSION) throw new TransferError('version', `形式 ${m[1]}${m[2]} には対応していません`);
      if (code.length > LIMITS.codeChars) throw new TransferError('corrupt', 'コードが長すぎます');
      const all = fromBase64Url(m[3]);
      if (all.length < 6) throw new TransferError('truncated', 'コードが短すぎます');
      if (all.length > LIMITS.bytes) throw new TransferError('corrupt', 'データが大きすぎます');
      // 先に構造を読み、残りがちょうど CRC32 の4バイトか確かめる（足りなければ途中で切れている）
      const r = new Reader(all);
      const data = readPayload(r);
      const rest = all.length - r.pos;
      if (rest < 4) throw new TransferError('truncated', 'チェック情報が足りません');
      if (rest > 4) throw new TransferError('corrupt', '余分なデータがあります');
      const payload = all.slice(0, r.pos);
      const expected = crc32(Uint8Array.from([...TAG].map((ch) => ch.charCodeAt(0)).concat([...payload])));
      const actual = ((all[r.pos] << 24) | (all[r.pos + 1] << 16) | (all[r.pos + 2] << 8) | all[r.pos + 3]) >>> 0;
      if (expected !== actual) throw new TransferError('corrupt', 'チェック情報が一致しません');
      validate(data);
      return { ok: true, data, summary: summarize(data) };
    } catch (e) {
      if (e instanceof TransferError) return { ok: false, reason: e.reason, detail: e.message };
      return { ok: false, reason: 'corrupt', detail: String(e && e.message) };
    }
  }

  function readPayload(r) {
    let last = BASE_MS;
    const date = () => {
      const z = r.uint();
      if (z === 0) return null;
      const d = z % 2 === 1 ? (z - 1) / 2 : -z / 2;
      const t = last + d;
      if (!Number.isSafeInteger(t) || t < DATE_MIN || t >= DATE_MAX) throw new TransferError('corrupt', '日時が正しくありません');
      last = t;
      return isoOf(t);
    };
    const count = (max) => {
      const n = r.uint();
      if (n > max) throw new TransferError('corrupt', '数が大きすぎます');
      return n;
    };
    const data = { official: {}, certification: {} };
    const nOfficial = count(LIMITS.units);
    for (let i = 0; i < nOfficial; i++) {
      const unit = readUnit(r);
      if (Object.prototype.hasOwnProperty.call(data.official, unit)) throw new TransferError('corrupt', '同じ単元が2回あります');
      const best = count(LIMITS.score + 1);
      data.official[unit] = { bestScore: best === 0 ? null : best - 1, bestDate: date(), maxStreak: count(LIMITS.count), plays: count(LIMITS.count) };
    }
    const nCert = count(LIMITS.units);
    for (let i = 0; i < nCert; i++) {
      const unit = readUnit(r);
      if (Object.prototype.hasOwnProperty.call(data.certification, unit)) throw new TransferError('corrupt', '同じ単元が2回あります');
      const h = r.uint();
      if (h > MAX_EXAM) throw new TransferError('corrupt', `存在しない試験までクリアしています: ${h}`);
      const exams = {};
      for (let id = 1; id <= h; id++) exams[String(id)] = { cleared: true, attempts: count(LIMITS.count), firstClearedAt: date() };
      const k = count(MAX_EXAM);
      for (let j = 0; j < k; j++) {
        const id = r.uint();
        if (id < 1 || id > MAX_EXAM) throw new TransferError('corrupt', `存在しない試験番号: ${id}`);
        if (id <= h || exams[String(id)]) throw new TransferError('corrupt', `試験 ${id} の記録が矛盾しています`);
        exams[String(id)] = { cleared: false, attempts: count(LIMITS.count), firstClearedAt: null };
      }
      data.certification[unit] = { highestCleared: h, exams };
    }
    return data;
  }

  /** 引継ぎデータが、アプリの仕様と矛盾しないか確かめる（矛盾していれば TransferError） */
  function validate(data) {
    const bad = (msg) => { throw new TransferError('corrupt', msg); };
    Object.entries(data.official).forEach(([unit, r]) => {
      if (!isSafeUnitId(unit)) bad(`単元ID: ${unit}`);
      if (r.bestScore !== null && (!Number.isSafeInteger(r.bestScore) || r.bestScore < 0 || r.bestScore > LIMITS.score)) bad('最高スコアが正しくありません');
      if (r.bestScore !== null && r.plays < 1) bad('最高スコアがあるのにプレイ回数が0です');
      if (r.bestScore === null && r.bestDate !== null) bad('最高スコアがないのに達成日があります');
    });
    Object.entries(data.certification).forEach(([unit, c]) => {
      if (!isSafeUnitId(unit)) bad(`単元ID: ${unit}`);
      for (let id = 1; id <= c.highestCleared; id++) {
        const e = c.exams[String(id)];
        if (!e || !e.cleared) bad(`第${id}試験がクリアされていないのに、第${c.highestCleared}試験までクリアしています`);
        if (e.attempts < 1) bad(`クリアした第${id}試験の挑戦回数が0です`);
      }
      Object.entries(c.exams).forEach(([id, e]) => {
        if (Number(id) > c.highestCleared) {
          if (e.cleared || e.firstClearedAt !== null) bad(`第${id}試験の記録が矛盾しています`);
          // 試験は順番にしか挑戦できないので、クリアしていない試験の記録は「次の試験」だけ
          if (Number(id) !== c.highestCleared + 1) bad(`まだ挑戦できない第${id}試験の記録があります`);
          if (e.attempts < 1) bad(`第${id}試験の挑戦回数が0です`);
        }
      });
    });
  }

  /** 確認画面用のまとめ（単元ごとの最高スコア・最高クリア試験） */
  function summarize(data) {
    const units = [...new Set([...Object.keys(data.official), ...Object.keys(data.certification)])].sort();
    return {
      empty: units.length === 0,
      units: units.map((unit) => ({
        unit,
        bestScore: data.official[unit] ? data.official[unit].bestScore : null,
        highestCleared: data.certification[unit] ? data.certification[unit].highestCleared : null,
      })),
    };
  }

  /** 引継ぎデータに記録が1つもないか（公式の最高スコアも、認定の挑戦記録もない） */
  function isEmpty(transfer) {
    return Object.keys(transfer.official || {}).length === 0 && Object.keys(transfer.certification || {}).length === 0;
  }

  return {
    TAG, FORMAT_VERSION, BASE_MS, MAX_EXAM, UNIT_CODES, LIMITS,
    extract, encode, createCode, decode, cleanInput, validate, summarize, isEmpty, isSafeUnitId,
    // テスト用
    _internal: { crc32, toBase64Url, fromBase64Url, TransferError },
  };
});
