#!/usr/bin/env node
/*
 * question-report.js
 * 問題データの集計レポート（制作の進捗・出題バランス・レビュー状況）。
 *
 *   node tools/question-report.js                 コンソールに表示
 *   node tools/question-report.js --json out.json JSON にも書き出す
 *   node tools/question-report.js --csv out.csv   問題ごとの一覧を CSV に書き出す
 *   node tools/question-report.js --strict        バランスの WARN があれば終了コード 1（完成判定用）
 *   node tools/question-report.js --classify out.csv（または .json）
 *       第7段階：もともと「全部正しい！」だった問題の分類（模範解答と同じ／別解）を書き出す
 *
 * 第7段階から、1つの問題に正答パターンと誤答パターンを登録し、出題のたびに切り替える（js/question-variants.js）。
 *  - 「登録データの全部正しい！」は、問題データの基本の答案（answerLines）が正しい答案の問題の数（第6段階までと同じ数え方）。
 *  - 「理論上の出題率」は、答案パターンの抽選（正答25%・誤答75%、別解の問題はいつも正答）から計算した、
 *    1問を出したときに「全部正しい！」が正解になる確率の平均。実際のプレイでは、選んだカテゴリ・難易度や
 *    出題された問題によって変わる。
 *  - 最初の誤り行・errorType の集計は、登録したすべての誤答パターン（既存の誤答＋第7段階で追加した誤答）が対象。
 *
 * - 数学的な不整合（ERROR）は validate-questions.js の判定をそのまま使う。
 * - このスクリプトが出す WARN は「出題バランス・制作目標」に関するもので、数学的な誤りではない。
 *   WARN が出ても、数学的に正しい問題を自動で書き換えたり除外したりはしない。
 * - 類題候補は「式の形・誤り行・errorType が同じ」ものを機械的に挙げるだけ。類題かどうかは人が判断する。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const V = require('./validate-questions.js');
const S = require('../js/lib/question-schema.js');
const QV = require('../js/question-variants.js');

/** 別解の正答問題（模範解答と途中式が違う正しい答案）について、AI が内容を確認した記録 */
const ALTERNATIVE_NOTES = {
  'J1-PN-0010': '分配法則で (-12) をかっこの中にかけてから計算している（模範解答はかっこの中を通分してから計算）',
  'J1-PN-0015': '小数を分数に直してから計算している（模範解答は小数のまま逆数をかけて計算）',
  'J1-EQ-0003': '文字の項を右辺、数の項を左辺に移項している（模範解答は文字の項を左辺に集める）',
  'J1-EQ-0016': '両辺を 20 倍して係数を整数にしている（模範解答は 100 倍）',
};

// ------------------------------------------------------------------ 第4段階の目標
const TARGETS = {
  perUnit: 100,
  perCategory: 25,
  perDifficulty: 25,
  // カテゴリ×難易度：25問を4難易度へ 6〜7問ずつ。この範囲を外れたら WARN
  perCell: { min: 5, max: 8 },
  // 「全部正しい！」の割合（単元ごと・全体）
  correctRatio: { min: 0.25, max: 0.30 },
  // 1つのカテゴリの「全部正しい！」の割合がこれを超えたら偏りとして WARN
  correctRatioPerCategoryMax: 0.45,
  // 誤答の最初の誤り行（画面の「○行目」。index+1）の目安。tolerance 以上ずれたら WARN
  errorLineShare: { 2: 0.25, 3: 0.35, 4: 0.25, '5+': 0.15 },
  errorLineTolerance: 0.10,
  // 誤り行の目安を当てはめない単元（第6段階の指示：連立方程式は答案が6〜7行と長いため、目安は柔軟に扱う）。参考として表示だけする
  errorLineShareExempt: ['simultaneous-equations'],
  // 1つの errorType が単元の誤答に占める割合の上限
  errorTypeShareMax: 0.10,
  // 第7段階：理論上の「全部正しい！」の出題率が、正答パターンの確率（25%）をこれ以上こえたら WARN（別解の問題が多すぎる）
  correctProbabilityTolerance: 0.05,
};

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

