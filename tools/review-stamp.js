#!/usr/bin/env node
/*
 * 手動レビューの記録を残す。
 *
 *   node tools/review-stamp.js --reviewer "山田" J1-PN-0001 J1-PN-0002
 *   node tools/review-stamp.js --reviewer "山田" --note "別解として妥当" J1-EQ-0003
 *   node tools/review-stamp.js --reviewer "山田" --all
 *   node tools/review-stamp.js --list            （レビュー状況の一覧）
 *   node tools/review-stamp.js --reviewer "Claude Code（AIによる確認）" --role ai J1-PN-0017 ...
 *
 * --role は確認者の種類（ai：AI による確認 / teacher：数学講師による確認）。省略時は名前から判断する
 * （「Claude」「AI」を含めば ai、それ以外は teacher）。AI の確認を数学講師の確認として記録しないこと。
 *
 * - 記録は review/manual-review.json に保存する。
 * - 問題データの内容のハッシュ（SHA-256）を一緒に保存するので、レビュー後に問題を
 *   書き換えると validate-questions.js が「要再レビュー」と警告する。
 * - 自動検証でエラーがある問題は記録できない（先にデータを直す）。
 *
 * レビューで確認する項目（docs/question-data-spec.md の「手動確認チェックリスト」）：
 *   正しい答え / 誤り行の一意性 / 誤答の自然さ / 解説と誤りの一致 / ヒントの正確さ /
 *   表記・答えの形 / 別解の妥当性 / 難易度・カテゴリの妥当性
 */
'use strict';
const fs = require('fs');
const path = require('path');
const V = require('./validate-questions.js');

const args = process.argv.slice(2);
const val = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const reviewer = val('--reviewer');
const note = val('--note');
const roleArg = val('--role');
if (roleArg && !['ai', 'teacher'].includes(roleArg)) { console.error('--role は ai か teacher です'); process.exit(1); }
const all = args.includes('--all');
const list = args.includes('--list');
const flagValues = new Set([reviewer, note, roleArg].filter(Boolean));
const ids = args.filter((a) => !a.startsWith('--') && !flagValues.has(a));

const CHECKS = [
  '正しい答え',
  '誤り行の一意性',
  '誤答の自然さ',
  '解説と誤りの一致',
  'ヒントの正確さ',
  '表記・答えの形',
  '別解の妥当性',
  '難易度・カテゴリ',
];

function loadQuestions() {
  const manifest = JSON.parse(fs.readFileSync(path.join(V.DATA_DIR, 'manifest.json'), 'utf8'));
  return manifest.files.flatMap((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(V.DATA_DIR, f.file), 'utf8'));
    return data.questions.map((q) => ({ q, file: data }));
  });
}

function loadReviews() {
  if (!fs.existsSync(V.REVIEW_FILE)) return { schemaVersion: 1, reviews: {} };
  return JSON.parse(fs.readFileSync(V.REVIEW_FILE, 'utf8'));
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const items = loadQuestions();
const store = loadReviews();

if (list) {
  for (const { q } of items) {
    const rv = store.reviews[q.id];
    const role = rv && (rv.reviewerRole || (/claude|ai|ＡＩ/i.test(rv.reviewer || '') ? 'ai' : 'teacher')) === 'ai' ? '［AI］' : '［数学講師］';
    const st = !rv ? '未レビュー' : rv.hash === V.questionHash(q) ? `済 ${rv.reviewedAt} ${role}${rv.reviewer}` : '要再レビュー（内容変更あり）';
    console.log(`${q.id}  ${st}${rv && rv.note ? `  / ${rv.note}` : ''}`);
  }
  process.exit(0);
}

if (!reviewer || (!all && ids.length === 0)) {
  console.error('使い方: node tools/review-stamp.js --reviewer "名前" [--note "メモ"] (--all | ID ...)');
  process.exit(1);
}

const targets = all ? items : ids.map((id) => {
  const found = items.find((it) => it.q.id === id);
  if (!found) { console.error(`問題 ${id} が見つかりません`); process.exit(1); }
  return found;
});

let stamped = 0;
for (const { q, file } of targets) {
  const res = V.validateQuestion(q, { file });
  if (res.errors.length) {
    console.error(`× ${q.id}: 自動検証のエラーがあるため記録しません（${res.errors[0]}）`);
    continue;
  }
  const prev = store.reviews[q.id];
  // --all では、内容が変わっていない既存の記録（個別メモ付きなど）は上書きしない
  if (all && prev && prev.hash === V.questionHash(q)) continue;
  const role = roleArg || (/claude|ai|ＡＩ/i.test(reviewer) ? 'ai' : 'teacher');
  // 数学講師の確認の記録は消さない：新しく記録するときは、それまでの数学講師の記録を history に残す
  // （AI の確認で、数学講師の確認済みを上書きしたことにならないようにする）
  const history = prev ? (prev.history || []).slice() : [];
  if (prev && (prev.reviewerRole || (/claude|ai|ＡＩ/i.test(prev.reviewer || '') ? 'ai' : 'teacher')) === 'teacher') {
    const { history: _h, ...prevRecord } = prev;
    history.push(prevRecord);
    if (role === 'ai') console.log(`  ! ${q.id}: 数学講師の確認の記録（${prev.reviewedAt} ${prev.reviewer}）は history に残しました。内容が変わったため、数学講師の再確認が必要です`);
  }
  store.reviews[q.id] = {
    hash: V.questionHash(q),
    reviewer,
    reviewerRole: role,
    reviewedAt: today(),
    checks: CHECKS,
    manualItems: res.manual,
    note: note || (prev && prev.hash === V.questionHash(q) ? prev.note : '') || '',
    ...(history.length ? { history } : {}),
  };
  stamped++;
  console.log(`✓ ${q.id} を記録しました${res.manual.length ? `（手動確認項目 ${res.manual.length} 件を確認済みとして記録）` : ''}`);
}

store.schemaVersion = 1;
store.reviews = Object.fromEntries(Object.entries(store.reviews).sort(([a], [b]) => a.localeCompare(b)));
fs.mkdirSync(path.dirname(V.REVIEW_FILE), { recursive: true });
fs.writeFileSync(V.REVIEW_FILE, JSON.stringify(store, null, 2) + '\n');
console.log(`${stamped} 問を記録しました → ${path.relative(process.cwd(), V.REVIEW_FILE)}`);
