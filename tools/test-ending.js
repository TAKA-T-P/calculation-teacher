#!/usr/bin/env node
/*
 * エンディング演出のテスト（条件・表示する内容・「見たか」の保存・曲の再生）。ブラウザ不要。
 *   node tools/test-ending.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../js/ending.js');
const Records = require('../js/records.js');
const TA = require('../js/time-attack.js');
const C = require('../js/certification.js');

const ROOT = path.join(__dirname, '..');
let failed = 0;
let count = 0;
async function test(label, fn) {
  count++;
  try { await fn(); console.log(`OK  ${label}`); } catch (e) { failed++; console.log(`NG  ${label}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ''} 期待値 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`); }
function fakeStorage(init = {}) {
  const map = new Map(Object.entries(init));
  return {
    map, failSet: false,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (this.failSet) throw new Error('quota'); map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/manifest.json'), 'utf8'));
const UNITS = manifest.files.map((f) => ({ unit: f.unit, label: f.label, grade: f.grade }));
const TOP = TA.TITLES[0].minScore;

function recordsWith({ official = {}, cert = {} } = {}) {
  const r = Records.createRecordStore({ storage: fakeStorage(), now: () => new Date('2026-11-20T03:00:00Z') });
  Object.entries(official).forEach(([u, score]) => r.recordOfficial(u, { score, maxStreak: 12 }, TA.titleForScore));
  Object.entries(cert).forEach(([u, highest]) => { for (let id = 1; id <= highest; id++) r.recordExam(u, id, true); });
  return r;
}
const allOfficial = (score = TOP) => Object.fromEntries(UNITS.map((u) => [u.unit, score]));
const allCert = (n = 5) => Object.fromEntries(UNITS.map((u) => [u.unit, n]));

(async () => {
  console.log('--- 条件');
  await test('単元は8つ。最高の称号は「神の赤ペン」、最高のランクは「マスターティーチャー」', () => {
    eq(UNITS.length, 8);
    eq(TA.TITLES[0].name, '神の赤ペン');
    eq(C.RANKS[C.RANKS.length - 1].name, 'マスターティーチャー');
  });
  await test('公式：8単元すべてが最高称号のときだけ条件を満たす（境界値・記録なし・1単元足りない）', () => {
    assert(E.isComplete('official', UNITS, recordsWith({ official: allOfficial(TOP) })), 'ちょうど最高称号の点');
    assert(!E.isComplete('official', UNITS, recordsWith({ official: allOfficial(TOP - 1) })), '1点足りない');
    assert(!E.isComplete('official', UNITS, recordsWith()), '記録なし');
    const seven = allOfficial(TOP); delete seven['square-roots'];
    assert(!E.isComplete('official', UNITS, recordsWith({ official: seven })), '1単元だけ記録なし');
    assert(!E.isComplete('official', [], recordsWith()), '単元がない');
  });
  await test('認定：8単元すべてで最終試験に合格したときだけ条件を満たす', () => {
    assert(E.isComplete('cert', UNITS, recordsWith({ cert: allCert(5) })));
    const almost = allCert(5); almost.equation = 4;
    assert(!E.isComplete('cert', UNITS, recordsWith({ cert: almost })), '1単元が第4試験まで');
    assert(!E.isComplete('cert', UNITS, recordsWith({ official: allOfficial() })), '公式の記録では認定の条件にならない');
    assert(!E.isComplete('official', UNITS, recordsWith({ cert: allCert() })), '認定の記録では公式の条件にならない');
  });
  await test('wouldComplete：ほかの7単元がそろい、その単元だけまだのときだけ true（曲を前もって読み込む判断）', () => {
    const seven = allOfficial(TOP); seven.equation = 2000;
    const r = recordsWith({ official: seven });
    assert(E.wouldComplete('official', UNITS, r, 'equation'));
    assert(!E.wouldComplete('official', UNITS, r, 'expressions'), 'そろっている単元');
    assert(!E.wouldComplete('official', UNITS, recordsWith({ official: allOfficial(TOP) }), 'equation'), 'すでに全部そろっている');
    assert(!E.wouldComplete('official', UNITS, recordsWith(), 'equation'), '記録なし');
    assert(!E.wouldComplete('official', UNITS, r, 'no-such-unit'), '存在しない単元');
  });

  console.log('--- 表示する内容');
  await test('公式：単元の順に8つ。単元名・称号・自己ベスト・最大連続', () => {
    const off = allOfficial(TOP); off.equation = 3450;
    const list = E.entriesFor('official', UNITS, recordsWith({ official: off }));
    eq(list.length, 8);
    eq(list.map((e) => e.unit), UNITS.map((u) => u.unit));
    eq(list[0], { unit: 'positive-negative', label: '中1・正負の数', icon: '👑', title: '神の赤ペン', main: '自己ベスト 3,000点', sub: '最大連続 12問' });
    eq(list[2].main, '自己ベスト 3,450点');
  });
  await test('認定：ランク・最終試験の合格日・挑戦回数の合計', () => {
    const r = recordsWith({ cert: allCert(5) });
    r.recordExam('equation', 5, false); // 合格したあとの不合格も挑戦回数に数える
    const list = E.entriesFor('cert', UNITS, r);
    eq(list.length, 8);
    eq(list[0].icon + list[0].title, '👑マスターティーチャー');
    assert(/^最終試験 合格 2026\/11\/20$/.test(list[0].main), list[0].main);
    eq(list[0].sub, '挑戦 合計5回');
    eq(list[2].sub, '挑戦 合計6回');
  });
  await test('はじめの文・時間割（はじめ2秒＋8単元×2秒＋最後4秒＝22秒。曲は約21.8秒）・製作の表示', () => {
    eq(E.introFor('official', 8).heading, '全8単元 制覇！');
    assert(E.introFor('official', 8).text.includes('神の赤ペン'));
    assert(E.introFor('cert', 8).text.includes('マスターティーチャー'));
    eq(E.TIMELINE.perUnitMs, 2000);
    eq(E.totalMs(8), 22000);
    eq(E.CREDIT, '製作　T.TAKEMOTO / KEC Glows');
    assert(fs.existsSync(path.join(ROOT, E.MUSIC_URL)), `曲のファイルがない: ${E.MUSIC_URL}`);
    const kb = fs.statSync(path.join(ROOT, E.MUSIC_URL)).size / 1024;
    assert(kb < 800, `曲のファイルが大きすぎる: ${Math.round(kb)}KB`);
  });

  console.log('--- 「見たか」の保存');
  await test('最初は見ていない。見たら保存し、読み込み直しても残る（公式と認定は別）', () => {
    const st = fakeStorage();
    const s1 = E.createEndingStore({ storage: st, now: () => new Date('2026-11-24T00:00:00Z') });
    assert(!s1.hasSeen('official') && !s1.hasSeen('cert'));
    const entries = E.entriesFor('official', UNITS, recordsWith({ official: allOfficial() }));
    assert(s1.markSeen('official', entries));
    const s2 = E.createEndingStore({ storage: st });
    assert(s2.hasSeen('official') && !s2.hasSeen('cert'));
    eq(s2.savedEntries('official'), entries);
    eq(s2.snapshot().seen.official.at, '2026-11-24T00:00:00.000Z');
    eq(s2.savedEntries('cert'), null);
    assert(st.map.has('calcTeacher.ending') && !st.map.has('calcTeacher.records'), 'ゲームの記録とは別のキー');
  });
  await test('もう一度見たら、最初に見た日時は残し、記録だけ新しくする', () => {
    const st = fakeStorage();
    let t = new Date('2026-11-24T00:00:00Z');
    const s = E.createEndingStore({ storage: st, now: () => t });
    s.markSeen('cert', [{ unit: 'a', label: 'A', icon: '👑', title: 'x', main: '1', sub: '' }]);
    t = new Date('2026-12-01T00:00:00Z');
    s.markSeen('cert', [{ unit: 'a', label: 'A', icon: '👑', title: 'x', main: '2', sub: '' }]);
    eq(s.snapshot().seen.cert.at, '2026-11-24T00:00:00.000Z');
    eq(s.savedEntries('cert')[0].main, '2');
  });
  await test('壊れたデータ・保存できない・localStorage がない環境でも例外を出さない。clear() で見た記録が消える', () => {
    const broken = E.createEndingStore({ storage: fakeStorage({ 'calcTeacher.ending': '{壊れた' }) });
    assert(!broken.hasSeen('official'));
    const odd = E.createEndingStore({ storage: fakeStorage({ 'calcTeacher.ending': JSON.stringify({ seen: { official: 'x', cert: { entries: [null, { label: 1 }, { label: 'L' }] } } }) }) });
    assert(!odd.hasSeen('official') && odd.hasSeen('cert'));
    eq(odd.savedEntries('cert').length, 1);
    const st = fakeStorage(); st.failSet = true;
    const full = E.createEndingStore({ storage: st });
    eq(full.markSeen('official', []), false);
    assert(full.hasSeen('official'), '保存できなくても、この画面を開いている間は見た扱い');
    const none = E.createEndingStore({ storage: null });
    none.markSeen('official', []);
    assert(none.hasSeen('official'));
    const st2 = fakeStorage();
    const s = E.createEndingStore({ storage: st2 });
    s.markSeen('official', []); s.markSeen('cert', []);
    s.clear();
    assert(!s.hasSeen('official') && !s.hasSeen('cert') && !st2.map.has('calcTeacher.ending'));
  });

  console.log('--- 曲の再生');
  function fakeAudio() {
    const log = [];
    class Ctx {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; log.push('new'); }
      resume() { this.state = 'running'; log.push('resume'); return Promise.resolve(); }
      decodeAudioData(arr) { log.push(`decode:${arr.byteLength}`); return Promise.resolve({ duration: 21.8 }); }
      createBufferSource() { const src = { connect() {}, start() { log.push('start'); }, stop() { log.push('stop'); } }; return src; }
      createGain() { return { connect() {}, gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime(v) { log.push(`ramp:${v}`); } } }; }
    }
    const fetch = (url) => { log.push(`fetch:${url}`); return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); };
    return { Ctx, fetch, log };
  }
  await test('prime() で AudioContext を再開して読み込み、play() で頭から鳴らす。stop() はフェードしてから止める', async () => {
    const a = fakeAudio();
    const p = E.createMusicPlayer({ AudioContextClass: a.Ctx, fetch: a.fetch, getVolume: () => 0.4 });
    eq(a.log, [], '作っただけでは何もしない（起動時に読み込まない）');
    await p.prime();
    eq(a.log, ['new', 'resume', 'fetch:assets/ending/ending.mp3', 'decode:8']);
    assert(await p.play(), '鳴らない');
    assert(p.debug.playing && p.debug.loaded);
    p.stop();
    assert(a.log.includes('ramp:0') && a.log.includes('stop') && !p.debug.playing);
    eq(a.log.filter((x) => x.startsWith('fetch')).length, 1, '2回読み込んだ');
  });
  await test('ストーリーBGM が OFF（音量0）・Web Audio がない・読み込めないときは鳴らさず、例外も出さない', async () => {
    const a = fakeAudio();
    const off = E.createMusicPlayer({ AudioContextClass: a.Ctx, fetch: a.fetch, getVolume: () => 0 });
    eq(await off.play(), false);
    assert(!a.log.includes('start'));
    eq(await E.createMusicPlayer({ AudioContextClass: null, fetch: a.fetch }).play(), false);
    const bad = E.createMusicPlayer({ AudioContextClass: a.Ctx, fetch: () => Promise.resolve({ ok: false, status: 404 }) });
    eq(await bad.play(), false);
    assert(/404/.test(bad.debug.lastError), bad.debug.lastError);
    const slow = E.createMusicPlayer({ AudioContextClass: a.Ctx, fetch: () => new Promise(() => {}) });
    eq(await slow.play(50), false, '読み込みが間に合わなければ音なしで進む');
  });

  console.log(`\n${count - failed}/${count} 件 OK`);
  if (failed) process.exit(1);
})();
