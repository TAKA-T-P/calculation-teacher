#!/usr/bin/env node
/*
 * 計算ティーチャー！ 問題データ検証スクリプト
 *
 *   node tools/validate-questions.js                  通常の検証
 *   node tools/validate-questions.js --verbose        各行の判定結果も表示
 *   node tools/validate-questions.js --require-review 手動レビュー未完了・内容変更後未再レビューもエラーにする
 *   node tools/validate-questions.js --json out.json  結果を JSON にも書き出す
 *
 * 判定の種類
 *   ERROR  : データとして不正、または数学的な不整合を検出した（終了コード 1）
 *   WARN   : 推奨事項から外れている（終了コード 0）
 *   MANUAL : 自動では数学的な正しさを保証できない項目。人による確認が必要
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const katex = require('katex');
const M = require('../js/lib/math-verify.js');
const S = require('../js/lib/question-schema.js');
const QV = require('../js/question-variants.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const OPT = {
  verbose: args.includes('--verbose'),
  requireReview: args.includes('--require-review'),
  json: argValue('--json'),
  // 検証テスト用：別のデータフォルダ・レビュー記録を指定できる
  data: argValue('--data'),
  review: argValue('--review'),
};
const DATA_DIR = OPT.data ? path.resolve(OPT.data) : path.join(ROOT, 'data');
const REVIEW_FILE = OPT.review ? path.resolve(OPT.review) : path.join(ROOT, 'review', 'manual-review.json');

// ------------------------------------------------------------------ 共通
function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * レビュー記録のハッシュ。問題データに加えて、答案パターン（correctSolution から作る正答版の解説など）も含める。
 * 既存の項目しかない問題（別解の正答・誤答パターンの追加待ち）は、第6段階までと同じハッシュになる。
 */
function questionHash(q) {
  if (!q || typeof q !== 'object' || !Array.isArray(q.answerLines) || !Array.isArray(q.correctSolution)) return sha256(S.canonicalJson(q));
  const extra = QV.variantsOf(q).filter((v) => v.source !== 'data');
  if (!extra.length) return sha256(S.canonicalJson(q));
  return sha256(S.canonicalJson({ question: q, variants: extra }));
}

function katexCheck(latex) {
  try {
    katex.renderToString(latex, { displayMode: true, throwOnError: true, strict: 'error', trust: false });
    return null;
  } catch (e) {
    return e.message.replace(/\s+/g, ' ');
  }
}

function lineLabel(i) {
  return i === 0 ? '1行目（問題）' : `${i + 1}行目（index ${i}）`;
}

