/*
 * preview.js
 * 問題データ確認用のプレビュー画面（第1段階・開発者向け）。
 * 正式なゲーム画面ではない。データの表示確認・自動検証結果の確認に使う。
 */
(function () {
  'use strict';

  const S = window.QuestionSchema;
  const MV = window.MathVerify;
  const R = window.MathRender;

  const state = {
    units: [],
    all: [],
    filtered: [],
    pos: 0,
    reveal: false,
    hint: false,
    reviews: {},
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    unit: $('unit-select'),
    kind: $('kind-select'),
    diff: $('difficulty-select'),
    reveal: $('reveal-toggle'),
    index: $('question-index'),
    card: $('question-card'),
    prev: $('prev-btn'),
    next: $('next-btn'),
    pos: $('pager-pos'),
  };

  // ------------------------------------------------------------ 初期化
  async function init() {
    if (location.protocol === 'file:') {
      showStatus('このページは file:// では問題データを読み込めません。プロジェクトのフォルダで <code>npm run serve</code> を実行し、表示された URL を開いてください。', true);
      return;
    }
    try {
      const [data, reviews] = await Promise.all([window.DataLoader.loadAllQuestions(), window.DataLoader.loadReviews()]);
      state.units = data.units;
      state.all = data.questions;
      state.reviews = reviews;
    } catch (e) {
      showStatus(`問題データの読み込みに失敗しました：${R.escapeHtml(e.message)}<br>JSON の書式エラーがないか <code>npm run validate</code> で確認してください。`, true);
      return;
    }

    els.unit.innerHTML = '<option value="all">すべての単元</option>' +
      state.units.map((u) => `<option value="${u.unit}">中${u.grade}・${R.escapeHtml(u.label)}（${u.questions.length}問）</option>`).join('');

    // ?reveal=1 で最初から正解・解説を表示（レビュー作業用）
    const params = new URLSearchParams(location.search);
    if (params.get('reveal') === '1') { state.reveal = true; els.reveal.checked = true; }
    if (params.get('hint') === '1') state.hint = true;

    els.unit.addEventListener('change', () => applyFilter());
    els.kind.addEventListener('change', () => applyFilter());
    els.diff.addEventListener('change', () => applyFilter());
    els.reveal.addEventListener('change', () => { state.reveal = els.reveal.checked; render(); });
    els.prev.addEventListener('click', () => move(-1));
    els.next.addEventListener('click', () => move(1));
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', () => jumpToHash());

    applyFilter(true);
  }

  function onKey(e) {
    if (e.target.closest && e.target.closest('select, input, textarea')) return;
    if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'ArrowRight') move(1);
    else if (e.key === 'a' || e.key === 'A') { state.reveal = !state.reveal; els.reveal.checked = state.reveal; render(); }
    else if (e.key === 'h' || e.key === 'H') { state.hint = !state.hint; render(); }
  }

  function applyFilter(useHash) {
    const unit = els.unit.value;
    const kind = els.kind.value;
    const diff = els.diff.value;
    const currentId = current() && current().id;
    state.filtered = state.all.filter((q) =>
      (unit === 'all' || q.unit === unit) &&
      (kind === 'all' || (kind === 'correct' ? q.errorLine === null : q.errorLine !== null)) &&
      (diff === 'all' || String(q.difficulty) === diff));
    state.pos = Math.max(0, state.filtered.findIndex((q) => q.id === currentId));
    if (useHash) jumpToHash(true);
    else render();
  }

  function jumpToHash(silent) {
    const id = decodeURIComponent(location.hash.slice(1));
    const i = state.filtered.findIndex((q) => q.id === id);
    if (i >= 0 && i !== state.pos) { state.pos = i; if (!silent) state.hint = false; }
    render();
    if (!silent && i < 0 && id) console.warn('該当する問題がありません:', id);
  }

  function current() {
    return state.filtered[state.pos];
  }

  function move(delta) {
    if (!state.filtered.length) return;
    state.pos = (state.pos + delta + state.filtered.length) % state.filtered.length;
    state.hint = false;
    history.replaceState(null, '', '#' + encodeURIComponent(current().id));
    render();
  }

  function showStatus(html, isError) {
    els.card.innerHTML = `<p class="status-message${isError ? ' status-message--error' : ''}">${html}</p>`;
  }

  // ------------------------------------------------------------ 描画
  function render() {
    renderIndex();
    const q = current();
    els.pos.textContent = state.filtered.length ? `${state.pos + 1} / ${state.filtered.length}` : '0 / 0';
    els.prev.disabled = els.next.disabled = state.filtered.length <= 1;
    if (!q) {
      showStatus('条件に合う問題がありません。');
      return;
    }
    renderCard(q);
  }

  function renderIndex() {
    els.index.innerHTML = state.filtered.map((q, i) => {
      const cls = ['chip'];
      if (i === state.pos) cls.push('chip--current');
      if (state.reveal) cls.push(q.errorLine === null ? 'chip--correct' : 'chip--error');
      return `<a class="${cls.join(' ')}" href="#${encodeURIComponent(q.id)}" ${i === state.pos ? 'aria-current="true"' : ''}>${R.escapeHtml(q.id.replace(/^J\d-/, ''))}</a>`;
    }).join('');
  }

  function stars(n) {
    return '★'.repeat(n) + '<span class="stars__off">' + '★'.repeat(Math.max(0, 4 - n)) + '</span>';
  }

  function renderCard(q) {
    const unitDef = S.UNITS[q.unit] || { label: q.unit };
    const analysis = analyze(q);
    const instruction = q.instruction || S.defaultInstruction(q.unit);
    const isCorrect = q.errorLine === null;

    const lines = q.answerLines.map((latex, i) => {
      const cls = ['answer-line'];
      let tag = '';
      if (state.reveal && !isCorrect) {
        if (i === q.errorLine) { cls.push('answer-line--error'); tag = '<span class="line-tag">最初に間違えた行</span>'; }
        else if (i > q.errorLine) cls.push('answer-line--after');
      }
      if (i === 0) cls.push('answer-line--question');
      const label = i === 0 ? '問題' : `${i + 1}行目`;
      return `<li class="${cls.join(' ')}">
          <span class="line-no">${label}<small>index ${i}</small></span>
          <span class="line-math">${R.mathHtml(latex, true)}</span>
          ${state.reveal ? verifyMark(analysis.answer, i) : ''}
          ${tag}
        </li>`;
    }).join('');

    const verdict = !state.reveal ? '' : isCorrect
      ? `<div class="verdict verdict--correct"><strong>全部正しい！</strong><span>この答案に誤りはありません（errorLine: null）</span></div>`
      : `<div class="verdict verdict--error"><strong>${q.errorLine + 1}行目が最初の誤り</strong><span>（errorLine: ${q.errorLine}）${R.escapeHtml(q.errorType || '')}</span></div>`;

    const solution = q.correctSolution.map((latex, i) =>
      `<li class="answer-line${i === 0 ? ' answer-line--question' : ''}">
        <span class="line-no">${i === 0 ? '問題' : `${i + 1}行目`}</span>
        <span class="line-math">${R.mathHtml(latex, true)}</span>
        ${state.reveal ? verifyMark(analysis.solution, i) : ''}
      </li>`).join('');

    els.card.innerHTML = `
      <header class="card__meta">
        <span class="meta-id">${R.escapeHtml(q.id)}</span>
        <span class="meta-unit">中${q.grade}・${R.escapeHtml(unitDef.label)}</span>
        <span class="meta-cat">${R.escapeHtml(q.category)}</span>
        <span class="stars" aria-label="難易度${q.difficulty}">${stars(q.difficulty)}</span>
      </header>

      <section class="block">
        <p class="instruction">${R.richTextHtml(instruction)}</p>
        <div class="problem">${R.mathHtml(q.question, true)}</div>
      </section>

      <section class="block">
        <h2 class="block__title">生徒の答案 <small>最初に間違えた行を1つ選ぶ／誤りがなければ「全部正しい！」</small></h2>
        <ol class="answer-lines">${lines}</ol>
        <div class="choice-preview" aria-hidden="true"><span class="choice-btn">全部正しい！</span></div>
      </section>

      <section class="block block--hint">
        <button type="button" class="btn btn--ghost" id="hint-btn">${state.hint ? 'ヒントを隠す' : 'ヒントを見る'}</button>
        ${state.hint ? `<p class="hint">${R.richTextHtml(q.hint)}</p>` : ''}
      </section>

      ${state.reveal ? `
      <section class="block block--answer">
        ${verdict}
        <h2 class="block__title">解説</h2>
        <p class="explanation">${R.richTextHtml(q.explanation)}</p>
        <h2 class="block__title">正しい計算過程</h2>
        <ol class="answer-lines answer-lines--solution">${solution}</ol>
      </section>
      <section class="block block--dev">
        <h2 class="block__title">開発者向け：自動検証</h2>
        ${devSummary(q, analysis)}
        <p class="review-status" id="review-status">レビュー記録を確認中…</p>
      </section>` : `<p class="reveal-note">「正解・解説を表示」をオンにすると、正解の行・解説・正しい計算過程・自動検証結果を表示します（<kbd>A</kbd> キー）。</p>`}
    `;

    $('hint-btn').addEventListener('click', () => { state.hint = !state.hint; render(); });
    if (state.reveal) updateReviewStatus(q);
  }

  // ------------------------------------------------------------ 自動検証（画面表示用）
  function analyze(q) {
    const mode = MV.modeForUnit(q.unit);
    if (!mode || (q.verification && q.verification.mode === 'manual')) return { mode: null };
    let sub = null;
    try { sub = MV.parseSubstitution(q.substitution); } catch (e) { return { mode: null }; }
    return {
      mode,
      answer: MV.analyzeLines(q.answerLines, mode, sub),
      solution: MV.analyzeLines(q.correctSolution, mode, sub),
    };
  }

  function verifyMark(an, i) {
    if (!an || i === 0) return '<span class="verify-mark verify-mark--none"></span>';
    const s = an.steps[i];
    const map = {
      equal: ['≡', 'verify-mark--eq', '直前の行と数学的に等価'],
      different: ['≠', 'verify-mark--ne', '直前の行と等価ではない'],
      unknown: ['?', 'verify-mark--unk', '自動判定できない'],
    };
    const [sym, cls, title] = map[s.vsPrev] || map.unknown;
    let extra = '';
    if (an.parsed[i].ok && an.parsed[i].kind === 'equation') {
      extra = `（解: ${MV.describeSolution(MV.solutionSet(an.parsed[i]))}）`;
    }
    return `<span class="verify-mark ${cls}" title="${title}${extra}">${sym}</span>`;
  }

  function devSummary(q, an) {
    if (!an.mode) return '<p class="dev-note dev-note--warn">この問題は自動検証の対象外です（手動確認）。</p>';
    const items = [];
    const expected = q.errorLine;
    const detected = an.answer.firstDifferent;
    if (an.answer.unknown || an.solution.unknown) {
      items.push('<li class="dev-note--warn">自動判定できない行があります（手動確認）。</li>');
    }
    if (expected === detected) {
      items.push(`<li class="dev-note--ok">自動判定の「最初に直前と等価でなくなる行」= ${detected === null ? 'なし（全部正しい）' : `index ${detected}`}。データと一致しています。</li>`);
    } else {
      items.push(`<li class="dev-note--ng">データの errorLine=${expected} ですが、自動判定では ${detected === null ? '誤りなし' : `index ${detected}`} です。<code>npm run validate</code> で確認してください。</li>`);
    }
    const afterErrors = an.answer.steps.filter((s) => expected !== null && s.index > expected && s.vsPrev === 'different');
    if (afterErrors.length) items.push('<li class="dev-note--ng">誤り行の後に、さらに別の誤りがあります。</li>');
    if (an.solution.steps.some((s) => s.vsPrev === 'different')) items.push('<li class="dev-note--ng">正しい計算過程に、直前と等価でない行があります。</li>');
    return `<ul class="dev-list">${items.join('')}</ul>
      <p class="dev-legend">行の右の記号：<span class="verify-mark verify-mark--eq">≡</span> 直前の行と等価　<span class="verify-mark verify-mark--ne">≠</span> 等価でない　<span class="verify-mark verify-mark--unk">?</span> 判定不能</p>`;
  }

  async function updateReviewStatus(q) {
    const el = $('review-status');
    if (!el) return;
    const rv = state.reviews[q.id];
    let text, cls;
    if (!rv) { text = '手動レビュー：記録なし'; cls = 'dev-note--warn'; }
    else {
      const hash = await window.DataLoader.questionHash(q);
      if (hash === null) { text = `手動レビュー：${rv.reviewedAt} ${rv.reviewer}（内容の一致は未確認）`; cls = ''; }
      else if (hash === rv.hash) { text = `手動レビュー済：${rv.reviewedAt} ${rv.reviewer}`; cls = 'dev-note--ok'; }
      else { text = '手動レビュー後にデータが変更されています（要再レビュー）'; cls = 'dev-note--warn'; }
    }
    if (current() && current().id === q.id && $('review-status')) {
      el.textContent = text;
      el.className = 'review-status ' + cls;
    }
  }

  init();
})();
