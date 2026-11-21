#!/usr/bin/env node
/*
 * test-stage4.js
 * 第4段階（中1の問題300問化）のテスト。
 *   - 問題データの数・分布・レビュー状況（tools/question-report.js の集計を使う）
 *   - 集計スクリプトの警告（バランスの WARN と数学的な ERROR を分けている）
 *   - タイムアタックの難易度の出題割合、認定試験の問題構成の多様さ
 *   - 既存の記録（第3段階で保存した形式）がそのまま読み込めること
 *   node tools/test-stage4.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('../js/game.js');
const TA = require('../js/time-attack.js');
const C = require('../js/certification.js');
const Rec = require('../js/records.js');
const S = require('../js/lib/question-schema.js');
const Report = require('./question-report.js');

const ROOT = path.join(__dirname, '..');
// 第4段階のテストは中1の3単元（300問）が対象。中2・中3の単元（第6段階）は tools/test-stage6.js で確かめる
const all = Report.load();
const data = { manifest: { ...all.manifest, files: all.manifest.files.filter((f) => f.grade === 1) }, items: all.items.filter((it) => it.q.grade === 1) };
const questions = data.items.map((it) => it.q);
const rep = Report.buildReport(data);

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

console.log(`問題データ ${questions.length} 問でテストします\n--- 問題データ`);

test('[1] 中1の3単元が各100問、合計300問', () => {
  eq(questions.length, 300);
  rep.units.forEach((u) => eq(u.total, 100, u.label));
  eq(rep.units.map((u) => u.unit).join(), 'positive-negative,expressions,equation');
});
test('[2] 全問題の ID に重複がなく、各単元で続き番号になっている（既存の ID は変わらない）', () => {
  eq(new Set(questions.map((q) => q.id)).size, questions.length, 'ID の重複');
  rep.units.forEach((u) => {
    const code = S.UNITS[u.unit].idCode;
    const nums = questions.filter((q) => q.unit === u.unit).map((q) => Number(q.id.split('-')[2]));
    eq(nums.join(), Array.from({ length: 100 }, (_, i) => i + 1).join(), `${code} の番号`);
  });
});
test('[3] カテゴリごとに25問（各単元の4カテゴリを維持）', () => {
  rep.units.forEach((u) => {
    eq(Object.keys(u.byCategory).join(), S.UNITS[u.unit].categories.join(), `${u.label} のカテゴリ`);
    Object.entries(u.byCategory).forEach(([c, n]) => eq(n, 25, `${u.label}「${c}」`));
  });
});
test('[4] 難易度ごとに25問、カテゴリ×難易度は6〜7問ずつ', () => {
  rep.units.forEach((u) => {
    [1, 2, 3, 4].forEach((d) => eq(u.byDifficulty[d], 25, `${u.label} ★${d}`));
    Object.entries(u.matrix).forEach(([c, row]) => row.forEach((n, i) => assert(n >= 6 && n <= 7, `${u.label}「${c}」★${i + 1} が ${n}問`)));
  });
});
test('[5] 「全部正しい！」は各単元・全体とも25〜30%で、カテゴリにかたよらない', () => {
  rep.units.forEach((u) => {
    assert(u.correctRatio >= 25 && u.correctRatio <= 30, `${u.label} ${u.correctRatio}%`);
    Object.entries(u.correctByCategory).forEach(([c, n]) => assert(n >= 5 && n <= 9, `${u.label}「${c}」の全部正しい ${n}問`));
  });
  assert(rep.correctRatio >= 25 && rep.correctRatio <= 30, `全体 ${rep.correctRatio}%`);
});
test('[6] 最初の誤り行の分布が目安（2行目25%・3行目35%・4行目25%・5行目以降15%）から±10%以内', () => {
  rep.units.forEach((u) => {
    Object.entries(Report.TARGETS.errorLineShare).forEach(([k, share]) => {
      const actual = u.errorLines[k] / u.wrong;
      assert(Math.abs(actual - share) <= Report.TARGETS.errorLineTolerance, `${u.label} ${k}行目 ${Math.round(actual * 100)}%`);
    });
  });
});
test('[7〜11] 全問題の自動検証で ERROR がない（最初の誤り行・誤りのあとの一貫性・正しい計算過程・KaTeX）', () => {
  eq(rep.errors.length, 0, JSON.stringify(rep.errors[0]));
  const manual = data.items.filter((it) => it.status === 'MANUAL');
  // 手動確認になるのは「文字式の表し方」（表記ルールは自動判定できない）と、途中式が別解の正しい答案だけ
  manual.forEach((it) => assert(it.q.category === '文字式の表し方' || it.q.errorLine === null || (it.q.verification && it.q.verification.mode === 'manual'), `${it.q.id} が手動確認になった理由を確認`));
});
test('[7] 誤答はどれも、最初の誤り行のあとの行が誤った式から一貫して計算されている（別の独立した誤りがない）', () => {
  // validate-questions.js の判定で「誤り行より後の行に、別の独立した誤り」が1件もないことを確かめる
  data.items.filter((it) => it.q.errorLine !== null).forEach((it) => {
    assert(!it.errors.some((m) => m.includes('別の独立した誤り')), `${it.q.id}: ${it.errors[0]}`);
  });
});
test('[12] 全問題のレビュー状況を確認でき、AI のレビューと数学講師のレビューを区別している', () => {
  rep.units.forEach((u) => {
    eq(u.review.ai + u.review.teacher + u.review.stale + u.review.missing, 100, u.label);
    eq(u.review.missing, 0, `${u.label} 未レビュー`);
    eq(u.review.stale, 0, `${u.label} レビュー後に変更`);
    eq(u.review.teacher, 0, `${u.label}：数学講師はまだ確認していない（AI の確認を講師の確認として扱わない）`);
  });
  const reviews = JSON.parse(fs.readFileSync(path.join(ROOT, 'review', 'manual-review.json'), 'utf8')).reviews;
  // 第3段階までの問題数（それより後の番号が第4段階で追加した問題）
  const before = { 'positive-negative': 16, expressions: 15, equation: 17 };
  const added = questions.filter((q) => Number(q.id.split('-')[2]) > before[q.unit]);
  eq(added.length, 252, '第4段階で追加した問題数');
  added.forEach((q) => eq(reviews[q.id].reviewerRole, 'ai', `${q.id} の reviewerRole`));
  eq(Report.reviewerRole({ reviewer: 'Claude Code（AIによる確認）' }), 'ai');
  eq(Report.reviewerRole({ reviewer: '山田', reviewerRole: 'teacher' }), 'teacher');
  eq(Report.reviewerRole({ reviewer: 'なにか', reviewerRole: 'ai' }), 'ai', 'reviewerRole を優先する');
});
test('完成数（ERROR なし・最新の内容でレビュー済み）が300問で、バランスの WARN がない', () => {
  eq(rep.done, 300);
  eq(rep.warnings.length, 0, rep.warnings.map((w) => w.msg).join(' / '));
});
test('errorType が1種類に集中していない（各単元の誤答の10%以下）', () => {
  rep.units.forEach((u) => Object.entries(u.errorTypes).forEach(([t, n]) => assert(n / u.wrong <= 0.10, `${u.label}「${t}」${n}問`)));
});
test('同じ問題式がない（数値だけ同じ問題の重複登録を防ぐ）', () => {
  const seen = new Map();
  questions.forEach((q) => {
    const k = q.question.replace(/\s+/g, '');
    assert(!seen.has(k), `${q.id} と ${seen.get(k)} が同じ問題式`);
    seen.set(k, q.id);
  });
});

console.log('--- 集計スクリプト');
test('目標から外れると WARN を出す（数学的な ERROR とは別に数える）', () => {
  // 正負の数の「累乗」★1 の問題を3問取り除いたデータで集計する
  let removed = 0;
  const items = data.items.filter((it) => {
    if (removed < 3 && it.q.unit === 'positive-negative' && it.q.category === '累乗' && it.q.difficulty === 1) { removed++; return false; }
    return true;
  });
  const r = Report.buildReport({ manifest: data.manifest, items });
  const msgs = r.warnings.map((w) => w.msg);
  assert(msgs.some((m) => m.includes('問題数 97')), '単元の問題数の WARN');
  assert(msgs.some((m) => m.includes('「累乗」 22問')), 'カテゴリの WARN');
  assert(msgs.some((m) => m.includes('★1 22問')), '難易度の WARN');
  assert(msgs.some((m) => m.includes('「累乗」×★1 が 3問')), 'カテゴリ×難易度の WARN');
  eq(r.errors.length, 0, 'バランスの問題を数学的な ERROR として数えない');
  // 問題そのものは書き換えない
  eq(JSON.stringify(items.map((it) => it.q)), JSON.stringify(data.items.filter((it) => items.includes(it)).map((it) => it.q)));
});
test('類題候補：カテゴリ・式の形・誤り行・errorType が同じものを挙げる（数字だけ違う問題）', () => {
  eq(Report.shapeOf('3x+5=-2'), Report.shapeOf('7x+1=-9'));
  assert(Report.shapeOf('3x+5=-2') !== Report.shapeOf('3(x+5)=-2'), '式の形が違う');
  assert(rep.similar.length <= 3, `類題候補が多い: ${JSON.stringify(rep.similar)}`);
});

console.log('--- タイムアタック・認定試験');
test('[17] 公式タイムアタックは決められた難易度の順に出題する（1→2→1→2→3→1→2→3→4→2→3→4、以降3→4のくり返し）', () => {
  const order = [1, 2, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 3, 4, 3, 4, 3, 4];
  eq(order.map((_, i) => TA.officialDifficultyAt(i)).join(), order.join());
  eq(TA.officialDifficultyAt(4), 3, '5問目は必ず★★★');
  for (const unit of ['positive-negative', 'expressions', 'equation']) {
    for (let seed = 1; seed <= 50; seed++) {
      const s = new TA.TimeAttackSession(questions, { mode: 'official', unit }, { rng: G.createRng(seed), now: () => 0 });
      eq(s.pool.length, 100, `${unit} の出題対象`);
      s.start();
      const drawn = [s.current];
      for (let i = 1; i < 80; i++) drawn.push(s.drawNext());
      drawn.forEach((q, i) => eq(q.difficulty, TA.officialDifficultyAt(i), `${unit} seed=${seed} ${i + 1}問目の難易度`));
      // 同じ難易度の中では、その難易度の問題を出し終えるまで重複しない（★★★・★★★★は各25問）
      [3, 4].forEach((d) => {
        const ofD = drawn.filter((q) => q.difficulty === d).slice(0, 25);
        eq(new Set(ofD.map((q) => q.id)).size, ofD.length, `${unit} seed=${seed} ★${d} が重複`);
      });
      for (let i = 1; i < drawn.length; i++) assert(drawn[i].id !== drawn[i - 1].id, '同じ問題が続いた');
    }
  }
  // 出題の順は seed によって変わる（難易度の順は同じでも、問題は毎回シャッフル）
  const firstIds = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const s = new TA.TimeAttackSession(questions, { mode: 'official', unit: 'equation' }, { rng: G.createRng(seed), now: () => 0 });
    s.start();
    firstIds.add(s.current.id);
  }
  assert(firstIds.size >= 8, `1問目の問題が ${firstIds.size} 種類しかない`);
});
test('[17] カスタムタイムアタックの出題は今までどおり（選んだ条件の全問題をシャッフルして順に出す）', () => {
  const s = new TA.TimeAttackSession(questions, { mode: 'custom', unit: 'expressions', categories: null, difficulties: [1, 2, 3, 4] }, { rng: G.createRng(3), now: () => 0 });
  s.start();
  const drawn = [s.current];
  for (let i = 1; i < 100; i++) drawn.push(s.drawNext());
  eq(new Set(drawn.map((q) => q.id)).size, 100, '1巡で全問題が1回ずつ出る');
  [1, 2, 3, 4].forEach((d) => eq(drawn.filter((q) => q.difficulty === d).length, 25, `★${d}`));
});
test('[18] タイムアタックの得点計算は第3段階のまま（190+10n・上限300点）。制限時間はご要望により90秒＋ロスタイム5秒', () => {
  eq([1, 2, 10, 11, 20].map(TA.pointsForStreak).join(), '200,210,290,300,300');
  eq(TA.CONFIG.durationMs, 90000); eq(TA.CONFIG.lossTimeMs, 5000); eq(TA.CONFIG.maxMisses, 3);
});
test('[20・21] 認定試験の配分は変わらず、挑戦ごとに異なる問題構成になる', () => {
  eq(C.EXAMS.map((e) => `${e.maxQuestions}/${e.requiredCorrect}`).join(), '5/3,6/4,7/5,8/6,10/10');
  for (const unit of ['positive-negative', 'expressions', 'equation']) {
    for (const exam of C.EXAMS) {
      assert(C.checkAvailability(questions, unit, exam).ok, `${unit} ${exam.name} が出題できない`);
      const sets = new Set();
      const used = new Set();
      for (let seed = 1; seed <= 30; seed++) {
        const qs = C.buildExamQuestions(questions, unit, exam, G.createRng(seed));
        [1, 2, 3, 4].forEach((d) => eq(qs.filter((q) => q.difficulty === d).length, exam.distribution[d], `${unit} ${exam.name} ★${d}`));
        sets.add(qs.map((q) => q.id).sort().join());
        qs.forEach((q) => used.add(q.id));
      }
      assert(sets.size >= 28, `${unit} ${exam.name}: 30回中 ${sets.size} 通りしかない`);
      const need = Object.values(exam.distribution).reduce((a, b) => a + b, 0);
      assert(used.size >= need * 3, `${unit} ${exam.name}: 30回で使われた問題が ${used.size} 問だけ`);
    }
  }
});
test('[20] 認定試験：難易度の中でカテゴリがかたよらない（追加後もカテゴリの均等化が働く）', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const qs = C.buildExamQuestions(questions, 'expressions', C.examById(5), G.createRng(seed));
    const star4 = qs.filter((q) => q.difficulty === 4);
    eq(new Set(star4.map((q) => q.category)).size, 4, `seed=${seed}: ★★★★4問が4カテゴリから出ていない`);
  }
});

console.log('--- 既存の記録');
test('[19・22] 第3段階で保存した記録は、問題データを増やしてもそのまま読み込める（リセットしない）', () => {
  const saved = {
    version: 1,
    timeAttack: {
      official: { equation: { bestScore: 2450, bestDate: '2026-11-20T10:00:00.000Z', maxStreak: 11, plays: 4, title: '神の赤ペン' } },
      custom: [{ playedAt: '2026-11-20T10:05:00.000Z', unit: 'positive-negative', categories: ['累乗'], difficulties: [1, 4], score: 600, correct: 3, wrong: 3, maxStreak: 2 }],
    },
    certification: { expressions: { highestCleared: 3, exams: { 1: { cleared: true, attempts: 1, firstClearedAt: '2026-11-19T00:00:00.000Z' }, 2: { cleared: true, attempts: 2, firstClearedAt: '2026-11-19T01:00:00.000Z' }, 3: { cleared: true, attempts: 1, firstClearedAt: '2026-11-20T00:00:00.000Z' } } } },
  };
  const store = { [Rec.STORAGE_KEY]: JSON.stringify(saved), 'calcTeacher.sound': '{"enabled":false,"volume":0.3}' };
  const storage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const r = Rec.createRecordStore({ storage });
  eq(Rec.STORAGE_KEY, 'calcTeacher.records');
  eq(r.officialFor('equation').bestScore, 2450);
  eq(r.officialFor('equation').title, '神の赤ペン', '保存されている文字列はそのまま読み込む');
  eq(TA.titleForScore(r.officialFor('equation').bestScore), '🎯赤ペンマスター', '画面には最高スコアから決めた新しい称号を表示する');
  eq(r.customHistory().length, 1);
  eq(r.certFor('expressions').highestCleared, 3);
  eq(C.rankFor(r.certFor('expressions').highestCleared).name, 'ベテランティーチャー');
  eq(store['calcTeacher.sound'], '{"enabled":false,"volume":0.3}', '効果音の設定');
  eq(r.status.readOnly, false);
});

console.log('--- 動作の軽さ');
test('[28] 300問でも、条件のしぼり込みとカテゴリ一覧はすぐに終わる', () => {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) {
    for (const unit of ['positive-negative', 'expressions', 'equation']) {
      G.listCategories(questions, unit);
      G.filterPool(questions, { unit, categories: null, difficulties: [1, 2, 3, 4] });
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert(ms < 2000, `200回で ${Math.round(ms)}ms`);
});

console.log(failed ? `\n${failed} / ${passed + failed} 件失敗しました。` : `\nすべて成功しました（${passed} 件）。`);
process.exit(failed ? 1 : 0);
