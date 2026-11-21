#!/usr/bin/env node
/*
 * 第7段階：模範解答と同じ正しい答案の問題に、誤答パターン（variants の wrong-1）を追加する。
 *   node tools/data-additions/stage7/add-variants.js <バッチ> --check   確認だけ（データは変えない）
 *   node tools/data-additions/stage7/add-variants.js <バッチ>           確認してから追加し、AI による確認として記録する
 *
 * バッチの形（module.exports）：
 *   [{ id: 'J1-PN-0002', a: ['=…', '=…'], e: 2, type: '誤りの種類', exp: '解説' }, ...]
 *   a は答案の2行目以降（1行目＝問題は自動で入れる）。e は errorLine（答案の index）。
 *
 * - 対象は「模範解答と同じ正しい答案で、誤答パターンがまだない問題」だけ（それ以外は ERROR）。
 * - 問題の既存の項目（問題式・正しい答案・模範解答・解説・ヒント・ID・カテゴリ・難易度）は変えない。variants を足すだけ。
 * - 1問でも ERROR があれば、バッチ全体を追加しない。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const V = require(path.join(ROOT, 'tools', 'validate-questions.js'));
const QV = require(path.join(ROOT, 'js', 'question-variants.js'));
const NOTE = '第7段階：誤答パターン（wrong-1）を追加。正答版・誤答版の両方の答案、最初の誤り行、誤りの種類と解説の一致、ヒントが両方で自然なことを AI が確認。数学講師は未確認。';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const batchFile = path.resolve(args.find((a) => !a.startsWith('--')) || '');
const batch = require(batchFile);

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
const files = manifest.files.map((f) => ({ f, p: path.join(ROOT, 'data', f.file), data: JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f.file), 'utf8')) }));
const find = (id) => {
  for (const file of files) {
    const i = file.data.questions.findIndex((q) => q.id === id);
    if (i >= 0) return { file, i, q: file.data.questions[i] };
  }
  return null;
};

let nErr = 0;
const seen = new Set();
const lines = {};
const types = {};
const planned = [];
for (const item of batch) {
  const at = find(item.id);
  const tag = (s) => `[${s}] ${item.id}`;
  if (!at) { console.log(`${tag('ERROR ')} 問題が見つかりません`); nErr++; continue; }
  if (seen.has(item.id)) { console.log(`${tag('ERROR ')} バッチの中で重複しています`); nErr++; continue; }
  seen.add(item.id);
  const q = at.q;
  if (QV.kindOf(q) !== QV.KINDS.CORRECT_PENDING) {
    console.log(`${tag('ERROR ')} 誤答パターンを追加できる問題ではありません（${QV.kindOf(q)}）`);
    nErr++;
    continue;
  }
  const variant = { id: 'wrong-1', answerLines: [q.question, ...item.a], errorLine: item.e, errorType: item.type, explanation: item.exp };
  const next = { ...q, variants: [variant] };
  const res = V.validateQuestion(next, { file: at.file.data });
  const errors = res.errors;
  const warnings = res.warnings;
  const st = errors.length ? 'ERROR ' : res.manual.length ? 'MANUAL' : 'AUTO  ';
  console.log(`${tag(st)} ★${q.difficulty} ${q.category}  誤答 ${item.e + 1}行目／${variant.answerLines.length}行  ${item.type}`);
  errors.forEach((m) => console.log(`    ERROR  ${m}`));
  warnings.forEach((m) => console.log(`    WARN   ${m}`));
  res.manual.forEach((m) => console.log(`    MANUAL ${m}`));
  nErr += errors.length;
  const k = item.e >= 4 ? '5+' : String(item.e + 1);
  lines[k] = (lines[k] || 0) + 1;
  types[item.type] = (types[item.type] || 0) + 1;
  planned.push({ at, next });
}
console.log(`\nバッチ: ${batch.length}問 / 最初の誤り行 ${JSON.stringify(lines)} / errorType ${Object.keys(types).length}種類`);
console.log(`ERROR ${nErr} 件`);
if (nErr) process.exit(1);
if (checkOnly) process.exit(0);

// 追加（ファイルごとに書き込み）。追加前後で、対象以外の問題が変わっていないことを確かめる
const before = new Map(files.map((file) => [file.p, JSON.stringify(file.data.questions)]));
planned.forEach(({ at, next }) => { at.file.data.questions[at.i] = next; });
const ids = new Set(planned.map((x) => x.next.id));
for (const file of files) {
  const old = JSON.parse(before.get(file.p));
  const now = file.data.questions;
  const other = now.filter((q, i) => !ids.has(q.id) && JSON.stringify(q) !== JSON.stringify(old[i]));
  if (other.length || old.length !== now.length) { console.error('対象以外の問題が変わるため中止しました'); process.exit(1); }
}
for (const file of files) {
  if (JSON.stringify(file.data.questions) !== before.get(file.p)) fs.writeFileSync(file.p, `${JSON.stringify(file.data, null, 2)}\n`);
}
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'review-stamp.js'), '--reviewer', 'Claude Code（AIによる確認）', '--role', 'ai', '--note', NOTE, ...ids], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
console.log(`\n誤答パターンを追加しました: ${ids.size}問（AI による確認として記録）`);
