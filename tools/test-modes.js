#!/usr/bin/env node
/*
 * 第3段階のロジックの自動テスト（タイムアタック・認定試験・記録）。
 * 偽の時計・偽の保存場所を使うので、60秒待ったりブラウザを開いたりせずに確かめられる。
 *   node tools/test-modes.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('../js/game.js');
const TA = require('../js/time-attack.js');
const C = require('../js/certification.js');
const Rec = require('../js/records.js');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
const questions = manifest.files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f.file), 'utf8')).questions);
const UNITS = ['positive-negative', 'expressions', 'equation'];

let failed = 0;
let count = 0;
function test(label, fn) {
  count++;
  try { fn(); console.log(`OK  ${label}`); } catch (e) { failed++; console.log(`NG  ${label}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} 期待値 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`); }
function throws(fn, type, msg) {
  try { fn(); } catch (e) { if (!type || e instanceof type) return e; throw new Error(`${msg || ''} 想定外の例外 ${e.constructor.name}: ${e.message}`); }
  throw new Error(`${msg || ''} 例外が発生しませんでした`);
}
const correctChoice = (q) => (q.errorLine === null ? { type: 'allCorrect' } : { type: 'line', index: q.errorLine });
const wrongChoice = (q) => (q.errorLine === null ? { type: 'line', index: 1 } : q.errorLine !== 1 ? { type: 'line', index: 1 } : q.answerLines.length > 2 ? { type: 'line', index: 2 } : { type: 'allCorrect' });

// 偽の時計
function makeClock(t0 = 1000) {
  let t = t0;
  return { now: () => t, advance: (ms) => { t += ms; return t; }, set: (v) => { t = v; } };
}
function taSession(config, seed = 1, clock = makeClock()) {
  return { s: new TA.TimeAttackSession(questions, config, { rng: G.createRng(seed), now: clock.now }), clock };
}

console.log(`問題データ ${questions.length} 問でテストします\n`);

// ================================================================ タイムアタック
console.log('--- タイムアタック');
test('公式：カテゴリ・難易度はすべてに固定（カスタムの指定を渡しても無視）', () => {
  const { s } = taSession({ mode: 'official', unit: 'equation', categories: ['移項'], difficulties: [1] });
  eq(s.criteria.categories, null);
  eq(s.criteria.difficulties.join(), '1,2,3,4');
  eq(s.pool.length, questions.filter((q) => q.unit === 'equation').length);
  eq(s.isOfficial, true);
});
test('カスタム：選んだカテゴリ・難易度の問題だけが出る。全部選んでも公式にはならない', () => {
  const { s, clock } = taSession({ mode: 'custom', unit: 'positive-negative', categories: ['累乗', '加法・減法'], difficulties: [1, 2] });
  s.start();
  for (let i = 0; i < 30; i++) {
    assert(['累乗', '加法・減法'].includes(s.current.category) && [1, 2].includes(s.current.difficulty), `${s.current.id} が条件外`);
    s.answer(correctChoice(s.current)); clock.advance(500); s.advance();
  }
  const all = taSession({ mode: 'custom', unit: 'positive-negative', categories: ['加法・減法', '乗法・除法', '累乗', '四則混合'], difficulties: [1, 2, 3, 4] }).s;
  eq(all.isOfficial, false, '全部選んだカスタム');
  throws(() => new TA.TimeAttackSession(questions, { mode: 'unknown', unit: 'equation' }), TypeError, '不明なモード');
});
test('開始カウントダウン中（start 前）は時間が減らず、回答もできない', () => {
  const { s, clock } = taSession({ mode: 'official', unit: 'expressions' });
  clock.advance(3000); // 3・2・1 の間
  eq(s.remaining(), TA.CONFIG.durationMs);
  eq(s.answer({ type: 'allCorrect' }), null);
  s.start();
  clock.advance(1000);
  eq(s.remaining(), TA.CONFIG.durationMs - 1000);
});
test('90秒で制限時間が終わる（経過時間で判定。タイマーの回数には頼らない）。演出中に0秒になったら次の問題に進まない', () => {
  eq(TA.CONFIG.durationMs, 90 * 1000);
  const { s, clock } = taSession({ mode: 'official', unit: 'equation' });
  s.start();
  clock.advance(89999);
  eq(s.isTimeUp(), false);
  clock.advance(1);
  eq(s.isTimeUp(), true);
  eq(s.remaining(), 0);
  s.answer(correctChoice(s.current)); // ロスタイム中の回答
  eq(s.advance(), false, 'タイムアップ後は次の問題に進まない');
  eq(s.ended, true);
  // バックグラウンドで長く止まっていても、戻ったときに時間切れになっている
  const b = taSession({ mode: 'official', unit: 'equation' });
  b.s.start(); b.clock.advance(5 * 60 * 1000);
  eq(b.s.isTimeUp(), true);
  eq(b.s.remaining(), 0);
});
test('行のタップ・「全部正しい！」は即時判定される', () => {
  const { s } = taSession({ mode: 'official', unit: 'positive-negative' }, 3);
  s.start();
  const q = s.current;
  const r = s.answer(correctChoice(q));
  assert(r && r.correct === true && r.question === q, '即時判定されない');
  eq(s.results.length, 1);
});
test('二重回答できない（演出中・次の問題を出すまでは受け付けない）', () => {
  const { s, clock } = taSession({ mode: 'official', unit: 'positive-negative' });
  s.start();
  const q = s.current;
  s.answer(correctChoice(q));
  eq(s.answer(correctChoice(q)), null, '同じ問題への2回目');
  eq(s.answer({ type: 'allCorrect' }), null, '演出中の別の回答');
  eq(s.results.length, 1);
  eq(s.score, 250); // 正負の数の基礎点
  clock.advance(300); s.advance();
  assert(s.answer(correctChoice(s.current)), '次の問題に回答できない');
});
test('得点（文字式・基礎点250）：1問目250点・2問目260点 … 6問目以降300点。不正解は100点減点で連続が切れ、次は250点から', () => {
  eq([0, 1, 2, 3, 5, 6, 7, 12, 50].map(TA.pointsForStreak).join(), '0,200,210,220,240,250,250,250,250', '単元を指定しないとき（基礎点200）');
  const { s, clock } = taSession({ mode: 'official', unit: 'expressions' }, 5);
  s.start();
  const pattern = [true, true, true, true, true, true, false, true, true, true];
  const pts = [];
  pattern.forEach((ok) => {
    const r = s.answer(ok ? correctChoice(s.current) : wrongChoice(s.current));
    pts.push(r.points);
    clock.advance(1000); s.advance();
  });
  eq(pts.join(), '250,260,270,280,290,300,-100,250,260,270');
  eq(s.score, 2330);
  const sum = s.summary();
  eq(sum.correct, 9); eq(sum.wrong, 1); eq(sum.maxStreak, 6); eq(sum.rate, 90); eq(sum.answered, 10);
});
test('得点：単元ごとの基礎点＋連続正解ボーナス（0,10,…,50。6問目以降は+50）。公式・カスタムとも同じ', () => {
  const BASE = {
    'positive-negative': 250, expressions: 250, equation: 250, polynomials: 300,
    'simultaneous-equations': 400, 'expansion-factorization': 250, 'square-roots': 200, 'quadratic-equations': 250,
  };
  eq(JSON.stringify(TA.SCORE_RULES.baseByUnit), JSON.stringify(BASE), '基礎点の表');
  eq(Object.keys(BASE).sort().join(), manifest.files.map((f) => f.unit).sort().join(), '全単元に基礎点がある');
  eq(TA.SCORE_RULES.maxBonus, 50);
  eq([0, 1, 2, 3, 5, 6, 7, 11, 50].map(TA.streakBonus).join(), '0,0,10,20,40,50,50,50,50', 'ボーナス（6問目以降は50点）');
  Object.entries(BASE).forEach(([u, b]) => {
    eq([1, 2, 5, 6, 7, 12].map((n) => TA.pointsForStreak(n, u)).join(), [b, b + 10, b + 40, b + 50, b + 50, b + 50].join(), u);
    eq(TA.pointsForStreak(0, u), 0, `${u} 不正解`);
  });
  eq(TA.pointsForStreak(1, 'new-unit'), 200, '基礎点表にない単元は200点');
  // プレイ：連立方程式（基礎点400）と平方根（基礎点200）。不正解で連続が切れ、次はボーナス0から
  for (const [mode, unit, b] of [['official', 'simultaneous-equations', 400], ['custom', 'square-roots', 200]]) {
    const { s, clock } = taSession({ mode, unit }, 3);
    s.start();
    const pts = [];
    [...Array(13).fill(true), false, true].forEach((ok) => {
      const r = s.answer(ok ? correctChoice(s.current) : wrongChoice(s.current));
      pts.push(r.points);
      clock.advance(500); s.advance();
    });
    const expected = [...Array.from({ length: 13 }, (_, i) => b + Math.min(50, i * 10)), -100, b];
    eq(pts.join(), expected.join(), `${unit} の得点`);
    eq(s.score, expected.reduce((a, x) => a + x, 0), `${unit} の合計`);
  }
});
test('不正解は100点の減点。スコアは0点より下にならない（0点のときは0点のまま、100点未満なら0点まで）', () => {
  eq(TA.SCORE_RULES.missPenalty, 100);
  const { s, clock } = taSession({ mode: 'custom', unit: 'square-roots' }, 2);
  s.maxMisses = 99;
  s.start();
  const step = (ok) => { const r = s.answer(ok ? correctChoice(s.current) : wrongChoice(s.current)); clock.advance(300); s.advance(); return r; };
  const r0 = step(false);
  eq(JSON.stringify([r0.points, s.score]), JSON.stringify([0, 0]), '0点のときの不正解');
  step(true); // 平方根の基礎点 200点
  const r1 = step(false);
  eq(JSON.stringify([r1.points, s.score]), JSON.stringify([-100, 100]), '200点から100点減点');
  s.score = 50; // 100点未満のとき（基礎点を変えた場合などに備えて確かめる）
  const r2 = step(false);
  eq(JSON.stringify([r2.points, s.score]), JSON.stringify([-50, 0]), '50点から（0点より下にしない）');
  eq(s.results.reduce((a, r) => a + r.points, 0), s.score + 50, '結果の点数の合計（途中で50点にした分をのぞく）とスコアが一致');
  eq(s.summary().score, 0);
});
test('全問題を出し終えたら並べ直して続ける。1巡の中では重複せず、巡の切れ目でも同じ問題が続かない', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const { s, clock } = taSession({ mode: 'custom', unit: 'equation', categories: ['移項', 'かっこを含む方程式'] }, seed);
    const n = s.pool.length;
    s.start();
    const seen = [s.current.id];
    for (let i = 1; i < n * 3; i++) { s.answer(correctChoice(s.current)); clock.advance(100); s.advance(); seen.push(s.current.id); }
    for (let k = 0; k < 3; k++) eq(new Set(seen.slice(k * n, (k + 1) * n)).size, n, `seed=${seed} ${k + 1}巡目に重複`);
    for (let i = 1; i < seen.length; i++) assert(seen[i] !== seen[i - 1], `seed=${seed} 同じ問題が続いた（${seen[i]}）`);
  }
});
test('対象が1問だけのカスタムでは、同じ問題を続けて出してよい', () => {
  // 問題データには1問だけの条件がないので、条件に合う問題を1問だけにしたデータで確かめる
  const crit = { mode: 'custom', unit: 'expressions', categories: ['文字式の表し方'], difficulties: [1] };
  const one = questions.find((q) => q.unit === 'expressions' && q.category === '文字式の表し方' && q.difficulty === 1);
  const clock = makeClock();
  const s = new TA.TimeAttackSession([one], crit, { rng: G.createRng(1), now: clock.now });
  eq(s.pool.length, 1);
  s.start();
  const id = s.current.id;
  s.answer(correctChoice(s.current)); clock.advance(100); s.advance();
  eq(s.current.id, id);
});
test('時間切れで回答できなかった問題は unanswered に残る（得点・正解数・回答数には入れない）。回答した・ゲームオーバー・途中でやめたときは残さない', () => {
  // 時間切れ（ロスタイムも過ぎた）：表示中の問題が残る
  const a = taSession({ mode: 'custom', unit: 'equation' }, 3);
  a.s.start();
  const r1 = a.s.answer(correctChoice(a.s.current)); a.clock.advance(500); a.s.advance();
  const shown = a.s.current;
  a.clock.advance(TA.CONFIG.durationMs + TA.CONFIG.lossTimeMs);
  eq(a.s.answer(correctChoice(shown)), null, 'ロスタイムのあとに回答できた');
  eq(a.s.ended, true);
  assert(a.s.unanswered && a.s.unanswered.question === shown, '時間切れの問題が残らない');
  eq(JSON.stringify(a.s.unanswered.expected), JSON.stringify(correctChoice(shown)), '正しい選択');
  eq(a.s.results.length, 1); eq(a.s.results[0], r1);
  const sum = a.s.summary();
  eq(JSON.stringify([sum.answered, sum.correct, sum.wrong, sum.score]), JSON.stringify([1, 1, 0, r1.points]), '集計に時間切れの問題が入った');
  // ロスタイム中に回答した：残さない
  const b = taSession({ mode: 'custom', unit: 'equation' }, 4);
  b.s.start(); b.clock.advance(TA.CONFIG.durationMs + 2000);
  b.s.answer(correctChoice(b.s.current)); b.clock.advance(600); b.s.advance();
  eq(b.s.ended, true); eq(b.s.unanswered, null, '回答した問題が時間切れとして残った');
  // 回答の演出中に時間切れ：残さない
  const c = taSession({ mode: 'custom', unit: 'equation' }, 5);
  c.s.start(); c.clock.advance(TA.CONFIG.durationMs - 100);
  c.s.answer(correctChoice(c.s.current)); c.clock.advance(600); c.s.advance();
  eq(c.s.ended, true); eq(c.s.unanswered, null, '演出中の時間切れで残った');
  // ゲームオーバー：残さない
  const d = taSession({ mode: 'official', unit: 'equation' }, 6);
  d.s.start();
  for (let i = 0; i < 3; i++) { d.s.answer(wrongChoice(d.s.current)); d.clock.advance(500); d.s.advance(); }
  eq(d.s.endReason, 'gameover'); eq(d.s.unanswered, null, 'ゲームオーバーで残った');
  // 途中でやめた（時間が残っている）：残さない
  const e = taSession({ mode: 'custom', unit: 'equation' }, 7);
  e.s.start(); e.clock.advance(10000); e.s.finish();
  eq(e.s.unanswered, null, '途中でやめたのに残った');
});
test('ロスタイム：0秒の時点で表示中の問題は、さらに5秒まで回答できる（正解・不正解とも記録され、そのあと終了）。表示は0秒のまま', () => {
  eq(TA.CONFIG.lossTimeMs, 5 * 1000);
  [true, false].forEach((ok) => {
    const { s, clock } = taSession({ mode: 'official', unit: 'equation' });
    s.start();
    clock.advance(TA.CONFIG.durationMs + 3000); // 残り0秒から3秒後
    eq(s.inLossTime(), true, 'ロスタイム中');
    eq(s.isLossTimeOver(), false);
    eq(s.remaining(), 0, '表示は0秒のまま');
    const r = s.answer(ok ? correctChoice(s.current) : wrongChoice(s.current));
    assert(r && r.correct === ok && r.lossTime, 'ロスタイム中の回答が無効になった');
    eq(s.score, ok ? TA.basePointsFor(s.criteria.unit) : 0, 'ロスタイム中の正解にも得点がつく');
    eq(s.advance(), false, 'ロスタイムの回答のあと次の問題に進んだ');
    eq(s.ended, true);
    eq(s.summary().gameOver, false, '時間切れとして終わる');
  });
  // 5秒ちょうどまでは有効、過ぎたら無効で終了
  const e = taSession({ mode: 'official', unit: 'equation' });
  e.s.start(); e.clock.advance(TA.CONFIG.durationMs + TA.CONFIG.lossTimeMs);
  assert(e.s.answer(correctChoice(e.s.current)), 'ロスタイム5秒ちょうどの回答が無効になった');
  const t = taSession({ mode: 'official', unit: 'equation' });
  t.s.start();
  t.clock.advance(TA.CONFIG.durationMs + TA.CONFIG.lossTimeMs + 1);
  eq(t.s.isLossTimeOver(), true);
  eq(t.s.answer(correctChoice(t.s.current)), null, 'ロスタイムを過ぎた回答が有効になった');
  eq(t.s.ended, true);
  eq(t.s.results.length, 0);
  // 演出中に0秒になったときは、演出のあと次の問題を出さずに終わる（ロスタイムは表示中の問題だけ）
  const f = taSession({ mode: 'official', unit: 'equation' });
  f.s.start(); f.clock.advance(TA.CONFIG.durationMs - 100);
  f.s.answer(correctChoice(f.s.current));
  f.clock.advance(TA.CONFIG.feedbackMs);
  eq(f.s.advance(), false);
  eq(f.s.ended, true);
});
test('正誤の演出の時間は0.6秒（以前の2倍）', () => eq(TA.CONFIG.feedbackMs, 600));
test('3回ミスした時点でゲームオーバー（時間が残っていても強制終了）。2回まではつづけられる', () => {
  eq(TA.CONFIG.maxMisses, 3);
  const { s, clock } = taSession({ mode: 'official', unit: 'expressions' }, 7);
  s.start();
  const plan = [false, true, true, false, true];
  plan.forEach((ok) => { s.answer(ok ? correctChoice(s.current) : wrongChoice(s.current)); clock.advance(500); eq(s.advance(), true, '2回目までのミスで終わった'); });
  eq(s.misses, 2); eq(s.livesLeft, 1); eq(s.ended, false);
  const r = s.answer(wrongChoice(s.current));
  eq(r.misses, 3);
  clock.advance(300);
  eq(s.advance(), false, '3回目のミスのあとに次の問題へ進んだ');
  eq(s.ended, true); eq(s.endReason, 'gameover'); eq(s.isGameOver, true);
  assert(s.remaining() > 0, '残り時間があるはず');
  eq(s.answer(correctChoice(s.current)), null, 'ゲームオーバー後に回答できた');
  const sum = s.summary();
  eq(sum.gameOver, true); eq(sum.misses, 3); eq(sum.wrong, 3); eq(sum.correct, 3);
  // 1問目の不正解は0点のとき（減点なし）、そのあとの不正解は100点ずつ減点
  const b = TA.basePointsFor(s.criteria.unit);
  eq(s.score, 0 + b + (b + 10) - 100 + b - 100, 'ゲームオーバーまでの得点はそのまま残る');
});
test('時間切れで終わったときは endReason が timeup（ゲームオーバーではない）', () => {
  const { s, clock } = taSession({ mode: 'official', unit: 'equation' });
  s.start();
  s.answer(wrongChoice(s.current)); clock.advance(300); s.advance();
  clock.advance(TA.CONFIG.durationMs);
  s.answer(correctChoice(s.current));
  eq(s.advance(), false);
  eq(s.endReason, 'timeup'); eq(s.summary().gameOver, false);
});
test('問題データ（errorLine など）を書き換えない', () => {
  const { s, clock } = taSession({ mode: 'official', unit: 'positive-negative' });
  const before = JSON.stringify(questions);
  s.start();
  for (let i = 0; i < 20; i++) { s.answer(i % 2 ? wrongChoice(s.current) : correctChoice(s.current)); clock.advance(100); s.advance(); }
  eq(JSON.stringify(questions), before);
});
test('称号：最高スコアに応じて10段階で決まる（境目の点数ちょうどで上がる）', () => {
  const expected = [
    [0, 1, '🔰見習い添削係'], [299, 1, '🔰見習い添削係'],
    [300, 2, '✏️かけだしティーチャー'], [599, 2, '✏️かけだしティーチャー'],
    [600, 3, '🔍ミス発見上手'], [899, 3, '🔍ミス発見上手'],
    [900, 4, '📘一人前ティーチャー'], [1199, 4, '📘一人前ティーチャー'],
    [1200, 5, '⚡スピードティーチャー'], [1499, 5, '⚡スピードティーチャー'],
    [1500, 6, '🏅ベテラン添削先生'], [1799, 6, '🏅ベテラン添削先生'],
    [1800, 7, '💥スーパー添削先生'], [2199, 7, '💥スーパー添削先生'],
    [2200, 8, '🎯赤ペンマスター'], [2599, 8, '🎯赤ペンマスター'],
    [2600, 9, '🌟伝説のティーチャー'], [2999, 9, '🌟伝説のティーチャー'],
    [3000, 10, '👑神の赤ペン'], [9999, 10, '👑神の赤ペン'],
  ];
  expected.forEach(([score, rank, label]) => {
    eq(TA.titleForScore(score), label, `${score}点`);
    eq(TA.titleInfoForScore(score).rank, rank, `${score}点のランク`);
  });
  eq(TA.TITLES.length, 10);
});

// ================================================================ 認定試験
console.log('--- 認定試験');
test('試験の定義：問題数・必要正解数・難易度の配分（合計が最大問題数）', () => {
  eq(C.EXAMS.map((e) => `${e.maxQuestions}/${e.requiredCorrect}`).join(), '5/3,6/4,7/5,8/6,10/10');
  C.EXAMS.forEach((e) => eq(Object.values(e.distribution).reduce((a, b) => a + b, 0), e.maxQuestions, e.name));
});
test('最初は第1試験だけ挑戦できる。クリアすると次が解放される（クリア済みはいつでも再挑戦できる）', () => {
  eq([1, 2, 3, 4, 5].map((id) => C.isUnlocked(0, id)).join(), 'true,false,false,false,false');
  eq([1, 2, 3, 4, 5].map((id) => C.isUnlocked(1, id)).join(), 'true,true,false,false,false');
  eq([1, 2, 3, 4, 5].map((id) => C.isUnlocked(4, id)).join(), 'true,true,true,true,true');
});
test('合否の判定式：第1試験は3問正解で合格／第1〜第4試験は3問不正解で不合格／最終試験は1問不正解で不合格', () => {
  const e1 = C.examById(1);
  eq(C.judge(e1, 3, 0), 'pass'); eq(C.judge(e1, 2, 2), null); eq(C.judge(e1, 2, 3), 'fail');
  [1, 2, 3, 4].forEach((id) => { eq(C.failAt(C.examById(id)), 3, `第${id}試験`); eq(C.judge(C.examById(id), 0, 2), null); eq(C.judge(C.examById(id), 0, 3), 'fail'); });
  const f = C.examById(5);
  eq(C.failAt(f), 1); eq(C.judge(f, 9, 0), null); eq(C.judge(f, 0, 1), 'fail'); eq(C.judge(f, 10, 0), 'pass');
});
function playExam(unit, examId, pattern, seed = 1) {
  const s = new C.CertificationSession(questions, { unit, examId }, G.createRng(seed));
  let i = 0;
  while (!s.finished) {
    const q = s.current;
    const ok = pattern[i] !== false;
    const choice = ok ? correctChoice(q) : wrongChoice(q);
    if (choice.type === 'allCorrect') s.selectAllCorrect(); else s.selectLine(choice.index);
    s.submit();
    i++;
    s.next();
  }
  return s;
}
test('合格が決まった時点で終了し、残りの問題は出題しない（第1試験：最初の3問に正解）', () => {
  const s = playExam('positive-negative', 1, [true, true, true, true, true]);
  eq(s.outcome, 'pass'); eq(s.results.length, 3); eq(s.finished, true);
});
test('不合格が決まった時点で終了する（第2試験：3問不正解／最終試験：1問不正解）', () => {
  const s = playExam('expressions', 2, [false, true, false, false, true, true]);
  eq(s.outcome, 'fail'); eq(s.results.length, 4);
  const f = playExam('equation', 5, [true, false, true]);
  eq(f.outcome, 'fail'); eq(f.results.length, 2);
});
test('合否が決まるまでは出題が続く（第1試験：正解2・不正解2なら5問目へ）', () => {
  const s = playExam('equation', 1, [true, false, true, false, true]);
  eq(s.results.length, 5); eq(s.outcome, 'pass');
});
test('難易度別の出題数が正しく、1回の試験で問題が重複しない（全単元・全試験・乱数200通り）', () => {
  UNITS.forEach((unit) => C.EXAMS.forEach((exam) => {
    for (let seed = 1; seed <= 200; seed++) {
      const qs = C.buildExamQuestions(questions, unit, exam, G.createRng(seed));
      eq(qs.length, exam.maxQuestions);
      eq(new Set(qs.map((q) => q.id)).size, qs.length, `${unit} ${exam.name} seed=${seed} 重複`);
      assert(qs.every((q) => q.unit === unit), '別の単元の問題');
      G.DIFFICULTIES.forEach((d) => eq(qs.filter((q) => q.difficulty === d).length, exam.distribution[d] || 0, `${unit} ${exam.name} ★${d}`));
    }
  }));
});
test('出題順は難易度順に固まらない（第4試験の1問目の難易度がばらける）', () => {
  const first = new Set();
  for (let seed = 1; seed <= 100; seed++) first.add(C.buildExamQuestions(questions, 'equation', C.examById(4), G.createRng(seed))[0].difficulty);
  assert(first.size >= 3, `1問目の難易度の種類が少ない（${[...first]}）`);
});
test('カテゴリが偏らないように選ぶ（同じ難易度で選べるカテゴリが複数あれば散らす）', () => {
  const fake = [];
  ['A', 'B'].forEach((cat) => { for (let i = 0; i < 10; i++) fake.push({ ...questions[0], id: `X-${cat}-${i}`, unit: 'u', category: cat, difficulty: 1 }); });
  for (let seed = 1; seed <= 50; seed++) {
    const qs = C.buildExamQuestions(fake, 'u', C.examById(1), G.createRng(seed));
    const a = qs.filter((q) => q.category === 'A').length;
    assert(a === 2 || a === 3, `seed=${seed} カテゴリAが${a}問`);
  }
});
test('問題が足りないときは試験を始められない（重複や低い難易度で埋めない）。足りない数をメッセージで伝える', () => {
  const lacking = questions.filter((q) => !(q.unit === 'equation' && q.difficulty === 4 && q.id !== 'J1-EQ-0010'));
  const av = C.checkAvailability(lacking, 'equation', C.examById(5));
  eq(av.ok, false);
  eq(JSON.stringify(av.shortages), JSON.stringify([{ difficulty: 4, need: 4, have: 1, missing: 3 }]));
  eq(C.shortageMessage(av.shortages), '★★★★の問題が3問不足しているため、現在この試験には挑戦できません。');
  throws(() => C.buildExamQuestions(lacking, 'equation', C.examById(5)), C.ShortageError);
  throws(() => new C.CertificationSession(lacking, { unit: 'equation', examId: 5 }), C.ShortageError);
  eq(C.checkAvailability(lacking, 'equation', C.examById(3)).ok, true, '★★★★を使わない試験は受けられる');
});
test('現在の問題データで、全単元の全試験に必要な問題がそろっている', () => {
  UNITS.forEach((unit) => C.EXAMS.forEach((exam) => eq(C.checkAvailability(questions, unit, exam).ok, true, `${unit} ${exam.name}`)));
});
test('試験ではヒントを使えない', () => {
  const s = new C.CertificationSession(questions, { unit: 'equation', examId: 1 }, G.createRng(2));
  eq(s.toggleHint(), false);
  eq(s.hintOpen, false);
});
test('ランク：最高クリア試験で決まる（未認定〜マスター）', () => {
  eq([0, 1, 2, 3, 4, 5].map((n) => C.rankFor(n).name).join(),
    'ティーチャー見習い,新人ティーチャー,一人前ティーチャー,ベテランティーチャー,エキスパートティーチャー,マスターティーチャー');
});

// ================================================================ 記録
console.log('--- 記録');
function makeStorage(initial = {}, opts = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => { if (opts.failGet) throw new Error('使えない'); return k in data ? data[k] : null; },
    setItem: (k, v) => { if (opts.quota) { const e = new Error('容量'); e.name = 'QuotaExceededError'; throw e; } data[k] = String(v); },
  };
}
const fixedNow = () => new Date('2026-11-21T10:00:00Z');
test('公式：最高スコアは上回ったときだけ更新。プレイ回数・最大連続・称号も記録', () => {
  const st = makeStorage();
  const r = Rec.createRecordStore({ storage: st, now: fixedNow });
  const a = r.recordOfficial('equation', { score: 800, maxStreak: 4 }, TA.titleForScore);
  eq(a.isBest, true); eq(a.firstPlay, true);
  const b = r.recordOfficial('equation', { score: 600, maxStreak: 7 }, TA.titleForScore);
  eq(b.isBest, false);
  const o = r.officialFor('equation');
  eq(o.bestScore, 800); eq(o.plays, 2); eq(o.maxStreak, 7); eq(o.title, '🔍ミス発見上手'); eq(o.bestDate, '2026-11-21T10:00:00.000Z');
  const c = r.recordOfficial('equation', { score: 1200, maxStreak: 2 }, TA.titleForScore);
  eq(c.isBest, true); eq(r.officialFor('equation').title, '⚡スピードティーチャー');
  eq(r.officialFor('expressions').bestScore, null, '単元ごとに独立');
});
test('カスタム：履歴は新しい順で20件まで（21件目以降は古いものから消える）。公式の記録は変わらない', () => {
  const r = Rec.createRecordStore({ storage: makeStorage(), now: fixedNow });
  for (let i = 1; i <= 25; i++) r.addCustom({ unit: 'equation', categories: ['移項'], difficulties: [1, 2], score: i * 10, correct: i, wrong: 0, maxStreak: i });
  const h = r.customHistory();
  eq(h.length, 20);
  eq(h[0].score, 250, 'いちばん新しい');
  eq(h[19].score, 60, 'いちばん古い（1〜5回目は消えている）');
  eq(h[0].categories.join(), '移項');
  eq(r.officialFor('equation').bestScore, null, 'カスタムで公式記録が変わった');
});
test('認定：合格で記録・初クリアの判定・昇格。不合格でもランクは下がらない。単元ごとに独立', () => {
  const r = Rec.createRecordStore({ storage: makeStorage(), now: fixedNow });
  eq(r.recordExam('positive-negative', 1, true).firstClear, true);
  r.recordExam('positive-negative', 2, true);
  const third = r.recordExam('positive-negative', 3, true);
  eq(third.rankUp, true); eq(third.highestCleared, 3);
  const again = r.recordExam('positive-negative', 1, true);
  eq(again.firstClear, false, '2回目のクリア'); eq(again.rankUp, false);
  const fail = r.recordExam('positive-negative', 2, false);
  eq(fail.highestCleared, 3, '不合格で下がった');
  const c = r.certFor('positive-negative');
  eq(c.exams['2'].cleared, true); eq(c.exams['2'].attempts, 2); eq(c.exams['1'].attempts, 2); eq(c.exams['1'].firstClearedAt, '2026-11-21T10:00:00.000Z');
  eq(r.certFor('expressions').highestCleared, 0, '別の単元に影響した');
});
test('保存されたデータは、作り直しても（再読み込みしても）読み込める', () => {
  const st = makeStorage();
  const a = Rec.createRecordStore({ storage: st, now: fixedNow });
  a.recordOfficial('equation', { score: 900, maxStreak: 5 }, TA.titleForScore);
  a.recordExam('equation', 1, true);
  a.addCustom({ unit: 'equation', categories: null, difficulties: [1], score: 100, correct: 1, wrong: 0, maxStreak: 1 });
  const b = Rec.createRecordStore({ storage: st, now: fixedNow });
  eq(b.officialFor('equation').bestScore, 900); eq(b.certFor('equation').highestCleared, 1); eq(b.customHistory().length, 1);
  eq(JSON.parse(st.data[Rec.STORAGE_KEY]).version, Rec.VERSION);
  assert(!('calcTeacher.sound' in st.data), '効果音の設定のキーにさわった');
});
test('保存データが壊れている：元の文字列を退避して、空の記録で続ける（消さない）', () => {
  const st = makeStorage({ [Rec.STORAGE_KEY]: '{こわれた', 'calcTeacher.sound': '{"enabled":false,"volume":30}' });
  const r = Rec.createRecordStore({ storage: st, now: fixedNow });
  eq(r.status.recovered, true);
  eq(st.data[Rec.BACKUP_KEY], '{こわれた', '退避されていない');
  eq(st.data['calcTeacher.sound'], '{"enabled":false,"volume":30}', '効果音の設定が消えた');
  eq(r.officialFor('equation').bestScore, null);
  r.recordExam('equation', 1, true);
  eq(st.data[Rec.BACKUP_KEY], '{こわれた', '退避したデータが上書きされた');
});
test('古い版（version なし）は読み込める。新しい版のデータは上書きしない', () => {
  const old = makeStorage({ [Rec.STORAGE_KEY]: JSON.stringify({ timeAttack: { official: { equation: { bestScore: 700, plays: 3 } } } }) });
  eq(Rec.createRecordStore({ storage: old }).officialFor('equation').bestScore, 700);
  const raw = JSON.stringify({ version: 99, somethingNew: true });
  const newer = makeStorage({ [Rec.STORAGE_KEY]: raw });
  const r = Rec.createRecordStore({ storage: newer, now: fixedNow });
  eq(r.status.readOnly, true);
  const res = r.recordExam('equation', 1, true);
  eq(res.saved, false);
  eq(newer.data[Rec.STORAGE_KEY], raw, '新しい版のデータを上書きした');
});
test('記録を消す：公式・カスタム・認定がすべて空になり、保存される。新しい版のデータは消さない', () => {
  const st = makeStorage();
  const r = Rec.createRecordStore({ storage: st, now: fixedNow });
  r.recordOfficial('equation', { score: 500, maxStreak: 2 }, TA.titleForScore);
  r.addCustom({ unit: 'equation', score: 100, correct: 1, wrong: 0, maxStreak: 1 });
  r.recordExam('equation', 1, true);
  st.data.other = 'そのまま'; // 記録以外の保存データ（効果音の設定など）
  eq(r.clearAll().ok, true);
  eq(r.officialFor('equation').bestScore, null); eq(r.customHistory().length, 0); eq(r.certFor('equation').highestCleared, 0);
  const again = Rec.createRecordStore({ storage: st });
  eq(again.officialFor('equation').plays, 0, '保存されていない'); eq(again.customHistory().length, 0); eq(again.certFor('equation').highestCleared, 0);
  eq(st.data.other, 'そのまま', '記録以外を消した');
  const raw = JSON.stringify({ version: 99, somethingNew: true });
  const newer = makeStorage({ [Rec.STORAGE_KEY]: raw });
  const res = Rec.createRecordStore({ storage: newer }).clearAll();
  eq(res.ok, false); eq(res.reason, 'newer-version'); eq(newer.data[Rec.STORAGE_KEY], raw);
  eq(Rec.createRecordStore({ storage: makeStorage({}, { quota: true }) }).clearAll().reason, 'save-failed');
});
test('localStorage が使えない・容量がいっぱいでも、例外を出さずに続ける', () => {
  const none = Rec.createRecordStore({ storage: null });
  eq(none.recordOfficial('equation', { score: 100, maxStreak: 1 }, TA.titleForScore).saved, false);
  eq(none.officialFor('equation').bestScore, 100, 'メモリ上では記録される');
  const broken = Rec.createRecordStore({ storage: makeStorage({}, { failGet: true }) });
  eq(broken.status.available, false);
  const full = Rec.createRecordStore({ storage: makeStorage({}, { quota: true }) });
  const r = full.addCustom({ unit: 'equation', difficulties: [1], score: 0, correct: 0, wrong: 0, maxStreak: 0 });
  eq(r.saved, false); eq(full.status.lastError, 'quota');
});

console.log(failed === 0 ? `\nすべて成功しました（${count} 件）。` : `\n${failed} / ${count} 件失敗しました。`);
process.exit(failed === 0 ? 0 : 1);
