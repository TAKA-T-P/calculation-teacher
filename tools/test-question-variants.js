#!/usr/bin/env node
/*
 * 第7段階のテスト：答案パターン（正答・誤答）の登録・抽選・出題・採点。
 *   node tools/test-question-variants.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const QV = require('../js/question-variants.js');
const G = require('../js/game.js');
const TA = require('../js/time-attack.js');
const C = require('../js/certification.js');
const V = require('./validate-questions.js');
const Report = require('./question-report.js');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
const files = manifest.files.map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f.file), 'utf8')));
const questions = files.flatMap((d) => d.questions);
const reviews = JSON.parse(fs.readFileSync(path.join(ROOT, 'review', 'manual-review.json'), 'utf8')).reviews;

let failed = 0;
let count = 0;
function test(label, fn) {
  count++;
  try { fn(); console.log(`OK  ${label}`); } catch (e) { failed++; console.log(`NG  ${label}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} 期待値 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`); }
const choiceFor = (q) => (q.errorLine === null ? { type: 'allCorrect' } : { type: 'line', index: q.errorLine });
const wrongChoiceFor = (q) => (q.errorLine === null ? { type: 'line', index: 1 } : { type: 'allCorrect' });
const byId = (id) => questions.find((q) => q.id === id);
const ALTERNATIVES = ['J1-EQ-0003', 'J1-EQ-0016', 'J1-PN-0010', 'J1-PN-0015'];

console.log('--- データ');
test('[1・2] 問題ID は800問のまま・重複なし（答案パターンを問題数として数えない）', () => {
  eq(questions.length, 800);
  eq(new Set(questions.map((q) => q.id)).size, 800);
  manifest.files.forEach((f, i) => eq(files[i].questions.length, 100, f.unit));
});
test('[3] 既存の誤答の問題（575問）には、模範解答の正答パターン correct-1 がある', () => {
  const wrong = questions.filter((q) => q.errorLine !== null);
  eq(wrong.length, 575);
  wrong.forEach((q) => {
    const v = QV.variantsOf(q).find((x) => x.id === 'correct-1');
    assert(v && v.type === QV.TYPES.CORRECT && v.errorLine === null && v.source === 'model', `${q.id} に正答パターンがない`);
    eq(JSON.stringify(v.answerLines), JSON.stringify(q.correctSolution), `${q.id} の正答パターンの答案`);
    assert(!v.explanation.includes(q.explanation), `${q.id} の正答パターンに誤答の解説が入っている`);
  });
});
test('[4] 模範解答と同じ正答の問題（221問）には誤答パターン wrong-1 がある。別解の正答（4問）は変えない', () => {
  const correct = questions.filter((q) => q.errorLine === null);
  eq(correct.length, 225);
  const same = correct.filter((q) => QV.sameAsModel(q));
  eq(same.length, 221);
  same.forEach((q) => {
    eq(QV.kindOf(q), QV.KINDS.SWITCHABLE, q.id);
    const w = QV.variantsOf(q).find((x) => x.id === 'wrong-1');
    assert(w && w.type === QV.TYPES.INCORRECT && w.source === 'variants', `${q.id} に誤答パターンがない`);
  });
  const alt = correct.filter((q) => !QV.sameAsModel(q)).map((q) => q.id).sort();
  eq(alt.join(), ALTERNATIVES.join(), '別解の正答問題');
  alt.forEach((id) => {
    const q = byId(id);
    assert(!('variants' in q), `${id} に答案パターンが追加されている`);
    eq(QV.kindOf(q), QV.KINDS.ALTERNATIVE, id);
    eq(QV.variantsOf(q).length, 1, id);
  });
});
test('[5〜8] 正答パターンは errorLine=null、誤答パターンは最初の誤り行（1以上・行数未満）と errorType がある', () => {
  questions.forEach((q) => QV.variantsOf(q).forEach((v) => {
    eq(v.answerLines[0], q.question, `${q.id} ${v.id} の1行目`);
    if (v.type === QV.TYPES.CORRECT) { eq(v.errorLine, null, `${q.id} ${v.id}`); eq(v.errorType, null, `${q.id} ${v.id}`); }
    else {
      assert(Number.isInteger(v.errorLine) && v.errorLine >= 1 && v.errorLine < v.answerLines.length, `${q.id} ${v.id} の errorLine`);
      assert(typeof v.errorType === 'string' && v.errorType.trim(), `${q.id} ${v.id} の errorType`);
    }
  }));
});
test('[6・9] すべての答案パターン（1596個）を数学的に検証し、ERROR がない（検証できない答案は合格扱いにしない）', () => {
  let patterns = 0;
  questions.forEach((q, i) => {
    const file = files.find((d) => d.questions.includes(q));
    const r = V.validateQuestion(q, { file });
    eq(r.errors.length, 0, `${q.id}: ${r.errors[0]}`);
    eq(r.variants.length, QV.variantsOf(q).length, `${q.id} の検証した答案パターンの数`);
    r.variants.forEach((v) => assert(['AUTO', 'MANUAL'].includes(v.status), `${q.id} ${v.id} の検証結果 ${v.status}`));
    patterns += r.variants.length;
    if (i === 0) assert(r.variants.every((v) => v.status), '検証結果がない');
  });
  eq(patterns, 1596);
});
test('[10] レビュー記録：800問とも最新の内容（答案パターンを含むハッシュ）で記録され、AI と数学講師を区別している', () => {
  questions.forEach((q) => {
    const rv = reviews[q.id];
    assert(rv && rv.hash === V.questionHash(q), `${q.id} のレビュー記録が古い`);
    eq(rv.reviewerRole, 'ai', `${q.id}：AI の確認を数学講師の確認として記録していない`);
  });
  // 答案パターンを変えるとハッシュが変わる（再レビューが必要になる）
  const q = questions.find((x) => x.variants);
  const changed = JSON.parse(JSON.stringify(q));
  changed.variants[0].explanation += '（変更）';
  assert(V.questionHash(changed) !== V.questionHash(q), '答案パターンの変更でハッシュが変わらない');
  const w = questions.find((x) => x.errorLine !== null);
  assert(V.questionHash({ ...w, correctExplanation: 'ちがう解説' }) !== V.questionHash(w), '正答パターンの解説の変更でハッシュが変わらない');
});
test('ヒントは正答版・誤答版の両方で出すので、誤答の行にしかない式を示していない', () => {
  questions.forEach((q) => {
    const file = files.find((d) => d.questions.includes(q));
    const r = V.validateQuestion(q, { file });
    assert(!r.warnings.some((m) => m.includes('ヒントの')), `${q.id}: ${r.warnings.find((m) => m.includes('ヒントの'))}`);
  });
});
test('分類の一覧（CSV/JSON）：225問を模範解答と同じ221問・別解4問に分け、判定理由と数学講師の確認の要否がある', () => {
  const rows = Report.classify(Report.load().items);
  eq(rows.length, 225);
  eq(rows.filter((r) => r.sameAsModel).length, 221);
  rows.filter((r) => !r.sameAsModel).forEach((r) => {
    assert(r.reason.includes('：') && r.teacherReview.startsWith('必要') && /AI/.test(r.judgedBy), `${r.id} の別解の判定理由`);
  });
  rows.filter((r) => r.sameAsModel).forEach((r) => assert(r.needsIncorrect && r.incorrectAdded, `${r.id} の誤答追加`));
});

console.log('--- 抽選');
test('[26] 境界：u < 0.25 なら正答、0.25 以上なら誤答（CORRECT_VARIANT_RATE は共通の定数）', () => {
  eq(QV.CORRECT_VARIANT_RATE, 0.25);
  const wq = byId('J1-PN-0001'); // 既存の誤答の問題
  const cq = byId('J1-PN-0003'); // 誤答を追加した問題
  [wq, cq].forEach((q) => {
    eq(QV.pickVariant(q, 0).type, 'correct', q.id);
    eq(QV.pickVariant(q, 0.2499999).type, 'correct', q.id);
    eq(QV.pickVariant(q, 0.25).type, 'incorrect', q.id);
    eq(QV.pickVariant(q, 0.9999999).type, 'incorrect', q.id);
  });
  ALTERNATIVES.forEach((id) => [0, 0.1, 0.25, 0.5, 0.99].forEach((u) => eq(QV.pickVariant(byId(id), u).type, 'correct', `${id}（別解はいつも正答）`)));
});
test('[26] 10,000回の抽選で、正答は約25%・誤答は約75%（切替できる問題）', () => {
  const rng = G.createRng(20261122);
  const q = byId('J3-QE-0013');
  let correct = 0;
  for (let i = 0; i < 10000; i++) if (QV.resolve(q, rng).errorLine === null) correct++;
  assert(correct > 2350 && correct < 2650, `正答 ${correct}/10000`);
});
test('[26] 問題ごとに独立に抽選する（全体の正答数をそろえる補正をしない）', () => {
  // 10問ずつ100回：正答の数は0〜10まで散らばる（いつも2〜3問になるわけではない）
  const rng = G.createRng(7);
  const pool = questions.filter((q) => QV.kindOf(q) === QV.KINDS.SWITCHABLE).slice(0, 10);
  const counts = new Set();
  for (let i = 0; i < 100; i++) counts.add(pool.map((q) => QV.resolve(q, rng)).filter((p) => p.errorLine === null).length);
  assert(counts.size >= 5 && (counts.has(0) || counts.has(5) || counts.has(6)), `正答数の散らばり ${[...counts].sort()}`);
});
test('[26] ?seed= と同じく、答案パターン用の乱数を固定すると再現できる。出題順は答案パターンの抽選に影響されない', () => {
  const make = (vseed) => new G.TrainingSession(questions, { unit: 'square-roots', count: 10 }, G.createRng(42), { variantRng: QV.createVariantRng(vseed, G.createRng) });
  const a = make(5);
  const b = make(5);
  eq(a.questions.map((q) => `${q.id}:${q.variantId}`).join(), b.questions.map((q) => `${q.id}:${q.variantId}`).join(), '同じ seed で同じ答案');
  const c = make(6);
  eq(c.questionIds.join(), a.questionIds.join(), '答案パターンの乱数を変えても出題順は同じ');
  const plain = new G.TrainingSession(questions, { unit: 'square-roots', count: 10 }, G.createRng(42));
  eq(plain.questionIds.join(), a.questionIds.join(), '答案パターンの抽選が出題順を変えていない');
  assert(QV.createVariantRng(null, G.createRng) === Math.random && QV.createVariantRng('', G.createRng) === Math.random, 'seed なしはふつうの乱数');
});

console.log('--- トレーニング');
test('[27] 正答版は「全部正しい！」、誤答版は設定した行が正解。採点は出題した答案の errorLine を使う', () => {
  const q = byId('J2-SE-0001');
  const correct = QV.resolveById(q, 'correct-1');
  const wrong = QV.resolveById(q, 'wrong-1');
  eq(G.grade(correct, { type: 'allCorrect' }).correct, true);
  eq(G.grade(correct, { type: 'line', index: q.errorLine }).correct, false, '元の errorLine の行を選んでも正答版では不正解');
  eq(G.grade(wrong, { type: 'line', index: q.errorLine }).correct, true);
  eq(G.grade(wrong, { type: 'allCorrect' }).correct, false);
  const added = byId('J2-SE-0002');
  eq(G.grade(QV.resolveById(added, 'wrong-1'), { type: 'line', index: added.variants[0].errorLine }).correct, true, '追加した誤答');
  eq(G.grade(QV.resolveById(added, 'correct-1'), { type: 'allCorrect' }).correct, true, '元の正しい答案');
});
test('[27] 1問解き直しでは同じ答案、新しいプレイ（もう一度チャレンジ）では抽選し直す', () => {
  const s = new G.TrainingSession(questions, { unit: 'polynomials', count: 'all' }, G.createRng(3), { variantRng: G.createRng(9) });
  s.questions.forEach((played) => {
    const retry = new G.TrainingSession([played], { unit: played.unit, difficulties: [played.difficulty], count: 1 }, G.createRng(1), { variantRng: () => 0.99 });
    eq(retry.current.variantId, played.variantId, `${played.id} の解き直し`);
    eq(JSON.stringify(retry.current.answerLines), JSON.stringify(played.answerLines), `${played.id} の解き直しの答案`);
  });
  const again = new G.TrainingSession(questions, { unit: 'polynomials', count: 'all' }, G.createRng(3), { variantRng: G.createRng(10) });
  const diff = s.questions.filter((q, i) => q.variantId !== again.questions[i].variantId).length;
  assert(diff > 10, `再挑戦で答案パターンが抽選し直されていない（違う答案 ${diff}問）`);
});
test('トレーニングの1回の中で同じ問題IDは出ない（答案パターンがちがっても別の問題として数えない）', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const s = new G.TrainingSession(questions, { unit: 'equation', count: 'all' }, G.createRng(seed), { variantRng: G.createRng(seed) });
    eq(new Set(s.questionIds).size, s.questionIds.length);
    eq(s.total, 100, '問題数は ID の数');
  }
});
test('全モード共通：抽選の結果は「出題した答案」として保持し、採点・解説・結果で同じものを使う', () => {
  const s = new G.TrainingSession(questions, { unit: 'square-roots', count: 5 }, G.createRng(11), { variantRng: G.createRng(12) });
  while (!s.finished) {
    const shown = s.current;
    if (shown.errorLine === null) s.selectAllCorrect(); else s.selectLine(shown.errorLine);
    const r = s.submit();
    eq(r.correct, true, `${shown.id}（${shown.variantId}）`);
    eq(r.variantId, shown.variantId);
    eq(s.current, shown, '採点で答案が変わった');
    s.next();
  }
  s.questions.forEach((q) => assert(QV.isResolved(q) && q.variantType, `${q.id} の答案パターンが保持されていない`));
});

console.log('--- タイムアタック');
test('[27] 正答・誤答を正しく判定し、90秒＋ロスタイム5秒・3回ミス・得点は変わらない', () => {
  eq(TA.CONFIG.durationMs, 90000); eq(TA.CONFIG.lossTimeMs, 5000); eq(TA.CONFIG.maxMisses, 3);
  eq([1, 2, 11].map(TA.pointsForStreak).join(), '200,210,300');
  let t = 0;
  const s = new TA.TimeAttackSession(questions, { mode: 'official', unit: 'quadratic-equations' }, { rng: G.createRng(2), variantRng: G.createRng(3), now: () => t, maxMisses: 999 });
  s.start();
  let correctShown = 0;
  for (let i = 0; i < 40; i++) {
    const shown = s.current;
    if (shown.errorLine === null) correctShown++;
    const r = s.answer(choiceFor(shown));
    assert(r.correct && r.question === shown, `${shown.id}（${shown.variantId}）の判定`);
    t += 500; s.advance();
  }
  assert(correctShown > 0 && correctShown < 40, `正答版と誤答版の両方が出る（正答 ${correctShown}/40）`);
  const w = s.current;
  eq(s.answer(wrongChoiceFor(w)).correct, false, '誤った選択は不正解');
});
test('[27] 公式の難易度の出題順は変わらず、同じ問題がまた出たときは答案パターンを抽選し直す', () => {
  let t = 0;
  const s = new TA.TimeAttackSession(questions, { mode: 'official', unit: 'expressions' }, { rng: G.createRng(4), variantRng: G.createRng(5), now: () => t, maxMisses: 999 });
  s.start();
  for (let n = 0; n < 30; n++) {
    eq(s.current.difficulty, TA.officialDifficultyAt(n), `${n + 1}問目の難易度`);
    s.answer(choiceFor(s.current)); t += 200; s.advance();
  }
  // 1問しかない条件では同じ問題が続けて出る。そのたびに抽選し直すので、正答版と誤答版の両方が出る
  const one = byId('J1-EX-0002');
  let u = 0;
  const s1 = new TA.TimeAttackSession([one], { mode: 'custom', unit: one.unit }, { rng: G.createRng(1), variantRng: G.createRng(8), now: () => u, maxMisses: 999 });
  s1.start();
  const seen = new Set();
  for (let i = 0; i < 40; i++) { seen.add(s1.current.variantId); s1.answer(choiceFor(s1.current)); u += 200; s1.advance(); }
  eq([...seen].sort().join(), 'correct-1,wrong-1');
});
test('[27] 結果の記録は実際に出題した答案（解説もその答案のもの）', () => {
  let t = 0;
  const s = new TA.TimeAttackSession(questions, { mode: 'custom', unit: 'equation' }, { rng: G.createRng(6), variantRng: G.createRng(7), now: () => t });
  s.start();
  for (let i = 0; i < 10; i++) { s.answer(choiceFor(s.current)); t += 300; s.advance(); }
  s.results.forEach((r) => {
    const v = QV.variantsOf(byId(r.question.id)).find((x) => x.id === r.question.variantId);
    eq(r.question.explanation, v.explanation, `${r.question.id} の解説`);
    eq(JSON.stringify(r.expected), JSON.stringify(choiceFor(r.question)), `${r.question.id} の正しい選択`);
  });
});

console.log('--- 認定試験');
test('[27] 難易度別の出題配分は変わらず、同じ問題IDは重複しない。答案パターンで合否の判定は変わらない', () => {
  for (const unit of ['positive-negative', 'simultaneous-equations', 'quadratic-equations']) {
    for (const exam of C.EXAMS) {
      for (let seed = 1; seed <= 20; seed++) {
        const s = new C.CertificationSession(questions, { unit, examId: exam.id }, G.createRng(seed), { variantRng: G.createRng(seed * 31) });
        eq(new Set(s.questionIds).size, s.questions.length, '重複');
        G.DIFFICULTIES.forEach((d) => eq(s.questions.filter((q) => q.difficulty === d).length, exam.distribution[d] || 0, `${unit} ${exam.name} ★${d}`));
        while (!s.finished) { const q = s.current; if (q.errorLine === null) s.selectAllCorrect(); else s.selectLine(q.errorLine); s.submit(); s.next(); }
        eq(s.outcome, C.OUTCOME.PASS, '全問正しく添削すれば合格');
      }
    }
  }
});
test('認定試験の問題選びは、答案パターンの乱数で変わらない（問題IDと難易度で選ぶ）', () => {
  const a = new C.CertificationSession(questions, { unit: 'square-roots', examId: 4 }, G.createRng(3), { variantRng: G.createRng(1) });
  const b = new C.CertificationSession(questions, { unit: 'square-roots', examId: 4 }, G.createRng(3), { variantRng: G.createRng(2) });
  eq(a.questionIds.join(), b.questionIds.join());
});

console.log(failed ? `\n${failed} 件失敗しました。` : `\nすべて成功しました（${count} 件）。`);
process.exit(failed ? 1 : 0);