// ------------------------------------------------------------------ 1問の検証
function validateQuestion(q, ctx) {
  const r = { id: q && q.id, errors: [], warnings: [], manual: [], info: [], lines: null };
  const err = (m) => r.errors.push(m);
  const warn = (m) => r.warnings.push(m);
  const manual = (m) => r.manual.push(m);

  if (!q || typeof q !== 'object' || Array.isArray(q)) {
    err('問題がオブジェクトではありません');
    return r;
  }

  // ---- 必須項目と型
  for (const [key, type] of Object.entries(S.REQUIRED_FIELDS)) {
    if (!(key in q)) { err(`必須項目 "${key}" がありません`); continue; }
    const t = S.typeOf(q[key]);
    if (!type.split('|').includes(t)) err(`"${key}" の型が不正です（期待: ${type} / 実際: ${t}）`);
  }
  for (const key of Object.keys(q)) {
    if (!(key in S.REQUIRED_FIELDS) && !(key in S.OPTIONAL_FIELDS)) warn(`未定義の項目 "${key}" があります`);
  }
  for (const [key, type] of Object.entries(S.OPTIONAL_FIELDS)) {
    if (key in q && S.typeOf(q[key]) !== type) err(`"${key}" の型が不正です（期待: ${type}）`);
  }
  if (r.errors.length) return r; // 型が崩れていると以降の検査が意味をなさない

  // ---- 値の範囲
  const unitDef = S.UNITS[q.unit];
  if (!unitDef) err(`unit "${q.unit}" は定義されていません`);
  if (![1, 2, 3].includes(q.grade)) err(`grade は 1〜3 です（${q.grade}）`);
  if (unitDef && unitDef.grade !== q.grade) err(`unit "${q.unit}" は中${unitDef.grade}の単元ですが grade=${q.grade} です`);
  if (ctx.file.unit && q.unit !== ctx.file.unit) err(`ファイルの単元（${ctx.file.unit}）と問題の unit（${q.unit}）が一致しません`);
  if (q.difficulty < S.DIFFICULTY.min || q.difficulty > S.DIFFICULTY.max) err(`difficulty は ${S.DIFFICULTY.min}〜${S.DIFFICULTY.max} です（${q.difficulty}）`);
  if (unitDef && !unitDef.categories.includes(q.category)) err(`category "${q.category}" は単元 ${q.unit} のカテゴリ一覧にありません`);

  // ---- ID
  const idRe = /^J([1-3])-([A-Z]{2})-(\d{4})$/;
  const m = idRe.exec(q.id);
  if (!m) err(`id "${q.id}" の形式が不正です（例: J1-EQ-0001）`);
  else {
    if (Number(m[1]) !== q.grade) err(`id の学年（J${m[1]}）と grade=${q.grade} が一致しません`);
    if (unitDef && m[2] !== unitDef.idCode) err(`id の単元記号 ${m[2]} が unit の記号 ${unitDef.idCode} と一致しません`);
  }

  // ---- 文字列の空チェック
  for (const key of ['question', 'explanation', 'hint', 'category']) {
    if (!q[key].trim()) err(`"${key}" が空です`);
  }

  // ---- 答案・正しい計算過程
  const checkLines = (key) => {
    const lines = q[key];
    if (!lines.every((l) => typeof l === 'string' && l.trim())) err(`"${key}" に空行または文字列以外があります`);
    const LC = S.lineCountFor(q.unit);
    if (lines.length < LC.min || lines.length > LC.max) {
      err(`"${key}" の行数 ${lines.length} が範囲外です（${LC.min}〜${LC.max}）`);
    } else if (lines.length > LC.recommendedMax) {
      warn(`"${key}" が ${lines.length} 行あります（推奨は ${LC.recommendedMax} 行以下）`);
    }
    if (lines[0] !== q.question) err(`"${key}" の1行目が question と一致しません`);
  };
  checkLines('answerLines');
  checkLines('correctSolution');

  // ---- errorLine / errorType の整合
  if (q.errorLine === null) {
    if (q.errorType !== null) err('正しい答案（errorLine=null）なのに errorType が null ではありません');
  } else {
    if (q.errorLine < 1 || q.errorLine >= q.answerLines.length) {
      err(`errorLine=${q.errorLine} が範囲外です（1〜${q.answerLines.length - 1}。0 は問題の再掲なので指定できません）`);
    }
    if (q.errorType === null || !String(q.errorType).trim()) err('誤答なのに errorType がありません');
  }
  if (q.errorLine !== null && S.canonicalJson(q.answerLines) === S.canonicalJson(q.correctSolution)) {
    err('誤答なのに answerLines と correctSolution が同一です');
  }

  // ---- KaTeX
  const mathFields = [['question', [q.question]], ['answerLines', q.answerLines], ['correctSolution', q.correctSolution]];
  for (const [key, list] of mathFields) {
    list.forEach((latex, i) => {
      const e = katexCheck(latex);
      if (e) err(`KaTeX エラー（${key}[${i}] "${latex}"）: ${e}`);
    });
  }
  for (const key of ['explanation', 'hint', 'instruction']) {
    if (typeof q[key] !== 'string') continue;
    S.splitInlineMath(q[key]).filter((p) => p.type === 'math').forEach((p) => {
      const e = katexCheck(p.value);
      if (e) err(`KaTeX エラー（${key} 内の $${p.value}$）: ${e}`);
    });
    if ((q[key].match(/\$/g) || []).length % 2 === 1) err(`"${key}" の $ の数が奇数です（数式の閉じ忘れ）`);
  }
  if (q.substitution && !q.instruction) warn('substitution があるのに instruction（「a=-3 のとき…」）がありません');

  // ---- 答案パターン（第7段階）
  checkVariantStructure(q, r);
  if (r.errors.length) return r;

  // ---- 数学的な検証
  mathCheck(q, r);
  if (!ctx.variantOf) validateVariants(q, r, ctx);
  return r;
}

