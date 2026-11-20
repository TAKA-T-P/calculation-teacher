#!/usr/bin/env node
/*
 * 検証スクリプトの異常系テスト。
 * tests/fixtures/broken/ の「わざと壊した問題データ」を検証し、
 * 想定どおりのエラー・手動確認が検出されることを確かめる。
 *   node tools/test-validator.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const outFile = path.join(os.tmpdir(), `ct-validator-test-${process.pid}.json`);
const run = spawnSync(process.execPath, [
  path.join(__dirname, 'validate-questions.js'),
  '--data', path.join(ROOT, 'tests', 'fixtures', 'broken'),
  '--review', path.join(ROOT, 'tests', 'fixtures', 'no-such-review.json'),
  '--json', outFile,
], { encoding: 'utf8' });

let failed = 0;
const check = (label, ok) => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
};

check('異常データでは終了コードが 1 になる', run.status === 1);
const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
fs.unlinkSync(outFile);
const byId = (id) => report.results.filter((r) => r.id === id);
const has = (id, field, text) => byId(id).some((r) => r[field].some((m) => m.includes(text)));

const expectations = [
  ['J1-PN-9001', 'errors', '直前の行と数学的に等価です', '誤り行に指定した行が実は正しい'],
  ['J1-PN-9002', 'errors', 'すでに直前の行と等価でなくなっています', '指定行より前に誤りがある'],
  ['J1-PN-9003', 'errors', '別の独立した誤り', '誤り行の後に別の誤りがある'],
  ['J1-PN-9004', 'errors', '正しい答案のはずですが', '正しい答案に誤った行がある'],
  ['J1-PN-9005', 'errors', 'correctSolution の', '正しい計算過程が誤っている'],
  ['J1-PN-9006', 'errors', 'KaTeX エラー', 'KaTeX で表示できない数式'],
  ['J1-PN-9007', 'errors', 'errorType が null ではありません', '正しい答案に errorType がある'],
  ['J1-PN-9008', 'errors', '範囲外', 'errorLine=0（問題の再掲行）を指定'],
  ['J1-PN-9009', 'errors', 'difficulty', '難易度が範囲外'],
  ['J1-PN-9009', 'errors', '重複', 'ID の重複'],
  ['J1-PN-9011', 'errors', '必須項目 "hint"', '必須項目の欠落'],
  ['J1-PN-9012', 'errors', 'category', '単元にないカテゴリ'],
  ['J1-EQ-9001', 'errors', '直前の行と数学的に等価です', '方程式：誤り行の指定ミス'],
  ['J1-EQ-9001', 'errors', '別の独立した誤り', '方程式：本当の誤り行を「後の別の誤り」として検出'],
  ['J1-EQ-9002', 'errors', '「x=数」の形ではありません', '方程式：正しい答案が最後まで解けていない'],
  ['J1-EQ-9003', 'manual', '自動判定できません', '2次方程式は自動合格にせず手動確認にする'],
];
for (const [id, field, text, label] of expectations) check(`${id} ${label}`, has(id, field, text));
check('J1-EQ-9003 は AUTO 扱いにならない', byId('J1-EQ-9003').every((r) => r.status !== 'AUTO'));
check('レビュー記録なしが警告される', report.results.every((r) => r.warnings.some((m) => m.includes('手動レビュー'))));

console.log(failed === 0 ? '\nすべて成功しました。' : `\n${failed} 件失敗しました。`);
process.exit(failed === 0 ? 0 : 1);
