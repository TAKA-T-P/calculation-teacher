#!/usr/bin/env node
/*
 * 第4段階：追加する問題のバッチを、data/*.json に入れる前に確認する。
 *   node tools/data-additions/stage4/check-batch.js tools/data-additions/stage4/batch-01-pn-add.js
 *
 * 確認すること：
 *   - validate-questions.js と同じ自動検証（必須項目・KaTeX・各行の等価性・最初の誤り行・誤りのあとの一貫性・正しい計算過程）
 *   - ID が既存データ・バッチ内で重複していないか、既存の問題が書き換わらないか（同じ ID は追記しない）
 *   - 既存の問題・バッチ内の問題と「式の形・誤り行・errorType」が同じ類題候補（人が確認する）
 *   - 同じ問題式がすでにないか
 * ERROR があれば終了コード 1（そのバッチは追加しない）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const V = require('../../validate-questions.js');
const { shapeOf } = require('../../question-report.js');

const file = path.resolve(process.argv[2] || '');
const batch = require(file);
const manifest = JSON.parse(fs.readFileSync(path.join(V.DATA_DIR, 'manifest.json'), 'utf8'));
const existing = manifest.files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(V.DATA_DIR, f.file), 'utf8')).questions);
const existingIds = new Set(existing.map((q) => q.id));

let nErr = 0;
let nWarn = 0;
const seen = new Set();
const sigs = new Map(existing.map((q) => [[q.unit, q.category, shapeOf(q.question), q.errorLine, q.errorType].join('|'), q.id]));
const questionsSeen = new Map(existing.map((q) => [q.question.replace(/\s+/g, ''), q.id]));
const tally = { correct: 0, lines: {}, diff: {}, cat: {} };

for (const [dataFile, questions] of Object.entries(batch)) {
  const data = JSON.parse(fs.readFileSync(path.join(V.DATA_DIR, dataFile), 'utf8'));
  console.log(`=== ${dataFile}（${questions.length}問）`);
  for (const q of questions) {
    const res = V.validateQuestion(q, { file: data });
    if (existingIds.has(q.id)) res.errors.push(`ID ${q.id} はすでにデータにあります（追記しません。既存の問題は変更しない）`);
    if (seen.has(q.id)) res.errors.push(`ID ${q.id} がバッチ内で重複しています`);
    seen.add(q.id);
    const sig = [q.unit, q.category, shapeOf(q.question), q.errorLine, q.errorType].join('|');
    if (sigs.has(sig)) res.warnings.push(`類題候補：${sigs.get(sig)} と式の形・誤り行・errorType が同じです（人が確認）`);
    else sigs.set(sig, q.id);
    const qk = q.question.replace(/\s+/g, '');
    if (questionsSeen.has(qk)) res.errors.push(`同じ問題式が ${questionsSeen.get(qk)} にあります`);
    else questionsSeen.set(qk, q.id);
    const tag = res.errors.length ? 'ERROR ' : res.manual.length ? 'MANUAL' : 'AUTO  ';
    const kind = q.errorLine === null ? '全部正しい' : `${q.errorLine + 1}行目`;
    console.log(`[${tag}] ${q.id} ★${q.difficulty} ${q.category} ${kind} ${q.answerLines.length}行  ${q.errorType || ''}`);
    res.errors.forEach((m) => console.log(`    ERROR  ${m}`));
    res.warnings.forEach((m) => console.log(`    WARN   ${m}`));
    res.manual.forEach((m) => console.log(`    MANUAL ${m}`));
    nErr += res.errors.length;
    nWarn += res.warnings.length;
    if (q.errorLine === null) tally.correct++;
    else tally.lines[q.errorLine + 1] = (tally.lines[q.errorLine + 1] || 0) + 1;
    tally.diff[q.difficulty] = (tally.diff[q.difficulty] || 0) + 1;
    tally.cat[q.category] = (tally.cat[q.category] || 0) + 1;
  }
}
console.log(`\nバッチの内訳: 難易度 ${JSON.stringify(tally.diff)} / 全部正しい ${tally.correct} / 最初の誤り行 ${JSON.stringify(tally.lines)} / カテゴリ ${JSON.stringify(tally.cat)}`);
console.log(`ERROR ${nErr} 件 / WARN ${nWarn} 件`);
process.exit(nErr ? 1 : 0);
