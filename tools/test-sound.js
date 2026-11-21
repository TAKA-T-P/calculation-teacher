#!/usr/bin/env node
/*
 * 効果音（js/sound.js）の自動テスト。
 * 本物の音は鳴らさず、AudioContext の代わりの「にせもの」を使って、
 * 音の長さ・フェード・ON/OFF・音量・保存・連打の間引き・同時発音数・失敗時の安全性を確かめる。
 *   node tools/test-sound.js
 *
 * 実際に聞こえるか・音量や音色が適切かは、実機で確認する必要がある。
 */
'use strict';
const S = require('../js/sound.js');

let failed = 0;
let count = 0;
function test(label, fn) {
  count++;
  try { fn(); console.log(`OK  ${label}`); } catch (e) { failed++; console.log(`NG  ${label}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} 期待値 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`); }

// ---------------------------------------------------------------- にせものの Web Audio
function makeFakeAudio() {
  const stats = { contexts: 0, oscillators: [], gains: [], disconnects: 0 };
  class Param {
    constructor(v) { this.value = v; this.events = []; }
    setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; }
    linearRampToValueAtTime(v, t) { this.events.push(['linear', v, t]); }
    exponentialRampToValueAtTime(v, t) { if (v <= 0) throw new RangeError('指数ランプに 0 は使えない'); this.events.push(['exp', v, t]); }
    setTargetAtTime(v, t) { this.events.push(['target', v, t]); }
    cancelScheduledValues(t) { this.events.push(['cancel', t]); }
  }
  class Node {
    connect(n) { this.out = n; return n; }
    disconnect() { stats.disconnects++; }
  }
  class FakeContext {
    constructor() {
      stats.contexts++;
      this.currentTime = 0;
      this.state = 'running';
      this.destination = new Node();
    }
    createGain() { const g = new Node(); g.gain = new Param(1); stats.gains.push(g); return g; }
    createOscillator() {
      const o = new Node();
      o.frequency = new Param(440);
      o.type = 'sine';
      o.start = (t) => { o.startAt = t; };
      o.stop = (t) => { o.stopAt = t; };
      stats.oscillators.push(o);
      return o;
    }
    createDynamicsCompressor() {
      const c = new Node();
      ['threshold', 'knee', 'ratio', 'attack', 'release'].forEach((k) => { c[k] = new Param(0); });
      stats.compressor = c;
      return c;
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  return { FakeContext, stats };
}

function makeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

function makeManager(extra = {}) {
  const audio = makeFakeAudio();
  let t = 1000;
  const clock = { advance: (ms) => { t += ms; } };
  const storage = extra.storage || makeStorage();
  const m = S.createSoundManager({ AudioContextClass: audio.FakeContext, storage, now: () => t, ...extra });
  return { m, audio, clock, storage };
}

// ---------------------------------------------------------------- 音の長さ・音色
const SPEC = {
  select: [0.05, 0.12], tap: [0.03, 0.12], submit: [0.1, 0.2], correct: [0.3, 0.6], incorrect: [0.2, 0.4],
  hint: [0.2, 0.4], next: [0.1, 0.2], start: [0.4, 0.7], result: [0.6, 1.0], perfect: [1.0, 1.5],
};
test('すべての効果音の長さが指示書の範囲内', () => {
  Object.entries(SPEC).forEach(([name, [lo, hi]]) => {
    const d = S.recipeDuration(name);
    assert(d >= lo && d <= hi, `${name}: ${d.toFixed(3)} 秒（${lo}〜${hi}）`);
  });
  eq(Object.keys(S.RECIPES).sort().join(), Object.keys(SPEC).sort().join(), '効果音の一覧');
});
test('正解は高く明るい上昇音、不正解は低い音（音色が区別できる）', () => {
  const freqs = (name) => S.RECIPES[name].notes.filter((n) => n.v >= 0.5).map((n) => n.f);
  const c = freqs('correct');
  const w = freqs('incorrect');
  assert(c[c.length - 1] > c[0], '正解音が上昇していない');
  assert(Math.min(...c) > Math.max(...w), '正解音が不正解音より高くない');
  assert(w[w.length - 1] < w[0], '不正解音が下降していない');
});
test('結果発表（通常・全問正解）は和音を含み、全問正解のほうが長く豪華', () => {
  const chord = (name) => { const ts = {}; S.RECIPES[name].notes.forEach((n) => { ts[n.t] = (ts[n.t] || 0) + 1; }); return Math.max(...Object.values(ts)); };
  assert(chord('result') >= 3, '通常の結果音に和音がない');
  assert(chord('perfect') >= 4, 'ファンファーレの和音');
  assert(S.recipeDuration('perfect') > S.recipeDuration('result'), 'ファンファーレのほうが長くない');
});
test('すべての音に、立ち上がりと終わりのフェードがある（クリックノイズ防止）', () => {
  const { m, audio } = makeManager();
  Object.keys(S.RECIPES).forEach((name) => { m.debug.resetThrottle(); m.play(name); });
  // 各音符の音量（発振器のすぐ後ろにつながる GainNode）の変化を調べる
  const envs = audio.stats.oscillators.map((o) => o.out);
  eq(envs.length, Object.values(S.RECIPES).reduce((a, r) => a + r.notes.length, 0), '音符の数');
  assert(envs.length > 0, '音量の変化がない');
  envs.forEach((g) => {
    const ev = g.gain.events;
    assert(ev[0][0] === 'set' && ev[0][1] === 0, '0 から始まっていない');
    const last = ev[ev.length - 1];
    assert(last[0] === 'linear' && last[1] === 0, '0 で終わっていない');
  });
});

// ---------------------------------------------------------------- 設定
test('初期値は ON・音量50%', () => {
  const { m } = makeManager();
  eq(JSON.stringify(m.getSettings()), JSON.stringify({ enabled: true, volume: 50 }));
});
test('[13][14] ON/OFF と音量が保存され、作り直しても（再読み込みしても）維持される', () => {
  const storage = makeStorage();
  const a = makeManager({ storage }).m;
  a.setVolume(30);
  a.setEnabled(false);
  eq(storage.data[S.STORAGE_KEY], JSON.stringify({ enabled: false, volume: 30 }), '保存された内容');
  const b = makeManager({ storage }).m;
  eq(JSON.stringify(b.getSettings()), JSON.stringify({ enabled: false, volume: 30 }), '読み込んだ設定');
});
test('保存内容が壊れていても初期値で動く。音量は 0〜100 に収める', () => {
  eq(JSON.stringify(makeManager({ storage: makeStorage({ [S.STORAGE_KEY]: '{壊れた' }) }).m.getSettings()), JSON.stringify(S.DEFAULT_SETTINGS));
  const { m } = makeManager();
  m.setVolume(150); eq(m.getSettings().volume, 100);
  m.setVolume(-5); eq(m.getSettings().volume, 0);
});
test('[11] OFF のときはどの音も鳴らさない（音を作らない）', () => {
  const { m, audio } = makeManager();
  m.setEnabled(false);
  Object.keys(S.RECIPES).forEach((name) => eq(m.play(name), false, name));
  eq(audio.stats.oscillators.length, 0, '発振器が作られた');
  assert(m.debug.log.every((e) => e.reason === 'off'), '理由が off でない');
});
test('[12] 音量0%は無音。音量を変えると全体の音量が変わる（大きいほど大きい）', () => {
  const { m, audio } = makeManager();
  m.setVolume(0);
  eq(m.play('correct'), false);
  eq(audio.stats.oscillators.length, 0);
  const gains = [10, 30, 50, 80, 100].map((v) => S.volumeToGain(v));
  gains.reduce((a, b) => { assert(b > a, '音量が単調に増えない'); return b; });
  m.setVolume(80);
  eq(m.play('correct'), true);
  eq(m.debug.masterGain, S.volumeToGain(80));
  m.setVolume(20);
  eq(m.debug.masterGain, S.volumeToGain(20), '鳴らしたあとの音量変更');
});
test('OFF にすると、鳴っている音もすぐに止める', () => {
  const { m } = makeManager();
  m.play('perfect');
  eq(m.debug.activeVoices, 1);
  m.setEnabled(false);
  eq(m.debug.activeVoices, 0);
});

// ---------------------------------------------------------------- 連打・同時発音・解放
test('[15] 連打は間引く（同じ音を短い間隔で何度押しても1回）', () => {
  const { m, clock } = makeManager();
  let played = 0;
  for (let i = 0; i < 20; i++) { if (m.play('select')) played++; clock.advance(5); }
  eq(played, 2, '100ms の間に select（間隔 50ms）が鳴った回数');
});
test('[15] 同時に鳴る音の数に上限があり、音量を抑える仕組み（コンプレッサー）を通る', () => {
  const { m, clock, audio } = makeManager();
  for (let i = 0; i < 30; i++) { m.play(['select', 'tap', 'next', 'hint', 'submit'][i % 5]); clock.advance(200); }
  assert(m.debug.activeVoices <= S.MAX_VOICES, `同時に ${m.debug.activeVoices} 個鳴っている`);
  assert(audio.stats.compressor, 'コンプレッサーがない');
});
test('長い音（正解・結果など）は前の長い音を止めてから鳴らす（重ならない）', () => {
  const { m, clock } = makeManager();
  m.play('correct');
  clock.advance(300);
  m.play('result');
  eq(m.debug.activeVoices, 1, '長い音が重なっている');
});
test('AudioContext は1つだけ作る。最初に鳴らすまでは作らない', () => {
  const { m, audio, clock } = makeManager();
  eq(audio.stats.contexts, 0, '作成前');
  for (let i = 0; i < 10; i++) { m.play('select'); clock.advance(100); }
  eq(audio.stats.contexts, 1);
});
test('鳴り終わったら接続を外して解放する', () => {
  const { m, audio } = makeManager();
  m.play('correct');
  eq(m.debug.activeVoices, 1);
  audio.stats.oscillators.forEach((o) => o.onended());
  eq(m.debug.activeVoices, 0, '解放されていない');
  assert(audio.stats.disconnects > 0, 'disconnect されていない');
});
test('添削音 → 正解音は、正解音を少し遅らせて自然につなげられる（delay）', () => {
  const { m, audio } = makeManager();
  m.play('submit');
  const n = audio.stats.oscillators.length;
  m.play('correct', { delay: 0.12 });
  const first = audio.stats.oscillators[n];
  assert(first.startAt >= 0.12, `正解音の開始 ${first.startAt}`);
});

// ---------------------------------------------------------------- 失敗しても止まらない
test('[16] AudioContext が使えない・作れない・再生に失敗しても例外を出さない', () => {
  const none = S.createSoundManager({ AudioContextClass: null, storage: makeStorage() });
  eq(none.play('correct'), false);
  none.unlock();
  const broken = S.createSoundManager({ AudioContextClass: function () { throw new Error('作れない'); }, storage: makeStorage() });
  eq(broken.play('correct'), false);
  eq(broken.debug.contextState, 'unavailable');
  const { m } = makeManager();
  m.debug.simulateFailure(true);
  eq(m.play('correct'), false);
  eq(m.debug.log[0].reason, 'error');
  eq(m.play('no-such-sound'), false);
});
test('[16] 保存場所（localStorage）が使えなくても動く', () => {
  const bad = { getItem() { throw new Error('使えない'); }, setItem() { throw new Error('使えない'); } };
  const m = S.createSoundManager({ AudioContextClass: makeFakeAudio().FakeContext, storage: bad });
  eq(m.getSettings().enabled, true);
  m.setVolume(40);
  eq(m.getSettings().volume, 40);
});

console.log(failed === 0 ? `\nすべて成功しました（${count} 件）。` : `\n${failed} / ${count} 件失敗しました。`);
process.exit(failed === 0 ? 0 : 1);
