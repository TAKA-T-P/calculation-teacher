#!/usr/bin/env node
/*
 * ゲーム進行・採点ロジック（js/game.js）の自動テスト。
 * 実際の問題データ（data/*.json）を使って確かめる。
 *   node tools/test-game.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('../js/game.js');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
const questions = manifest.files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f.file), 'utf8')).questions);

let failed = 0;
let count = 0;
function test(label, fn) {
  count++;
  try {
    fn();
    console.log(`OK  ${label}`);
  } catch (e) {
    failed++;
    console.log(`NG  ${label}\n      ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} 期待値 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`); }
function throws(fn, type, msg) {
  try { fn(); } catch (e) { if (!type || e instanceof type) return; throw new Error(`${msg || ''} 想定外の例外 ${e.constructor.name}: ${e.message}`); }
  throw new Error(`${msg || ''} 例外が発生しませんでした`);
}
const session = (cfg, seed = 1) => new G.TrainingSession(questions, cfg, G.createRng(seed));
const ids = (s) => s.questions.map((q) => q.id);
// わざと不正解にする選択（誤り行ではない行。2行だけの答案で誤り行が2行目なら「全部正しい！」）
function chooseWrong(s) {
  const q = s.current;
  if (q.errorLine === null || q.errorLine !== 1) s.selectLine(1);
  else if (q.answerLines.length > 2) s.selectLine(2);
  else s.selectAllCorrect();
}

// 期待値を問題データから数える（filterPool を使わず独立に数えるので、実装をなぞるだけのテストにならない）。
// 問題を追加しても、テストを書き直さずに済むようにする。
function countOf({ unit, categories, difficulties }) {
  return questions.filter((q) => q.unit === unit &&
    (!categories || categories.includes(q.category)) &&
    (!difficulties || difficulties.includes(q.difficulty))).length;
}
const unitSize = (unit) => countOf({ unit });

console.log(`問題データ ${questions.length} 問でテストします\n`);

// ---------------------------------------------------------------- データ
test('全問題が出題可能（validateForPlay でエラーなし）', () => {
  const bad = questions.filter((q) => G.validateForPlay(q).length);
  eq(bad.length, 0, `出題できない問題: ${bad.map((q) => q.id).join(', ')}`);
});

// ---------------------------------------------------------------- 2. 単元
test('[2] 単元を変えると出題対象の単元が切り替わる', () => {
  for (const unit of ['positive-negative', 'expressions', 'equation']) {
    const s = session({ unit, difficulties: [1, 2, 3, 4], count: 'all' });
    assert(s.questions.every((q) => q.unit === unit), `${unit} 以外の問題が混ざっています`);
    eq(s.total, unitSize(unit), `${unit} の問題数`);
  }
});

// ---------------------------------------------------------------- 3. 難易度
test('[3] 難易度を複数選ぶと、その難易度の問題だけが出る', () => {
  const s = session({ unit: 'equation', difficulties: [2, 4], count: 'all' });
  assert(s.questions.every((q) => q.difficulty === 2 || q.difficulty === 4), '選んでいない難易度が混ざっています');
  const expected = questions.filter((q) => q.unit === 'equation' && (q.difficulty === 2 || q.difficulty === 4)).length;
  eq(s.total, expected, '問題数');
});
test('[3] 難易度ごとの問題数（設定画面の表示用）が正しい', () => {
  for (const unit of ['positive-negative', 'expressions', 'equation']) {
    const c = G.countByDifficulty(questions, unit);
    const expected = { 1: 0, 2: 0, 3: 0, 4: 0 };
    [1, 2, 3, 4].forEach((d) => { expected[d] = countOf({ unit, difficulties: [d] }); });
    eq(JSON.stringify(c), JSON.stringify(expected), `${unit} の難易度別問題数`);
  }
});
test('[3] 難易度を空で渡すとすべての難易度になる', () => {
  eq(session({ unit: 'expressions', difficulties: [], count: 'all' }).total, unitSize('expressions'));
});

// ---------------------------------------------------------------- 4. 問題数
test('[4] 問題数 5問・10問・すべて が選べ、既定は5問', () => {
  eq(JSON.stringify(G.COUNT_OPTIONS), JSON.stringify([5, 10, 'all']));
  eq(G.DEFAULT_COUNT, 5);
  eq(session({ unit: 'equation', difficulties: [1, 2, 3, 4], count: 5 }).total, 5);
  eq(session({ unit: 'equation', difficulties: [1, 2, 3, 4], count: 10 }).total, Math.min(10, unitSize('equation')));
  eq(session({ unit: 'equation', difficulties: [1, 2, 3, 4], count: 'all' }).total, unitSize('equation'));
  eq(session({ unit: 'equation', difficulties: [1, 2, 3, 4] }).total, 5, '問題数を省略したとき');
});

// ---------------------------------------------------------------- 5. 問題数不足
test('[5] 条件に合う問題が指定数より少ないときは、ある分だけ出題する（重複で埋めない）', () => {
  // 問題データから「1問以上10問未満」の条件（カテゴリ×難易度）を探す（問題を追加してもテストが壊れないように）
  const cells = manifest.files.flatMap((f) => [...new Set(questions.filter((q) => q.unit === f.unit).map((q) => q.category))]
    .flatMap((c) => [1, 2, 3, 4].map((d) => ({ unit: f.unit, categories: [c], difficulties: [d] }))));
  const few = cells.find((c) => countOf(c) > 0 && countOf(c) < 10);
  const n = few ? countOf(few) : 0;
  assert(n > 0 && n < 10, `このテストには10問未満の条件が必要（${n}問）`);
  const s = session({ ...few, count: 10 });
  eq(s.total, n, `${JSON.stringify(few)} の問題数`);
  eq(s.available, n);
  const tiny = cells.filter((c) => countOf(c) > 0).sort((a, b) => countOf(a) - countOf(b))[0];
  const s2 = session({ ...tiny, count: 10 });
  eq(s2.total, countOf(tiny));
  eq(new Set(ids(s2)).size, s2.total, '重複');
});
test('[5] 条件に合う問題が0問なら開始できない', () => {
  throws(() => session({ unit: 'no-such-unit', difficulties: [1], count: 5 }), RangeError);
});

// ---------------------------------------------------------------- 6. 重複なし・ランダム
test('[6] 1回のプレイで同じ問題が重複しない（乱数 300 通り）', () => {
  for (let seed = 1; seed <= 300; seed++) {
    for (const count of [5, 10, 'all']) {
      const s = session({ unit: ['positive-negative', 'expressions', 'equation'][seed % 3], difficulties: [1, 2, 3, 4], count }, seed);
      eq(new Set(ids(s)).size, s.total, `seed=${seed} count=${count}`);
    }
  }
});
test('[6] 出題順はランダム（乱数によって順番が変わる）', () => {
  const orders = new Set();
  for (let seed = 1; seed <= 50; seed++) orders.add(ids(session({ unit: 'equation', difficulties: [1, 2, 3, 4], count: 'all' }, seed)).join(','));
  assert(orders.size > 40, `並び順の種類が少なすぎます（${orders.size}）`);
});
test('[6] 5問の出題を何度もくり返すと、対象の全問題が出題される（かたよりがない）', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 300; seed++) ids(session({ unit: 'expressions', difficulties: [1, 2, 3, 4], count: 5 }, seed)).forEach((id) => seen.add(id));
  eq(seen.size, unitSize('expressions'));
});
test('[6] errorLine を書き換えたり補正したりしない（出題後も元データと同じ）', () => {
  const s = session({ unit: 'equation', difficulties: [1, 2, 3, 4], count: 'all' });
  s.questions.forEach((q) => {
    const orig = questions.find((o) => o.id === q.id);
    assert(q === orig, `${q.id} が元データと別のオブジェクトです`);
  });
});

// ---------------------------------------------------------------- 7〜9. 選択
test('[7] 答案の行は1つだけ選択でき、別の行を選ぶと切り替わる', () => {
  const s = session({ unit: 'equation', difficulties: [1, 2, 3, 4], count: 5 });
  assert(s.selectLine(1));
  eq(JSON.stringify(s.selection), JSON.stringify({ type: 'line', index: 1 }));
  assert(s.selectLine(2));
  eq(JSON.stringify(s.selection), JSON.stringify({ type: 'line', index: 2 }));
  s.selectLine(2);
  eq(s.selection, null, '同じ行をもう一度押すと解除');
});
test('[7] 1行目（問題の再掲）と範囲外の行は選択できない', () => {
  const s = session({ unit: 'equation', difficulties: [1, 2, 3, 4], count: 5 });
  assert(!s.selectLine(0), '1行目');
  assert(!s.selectLine(s.current.answerLines.length), '範囲外');
  assert(!s.selectLine(-1), '負の index');
  assert(!s.selectLine(1.5), '小数');
  eq(s.selection, null);
});
test('[8] 「全部正しい！」を選ぶと行の選択が解除され、行を選ぶと「全部正しい！」が解除される', () => {
  const s = session({ unit: 'expressions', difficulties: [1, 2, 3, 4], count: 5 });
  s.selectLine(1);
  s.selectAllCorrect();
  eq(JSON.stringify(s.selection), JSON.stringify({ type: 'allCorrect' }));
  s.selectLine(1);
  eq(JSON.stringify(s.selection), JSON.stringify({ type: 'line', index: 1 }));
});
test('[9] 何も選んでいないときは添削できない', () => {
  const s = session({ unit: 'expressions', difficulties: [1, 2, 3, 4], count: 5 });
  eq(s.canSubmit, false);
  throws(() => s.submit(), Error);
  eq(s.results.length, 0);
});

// ---------------------------------------------------------------- 10〜13. 採点（全30問で確認）
test('[10][11][12][13] 全問題で、正しい選択は正解・それ以外の選択はすべて不正解になる', () => {
  for (const q of questions) {
    const n = q.answerLines.length;
    const choices = [{ type: 'allCorrect' }];
    for (let i = 1; i < n; i++) choices.push({ type: 'line', index: i });
    for (const c of choices) {
      const expected = q.errorLine === null ? c.type === 'allCorrect' : c.type === 'line' && c.index === q.errorLine;
      eq(G.grade(q, c).correct, expected, `${q.id} 選択 ${JSON.stringify(c)}`);
    }
  }
});
test('[10] 誤りのある答案で、最初に間違えた行を選ぶと正解', () => {
  const q = questions.find((x) => x.id === 'J1-EQ-0002'); // errorLine 3
  const r = G.grade(q, { type: 'line', index: 3 });
  eq(r.correct, true);
  eq(JSON.stringify(r.expected), JSON.stringify({ type: 'line', index: 3 }));
});
test('[11] 誤りのある答案で、別の行や「全部正しい！」を選ぶと不正解', () => {
  const q = questions.find((x) => x.id === 'J1-EQ-0002');
  eq(G.grade(q, { type: 'line', index: 2 }).correct, false);
  eq(G.grade(q, { type: 'allCorrect' }).correct, false);
});
test('[12] 正しい答案で「全部正しい！」を選ぶと正解', () => {
  eq(G.grade(questions.find((x) => x.id === 'J1-EQ-0003'), { type: 'allCorrect' }).correct, true);
});
test('[13] 正しい答案で行を選ぶと不正解', () => {
  eq(G.grade(questions.find((x) => x.id === 'J1-EQ-0003'), { type: 'line', index: 1 }).correct, false);
});

// ---------------------------------------------------------------- 14. 1回だけ判定
test('[14] 1問につき1回だけ判定され、確定後は選択も変えられない', () => {
  const s = session({ unit: 'positive-negative', difficulties: [1, 2, 3, 4], count: 5 });
  const q = s.current;
  if (q.errorLine === null) s.selectAllCorrect(); else s.selectLine(q.errorLine);
  const r1 = s.submit();
  eq(r1.correct, true);
  eq(s.correctCount, 1);
  const r2 = s.submit();
  eq(r2, r1, '2回目は同じ結果を返す');
  eq(s.correctCount, 1, '正解数が増えない');
  eq(s.results.length, 1, '結果が1件だけ');
  eq(s.canSubmit, false);
  assert(!s.selectLine(1) && !s.selectAllCorrect(), '確定後に選択を変えられた');
});
test('[14] 添削する前に次の問題へ進めない', () => {
  const s = session({ unit: 'positive-negative', difficulties: [1, 2, 3, 4], count: 5 });
  throws(() => s.next(), Error);
  eq(s.index, 0);
});

// ---------------------------------------------------------------- 16. ヒント
test('[16] ヒントを開閉でき、問題が変わると閉じる。正解数に影響しない', () => {
  const s = session({ unit: 'equation', difficulties: [1, 2, 3, 4], count: 5 });
  eq(s.toggleHint(), true);
  eq(s.toggleHint(), false);
  s.toggleHint();
  const q = s.current;
  if (q.errorLine === null) s.selectAllCorrect(); else s.selectLine(q.errorLine);
  s.submit();
  eq(s.correctCount, 1, 'ヒントを見ても正解は1問として数える');
  s.next();
  eq(s.hintOpen, false, '次の問題ではヒントは閉じている');
});

// ---------------------------------------------------------------- 17・18. 終了と集計
test('[17][18] 指定数を解き終えると終了し、正解数・正解率が正しい', () => {
  const s = session({ unit: 'expressions', difficulties: [1, 2, 3, 4], count: 5 }, 7);
  const pattern = [true, false, true, true, false]; // 3/5 = 60%
  pattern.forEach((ok, i) => {
    const q = s.current;
    if (ok) { if (q.errorLine === null) s.selectAllCorrect(); else s.selectLine(q.errorLine); }
    else chooseWrong(s);
    eq(s.submit().correct, ok, `${i + 1}問目`);
    const more = s.next();
    eq(more, i < 4, `${i + 1}問目のあと`);
  });
  eq(s.finished, true);
  const sum = s.summary();
  eq(JSON.stringify(sum), JSON.stringify({ total: 5, answered: 5, correct: 3, wrong: 2, rate: 60 }));
});
test('[18] 正解率は四捨五入した整数（例：3問中2問 → 67%）', () => {
  // 3問だけを出題する（問題数を3にして）
  const s3 = session({ unit: 'positive-negative', difficulties: [1, 2, 3, 4], count: 3 });
  eq(s3.total, 3);
  [true, true, false].forEach((ok) => {
    const q = s3.current;
    if (ok) { if (q.errorLine === null) s3.selectAllCorrect(); else s3.selectLine(q.errorLine); }
    else chooseWrong(s3);
    s3.submit(); s3.next();
  });
  eq(s3.summary().rate, 67);
});
test('[18] 評価コメントが正解率に応じて変わる', () => {
  const set = new Set([100, 80, 60, 40, 0].map(G.evaluationComment));
  eq(set.size, 5);
  eq(G.evaluationComment(80), 'いい調子！ 計算ミスを見抜く力がついてきたね！');
});

// ---------------------------------------------------------------- 19. 再挑戦
test('[19] 再挑戦（同じ条件で新しいセッション）は状態がリセットされ、問題順が作り直される', () => {
  const rng = G.createRng(42);
  const cfg = { unit: 'equation', difficulties: [1, 2, 3, 4], count: 'all' };
  const a = new G.TrainingSession(questions, cfg, rng);
  a.selectAllCorrect(); a.submit();
  const b = new G.TrainingSession(questions, cfg, rng);
  eq(b.index, 0); eq(b.correctCount, 0); eq(b.results.length, 0); eq(b.selection, null);
  eq(JSON.stringify(b.config), JSON.stringify(a.config), '条件は同じ');
  assert(ids(a).join() !== ids(b).join(), '問題順が同じままです');
  eq([...ids(a)].sort().join(), [...ids(b)].sort().join(), '出題される問題の集合は同じ');
});

// ---------------------------------------------------------------- カテゴリ
const S = require('../js/lib/question-schema.js');
test('[カテゴリ 1] 単元ごとのカテゴリ一覧が、定義の順に正しく出る（問題数つき）', () => {
  for (const unit of ['positive-negative', 'expressions', 'equation']) {
    const list = G.listCategories(questions, unit, S.UNITS[unit].categories);
    eq(list.map((c) => c.name).join(), S.UNITS[unit].categories.join(), `${unit} のカテゴリと順番`);
    list.forEach((c) => eq(c.count, countOf({ unit, categories: [c.name] }), `${unit} / ${c.name} の問題数`));
  }
});
test('[カテゴリ] 定義にないカテゴリや、定義がまだ空の単元（中2・中3）でも、問題データから一覧になる', () => {
  const extra = [...questions, { ...questions[0], id: 'J1-PN-9998', category: '新しいカテゴリ' }];
  const list = G.listCategories(extra, 'positive-negative', S.UNITS['positive-negative'].categories).map((c) => c.name);
  eq(list[list.length - 1], '新しいカテゴリ', '定義にないカテゴリは後ろに付く');
  const future = [{ ...questions[0], id: 'J2-PO-0001', unit: 'polynomials', grade: 2, category: '単項式の乗除' }];
  eq(G.listCategories(future, 'polynomials', S.UNITS.polynomials.categories).map((c) => c.name).join(), '単項式の乗除');
});
test('[カテゴリ 8] 出題対象はカテゴリと難易度の両方に一致する（それぞれの中は OR、両者は AND）', () => {
  const s = session({ unit: 'positive-negative', categories: ['加法・減法', '累乗'], difficulties: [2, 3], count: 'all' });
  const expected = questions.filter((q) => q.unit === 'positive-negative' && ['加法・減法', '累乗'].includes(q.category) && [2, 3].includes(q.difficulty));
  eq(s.total, expected.length, '問題数');
  assert(s.questions.every((q) => ['加法・減法', '累乗'].includes(q.category) && [2, 3].includes(q.difficulty)), '条件に合わない問題が出た');
  eq([...ids(s)].sort().join(), expected.map((q) => q.id).sort().join());
});
test('[カテゴリ] カテゴリ条件を渡さない・空のときは、すべてのカテゴリが対象（既存の呼び出しと互換）', () => {
  eq(G.filterPool(questions, { unit: 'expressions', difficulties: [1, 2, 3, 4] }).length, unitSize('expressions'));
  eq(G.filterPool(questions, { unit: 'expressions', categories: [], difficulties: [1, 2, 3, 4] }).length, unitSize('expressions'));
  eq(session({ unit: 'expressions', count: 'all' }).config.categories, null, 'config.categories');
});
test('[カテゴリ 9] カテゴリでしぼると出題できる最大数が変わる（累乗だけ → 累乗の問題数）', () => {
  const n = countOf({ unit: 'positive-negative', categories: ['累乗'] });
  assert(n < unitSize('positive-negative'), 'しぼっても数が変わらない');
  eq(G.filterPool(questions, { unit: 'positive-negative', categories: ['累乗'] }).length, n);
  eq(session({ unit: 'positive-negative', categories: ['累乗'], count: 10 }).total, Math.min(10, n), '10問を指定したとき');
});
test('[カテゴリ 10] 条件に合う問題が0問なら開始できない', () => {
  // 問題データにはすべてのカテゴリ×難易度の問題があるので、「文字式の表し方」の★★を取り除いたデータで確かめる
  const cond = { unit: 'expressions', categories: ['文字式の表し方'], difficulties: [2] };
  const without = questions.filter((q) => !(q.unit === 'expressions' && q.category === '文字式の表し方' && q.difficulty === 2));
  throws(() => new G.TrainingSession(without, { ...cond, count: 5 }, G.createRng(1)), RangeError);
  throws(() => session({ unit: 'positive-negative', categories: ['ないカテゴリ'], count: 5 }), RangeError);
});
test('[カテゴリ 12・14] カテゴリでしぼっても重複しない。同じ seed なら同じ順番', () => {
  const cfg = { unit: 'equation', categories: ['移項', '分数を含む方程式'], difficulties: [1, 2, 3, 4], count: 'all' };
  for (let seed = 1; seed <= 100; seed++) {
    const s = session(cfg, seed);
    eq(new Set(ids(s)).size, s.total, `seed=${seed}`);
    eq(s.total, countOf(cfg));
  }
  eq(ids(session(cfg, 7)).join(), ids(session(cfg, 7)).join());
});
test('[カテゴリ 13] 再挑戦（同じ条件で新しいセッション）でもカテゴリ条件が保たれる', () => {
  const rng = G.createRng(5);
  const cfg = { unit: 'expressions', categories: ['同類項の計算', '式の値'], difficulties: [1, 2, 3], count: 'all' };
  const a = new G.TrainingSession(questions, cfg, rng);
  const b = new G.TrainingSession(questions, a.config, rng);
  eq(JSON.stringify(b.config), JSON.stringify(a.config));
  assert(b.questions.every((q) => ['同類項の計算', '式の値'].includes(q.category)), 'カテゴリ外の問題');
});

// ---------------------------------------------------------------- データ不整合
test('データに不整合がある問題は採点せずにエラーにする', () => {
  const broken = { ...questions[0], errorLine: 99 };
  assert(G.validateForPlay(broken).length > 0);
  throws(() => G.grade(broken, { type: 'line', index: 1 }), G.GameDataError);
  const broken2 = { ...questions[0], answerLines: 'x' };
  throws(() => G.grade(broken2, { type: 'allCorrect' }), G.GameDataError);
});
test('データに不整合がある問題は出題対象から除かれる', () => {
  const broken = { ...questions[0], id: 'J1-PN-9999', errorLine: 0 };
  const pool = G.filterPool([...questions, broken], { unit: 'positive-negative', difficulties: [1, 2, 3, 4] });
  assert(!pool.includes(broken));
  eq(pool.length, unitSize('positive-negative'));
});
test('同じ seed なら同じ出題順になる（不具合の再現用）', () => {
  const cfg = { unit: 'expressions', difficulties: [1, 2, 3, 4], count: 'all' };
  eq(ids(session(cfg, 99)).join(), ids(session(cfg, 99)).join());
});

console.log(failed === 0 ? `\nすべて成功しました（${count} 件）。` : `\n${failed} / ${count} 件失敗しました。`);
process.exit(failed === 0 ? 0 : 1);
