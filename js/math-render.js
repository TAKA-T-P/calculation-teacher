/*
 * math-render.js
 * KaTeX による数式表示の共通処理。
 */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** 数式1つを要素に描画する。失敗した場合は元の文字列を赤字で表示する。 */
  function renderMath(el, latex, displayMode) {
    try {
      global.katex.render(latex, el, { displayMode: !!displayMode, throwOnError: true, strict: 'warn' });
    } catch (e) {
      el.innerHTML = `<span class="math-error" title="${escapeHtml(e.message)}">${escapeHtml(latex)}</span>`;
    }
  }

  /** 数式の HTML 文字列を返す */
  function mathHtml(latex, displayMode) {
    try {
      // 連立方程式の中かっこ内も分数を通常の大きさで表示する（cases → dcases。データはそのまま）
      const src = latex.replace(/\{cases\}/g, '{dcases}');
      return global.katex.renderToString(src, { displayMode: !!displayMode, throwOnError: true, strict: 'warn' });
    } catch (e) {
      return `<span class="math-error" title="${escapeHtml(e.message)}">${escapeHtml(latex)}</span>`;
    }
  }

  /** 「$...$」を含む説明文を HTML にする（数式以外はエスケープする） */
  function richTextHtml(text) {
    return global.QuestionSchema.splitInlineMath(text)
      .map((p) => (p.type === 'math' ? mathHtml(p.value, false) : escapeHtml(p.value)))
      .join('');
  }

  global.MathRender = { renderMath, mathHtml, richTextHtml, escapeHtml };
})(window);
