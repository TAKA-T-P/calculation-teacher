#!/usr/bin/env node
/*
 * 第6段階：追加ずみの問題を、バッチファイルで直した内容に置きかえ、AI による確認として記録し直す。
 *   node tools/data-additions/stage6/replace-questions.js <バッチファイル> <ID> [<ID> ...] [--note "…"]
 *
 * - 中1の問題（grade 1）は置きかえない（第6段階の指示：既存の中1の300問は変更しない）。
 * - 指定した ID 以外の問題は変更しない（置きかえ前後で比べて確かめる）。
 * - 置きかえたあと、問題ごとに自動検証し、ERROR があれば元にもどして止まる。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
const noteAt = args.indexOf('--note');
const NOTE = noteAt >= 0 ? args[noteAt + 1] : '第6段階で追加。出題バランスの調整のため内容を変更。解説・ヒント・誤答の自然さ・誤り行の一意性・答えの形・難易度とカテゴリを AI が確認。数学講師は未確認。';
const rest = noteAt >= 0 ? args.filter((_, i) => i !== noteAt && i !== noteAt + 1) : args;
const [batchArg, ...ids] = rest;
if (!batchArg || !ids.length) {
  console.error('使い方: node replace-questions.js <バッチファイル> <ID> [<ID> ...] [--note "…"]');
  process.exit(1);
}
const batch = require(path.resolve(batchArg));

const touched = new Map(); // ファイル名 → 元の内容
for (const [file, list] of Object.entries(batch)) {
  const p = path.join(ROOT, 'data', file);
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  let changed = false;
  for (const q of list.filter((x) => ids.includes(x.id))) {
    if (q.grade === 1) { console.error(`${q.id}: 中1の問題は置きかえません`); process.exit(1); }
    const i = data.questions.findIndex((x) => x.id === q.id);
    if (i < 0) { console.error(`${q.id}: data/${file} にありません`); process.exit(1); }
    if (!touched.has(file)) touched.set(file, fs.readFileSync(p, 'utf8'));
    data.questions[i] = q;
    changed = true;
  }
  if (changed) fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
}
const found = [...touched.keys()].length ? ids : [];
if (!found.length) { console.error('置きかえる問題が見つかりませんでした'); process.exit(1); }

// 指定した問題以外が変わっていないこと
for (const [file, before] of touched) {
  const a = JSON.parse(before).questions;
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8')).questions;
  const other = a.filter((q, i) => !ids.includes(q.id) && JSON.stringify(q) !== JSON.stringify(b[i]));
  if (a.length !== b.length || other.length) {
    touched.forEach((text, f) => fs.writeFileSync(path.join(ROOT, 'data', f), text));
    console.error('指定した問題以外が変わったため、元にもどしました');
    process.exit(1);
  }
}

try {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'review-stamp.js'), '--reviewer', 'Claude Code（AIによる確認）', '--role', 'ai', '--note', NOTE, ...ids], { cwd: ROOT, stdio: 'inherit' });
} catch (e) {
  touched.forEach((text, f) => fs.writeFileSync(path.join(ROOT, 'data', f), text));
  console.error('自動検証または記録に失敗したため、問題データを元にもどしました');
  process.exit(1);
}
console.log(`\n置きかえ: ${ids.length}問（${ids.join(', ')}）`);
