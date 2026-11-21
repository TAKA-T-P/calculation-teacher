#!/usr/bin/env node
/*
 * 第4段階：確認ずみのバッチを正式なデータに追加し、AI によるレビュー記録を残す。
 *   node tools/data-additions/stage4/add-batch.js tools/data-additions/stage4/batch-01-pn-addsub.js
 *
 * 手順（どれかが失敗したらそこで止まる）：
 *   1. check-batch.js で確認（ERROR があれば追加しない）
 *   2. ../append-questions.js で data/*.json の末尾に追記（既存の問題は変更しない・同じ ID は追記しない）
 *   3. 既存の問題が変わっていないことを確認（追記前後で、既存の問題の内容が同じ）
 *   4. review-stamp.js で、AI（Claude Code）による確認として記録（--role ai）。数学講師の確認ではない
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const batchFile = path.resolve(process.argv[2] || '');
const REVIEWER = 'Claude Code（AIによる確認）';
const NOTE = process.argv[3] || '第4段階で追加。解説・ヒント・誤答の自然さ・誤り行の一意性・難易度とカテゴリを AI が確認。数学講師は未確認。';

const run = (args) => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
const snapshot = () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manifest.json'), 'utf8'));
  return Object.fromEntries(manifest.files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f.file), 'utf8')).questions.map((q) => [q.id, JSON.stringify(q)])));
};

run([path.join(__dirname, 'check-batch.js'), batchFile]);
const before = snapshot();
run([path.join(__dirname, '..', 'append-questions.js'), batchFile]);
const after = snapshot();
const changed = Object.keys(before).filter((id) => before[id] !== after[id]);
if (changed.length) {
  console.error(`既存の問題が変わっています: ${changed.join(', ')}`);
  process.exit(1);
}
const ids = Object.values(require(batchFile)).flat().map((q) => q.id).filter((id) => !(id in before));
if (ids.length) run([path.join(ROOT, 'tools', 'review-stamp.js'), '--reviewer', REVIEWER, '--role', 'ai', '--note', NOTE, ...ids]);
console.log(`\n追加: ${ids.length}問 / 既存の問題の変更: 0問`);