/** レビュー記録の確認者が AI か数学講師か。reviewerRole があればそれを使い、なければ名前から判断する */
function reviewerRole(rv) {
  if (!rv) return null;
  if (rv.reviewerRole === 'ai' || rv.reviewerRole === 'teacher') return rv.reviewerRole;
  return /claude|ai|ＡＩ/i.test(rv.reviewer || '') ? 'ai' : 'teacher';
}

const lineKey = (errorLine) => (errorLine === null ? null : errorLine + 1 >= 5 ? '5+' : String(errorLine + 1));

/** 類題候補を見つけるための「式の形」：数字を # に置きかえ、空白を除く */
function shapeOf(latex) {
  return latex.replace(/\s+/g, '').replace(/\d+(\.\d+)?/g, '#');
}

function load() {
  const manifest = JSON.parse(fs.readFileSync(path.join(V.DATA_DIR, 'manifest.json'), 'utf8'));
  const reviews = fs.existsSync(V.REVIEW_FILE) ? JSON.parse(fs.readFileSync(V.REVIEW_FILE, 'utf8')).reviews || {} : {};
  const items = [];
  for (const f of manifest.files) {
    const data = JSON.parse(fs.readFileSync(path.join(V.DATA_DIR, f.file), 'utf8'));
    for (const q of data.questions) {
      const res = V.validateQuestion(q, { file: data });
      const rv = reviews[q.id];
      const review = !rv ? 'missing' : rv.hash === V.questionHash(q) ? 'ok' : 'stale';
      items.push({
        q,
        unit: f.unit,
        status: res.errors.length ? 'ERROR' : res.manual.length ? 'MANUAL' : 'AUTO',
        errors: res.errors,
        review,
        role: review === 'ok' ? reviewerRole(rv) : null,
        variants: res.variants || [],
        kind: QV.kindOf(q),
      });
    }
  }
  return { manifest, items };
}

