#!/usr/bin/env node
/*
 * 第6段階（中2・中3の5単元）の統合テスト。
 * 新しい単元が、トレーニング・タイムアタック・認定試験・記録・引継ぎコードで、
 * 中1の単元と同じように使えることを確かめる。
 *   node tools/test-stage6.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('../js/game.js');
const TA = require('../js/time-attack.js');
const C = require('../js/certification.js');
const Rec = require('../js/records.js');
const RT = require('../js/record-transfer.js');
const S = require('../js/lib/question-schema.js');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
const questions = manifest.files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f.file), 'utf8')).questions);
const NEW_UNITS = ['polynomials', 'simultaneous-equations', 'expansion-factorization', 'square-roots', 'quadratic-equations'];

let failed = 0;
let count = 0;
function test(label, fn) {
  count++;
  try { fn(); console.log(`OK  ${label}`); } catch (e) { failed++; console.log(`NG  ${label}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} 期待値 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`); }
const correctChoice = (q) => (q.errorLine === null ? { type: 'allCorrect' } : { type: 'line', index: q.errorLine });
const wrongChoice = (q) => (q.errorLine === null ? { type: 'line', index: 1 } : q.errorLine !== 1 ? { type: 'line', index: 1 } : { type: 'allCorrect' });
const choose = (s, c) => (c.type === 'allCorrect' ? s.selectAllCorrect() : s.selectLine(c.index));
function makeClock(t0 = 1000) { let t = t0; return { now: () => t, advance: (ms) => { t += ms; } }; }

console.log(`問題データ ${questions.length} 問でテストします\n`);

test('manifest に5単元が学年順（中1→中2→中3）で入り、各単元に問題がある', () => {
  const units = manifest.files.map((f) => f.unit);
  NEW_UNITS.forEach((u) => assert(units.includes(u), `${u} がない`));
  const grades = manifest.files.map((f) => f.grade);
  assert(grades.every((g, i) => i === 0 || grades[i - 1] <= g), `学年順でない ${grades}`);
  NEW_UNITS.forEach((u) => assert(questions.some((q) => q.unit === u), `${u} の問題がない`));
});

test('各単元のカテゴリは4つで、問題のカテゴリはすべてその中にある', () => {
  NEW_UNITS.forEach((u) => {
    const cats = S.UNITS[u].categories;
    eq(cats.length, 4, u);
    questions.filter((q) => q.unit === u).forEach((q) => assert(cats.includes(q.category), `${q.id} のカテゴリ ${q.category}`));
  });
});

test('トレーニング：新単元で全問を出題・採点でき、正解・不正解が正しく数えられる', () => {
  NEW_UNITS.forEach((unit) => {
    const pool = questions.filter((q) => q.unit === unit);
    const s = new G.TrainingSession(questions, { unit, count: pool.length }, G.createRng(7));
    let i = 0;
    while (!s.finished) {
      const q = s.current;
      eq(q.unit, unit);
      choose(s, i % 2 ? correctChoice(q) : wrongChoice(q));
      s.submit();
      s.next();
      i++;
    }
    eq(s.results.length, pool.length, unit);
    eq(s.results.filter((r) => r.correct).length, Math.floor(pool.length / 2), `${unit} 正解数`);
  });
});

test('タイムアタック（公式）：新単元でも公式の難易度順（1→2→1→2→3→1→2→3→4→2→3→4、以降3→4）で出題される', () => {
  NEW_UNITS.forEach((unit) => {
    const clock = makeClock();
    const s = new TA.TimeAttackSession(questions, { mode: 'official', unit }, { rng: G.createRng(3), now: clock.now, maxMisses: 999 });
    eq(s.pool.length, questions.filter((q) => q.unit === unit).length, `${unit} 公式は全問が対象`);
    s.start();
    for (let n = 0; n < 20 && s.current; n++) {
      eq(s.current.difficulty, TA.officialDifficultyAt(n), `${unit} ${n + 1}問目`);
      eq(s.current.unit, unit);
      s.answer(correctChoice(s.current)); clock.advance(200); s.advance();
    }
  });
});

test('タイムアタック（カスタム）：新単元のカテゴリ・難易度で絞り込める', () => {
  NEW_UNITS.forEach((unit) => {
    const cat = questions.find((q) => q.unit === unit).category;
    const clock = makeClock();
    const s = new TA.TimeAttackSession(questions, { mode: 'custom', unit, categories: [cat], difficulties: [1, 2, 3, 4] }, { rng: G.createRng(5), now: clock.now, maxMisses: 999 });
    s.start();
    for (let n = 0; n < 15; n++) {
      eq(s.current.category, cat, unit);
      s.answer(correctChoice(s.current)); clock.advance(200); s.advance();
    }
  });
});

test('認定試験：新単元の第1〜最終試験はすべて挑戦でき、難易度ごとの問題数どおりに出題される', () => {
  NEW_UNITS.forEach((unit) => C.EXAMS.forEach((exam) => {
    eq(C.checkAvailability(questions, unit, exam).ok, true, `${unit} ${exam.name}`);
    for (let seed = 1; seed <= 5; seed++) {
      const list = C.buildExamQuestions(questions, unit, exam, G.createRng(seed));
      eq(list.length, exam.maxQuestions, `${unit} ${exam.name}`);
      eq(new Set(list.map((q) => q.id)).size, list.length, '重複');
      G.DIFFICULTIES.forEach((d) => eq(list.filter((q) => q.difficulty === d).length, exam.distribution[d] || 0, `${unit} ${exam.name} ★${d}`));
      list.forEach((q) => eq(q.unit, unit));
    }
  }));
});

test('認定試験：新単元でも全問正解で合格、規定数まちがえると不合格になる', () => {
  NEW_UNITS.forEach((unit) => {
    [1, 5].forEach((examId) => {
      const pass = new C.CertificationSession(questions, { unit, examId }, G.createRng(11));
      while (!pass.finished) { choose(pass, correctChoice(pass.current)); pass.submit(); pass.next(); }
      eq(pass.outcome, C.OUTCOME.PASS, `${unit} 第${examId}試験 合格`);
      const fail = new C.CertificationSession(questions, { unit, examId }, G.createRng(11));
      while (!fail.finished) { choose(fail, wrongChoice(fail.current)); fail.submit(); fail.next(); }
      eq(fail.outcome, C.OUTCOME.FAIL, `${unit} 第${examId}試験 不合格`);
      eq(fail.results.length, C.failAt(C.examById(examId)), '不合格が決まったら終わる');
    });
  });
});

test('記録：新単元の公式タイムアタック・認定試験の記録が単元ごとに保存され、中1の記録と混ざらない', () => {
  const store = {};
  const storage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const rec = Rec.createRecordStore({ storage, now: () => new Date('2026-11-21T10:00:00.000Z') });
  rec.recordOfficial('equation', { score: 500, maxStreak: 3 }, TA.titleForScore);
  NEW_UNITS.forEach((u, i) => {
    rec.recordOfficial(u, { score: 1000 + i * 100, maxStreak: 5 + i }, TA.titleForScore);
    rec.recordExam(u, 1, true);
  });
  const again = Rec.createRecordStore({ storage });
  eq(again.officialFor('equation').bestScore, 500);
  NEW_UNITS.forEach((u, i) => {
    eq(again.officialFor(u).bestScore, 1000 + i * 100, u);
    eq(again.certFor(u).highestCleared, 1, u);
  });
});

test('引継ぎコード：8単元すべての記録がコードで正確に戻る', () => {
  const units = manifest.files.map((f) => f.unit);
  const exam = (date) => ({ cleared: true, attempts: 2, firstClearedAt: date });
  const records = { version: 1, timeAttack: { official: {}, custom: [] }, certification: {} };
  units.forEach((u, i) => {
    records.timeAttack.official[u] = { bestScore: 300 + i * 410, bestDate: `2026-11-${10 + i}T09:0${i}:00.${100 + i}Z`, maxStreak: 3 + i, plays: 1 + i };
    records.certification[u] = { highestCleared: 1 + (i % 5), exams: { 1: exam(`2026-11-${10 + i}T08:00:00.000Z`) } };
  });
  const d = RT.decode(RT.createCode(records));
  assert(d.ok, JSON.stringify(d));
  units.forEach((u) => {
    eq(JSON.stringify(d.data.official[u]), JSON.stringify(records.timeAttack.official[u]), u);
    eq(d.data.certification[u].highestCleared, records.certification[u].highestCleared, u);
  });
});

console.log(failed ? `\n${failed} 件失敗しました。` : `\nすべて成功しました（${count} 件）。`);
process.exit(failed ? 1 : 0);