const VARIANT_KEYS = { id: 'string', answerLines: 'array', errorLine: 'number', errorType: 'string', explanation: 'string' };

/** variants（正答の問題に追加した誤答パターン）の形の確認 */
function checkVariantStructure(q, r) {
  if (!('variants' in q)) return;
  const err = (m) => r.errors.push(m);
  if (q.errorLine !== null) { err('variants（追加の誤答パターン）は、正しい答案の問題（errorLine=null）だけに登録できます'); return; }
  if (!q.variants.length) { err('variants が空です'); return; }
  const ids = new Set(['correct-1']);
  q.variants.forEach((v, i) => {
    const at = `variants[${i}]`;
    if (!v || typeof v !== 'object' || Array.isArray(v)) { err(`${at} がオブジェクトではありません`); return; }
    for (const [k, t] of Object.entries(VARIANT_KEYS)) {
      if (!(k in v)) err(`${at} に "${k}" がありません`);
      else if (S.typeOf(v[k]) !== t) err(`${at}.${k} の型が不正です（期待: ${t}）`);
    }
    Object.keys(v).filter((k) => !(k in VARIANT_KEYS)).forEach((k) => r.warnings.push(`${at} に未定義の項目 "${k}" があります`));
    if (typeof v.id === 'string') {
      if (!/^wrong-\d+$/.test(v.id)) err(`${at}.id "${v.id}" は wrong-1 のような形にしてください`);
      if (ids.has(v.id)) err(`答案パターンの id "${v.id}" が重複しています`);
      ids.add(v.id);
    }
  });
}

/** 答案パターンの1つを、ふつうの問題と同じ検証にかける（検証処理は validateQuestion・mathCheck を共通で使う） */
function validateVariants(q, r, ctx) {
  r.variants = [{ id: QV.variantsOf(q)[0].id, type: QV.variantsOf(q)[0].type, source: 'data', status: r.errors.length ? 'ERROR' : r.manual.length ? 'MANUAL' : 'AUTO' }];
  const kind = QV.kindOf(q);
  r.variantKind = kind;
  if (kind === QV.KINDS.CORRECT_PENDING) r.warnings.push('模範解答と同じ正しい答案ですが、誤答パターン（variants）がまだありません');
  QV.variantsOf(q).filter((v) => v.source !== 'data').forEach((v) => {
    const pq = QV.toPlayable(q, v);
    delete pq.variantId;
    delete pq.variantType;
    const label = `［答案パターン ${v.id}（${v.type === QV.TYPES.CORRECT ? '正答' : '誤答'}）］`;
    const vr = validateQuestion(pq, { ...ctx, variantOf: q.id });
    vr.errors.forEach((m) => r.errors.push(`${label} ${m}`));
    vr.warnings.forEach((m) => r.warnings.push(`${label} ${m}`));
    vr.manual.filter((m) => !r.manual.includes(m)).forEach((m) => r.manual.push(`${label} ${m}`));
    vr.info.forEach((m) => r.info.push(`${label} ${m}`));
    r.variants.push({ id: v.id, type: v.type, source: v.source, status: vr.errors.length ? 'ERROR' : vr.manual.length ? 'MANUAL' : 'AUTO', errorLine: v.errorLine });
  });
  // ヒントは正答版・誤答版の両方で出す。誤答の行にしかない式を示していないか（示していると、正答版で不自然・誤答の目印になる）
  const nrm = (s) => s.replace(/\s+/g, '').replace(/\\left|\\right/g, '');
  const vs = QV.variantsOf(q);
  if (vs.length > 1 && typeof q.hint === 'string') {
    const correctText = [q.question, ...q.correctSolution, ...vs.filter((v) => v.type === QV.TYPES.CORRECT).flatMap((v) => v.answerLines)].map(nrm).join('\n');
    const wrongText = vs.filter((v) => v.type === QV.TYPES.INCORRECT).flatMap((v) => v.answerLines).map(nrm).join('\n');
    S.splitInlineMath(q.hint).filter((p) => p.type === 'math').map((p) => nrm(p.value)).forEach((m) => {
      if (m.length >= 3 && wrongText.includes(m) && !correctText.includes(m)) {
        r.warnings.push(`ヒントの $${m}$ は誤答パターンの答案にしかない式です（正答版では不自然。正答・誤答のどちらでも使えるヒントにしてください）`);
      }
    });
  }
}