/** レポートの中身を作る（テストからも使う） */
function buildReport({ manifest, items }) {
  const warnings = [];
  const warn = (scope, msg) => warnings.push({ scope, msg });
  const notes = []; // WARN にしない参考情報（目安を柔軟に扱う単元など）
  const units = manifest.files.map((f) => f.unit);
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

  const unitReports = units.map((unit) => {
    const def = S.UNITS[unit];
    const qs = items.filter((it) => it.unit === unit);
    const cats = def.categories;
    const matrix = Object.fromEntries(cats.map((c) => [c, [1, 2, 3, 4].map((d) => qs.filter((it) => it.q.category === c && it.q.difficulty === d).length)]));
    const byCategory = Object.fromEntries(cats.map((c) => [c, qs.filter((it) => it.q.category === c).length]));
    const byDifficulty = Object.fromEntries([1, 2, 3, 4].map((d) => [d, qs.filter((it) => it.q.difficulty === d).length]));
    const correct = qs.filter((it) => it.q.errorLine === null);
    const correctByCategory = Object.fromEntries(cats.map((c) => [c, correct.filter((it) => it.q.category === c).length]));
    // 誤答パターン（既存の誤答＋第7段階で追加した誤答）
    const wrong = qs.flatMap((it) => QV.variantsOf(it.q).filter((v) => v.type === QV.TYPES.INCORRECT));
    const errorLines = { 2: 0, 3: 0, 4: 0, '5+': 0 };
    wrong.forEach((v) => { errorLines[lineKey(v.errorLine)]++; });
    const errorTypes = {};
    wrong.forEach((v) => { errorTypes[v.errorType] = (errorTypes[v.errorType] || 0) + 1; });
    // 答案パターン（第7段階）
    const patternStatus = (type) => {
      const st = { AUTO: 0, MANUAL: 0, ERROR: 0 };
      qs.forEach((it) => it.variants.filter((v) => v.type === type).forEach((v) => { st[v.status]++; }));
      return st;
    };
    const variants = {
      patterns: qs.reduce((a, it) => a + QV.variantsOf(it.q).length, 0),
      switchable: qs.filter((it) => it.kind === QV.KINDS.SWITCHABLE).length,
      alternative: qs.filter((it) => it.kind === QV.KINDS.ALTERNATIVE).length,
      pending: qs.filter((it) => it.kind === QV.KINDS.CORRECT_PENDING).length,
      addedIncorrect: qs.filter((it) => (it.q.variants || []).length).length,
      modelCorrect: qs.filter((it) => it.q.errorLine !== null).length,
      correctStatus: patternStatus(QV.TYPES.CORRECT),
      incorrectStatus: patternStatus(QV.TYPES.INCORRECT),
      correctProbability: pct(qs.reduce((a, it) => a + QV.correctProbability(it.q), 0), qs.length),
    };
    const status = { AUTO: 0, MANUAL: 0, ERROR: 0 };
    qs.forEach((it) => { status[it.status]++; });
    const review = {
      ai: qs.filter((it) => it.role === 'ai').length,
      teacher: qs.filter((it) => it.role === 'teacher').length,
      stale: qs.filter((it) => it.review === 'stale').length,
      missing: qs.filter((it) => it.review === 'missing').length,
    };
    // 完成数：自動検証で ERROR がなく、最新の内容でレビュー記録がある問題だけ
    const done = qs.filter((it) => it.status !== 'ERROR' && it.review === 'ok').length;

    // ---- 目標との比較（バランスの WARN）
    const label = def.label;
    if (qs.length !== TARGETS.perUnit) warn(label, `問題数 ${qs.length}（目標 ${TARGETS.perUnit}）`);
    cats.forEach((c) => { if (byCategory[c] !== TARGETS.perCategory) warn(label, `カテゴリ「${c}」 ${byCategory[c]}問（目標 ${TARGETS.perCategory}）`); });
    [1, 2, 3, 4].forEach((d) => { if (byDifficulty[d] !== TARGETS.perDifficulty) warn(label, `難易度 ★${d} ${byDifficulty[d]}問（目標 ${TARGETS.perDifficulty}）`); });
    cats.forEach((c) => matrix[c].forEach((n, i) => {
      if (n < TARGETS.perCell.min || n > TARGETS.perCell.max) warn(label, `「${c}」×★${i + 1} が ${n}問（目安 ${TARGETS.perCell.min}〜${TARGETS.perCell.max}）`);
    }));
    // 第7段階：登録データの「全部正しい！」の割合ではなく、答案パターンの状態で判断する
    //  - 模範解答と同じ正しい答案なのに誤答パターンがない問題（いつも正答で出る）
    //  - 理論上の「全部正しい！」の出題率が、正答パターンの確率から大きく外れていないか
    if (variants.pending) warn(label, `誤答パターンの追加が必要な問題が ${variants.pending}問あります（模範解答と同じ正しい答案で、いつも「全部正しい！」で出題される）`);
    if (variants.correctProbability > (QV.CORRECT_VARIANT_RATE + TARGETS.correctProbabilityTolerance) * 100) {
      warn(label, `理論上の「全部正しい！」の出題率が ${variants.correctProbability}%（正答パターンの確率 ${QV.CORRECT_VARIANT_RATE * 100}% から大きく外れています）`);
    }
    cats.forEach((c) => {
      if (byCategory[c] >= 8 && correctByCategory[c] / byCategory[c] > TARGETS.correctRatioPerCategoryMax) {
        warn(label, `カテゴリ「${c}」の「全部正しい！」が ${correctByCategory[c]}/${byCategory[c]}問で多い`);
      }
    });
    if (wrong.length >= 20) {
      Object.entries(TARGETS.errorLineShare).forEach(([k, share]) => {
        const actual = errorLines[k] / wrong.length;
        if (Math.abs(actual - share) <= TARGETS.errorLineTolerance) return;
        if (TARGETS.errorLineShareExempt.includes(unit)) notes.push(`[${label}] 最初の誤りが${k}行目の答案が ${pct(errorLines[k], wrong.length)}%（目安 ${share * 100}%。答案が長い単元のため WARN にしない）`);
        else warn(label, `最初の誤りが${k}行目の答案が ${pct(errorLines[k], wrong.length)}%（目安 ${share * 100}%）`);
      });
      Object.entries(errorTypes).forEach(([t, n]) => {
        if (n >= 3 && n / wrong.length > TARGETS.errorTypeShareMax) warn(label, `errorType「${t}」が ${n}問（誤答の ${pct(n, wrong.length)}%）`);
      });
    }
    return {
      unit, label, total: qs.length, done, target: TARGETS.perUnit,
      byCategory, byDifficulty, matrix, correct: correct.length, correctRatio: pct(correct.length, qs.length), correctByCategory,
      wrong: wrong.length, errorLines, errorTypes, status, review, variants,
    };
  });

  // ---- 類題候補（同じ単元・カテゴリで、問題式の形・誤り行・errorType が同じもの）
  const groups = new Map();
  items.forEach((it) => {
    const key = [it.unit, it.q.category, shapeOf(it.q.question), it.q.errorLine, it.q.errorType].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it.q.id);
  });
  const similar = [...groups.values()].filter((ids) => ids.length > 1);

  const total = items.length;
  const totalCorrect = items.filter((it) => it.q.errorLine === null).length;
  return {
    generatedAt: new Date().toISOString(),
    targets: TARGETS,
    total,
    done: unitReports.reduce((a, u) => a + u.done, 0),
    correctRatio: pct(totalCorrect, total),
    correctProbability: pct(items.reduce((a, it) => a + QV.correctProbability(it.q), 0), total),
    patterns: items.reduce((a, it) => a + QV.variantsOf(it.q).length, 0),
    errors: items.filter((it) => it.status === 'ERROR').map((it) => ({ id: it.q.id, errors: it.errors })),
    units: unitReports,
    similar,
    warnings,
    notes,
  };
}

