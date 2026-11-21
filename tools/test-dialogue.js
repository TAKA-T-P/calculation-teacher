#!/usr/bin/env node
/*
 * test-dialogue.js
 * 生徒キャラクターとセリフ（js/character-dialogue.js）の自動テスト。
 *   node tools/test-dialogue.js
 */
'use strict';

const D = require('../js/character-dialogue.js');
const G = require('../js/game.js');

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
function assert(c, msg) { if (!c) throw new Error(msg || '条件を満たさない'); }
const fixed = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };

test('キャラクターは男の子（👦）と女の子（👧）の2人', () => {
  eq(D.CHARACTERS.map((c) => `${c.id}${c.emoji}`).join(), 'boy👦,girl👧');
});

test('セリフの数：タイトル10種類、結果画面の各グループ4種類。空や重複がない', () => {
  const expected = { title: 10 };
  Object.keys(D.LINES).forEach((g) => {
    const lines = D.LINES[g].map((l) => (typeof l === 'string' ? l : l.text));
    eq(lines.length, expected[g] || 4, `${g} の数`);
    eq(new Set(lines).size, lines.length, `${g} に重複`);
    lines.forEach((t) => assert(t.trim().length > 0 && t.length <= 24, `${g}: 長すぎる・空のセリフ「${t}」`));
  });
  eq(Object.keys(D.LINES).sort().join(), ['title', 'training-perfect', 'training-high', 'training-mid', 'training-low',
    'ta-best', 'ta-gameover', 'ta-high', 'ta-mid', 'ta-low', 'cert-master', 'cert-rankup', 'cert-pass', 'cert-fail'].sort().join());
});

test('一人称のセリフ：「ぼく」は男の子だけ、「わたし」は女の子だけが話す。ほかは共通', () => {
  const boy = D.linesFor('title', 'boy');
  const girl = D.linesFor('title', 'girl');
  eq(boy.length, 9); eq(girl.length, 9);
  assert(boy.some((t) => t.includes('ぼく')) && !boy.some((t) => t.includes('わたし')), '男の子のセリフ');
  assert(girl.some((t) => t.includes('わたし')) && !girl.some((t) => t.includes('ぼく')), '女の子のセリフ');
  Object.keys(D.LINES).forEach((g) => ['boy', 'girl'].forEach((c) => {
    const other = c === 'boy' ? 'わたし' : 'ぼく';
    assert(!D.linesFor(g, c).some((t) => t.includes(other)), `${g}: ${c} が「${other}」と言う`);
  }));
});

test('抽選は外から渡した乱数で決まる（同じ乱数なら同じ結果）', () => {
  const a = D.pick('title', fixed(0, 0));
  eq(a.character.id, 'boy'); eq(a.text, '先生！今日も添削よろしくね！'); eq(a.group, 'title');
  const b = D.pick('title', fixed(0.99, 0.999));
  eq(b.character.id, 'girl'); eq(b.text, '先生！さっそく授業を始めよう！');
  const r1 = G.createRng('42'); const r2 = G.createRng('42');
  for (let i = 0; i < 20; i++) eq(JSON.stringify(D.pick('ta-mid', r1)), JSON.stringify(D.pick('ta-mid', r2)));
});

test('男の子・女の子はほぼ50％ずつ選ばれ、どのセリフも選ばれる', () => {
  const rng = G.createRng('7');
  const count = { boy: 0, girl: 0 };
  const seen = new Set();
  const N = 4000;
  for (let i = 0; i < N; i++) { const p = D.pick('title', rng); count[p.character.id]++; seen.add(p.text); }
  assert(Math.abs(count.boy / N - 0.5) < 0.04, `偏りすぎ ${JSON.stringify(count)}`);
  eq(seen.size, 10, 'タイトルのセリフが全部出ない');
  const res = D.pick('cert-pass', Math.random);
  assert(D.linesFor('cert-pass', res.character.id).includes(res.text), 'グループ外のセリフ');
});

test('トレーニング：正解率で 100％／80〜99％／50〜79％／50％未満 に分かれる', () => {
  eq([100, 99, 80, 79, 50, 49, 0].map(D.trainingGroup).join(),
    'training-perfect,training-high,training-high,training-mid,training-mid,training-low,training-low');
});

test('タイムアタック：自己ベスト更新 → ゲームオーバー → 得点（2000以上／1000〜1999／1000未満）の順に判定', () => {
  const g = (o) => D.timeAttackGroup({ official: true, isBest: false, gameOver: false, score: 0, ...o });
  eq(g({ score: 2000 }), 'ta-high'); eq(g({ score: 1999 }), 'ta-mid'); eq(g({ score: 1000 }), 'ta-mid'); eq(g({ score: 999 }), 'ta-low');
  eq(g({ isBest: true, score: 600 }), 'ta-best', '自己ベスト更新');
  eq(g({ isBest: true, gameOver: true, score: 600 }), 'ta-best', 'ゲームオーバーでも新記録が優先');
  eq(g({ gameOver: true, score: 2500 }), 'ta-gameover', 'ゲームオーバーは得点より優先');
  eq(g({ official: false, isBest: true, score: 2500 }), 'ta-high', 'カスタムには自己ベストがない');
  eq(g({ isBest: true, score: 0 }), 'ta-low', '0点の初回は新記録としない');
});

test('認定試験：最終試験の初合格 → 初合格のランクアップ → 合格 → 不合格', () => {
  const g = (o) => D.certGroup({ passed: true, firstClear: false, rankUp: false, isFinal: false, ...o });
  eq(g({ firstClear: true, rankUp: true, isFinal: true }), 'cert-master');
  eq(g({ firstClear: true, rankUp: true }), 'cert-rankup');
  eq(g({}), 'cert-pass', '再合格');
  eq(g({ isFinal: true }), 'cert-pass', '最終試験の再合格');
  eq(g({ passed: false, firstClear: true, rankUp: true, isFinal: true }), 'cert-fail');
});

console.log(failed ? `\n${failed} 件失敗しました。` : `\nすべて成功しました（${passed} 件）。`);
process.exit(failed ? 1 : 0);