function mathCheck(q, r) {
  const err = (m) => r.errors.push(m);
  const warn = (m) => r.warnings.push(m);
  const manual = (m) => r.manual.push(m);

  if (q.verification && q.verification.mode === 'manual') {
    manual(`データで手動確認が指定されています: ${q.verification.reason || '(理由未記入)'}`);
    return;
  }
  const mode = M.modeForUnit(q.unit);
  if (!mode) {
    manual(`単元 ${q.unit} は自動検証に未対応です`);
    return;
  }

  let substitution = null;
  if (q.substitution) {
    try {
      substitution = M.parseSubstitution(q.substitution);
    } catch (e) {
      err(e.message);
      return;
    }
  }

  const ans = M.analyzeLines(q.answerLines, mode, substitution);
  const sol = M.analyzeLines(q.correctSolution, mode, substitution);
  r.lines = { mode, answer: ans, solution: sol };

  const reportParseFailures = (an, key) => {
    an.parsed.forEach((p, i) => {
      if (!p.ok) manual(`${key} の${lineLabel(i)}を数式として解析できません（${p.error}）`);
    });
    an.steps.forEach((s) => {
      if (s.vsPrev === 'unknown' && s.parse.ok && an.parsed[s.index - 1].ok) {
        manual(`${key} の${lineLabel(s.index)}と直前の行の等価性を自動判定できません（${(s.detail && s.detail.reason) || '理由不明'}）`);
      }
    });
  };
  reportParseFailures(sol, 'correctSolution');
  reportParseFailures(ans, 'answerLines');

  // 式の値の問題：代入後の行に文字が残っていないか（残っていても誤りではないが確認する）
  // 中1はすぐに代入する。中2以降は「式を簡単にしてから代入する」のがふつうなので、最終行だけを確かめる
  if (substitution) {
    const lines = q.grade === 1 ? ans.parsed.slice(1).map((p, i) => [p, i + 1]) : [[ans.parsed[ans.parsed.length - 1], ans.parsed.length - 1]];
    lines.forEach(([p, i]) => {
      if (p.ok && p.vars.length) warn(`式の値の問題ですが answerLines の${lineLabel(i)}に文字が残っています`);
    });
  }

  // 最終行に求める「答えの形」（第6段階の単元。中1の単元は従来どおり確かめない）
  const formKind = M.formKindFor(q.unit, q.instruction);
  const FORM_LABEL = { polynomial: '整理された式', expanded: '展開した式', factored: '因数分解した式', radical: '根号をふくむ数のいちばん簡単な形', quadratic: '解の簡単な形' };
  const checkFinalForm = (line) => {
    if (mode === 'quadratic') return M.checkQuadraticAnswerForm(line);
    if (formKind) return M.checkForm(line, formKind);
    return { ok: true };
  };
  const formLabel = FORM_LABEL[mode === 'quadratic' ? 'quadratic' : formKind];

  // ---- 正しい計算過程
  sol.steps.forEach((s) => {
    if (s.vsPrev === 'different') err(`correctSolution の${lineLabel(s.index)}が直前の行と等価ではありません${diffDetail(s)}`);
  });
  const solLast = sol.parsed[sol.parsed.length - 1];
  const lastSolLine = q.correctSolution[q.correctSolution.length - 1];
  if (mode === 'equation' && solLast.ok) {
    if (!M.isSolvedForm(solLast)) err('correctSolution の最終行が「x=数」の形ではありません');
    const s0 = M.solutionSet(sol.parsed[0]);
    if (s0.type !== 'unique' && s0.type !== 'unknown') warn(`元の方程式の解が1つに定まりません（${M.describeSolution(s0)}）`);
    if (s0.type === 'unique') r.info.push(`正しい解: ${M.describeSolution(s0)}`);
  }
  if (mode === 'quadratic' && solLast.ok) {
    if (!M.isQuadraticSolvedForm(solLast)) err('correctSolution の最終行が「x=数」の形ではありません');
    const s0 = M.lineSolutionSet(sol.parsed[0]);
    if (s0.type === 'set') {
      r.info.push(`正しい解: ${M.describeSet(s0)}`);
      if (!s0.values.length) warn('実数の解がない方程式です');
    }
  }
  if (mode === 'system') {
    if (sol.solution.type !== 'unique') manual(`連立方程式の解を自動で求められません（${sol.solution.reason}）`);
    else {
      r.info.push(`正しい解: ${Object.entries(sol.solution.env).map(([k, v]) => `${k}=${v.toString()}`).join(', ')}`);
      if (!sol.finalValues) err('correctSolution の最終行が「x=数, y=数」の形ではありません');
    }
  }
  if (mode === 'expression' && sol.parsed[0].ok) {
    if (substitution) {
      r.info.push(`正しい値: ${M.evaluate(sol.parsed[0].ast, substitution).toString()}`);
    } else if (sol.parsed[0].vars.length === 0) {
      try { r.info.push(`正しい値: ${M.evaluate(sol.parsed[0].ast, {}).toString()}`); } catch (e) { /* 0除算は上で検出 */ }
    }
  }
  if (formLabel && solLast.ok) {
    const f = checkFinalForm(lastSolLine);
    if (f.ok === false) err(`correctSolution の最終行が${formLabel}になっていません（${f.reason}）`);
    if (f.ok === null) manual(`correctSolution の最終行が${formLabel}か自動判定できません（${f.reason}）`);
  }
  // 最終行が整理された形か（簡易的な目安。最終判断は手動）
  if (/\\times|\\div|\\cdot/.test(lastSol(q))) manual('correctSolution の最終行に × や ÷ が残っています。答えの形として適切か確認してください');

  // ---- 生徒の答案
  const ansLast = ans.parsed[ans.parsed.length - 1];
  const lastAnsLine = q.answerLines[q.answerLines.length - 1];
  let finalVsCorrect = 'unknown';
  if (mode === 'system') {
    if (ans.finalValues && sol.solution.type === 'unique') {
      finalVsCorrect = Object.entries(sol.solution.env).every(([k, v]) => ans.finalValues[k] && ans.finalValues[k].equals(v)) ? 'equal' : 'different';
    }
  } else if (ansLast.ok && solLast.ok) {
    finalVsCorrect = M.compareLines(ansLast, solLast, mode, substitution).result;
  }

  if (q.errorLine === null) {
    ans.steps.forEach((s) => {
      if (s.vsPrev === 'different') {
        err(`正しい答案のはずですが、answerLines の${lineLabel(s.index)}が直前の行と等価ではありません${diffDetail(s)}`);
      }
    });
    if (finalVsCorrect === 'different') err('正しい答案の最終行が correctSolution の最終行と一致しません');
    if (mode === 'equation' && ansLast.ok && !M.isSolvedForm(ansLast)) err('正しい答案の最終行が「x=数」の形ではありません');
    if (mode === 'quadratic' && ansLast.ok && !M.isQuadraticSolvedForm(ansLast)) err('正しい答案の最終行が「x=数」の形ではありません');
    if (mode === 'system' && sol.solution.type === 'unique' && !ans.finalValues) err('正しい答案の最終行が「x=数, y=数」の形ではありません');
    if (formLabel && ansLast.ok) {
      const f = checkFinalForm(lastAnsLine);
      if (f.ok === false) err(`正しい答案のはずですが、最終行が${formLabel}になっていません（${f.reason}）`);
      if (f.ok === null) manual(`正しい答案の最終行が${formLabel}か自動判定できません（${f.reason}）`);
    }
    if (S.canonicalJson(q.answerLines) !== S.canonicalJson(q.correctSolution)) {
      r.info.push('answerLines と correctSolution の途中式が異なります（別解として妥当か手動で確認）');
      manual('正しい答案の途中式が correctSolution と異なります。別解・表記として妥当か確認してください');
    }
  } else {
    const e = q.errorLine;
    const lastIndex = q.answerLines.length - 1;
    // 「形の誤り」：最後の行が、数学的には直前の行と等しいが、問題が求める答えの形になっていない
    //  （展開しきっていない・因数分解が途中・根号を簡単にしていない・解を約分していない など）
    let formError = false;
    if (e === lastIndex && formLabel && ans.steps[e] && ans.steps[e].vsPrev === 'equal') {
      const f = checkFinalForm(lastAnsLine);
      if (f.ok === false) {
        formError = true;
        r.info.push(`誤り行（最後の行）は数学的には直前と等しいが、${formLabel}になっていない（${f.reason}）`);
      }
    }
    ans.steps.forEach((s) => {
      if (s.index === 0) return;
      if (s.index < e && s.vsPrev === 'different') {
        err(`指定した誤り行（index ${e}）より前の${lineLabel(s.index)}で、すでに直前の行と等価でなくなっています${diffDetail(s)}`);
      }
      if (s.index === e && s.vsPrev === 'equal' && !formError) {
        err(`指定した誤り行（index ${e}）は直前の行と数学的に等価です。誤りになっていません`);
      }
      if (s.index > e && s.vsPrev === 'different') {
        err(`誤り行（index ${e}）より後の${lineLabel(s.index)}に、別の独立した誤りがあります${diffDetail(s)}`);
      }
    });
    if (mode === 'system' && ans.steps[e] && ans.steps[e].consistentWithFinal === false) {
      err(`誤り行（index ${e}）の式が、最終行の答えでは成り立ちません（誤りのあとの計算が一貫していません）`);
    }
    if (ans.firstDifferent !== null && ans.firstDifferent === e) r.info.push(`自動判定の最初の誤り行: index ${e}（データと一致）`);
    if (finalVsCorrect === 'equal' && !formError) warn('誤答なのに最終行が正しい答えと等価です（途中の誤りが打ち消されていないか確認）');
    if (mode === 'equation' && ansLast.ok && !M.isSolvedForm(ansLast)) warn('誤答の最終行が「x=数」の形ではありません');
    if (mode === 'quadratic' && ansLast.ok && !M.isQuadraticSolvedForm(ansLast)) warn('誤答の最終行が「x=数」の形ではありません');
  }

  // ---- 単元固有の手動確認項目
  if (q.category === '文字式の表し方') {
    manual('文字式の表記ルール（× の省略・係数の位置・累乗の書き方など）は自動判定できません。表記を確認してください');
  }
}