function printReport(rep) {
  const line = (s = '') => console.log(s);
  line('計算ティーチャー！ 問題データ集計レポート');
  line('（WARN は出題バランス・制作目標に関するもの。数学的な誤りは「数学的な検証」の ERROR を見てください）\n');

  line('=== 制作の進捗（完成＝自動検証で ERROR なし、かつ最新の内容でレビュー記録あり）');
  line('| 単元 | 完成数 | 問題数 | 目標 | 未作成 |');
  line('|---|---:|---:|---:|---:|');
  rep.units.forEach((u) => line(`| ${u.label} | ${u.done} | ${u.total} | ${u.target} | ${Math.max(0, u.target - u.total)} |`));
  line(`| 合計 | ${rep.done} | ${rep.total} | ${rep.units.length * TARGETS.perUnit} | ${rep.units.reduce((a, u) => a + Math.max(0, u.target - u.total), 0)} |`);

  for (const u of rep.units) {
    line(`\n=== ${u.label}（${u.total}問）`);
    line('カテゴリ×難易度（括弧内は「全部正しい！」の数）');
    line(`  ${'カテゴリ'.padEnd(10, '　')}  ★   ★★  ★★★ ★★★★  計`);
    Object.entries(u.matrix).forEach(([c, row]) => {
      line(`  ${c.padEnd(10, '　')} ${row.map((n) => String(n).padStart(3)).join('  ')}  ${String(u.byCategory[c]).padStart(3)}（${u.correctByCategory[c]}）`);
    });
    line(`  ${'計'.padEnd(10, '　')} ${[1, 2, 3, 4].map((d) => String(u.byDifficulty[d]).padStart(3)).join('  ')}  ${String(u.total).padStart(3)}（${u.correct}）`);
    line(`登録データの「全部正しい！」（基本の答案）: ${u.correct}問（${u.correctRatio}%）`);
    const v = u.variants;
    line(`答案パターン: ${v.patterns}個（問題ID ${u.total}） / 正答・誤答を切り替える問題 ${v.switchable}問（既存の誤答に正答版 ${v.modelCorrect}問・正答に誤答を追加 ${v.addedIncorrect}問） / 別解の正答（いつも正答） ${v.alternative}問 / 誤答の追加が必要 ${v.pending}問`);
    line(`理論上の「全部正しい！」の出題率: ${v.correctProbability}%（正答パターン ${QV.CORRECT_VARIANT_RATE * 100}%・別解はいつも正答。実際のプレイでは選んだ条件や出題された問題で変わります）`);
    line(`答案パターンの自動検証: 正答 AUTO ${v.correctStatus.AUTO} / MANUAL ${v.correctStatus.MANUAL} / ERROR ${v.correctStatus.ERROR}、誤答 AUTO ${v.incorrectStatus.AUTO} / MANUAL ${v.incorrectStatus.MANUAL} / ERROR ${v.incorrectStatus.ERROR}`);
    const el = u.errorLines;
    const share = (n) => (u.wrong ? `${Math.round((n / u.wrong) * 100)}%` : '-');
    line(`最初の誤り行（誤答パターン ${u.wrong}個）: 2行目 ${el[2]}（${share(el[2])}） / 3行目 ${el[3]}（${share(el[3])}） / 4行目 ${el[4]}（${share(el[4])}） / 5行目以降 ${el['5+']}（${share(el['5+'])}）`);
    const types = Object.entries(u.errorTypes).sort((a, b) => b[1] - a[1]);
    line(`errorType: ${types.length}種類（多い順）`);
    types.slice(0, 8).forEach(([t, n]) => line(`    ${String(n).padStart(2)}  ${t}`));
    if (types.length > 8) line(`    …ほか ${types.length - 8} 種類（すべて ${types.slice(8).every(([, n]) => n === 1) ? '1問ずつ' : '2問以下'}）`);
    line(`自動検証: AUTO ${u.status.AUTO} / MANUAL ${u.status.MANUAL} / ERROR ${u.status.ERROR}`);
    line(`レビュー: AI（Claude Code）${u.review.ai} / 数学講師 ${u.review.teacher} / レビュー後に変更 ${u.review.stale} / 未レビュー ${u.review.missing}`);
  }

  line('\n=== 数学的な検証');
  if (rep.errors.length) rep.errors.forEach((e) => line(`ERROR ${e.id}: ${e.errors[0]}`));
  else line('ERROR 0 件（詳細は npm run validate）');

  line('\n=== 類題候補（カテゴリ・式の形・誤り行・errorType が同じ。類題かどうかは人が確認してください）');
  if (rep.similar.length) rep.similar.forEach((ids) => line(`  ${ids.join(' / ')}`));
  else line('  なし');

  line('\n=== 出題バランス・制作目標の WARN');
  if (rep.warnings.length) rep.warnings.forEach((w) => line(`WARN  [${w.scope}] ${w.msg}`));
  else line('なし');
  rep.notes.forEach((n) => line(`参考  ${n}`));
  line(`\n全体: ${rep.total}問（完成 ${rep.done}問）・答案パターン ${rep.patterns}個・登録データの「全部正しい！」${rep.correctRatio}%・理論上の「全部正しい！」の出題率 ${rep.correctProbability}%・バランスの WARN ${rep.warnings.length} 件`);
}

