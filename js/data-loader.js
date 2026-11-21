/*
 * data-loader.js
 * 問題データ（data/manifest.json と単元ごとの JSON）を読み込む。
 * プレビュー画面と、第2段階以降のゲーム画面で共通に使う想定。
 */
(function (global) {
  'use strict';

  const DATA_BASE = 'data/';

  async function fetchJson(url) {
    // データ編集後に再読み込みで必ず反映されるよう、キャッシュを使わない
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url} を読み込めません（HTTP ${res.status}）`);
    return res.json();
  }

  /**
   * すべての単元の問題を読み込む。
   * 戻り値: { units: [{unit, grade, label, questions: [...]}], questions: [...全問題] }
   */
  async function loadAllQuestions() {
    const manifest = await fetchJson(DATA_BASE + 'manifest.json');
    const units = await Promise.all(
      manifest.files.map(async (f) => {
        const data = await fetchJson(DATA_BASE + f.file);
        return { unit: f.unit, grade: f.grade, label: f.label, file: f.file, questions: data.questions || [] };
      })
    );
    const questions = units.flatMap((u) => u.questions);
    return { units, questions };
  }

  /** 手動レビュー記録（なければ空） */
  async function loadReviews() {
    try {
      const data = await fetchJson('review/manual-review.json');
      return data.reviews || {};
    } catch (e) {
      return {};
    }
  }

  /** レビュー記録との照合に使うハッシュ（tools/validate-questions.js と同じ計算） */
  async function questionHash(q) {
    if (!global.crypto || !global.crypto.subtle) return null; // http://（localhost 以外）では使えない
    // tools/validate-questions.js の questionHash と同じ（答案パターンも含める。第7段階）
    const QV = global.QuestionVariants;
    const extra = QV ? QV.variantsOf(q).filter((v) => v.source !== 'data') : [];
    const text = global.QuestionSchema.canonicalJson(extra.length ? { question: q, variants: extra } : q);
    const buf = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  global.DataLoader = { loadAllQuestions, loadReviews, questionHash };
})(window);
