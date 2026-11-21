#!/usr/bin/env node
/*
 * 追加問題を data/*.json の questions 配列の末尾に追記する。
 *   node tools/data-additions/append-questions.js tools/data-additions/stage3-questions.js
 * - 既存の問題は1文字も変えない（ファイルの末尾 "  ]\n}" の直前に挿入する）。
 * - すでに同じ ID があるときは追記しない（2回実行しても重複しない）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = path.resolve(process.argv[2] || path.join(__dirname, 'stage3-questions.js'));
const additions = require(src);
const DATA = path.join(__dirname, '..', '..', 'data');

const indent = (text, n) => text.split('\n').map((l) => ' '.repeat(n) + l).join('\n');

for (const [file, questions] of Object.entries(additions)) {
  const p = path.join(DATA, file);
  const raw = fs.readFileSync(p, 'utf8');
  const existing = new Set(JSON.parse(raw).questions.map((q) => q.id));
  const fresh = questions.filter((q) => !existing.has(q.id));
  if (!fresh.length) { console.log(`${file}: 追加する問題はありません`); continue; }
  if (JSON.parse(raw).questions.length === 0) {
    // まだ問題が1問もないファイル（第6段階の新しい単元）は、ファイル全体を書く
    const data = JSON.parse(raw);
    const body = fresh.map((q) => indent(JSON.stringify(q, null, 2), 4)).join(',\n');
    const out = `{\n  "schemaVersion": ${data.schemaVersion},\n  "grade": ${data.grade},\n  "unit": "${data.unit}",\n  "questions": [\n${body}\n  ]\n}\n`;
    JSON.parse(out);
    fs.writeFileSync(p, out);
    console.log(`${file}: ${fresh.length} 問を追加しました（${fresh.map((q) => q.id).join(', ')}）`);
    continue;
  }
  const m = /\n(\s*)\]\s*\n\}\s*$/.exec(raw);
  if (!m) throw new Error(`${file}: 末尾の形式が想定と違います`);
  const head = raw.slice(0, m.index);
  const body = fresh.map((q) => indent(JSON.stringify(q, null, 2), 4)).join(',\n');
  const out = `${head},\n${body}\n  ]\n}\n`;
  JSON.parse(out); // 書き込む前に JSON として正しいか確かめる
  fs.writeFileSync(p, out);
  console.log(`${file}: ${fresh.length} 問を追加しました（${fresh.map((q) => q.id).join(', ')}）`);
}