/**
 * 第7段階の分類：もともと「全部正しい！」だった問題（基本の答案が正しい答案）を、
 * 模範解答と同じ（誤答パターンを追加して切り替える）／別解（いつも正答）に分ける。
 */
function classify(items) {
  return items.filter((it) => it.q.errorLine === null).map((it) => {
    const q = it.q;
    const same = QV.sameAsModel(q);
    let reason;
    if (same) reason = '答案の途中式が模範解答（correctSolution）と同じ（空白などの表記の差だけ）';
    else {
      const diffAt = q.answerLines.findIndex((l, i) => (q.correctSolution[i] || '').replace(/\s+/g, '') !== l.replace(/\s+/g, ''));
      reason = `模範解答と途中式が違う（答案 ${q.answerLines.length}行・模範解答 ${q.correctSolution.length}行、${diffAt + 1}行目から違う）${ALTERNATIVE_NOTES[q.id] ? `：${ALTERNATIVE_NOTES[q.id]}` : ''}`;
    }
    return {
      id: q.id,
      grade: q.grade,
      unit: (S.UNITS[q.unit] || {}).label || q.unit,
      category: q.category,
      difficulty: q.difficulty,
      sameAsModel: same,
      reason,
      needsIncorrect: same,
      incorrectAdded: (q.variants || []).length > 0,
      judgedBy: same ? '自動判定（途中式の比較）' : (ALTERNATIVE_NOTES[q.id] ? '自動判定＋AI による内容確認' : '自動判定（AI の確認が必要）'),
      teacherReview: same ? '不要（途中式が同じことを機械的に確認）' : '必要（別解として妥当か）',
    };
  });
}