function lastSol(q) {
  return q.correctSolution[q.correctSolution.length - 1];
}

function fmt(v) {
  return v && typeof v.toString === 'function' ? v.toString() : String(v);
}

function diffDetail(step) {
  const d = step.detail;
  if (!d) return '';
  if (d.solutions) return `（解: ${M.describeSolution(d.solutions[0])} → ${M.describeSolution(d.solutions[1])}）`;
  if (d.values) {
    const at = d.at ? ' ' + Object.entries(d.at).map(([k, v]) => `${k}=${fmt(v)}`).join(', ') + ' のとき' : '';
    return `（${at}値: ${fmt(d.values[0])} → ${fmt(d.values[1])}）`.replace('（ ', '（');
  }
  return '';
}

// ------------------------------------------------------------------ 実行
function main() {
  const manifestPath = path.join(DATA_DIR, 'manifest.json');
  const globalErrors = [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR data/manifest.json を読み込めません: ${e.message}`);
    process.exit(1);
  }

  let reviews = {};
  if (fs.existsSync(REVIEW_FILE)) {
    try {
      reviews = JSON.parse(fs.readFileSync(REVIEW_FILE, 'utf8')).reviews || {};
    } catch (e) {
      globalErrors.push(`review/manual-review.json を読み込めません: ${e.message}`);
    }
  }

  const results = [];
  const allQuestions = [];
  const seenIds = new Map();

  for (const file of manifest.files || []) {
    const rel = path.join('data', file.file);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file.file), 'utf8'));
    } catch (e) {
      globalErrors.push(`${rel} を JSON として読み込めません: ${e.message}`);
      continue;
    }
    if (data.schemaVersion !== S.SCHEMA_VERSION) globalErrors.push(`${rel}: schemaVersion が ${S.SCHEMA_VERSION} ではありません`);
    if (data.unit !== file.unit || data.grade !== file.grade) globalErrors.push(`${rel}: manifest の unit/grade とファイルの unit/grade が一致しません`);
    if (!Array.isArray(data.questions)) {
      globalErrors.push(`${rel}: questions が配列ではありません`);
      continue;
    }
    data.questions.forEach((q, idx) => {
      const res = validateQuestion(q, { file: data });
      res.file = rel;
      res.index = idx;
      if (q && q.id) {
        if (seenIds.has(q.id)) res.errors.push(`id "${q.id}" が重複しています（${seenIds.get(q.id)} にもあります）`);
        else seenIds.set(q.id, rel);
      }
      // 手動レビュー記録
      if (q && q.id) {
        const rv = reviews[q.id];
        const hash = questionHash(q);
        if (!rv) res.review = 'missing';
        else if (rv.hash !== hash) res.review = 'stale';
        else res.review = 'ok';
        res.reviewInfo = rv || null;
        if (res.review !== 'ok') {
          const msg = res.review === 'missing'
            ? '手動レビューの記録がありません（review/manual-review.json）'
            : '前回の手動レビュー後に問題データが変更されています。再レビューが必要です';
          (OPT.requireReview ? res.errors : res.warnings).push(msg);
        }
      }
      results.push(res);
      allQuestions.push(q);
    });
  }

  // ---- 問題どうしの重複
  const byQuestion = new Map();
  allQuestions.forEach((q, i) => {
    if (!q || typeof q.question !== 'string') return;
    const key = q.question.replace(/\s+/g, '');
    if (byQuestion.has(key)) results[i].warnings.push(`同じ問題式が ${byQuestion.get(key)} にもあります`);
    else byQuestion.set(key, q.id);
  });
  // ---- 出力
  const tag = (r) => (r.errors.length ? 'ERROR ' : r.manual.length ? 'MANUAL' : 'AUTO  ');
  console.log('計算ティーチャー！ 問題データ検証\n');
  for (const g of globalErrors) console.log(`ERROR ${g}`);
  let currentFile = null;
  for (const r of results) {
    if (r.file !== currentFile) {
      currentFile = r.file;
      console.log(`\n=== ${currentFile}`);
    }
    const q = allQuestions[results.indexOf(r)];
    const kind = q && q.errorLine === null ? '全部正しい' : q ? `誤り行 index ${q.errorLine}` : '';
    const rv = r.review === 'ok' ? 'レビュー済' : r.review === 'stale' ? '要再レビュー' : '未レビュー';
    console.log(`[${tag(r)}] ${r.id || `(#${r.index})`}  ${kind}  ★${q && q.difficulty}  ${q && q.category}  [${rv}]`);
    r.errors.forEach((m) => console.log(`    ERROR  ${m}`));
    r.warnings.forEach((m) => console.log(`    WARN   ${m}`));
    r.manual.forEach((m) => console.log(`    MANUAL ${m}`));
    if (OPT.verbose) {
      r.info.forEach((m) => console.log(`    info   ${m}`));
      if (r.lines) printLines(q, r.lines);
    }
  }

  // ---- 集計
  console.log('\n=== 集計');
  const units = [...new Set(allQuestions.filter(Boolean).map((q) => q.unit))];
  // 理論上の「全部正しい！」の出題率（答案パターンを抽選したあと。js/question-variants.js と同じ計算）
  const pct = (qs) => (qs.length ? ((qs.reduce((a, q) => a + QV.correctProbability(q), 0) / qs.length) * 100).toFixed(1) : '0.0');
  for (const u of units) {
    const qs = allQuestions.filter((q) => q && q.unit === u);
    const correct = qs.filter((q) => q.errorLine === null).length;
    const diff = [1, 2, 3, 4].map((d) => `★${d}:${qs.filter((q) => q.difficulty === d).length}`).join(' ');
    const cats = {};
    qs.forEach((q) => { cats[q.category] = (cats[q.category] || 0) + 1; });
    console.log(`${(S.UNITS[u] || {}).label || u}: ${qs.length}問（登録データの全部正しい ${correct}問 / ${Math.round((correct / qs.length) * 100)}%・理論上の出題率 ${pct(qs)}%）  ${diff}`);
    console.log(`    カテゴリ: ${Object.entries(cats).map(([k, v]) => `${k} ${v}`).join(' / ')}`);
  }
  const totalCorrect = allQuestions.filter((q) => q && q.errorLine === null).length;
  console.log(`全体: ${allQuestions.length}問（登録データの全部正しい ${totalCorrect}問 / ${allQuestions.length ? Math.round((totalCorrect / allQuestions.length) * 100) : 0}%・理論上の出題率 ${pct(allQuestions.filter(Boolean))}%）`);
  console.log(`  ※ 正答・誤答を切り替える問題は、出題のたびに ${QV.CORRECT_VARIANT_RATE * 100}% で正答版、残りで誤答版を出します（第7段階）。理論上の出題率は「全部正しい！」が正解になる割合です。`);
  // errorType の偏り・カテゴリ×難易度・誤り行の分布など「出題バランス」は、数学的な検証とは分けて
  // tools/question-report.js（npm run report:questions）で集計・警告する
  console.log('出題バランス（カテゴリ×難易度・誤り行の分布・errorType の偏りなど）は npm run report:questions で確認できます。');

  const nErr = results.reduce((a, r) => a + r.errors.length, 0) + globalErrors.length;
  const nWarn = results.reduce((a, r) => a + r.warnings.length, 0);
  const nAuto = results.filter((r) => !r.errors.length && !r.manual.length).length;
  const nManual = results.filter((r) => !r.errors.length && r.manual.length).length;
  const nReviewed = results.filter((r) => r.review === 'ok').length;
  console.log(`\n自動検証で数学的整合性を確認: ${nAuto}問 / 手動確認項目あり: ${nManual}問 / エラーあり: ${results.filter((r) => r.errors.length).length}問`);
  console.log(`手動レビュー記録: ${nReviewed}/${results.length}問 が最新の内容でレビュー済`);
  console.log(`ERROR ${nErr} 件 / WARN ${nWarn} 件`);

  if (OPT.json) {
    const out = results.map((r) => ({
      id: r.id, file: r.file, status: tag(r).trim(), errors: r.errors, warnings: r.warnings, manual: r.manual, info: r.info, review: r.review,
    }));
    fs.writeFileSync(OPT.json, JSON.stringify({ generatedAt: new Date().toISOString(), results: out }, null, 2));
    console.log(`JSON を書き出しました: ${OPT.json}`);
  }
  process.exit(nErr ? 1 : 0);
}

function printLines(q, lines) {
  const show = (label, src, an) => {
    console.log(`    ${label}`);
    an.steps.forEach((s, i) => {
      const mark = s.vsPrev === null ? '  ' : s.vsPrev === 'equal' ? '≡ ' : s.vsPrev === 'different' ? '≠ ' : '? ';
      let extra = '';
      if (lines.mode === 'equation' && s.parse.ok) extra = `   [解: ${M.describeSolution(M.solutionSet(s.parse))}]`;
      console.log(`      ${mark}${String(i).padStart(2)}: ${src[i]}${extra}`);
    });
  };
  show('answerLines', q.answerLines, lines.answer);
  show('correctSolution', q.correctSolution, lines.solution);
}

if (require.main === module) {
  main();
} else {
  module.exports = { validateQuestion, questionHash, DATA_DIR, REVIEW_FILE };
}
