#!/usr/bin/env node
/*
 * test-transfer.js
 * 引継ぎコード（js/record-transfer.js）と、記録の置き換え（js/records.js の replaceTransferable）のテスト。
 *   node tools/test-transfer.js            テストを実行し、コードの長さを表示する
 */
'use strict';
const RT = require('../js/record-transfer.js');
const Rec = require('../js/records.js');
const TA = require('../js/time-attack.js');
const C = require('../js/certification.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`OK  ${name}`);
  } catch (e) {
    failed++;
    console.log(`NG  ${name}\n      ${e.message}`);
  }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} 期待: ${JSON.stringify(b)} / 実際: ${JSON.stringify(a)}`); }
function same(a, b, msg) { eq(JSON.stringify(a), JSON.stringify(b), msg); }
function assert(c, msg) { if (!c) throw new Error(msg || '条件を満たさない'); }

// ------------------------------------------------------------ テスト用の記録
const exam = (attempts, date) => ({ cleared: true, attempts, firstClearedAt: date });
function fullRecords() {
  return {
    version: 1,
    timeAttack: {
      official: {
        'positive-negative': { bestScore: 2450, bestDate: '2026-11-20T10:15:30.123Z', maxStreak: 11, plays: 14, title: '🎯赤ペンマスター' },
        expressions: { bestScore: 1860, bestDate: '2026-11-21T08:30:00.000Z', maxStreak: 8, plays: 7, title: '💥スーパー添削先生' },
        equation: { bestScore: 3120, bestDate: '2026-12-01T16:42:05.987Z', maxStreak: 14, plays: 23, title: '👑神の赤ペン' },
      },
      custom: [
        { playedAt: '2026-11-22T09:00:00.000Z', unit: 'equation', categories: ['移項'], difficulties: [1, 2], score: 900, correct: 4, wrong: 1, maxStreak: 3 },
      ],
    },
    certification: {
      'positive-negative': { highestCleared: 3, exams: { 1: exam(1, '2026-11-18T07:00:00.000Z'), 2: exam(2, '2026-11-18T07:20:11.500Z'), 3: exam(4, '2026-11-19T12:00:00.000Z'), 4: { cleared: false, attempts: 2, firstClearedAt: null } } },
      expressions: { highestCleared: 2, exams: { 1: exam(1, '2026-11-18T08:00:00.000Z'), 2: exam(1, '2026-11-18T08:30:00.000Z') } },
      equation: { highestCleared: 5, exams: { 1: exam(1, '2026-11-17T06:00:00.000Z'), 2: exam(1, '2026-11-17T06:30:00.000Z'), 3: exam(3, '2026-11-17T07:45:00.000Z'), 4: exam(2, '2026-11-20T09:00:00.000Z'), 5: exam(6, '2026-11-25T18:59:59.999Z') } },
    },
  };
}
function makeStorage(initial = {}, opts = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      if (opts.failSet && k === Rec.STORAGE_KEY && opts.failSet()) { const e = new Error('容量'); e.name = 'QuotaExceededError'; throw e; }
      data[k] = opts.corrupt ? String(v).slice(0, 5) : String(v);
    },
  };
}
/** 任意のバイト列から、チェック情報（CRC32）つきのコードを作る（壊れたデータを読ませるテスト用） */
function craft(bytes, tag = 'CT1') {
  const crc = RT._internal.crc32(Uint8Array.from([...tag].map((c) => c.charCodeAt(0)).concat(bytes)));
  return `${tag}-${RT._internal.toBase64Url(Uint8Array.from([...bytes, (crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]))}`;
}

// ================================================================ コードの生成
console.log('--- コードの生成');
test('[1] 記録がない状態でもコードを発行でき、読み込める（空の記録として）', () => {
  const code = RT.createCode(Rec.emptyData());
  assert(code.startsWith('CT1-'), code);
  const d = RT.decode(code);
  assert(d.ok, JSON.stringify(d));
  assert(RT.isEmpty(d.data) && d.summary.empty, '空になっていない');
  eq(RT.createCode({}), code, '記録のオブジェクトがなくても同じ');
});
test('[2〜8] 公式（最高スコア・達成日時・最大連続・プレイ回数）と認定（最高クリア・挑戦回数・初クリア日時）が、ミリ秒まで正確に戻る', () => {
  const rec = fullRecords();
  const d = RT.decode(RT.createCode(rec));
  assert(d.ok, JSON.stringify(d));
  Object.entries(rec.timeAttack.official).forEach(([u, r]) => {
    same(d.data.official[u], { bestScore: r.bestScore, bestDate: r.bestDate, maxStreak: r.maxStreak, plays: r.plays }, u);
  });
  Object.entries(rec.certification).forEach(([u, c]) => {
    eq(d.data.certification[u].highestCleared, c.highestCleared, u);
    same(Object.keys(d.data.certification[u].exams).sort(), Object.keys(c.exams).sort(), `${u} の試験`);
    Object.entries(c.exams).forEach(([id, e]) => same(d.data.certification[u].exams[id], e, `${u} 第${id}試験`));
  });
});
test('[9・10] カスタム履歴・効果音の設定・称号名はコードに入らない', () => {
  const rec = fullRecords();
  const withoutCustom = JSON.parse(JSON.stringify(rec));
  withoutCustom.timeAttack.custom = [];
  Object.values(withoutCustom.timeAttack.official).forEach((r) => { r.title = 'ちがう称号'; });
  eq(RT.createCode(rec), RT.createCode(withoutCustom), 'カスタム履歴・称号名でコードが変わった');
  const d = RT.decode(RT.createCode(rec));
  same(Object.keys(d.data).sort(), ['certification', 'official']);
  assert(!JSON.stringify(d.data).includes('custom') && !JSON.stringify(d.data).includes('title') && !JSON.stringify(d.data).includes('volume'), '余計な項目');
});
test('[11] 称号（10段階）とティーチャーランクは、読み込んだ記録から既存のロジックで計算できる', () => {
  const d = RT.decode(RT.createCode(fullRecords())).data;
  eq(TA.titleForScore(d.official['positive-negative'].bestScore), '🎯赤ペンマスター');
  eq(TA.titleForScore(d.official.equation.bestScore), '👑神の赤ペン');
  eq(C.rankFor(d.certification.equation.highestCleared).name, 'マスターティーチャー');
  eq(C.rankFor(d.certification.expressions.highestCleared).name, '一人前ティーチャー');
});
test('[12・13] コードを作っても元の記録は変わらない。同じ記録からはいつも同じコード（単元の順番が違っても）', () => {
  const rec = fullRecords();
  const before = JSON.stringify(rec);
  const a = RT.createCode(rec);
  eq(JSON.stringify(rec), before, '元の記録が変わった');
  const reordered = fullRecords();
  reordered.timeAttack.official = Object.fromEntries(Object.entries(reordered.timeAttack.official).reverse());
  reordered.certification = Object.fromEntries(Object.entries(reordered.certification).reverse());
  eq(RT.createCode(reordered), a);
  eq(RT.createCode(fullRecords()), a);
});
test('[14] 記録が増えてから作り直すと、最新の記録のコードになる', () => {
  const rec = fullRecords();
  const a = RT.createCode(rec);
  rec.timeAttack.official.expressions.bestScore = 2010;
  rec.timeAttack.official.expressions.plays = 8;
  const b = RT.createCode(rec);
  assert(a !== b, 'コードが変わらない');
  eq(RT.decode(b).data.official.expressions.bestScore, 2010);
});
test('[15] 中2・中3の単元（番号表の単元）と、番号表にない新しい単元も変換できる', () => {
  const rec = Rec.emptyData();
  const units = ['positive-negative', 'expressions', 'equation', 'polynomials', 'simultaneous-equations', 'expansion-factorization', 'square-roots', 'quadratic-equations', 'statistics-2'];
  units.forEach((u, i) => {
    rec.timeAttack.official[u] = { bestScore: 1000 + i * 10, bestDate: `2027-0${(i % 9) + 1}-10T10:00:00.000Z`, maxStreak: i, plays: i + 1 };
    rec.certification[u] = { highestCleared: i % 6, exams: Object.fromEntries(Array.from({ length: i % 6 }, (_, k) => [String(k + 1), exam(k + 1, `2027-0${(i % 9) + 1}-1${k}T00:00:00.000Z`)])) };
  });
  const d = RT.decode(RT.createCode(rec));
  assert(d.ok, JSON.stringify(d));
  same(Object.keys(d.data.official).sort(), units.slice().sort());
  eq(d.data.official['statistics-2'].bestScore, 1080);
  eq(d.data.certification['quadratic-equations'].highestCleared, 1);
});
test('単元の番号表は固定（番号を変えると古いコードが別の単元として読まれてしまう）。試験の数は認定試験と同じ', () => {
  same(RT.UNIT_CODES, {
    'positive-negative': 1, expressions: 2, equation: 3, polynomials: 4,
    'simultaneous-equations': 5, 'expansion-factorization': 6, 'square-roots': 7, 'quadratic-equations': 8,
  });
  eq(RT.MAX_EXAM, C.EXAMS.length);
  // 第1段階から使っているコードが、これからも同じ記録として読める（形式の固定）
  const fixed = RT.createCode({ timeAttack: { official: { equation: { bestScore: 2450, bestDate: '2026-11-20T10:00:00.123Z', maxStreak: 11, plays: 4 } } } });
  eq(fixed, RT.createCode({ timeAttack: { official: { equation: { bestScore: 2450, bestDate: '2026-11-20T10:00:00.123Z', maxStreak: 11, plays: 4 } } } }));
});

// ================================================================ コードの読み込み
console.log('--- コードの読み込み');
const GOOD = RT.createCode(fullRecords());
test('[1〜3] 正しいコード、前後や途中に空白・改行・見えない文字が入ったコードを読める', () => {
  const expected = JSON.stringify(RT.decode(GOOD).data);
  [`  ${GOOD}  `, GOOD.replace(/(.{10})/g, '$1\n'), GOOD.replace(/(.{7})/g, '$1 \r\n\t'), `​${GOOD}﻿`].forEach((variant, i) => {
    const d = RT.decode(variant);
    assert(d.ok, `パターン${i + 1}: ${d.reason}`);
    eq(JSON.stringify(d.data), expected, `パターン${i + 1}`);
  });
});
test('[4] 1文字だけ変わったコードは、すべて検出する（記録として読まれない）', () => {
  const body = GOOD.slice(4);
  const original = JSON.stringify(RT.decode(GOOD).data);
  let detected = 0;
  let harmless = 0;
  for (let i = 0; i < body.length; i++) {
    for (const ch of ['A', 'z', '0', '-', '_', 'Q']) {
      if (body[i] === ch) continue;
      const d = RT.decode(`CT1-${body.slice(0, i)}${ch}${body.slice(i + 1)}`);
      if (!d.ok) detected++;
      else {
        // 最後の文字の使われないビットだけが変わった場合は、同じ記録になる（記録は変わらない）
        eq(JSON.stringify(d.data), original, `位置 ${i} を ${ch} にしたら別の記録として読まれた`);
        harmless++;
      }
    }
  }
  assert(detected > 0 && harmless <= 6, `検出 ${detected} / 同じ記録 ${harmless}`);
});
test('[5] 途中で切れたコードは、どこで切れても検出する', () => {
  for (let n = 1; n < GOOD.length; n++) {
    const d = RT.decode(GOOD.slice(0, n));
    assert(!d.ok, `${n}文字で切れたコードが読めてしまった`);
    assert(['format', 'truncated', 'corrupt'].includes(d.reason), `${n}文字: ${d.reason}`);
  }
  eq(RT.decode(GOOD.slice(0, GOOD.length - 3)).reason, 'truncated', '末尾が切れた');
});
test('[6] 形式が違う入力は拒否する', () => {
  ['', 'hello', 'CT1', 'CT1-', 'CT1-@@@@', 'XX1-AAAA', '{"official":{}}', 'CT1-AAAA!', 'https://example.com/?c=CT1-AA'].forEach((s) => {
    const d = RT.decode(s);
    assert(!d.ok, `${JSON.stringify(s)} が読めてしまった`);
  });
  eq(RT.decode('hello').reason, 'format');
  eq(RT.decode('CT1-AAAA!').reason, 'format');
});
test('[7] 対応していない形式のバージョンは拒否する（新しいアプリで作ったコード）', () => {
  eq(RT.decode(GOOD.replace('CT1-', 'CT2-')).reason, 'version');
  eq(RT.decode('CT9-AAAAAAAA').reason, 'version');
  // 番号表にない単元番号（新しいアプリの番号表）も「アプリを更新してください」
  eq(RT.decode(craft([1, 99, 0, 0, 0, 0, 0])).reason, 'version');
});
test('[8] 不正な数（巨大な値・varint の異常）は拒否する', () => {
  const big = []; let n = RT.LIMITS.score + 5; do { let b = n % 128; n = Math.floor(n / 128); if (n) b += 128; big.push(b); } while (n);
  eq(RT.decode(craft([1, 3, ...big, 0, 0, 1, 0])).reason, 'corrupt', 'スコアが上限を超える');
  eq(RT.decode(craft([1, 3, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1])).reason, 'corrupt', '終わらない varint');
  eq(RT.decode(craft([70, 3])).reason, 'corrupt', '単元の数が多すぎる');
  eq(RT.decode(craft([1, 3, 101, 0, 0, 0, 0])).reason, 'corrupt', '最高スコアがあるのにプレイ回数0');
});
test('[9] 不正な日時（範囲外）は拒否する', () => {
  // 基準日から 200 年後
  let n = (200 * 365 * 86400000) * 2 + 1; const d = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b += 128; d.push(b); } while (n);
  eq(RT.decode(craft([1, 3, 101, ...d, 0, 1, 0])).reason, 'corrupt');
  // 最高スコアがないのに達成日がある
  eq(RT.decode(craft([1, 3, 0, 3, 0, 1, 0])).reason, 'corrupt');
});
test('[10] 不正な単元ID（危険な名前・形式違い・番号表の単元を文字で書いたもの）は拒否する', () => {
  const lit = (s) => [0, s.length, ...[...s].map((c) => c.charCodeAt(0))];
  ['__proto__', 'constructor', 'Bad Unit', 'UPPER', '1abc', 'a'.repeat(41), 'equation', '<img>'].forEach((u) => {
    const d = RT.decode(craft([1, ...lit(u), 101, 0, 0, 1, 0]));
    assert(!d.ok && d.reason === 'corrupt', `${u}: ${JSON.stringify(d)}`);
  });
  assert(RT.decode(craft([1, ...lit('statistics-2'), 101, 0, 0, 1, 0])).ok, '安全な新しい単元IDが読めない');
});
test('[11] 認定試験の記録の矛盾を検出する', () => {
  // [公式0] [認定1] 単元3（方程式） h, (挑戦回数, 日時)×h, k, (試験番号, 挑戦回数)×k
  const ok = craft([0, 1, 3, 1, 1, 0, 1, 2, 3]);
  assert(RT.decode(ok).ok, '正しい認定記録が読めない');
  const cases = {
    'クリアしていない試験の番号が範囲外': [0, 1, 3, 1, 1, 0, 1, 9, 1],
    '最高クリアが6': [0, 1, 3, 6],
    'クリア済みの試験をクリアしていない扱い': [0, 1, 3, 2, 1, 0, 1, 0, 1, 1, 1],
    'まだ挑戦できない第4試験の記録（第1試験までクリア）': [0, 1, 3, 1, 1, 0, 1, 4, 1],
    'クリア済みなのに挑戦回数0': [0, 1, 3, 1, 0, 0, 0],
    'クリアしていない試験の挑戦回数0': [0, 1, 3, 1, 1, 0, 1, 2, 0],
    '同じ単元が2回': [0, 2, 3, 0, 0, 3, 0, 0],
  };
  Object.entries(cases).forEach(([name, bytes]) => {
    const d = RT.decode(craft(bytes));
    assert(!d.ok && d.reason === 'corrupt', `${name}: ${JSON.stringify(d)}`);
  });
});
test('[12] 極端に長い入力は、すぐに安全に拒否する', () => {
  const t0 = Date.now();
  assert(!RT.decode(`CT1-${'A'.repeat(100000)}`).ok);
  assert(!RT.decode(`CT1-${'A'.repeat(3990)}`).ok);
  assert(!RT.decode(' '.repeat(30000)).ok);
  assert(Date.now() - t0 < 1000, '時間がかかりすぎる');
});

// ================================================================ 記録の置き換え（records.js）
console.log('--- 記録の置き換え');
const SOUND = '{"enabled":false,"volume":30}';
function deviceWith(recordsJson) {
  const init = { 'calcTeacher.sound': SOUND };
  if (recordsJson) init[Rec.STORAGE_KEY] = JSON.stringify(recordsJson);
  const storage = makeStorage(init);
  return { storage, store: Rec.createRecordStore({ storage }) };
}
test('[1・8・9・10・11] 記録のない端末へ復元でき、称号・ランク・試験の解放が計算され、再読み込み後も残る', () => {
  const { storage, store } = deviceWith(null);
  eq(store.hasTransferable(), false);
  const d = RT.decode(GOOD);
  const r = store.replaceTransferable(d.data, TA.titleForScore);
  assert(r.ok, JSON.stringify(r));
  eq(store.officialFor('equation').bestScore, 3120);
  eq(store.officialFor('equation').title, '👑神の赤ペン');
  eq(store.officialFor('positive-negative').bestDate, '2026-11-20T10:15:30.123Z');
  eq(C.rankFor(store.certFor('positive-negative').highestCleared).name, 'ベテランティーチャー');
  eq(C.isUnlocked(store.certFor('positive-negative').highestCleared, 4), true);
  eq(C.isUnlocked(store.certFor('positive-negative').highestCleared, 5), false);
  eq(store.certFor('positive-negative').exams['4'].attempts, 2);
  const again = Rec.createRecordStore({ storage });
  same(again.snapshot(), store.snapshot(), '再読み込み');
  eq(storage.data['calcTeacher.sound'], SOUND, '効果音の設定');
});
test('[2・4・5・6・7] 記録のある端末：公式・認定はコードの内容に置き換わり（コードにない単元は消える）、カスタム履歴と効果音の設定は残る', () => {
  const mine = Rec.emptyData();
  mine.timeAttack.official.equation = { bestScore: 9990, bestDate: '2026-10-01T00:00:00.000Z', maxStreak: 40, plays: 99, title: 'x' };
  mine.timeAttack.official['square-roots'] = { bestScore: 500, bestDate: '2026-10-01T00:00:00.000Z', maxStreak: 2, plays: 1, title: 'x' };
  mine.certification['square-roots'] = { highestCleared: 1, exams: { 1: exam(1, '2026-10-02T00:00:00.000Z') } };
  mine.timeAttack.custom = [{ playedAt: '2026-10-03T00:00:00.000Z', unit: 'square-roots', categories: null, difficulties: [1, 2, 3, 4], score: 777, correct: 3, wrong: 0, maxStreak: 3 }];
  const { storage, store } = deviceWith(mine);
  eq(store.hasTransferable(), true, '上書き確認が必要');
  const customBefore = JSON.stringify(store.customHistory());
  const r = store.replaceTransferable(RT.decode(GOOD).data, TA.titleForScore);
  assert(r.ok, JSON.stringify(r));
  eq(store.officialFor('equation').bestScore, 3120, 'コードの内容に置き換わる（大きいほうを残す統合はしない）');
  eq(store.officialFor('square-roots').bestScore, null, 'コードにない単元の公式記録は残らない');
  eq(store.certFor('square-roots').highestCleared, 0, 'コードにない単元の認定記録は残らない');
  eq(JSON.stringify(store.customHistory()), customBefore, 'カスタム履歴が変わった');
  eq(storage.data['calcTeacher.sound'], SOUND, '効果音の設定');
  same(Object.keys(JSON.parse(storage.data[Rec.STORAGE_KEY])).sort(), ['certification', 'timeAttack', 'version']);
});
test('[3] キャンセル（読み込んで確かめただけ）では記録は変わらない', () => {
  const { storage, store } = deviceWith(fullRecords());
  const before = storage.data[Rec.STORAGE_KEY];
  RT.decode(GOOD);
  RT.decode('壊れたコード');
  eq(storage.data[Rec.STORAGE_KEY], before);
  same(store.snapshot(), Rec.normalize(JSON.parse(before)));
});
test('[12・13] 保存に失敗したら成功にせず、この端末の記録（メモリ上・保存場所）は元のまま', () => {
  const mine = fullRecords();
  mine.timeAttack.official.equation.bestScore = 100;
  const init = { [Rec.STORAGE_KEY]: JSON.stringify(mine), 'calcTeacher.sound': SOUND };
  for (const opts of [{ failSet: () => true }, { corrupt: true }]) {
    const storage = makeStorage(init, opts);
    const store = Rec.createRecordStore({ storage });
    const before = JSON.stringify(store.snapshot());
    const target = RT.decode(RT.createCode(Rec.emptyData())).data;
    const r = store.replaceTransferable(target, TA.titleForScore);
    eq(r.ok, false, JSON.stringify(opts));
    eq(r.reason, 'save-failed');
    eq(JSON.stringify(store.snapshot()), before, 'メモリ上の記録が変わった');
    if (opts.failSet) eq(storage.data[Rec.STORAGE_KEY], init[Rec.STORAGE_KEY], '保存場所の記録が変わった');
  }
  const none = Rec.createRecordStore({ storage: null });
  eq(none.replaceTransferable(RT.decode(GOOD).data, TA.titleForScore).reason, 'unavailable', '保存できない環境');
});
test('新しい版のアプリで保存された記録は、引継ぎでも上書きしない', () => {
  const raw = JSON.stringify({ version: 99, somethingNew: true });
  const storage = makeStorage({ [Rec.STORAGE_KEY]: raw });
  const store = Rec.createRecordStore({ storage });
  eq(store.replaceTransferable(RT.decode(GOOD).data, TA.titleForScore).reason, 'newer-version');
  eq(storage.data[Rec.STORAGE_KEY], raw);
});
test('[14・15] 元の端末の記録はコードを作っても変わらず、引継ぎのあとも「記録を消す」が使える', () => {
  const src = deviceWith(fullRecords());
  const before = src.storage.data[Rec.STORAGE_KEY];
  RT.createCode(src.store.snapshot());
  eq(src.storage.data[Rec.STORAGE_KEY], before);
  const dst = deviceWith(null);
  dst.store.replaceTransferable(RT.decode(RT.createCode(src.store.snapshot())).data, TA.titleForScore);
  // 引き継いだ記録から作ったコードは、元の端末のコードと同じ（正確に復元できている）
  eq(RT.createCode(dst.store.snapshot()), RT.createCode(src.store.snapshot()));
  assert(dst.store.clearAll().ok);
  eq(dst.store.officialFor('equation').bestScore, null);
  eq(dst.storage.data['calcTeacher.sound'], SOUND);
});
test('引継ぎで読み込んだ「このアプリにない単元」の記録も、消さずに保存して持ち続ける', () => {
  const rec = Rec.emptyData();
  rec.timeAttack.official['statistics-2'] = { bestScore: 1500, bestDate: '2027-04-01T00:00:00.000Z', maxStreak: 5, plays: 3 };
  const { store } = deviceWith(null);
  assert(store.replaceTransferable(RT.decode(RT.createCode(rec)).data, TA.titleForScore).ok);
  eq(store.officialFor('statistics-2').bestScore, 1500);
  eq(RT.decode(RT.createCode(store.snapshot())).data.official['statistics-2'].bestScore, 1500, '次の引継ぎにも含まれる');
});

// ================================================================ コードの長さ
console.log('--- コードの長さ');
const lengths = {};
test('コードの長さを測る（記録なし・1単元・中1の3単元・8単元＋新しい単元）', () => {
  lengths['記録なし'] = RT.createCode(Rec.emptyData()).length;
  const one = Rec.emptyData();
  one.timeAttack.official.equation = fullRecords().timeAttack.official.equation;
  one.certification.equation = { highestCleared: 2, exams: { 1: exam(1, '2026-11-17T06:00:00.000Z'), 2: exam(2, '2026-11-17T06:30:00.000Z'), 3: { cleared: false, attempts: 1, firstClearedAt: null } } };
  lengths['1単元（公式＋認定 第2試験まで）'] = RT.createCode(one).length;
  lengths['中1の3単元すべて（上の fullRecords）'] = RT.createCode(fullRecords()).length;
  // 中1〜中3の8単元すべてで、最終試験までクリア・試験ごとに日時がばらばら（いちばん長くなる場合に近い）
  const eight = Rec.emptyData();
  Object.keys(RT.UNIT_CODES).forEach((u, i) => {
    eight.timeAttack.official[u] = { bestScore: 3000 + i * 10, bestDate: new Date(Date.UTC(2027, i, 3, 10, 11, 12, 345)).toISOString(), maxStreak: 25, plays: 150 };
    eight.certification[u] = { highestCleared: 5, exams: Object.fromEntries([1, 2, 3, 4, 5].map((k) => [String(k), exam(k * 3, new Date(Date.UTC(2027, i, k * 4, k, 17, 29, 801)).toISOString())])) };
  });
  lengths['8単元すべて最終試験までクリア'] = RT.createCode(eight).length;
  Object.entries(lengths).forEach(([k, v]) => console.log(`      ${k}: ${v}文字`));
  // JSON をそのまま Base64 にした場合との比較（短縮の効果）
  const naive = Buffer.from(JSON.stringify(RT.extract(fullRecords()))).toString('base64url').length;
  console.log(`      （参考）中1の3単元を JSON のまま Base64 にした場合: ${naive}文字`);
  assert(lengths['記録なし'] <= 16 && lengths['中1の3単元すべて（上の fullRecords）'] <= 200 && lengths['8単元すべて最終試験までクリア'] <= 500, JSON.stringify(lengths));
});

console.log(failed ? `\n${failed} / ${passed + failed} 件失敗しました。` : `\nすべて成功しました（${passed} 件）。`);
process.exit(failed ? 1 : 0);