function classifyCsv(rows) {
  const esc = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
  const head = ['問題ID', '学年', '単元', 'カテゴリ', '難易度', '模範解答と同一か', '判定理由', '誤答追加が必要か', '誤答追加済み', '判定方法', '数学講師による確認'];
  const body = rows.map((r) => [r.id, `中${r.grade}`, r.unit, r.category, r.difficulty, r.sameAsModel ? '同一' : '別解', r.reason, r.needsIncorrect ? '必要' : '不要', r.incorrectAdded ? '済み' : '', r.judgedBy, r.teacherReview]);
  return '\ufeff' + [head, ...body].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

function toCsv(items) {
  const esc = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
  const head = ['id', 'unit', 'category', 'difficulty', 'correctAnswer', 'firstErrorLine', 'errorType', 'lines', 'verification', 'review', 'reviewer', 'variantKind', 'variants', 'correctProbability'];
  const rows = items.map((it) => [
    it.q.id, it.unit, it.q.category, it.q.difficulty, it.q.errorLine === null ? '全部正しい' : '誤りあり',
    it.q.errorLine === null ? '' : it.q.errorLine + 1, it.q.errorType || '', it.q.answerLines.length, it.status,
    it.review, it.role === 'ai' ? 'AI' : it.role === 'teacher' ? '数学講師' : '',
    it.kind, QV.variantsOf(it.q).map((v) => v.id).join(' '), QV.correctProbability(it.q),
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

if (require.main === module) {
  const data = load();
  const rep = buildReport(data);
  printReport(rep);
  const jsonOut = argValue('--json');
  const csvOut = argValue('--csv');
  if (jsonOut) { fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(rep, null, 2)); console.log(`JSON を書き出しました: ${jsonOut}`); }
  if (csvOut) { fs.writeFileSync(path.resolve(csvOut), toCsv(data.items)); console.log(`CSV を書き出しました: ${csvOut}`); }
  const classifyOut = argValue('--classify');
  if (classifyOut) {
    const rows = classify(data.items);
    fs.writeFileSync(path.resolve(classifyOut), /\.json$/i.test(classifyOut) ? JSON.stringify(rows, null, 2) : classifyCsv(rows));
    console.log(`分類を書き出しました: ${classifyOut}（${rows.length}問：模範解答と同じ ${rows.filter((r) => r.sameAsModel).length}問・別解 ${rows.filter((r) => !r.sameAsModel).length}問）`);
  }
  if (rep.errors.length) process.exit(1);
  if (args.includes('--strict') && rep.warnings.length) process.exit(1);
} else {
  module.exports = { TARGETS, buildReport, load, reviewerRole, shapeOf, classify, ROOT };
}
