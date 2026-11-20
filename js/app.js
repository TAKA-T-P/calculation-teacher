/*
 * app.js
 * 計算ティーチャー！ ゲーム画面の画面遷移・表示・操作。
 * ゲーム進行と採点は game.js（TrainingSession）が担当し、ここでは DOM の表示だけを扱う。
 *
 * URL パラメータ（開発・テスト用）
 *   ?seed=123  出題順の乱数を固定する
 */
(function () {
  'use strict';

  const S = window.QuestionSchema;
  const R = window.MathRender;
  const G = window.Game;
  const esc = R.escapeHtml;

  const params = new URLSearchParams(location.search);
  const rng = G.createRng(params.get('seed'));

  const app = {
    screen: 'title',
    units: [],          // manifest の単元（label, grade, unit, questions）
    questions: [],      // 全問題
    invalidIds: [],     // 出題できない（データ不整合の）問題
    config: { unit: null, difficulties: new Set(G.DIFFICULTIES), count: G.DEFAULT_COUNT },
    session: null,
    ready: false,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const screens = {};
  document.querySelectorAll('[data-screen]').forEach((el) => { screens[el.dataset.screen] = el; });

  // ============================================================ 初期化
  async function init() {
    document.addEventListener('click', onClick);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('resize', debounce(fitAllMath, 150));
    // KaTeX のフォントが後から読み込まれると式の幅が変わるので、読み込み後にも調整し直す
    if (document.fonts) {
      document.fonts.addEventListener('loadingdone', debounce(fitAllMath, 50));
      document.fonts.ready.then(fitAllMath);
    }
    const dialog = $('#quit-dialog');
    dialog.addEventListener('cancel', () => { /* Esc キーでは「つづける」扱い */ });
    history.replaceState({ screen: 'title' }, '');

    if (location.protocol === 'file:') {
      setLoadStatus('このページは file:// では問題を読み込めません。npm run serve でサーバーを起動してから開いてください。', true);
      return;
    }
    setLoadStatus('問題を読み込んでいます…');
    try {
      const data = await window.DataLoader.loadAllQuestions();
      app.units = data.units.filter((u) => u.questions.length > 0);
      app.questions = data.questions;
      app.invalidIds = data.questions.filter((q) => G.validateForPlay(q).length).map((q) => (q && q.id) || '(id なし)');
      if (app.invalidIds.length) console.error('出題できない問題があります（データ不整合）:', app.invalidIds);
      app.config.unit = app.units.length ? app.units[0].unit : null;
      app.ready = true;
      setLoadStatus('');
    } catch (e) {
      console.error(e);
      setLoadStatus('問題を読み込めませんでした。通信状態を確かめて、ページを再読み込みしてください。', true);
    }
  }

  function setLoadStatus(text, isError) {
    const el = $('#load-status');
    el.textContent = text;
    el.classList.toggle('load-status--error', !!isError);
  }

  // ============================================================ 画面遷移
  /**
   * @param {string} name 画面名
   * @param {'push'|'replace'|'none'} historyMode
   */
  function show(name, historyMode = 'push') {
    Object.entries(screens).forEach(([key, el]) => { el.hidden = key !== name; });
    app.screen = name;
    document.body.dataset.screen = name;
    if (historyMode === 'push') history.pushState({ screen: name }, '');
    else if (historyMode === 'replace') history.replaceState({ screen: name }, '');
    window.scrollTo(0, 0);
    const heading = screens[name].querySelector('h1, h2');
    if (heading && name !== 'title') heading.focus({ preventScroll: true });
  }

  function inProgress() {
    return app.screen === 'play' && app.session && !app.session.finished;
  }

  // ブラウザの「戻る」：プレイ中は確認してから終了する
  function onPopState(e) {
    const target = (e.state && e.state.screen) || 'title';
    if (inProgress()) {
      history.pushState({ screen: 'play' }, '');
      openQuitDialog();
      return;
    }
    if ((target === 'play' || target === 'summary') && !app.session) {
      show(app.ready ? 'settings' : 'title', 'replace');
      if (app.ready) renderSettings();
      return;
    }
    if (target === 'play' && app.session && app.session.finished) { renderSummary(); show('summary', 'replace'); return; }
    if (target === 'settings') renderSettings();
    show(target, 'none');
  }

  // ============================================================ クリック
  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    const action = el.dataset.action;
    switch (action) {
      case 'go-title': app.session = null; show('title'); break;
      case 'go-howto': show('howto'); break;
      case 'go-settings':
        if (!app.ready) return;
        app.session = null;
        renderSettings();
        show('settings');
        break;
      case 'select-unit': selectUnit(el.dataset.unit); break;
      case 'toggle-difficulty': toggleDifficulty(el.dataset.difficulty); break;
      case 'select-count': app.config.count = el.dataset.count === 'all' ? 'all' : Number(el.dataset.count); renderSettings(); break;
      case 'start': startTraining(); break;
      case 'retry': startTraining(); break;
      case 'select-line': app.session.selectLine(Number(el.dataset.index)); updateSelection(); break;
      case 'select-all-correct': app.session.selectAllCorrect(); updateSelection(); break;
      case 'toggle-hint': app.session.toggleHint(); renderHint(); break;
      case 'submit': submitAnswer(); break;
      case 'next': nextQuestion(); break;
      case 'quit': openQuitDialog(); break;
      case 'quit-cancel': $('#quit-dialog').close(); break;
      case 'quit-confirm':
        $('#quit-dialog').close();
        app.session = null;
        show('title', 'replace');
        break;
      default: break;
    }
  }

  function openQuitDialog() {
    const d = $('#quit-dialog');
    if (!d.open) d.showModal();
  }

  // ============================================================ ② 設定画面
  function unitLabel(u) {
    return `中${u.grade}・${u.label}`;
  }

  function currentUnit() {
    return app.units.find((u) => u.unit === app.config.unit) || null;
  }

  function availableDifficulties() {
    const counts = G.countByDifficulty(app.questions, app.config.unit);
    return { counts, list: G.DIFFICULTIES.filter((d) => counts[d] > 0) };
  }

  function selectUnit(unit) {
    app.config.unit = unit;
    // 新しい単元に存在しない難易度は選択から外す。何も残らなければ「おまかせ」にする。
    const { list } = availableDifficulties();
    const kept = [...app.config.difficulties].filter((d) => list.includes(d));
    app.config.difficulties = new Set(kept.length ? kept : list);
    renderSettings();
  }

  function toggleDifficulty(value) {
    const { list } = availableDifficulties();
    const set = app.config.difficulties;
    if (value === 'auto') {
      app.config.difficulties = new Set(list);
    } else {
      const d = Number(value);
      if (!list.includes(d)) return;
      // 「おまかせ」（全部選択）の状態から1つを押したら、その難易度だけにする
      if (isAuto()) app.config.difficulties = new Set([d]);
      else if (set.has(d)) set.delete(d);
      else set.add(d);
    }
    renderSettings();
  }

  function isAuto() {
    const { list } = availableDifficulties();
    return list.length > 0 && list.every((d) => app.config.difficulties.has(d)) &&
      [...app.config.difficulties].every((d) => list.includes(d));
  }

  function selectedPool() {
    // 設定画面では「難易度を1つも選んでいない」＝出題なし（game.js の「空＝おまかせ」とは区別する）
    if (app.config.difficulties.size === 0) return [];
    return G.filterPool(app.questions, { unit: app.config.unit, difficulties: [...app.config.difficulties] });
  }

  function renderSettings() {
    const { counts, list } = availableDifficulties();
    // 選択中の難易度のうち、この単元にないものは外しておく
    app.config.difficulties = new Set([...app.config.difficulties].filter((d) => list.includes(d)));

    $('#unit-list').innerHTML = app.units.map((u) => {
      const on = u.unit === app.config.unit;
      const n = G.filterPool(app.questions, { unit: u.unit, difficulties: G.DIFFICULTIES }).length;
      return `<button type="button" class="unit-card${on ? ' is-selected' : ''}" role="radio" aria-checked="${on}"
          data-action="select-unit" data-unit="${esc(u.unit)}">
          <span class="unit-card__grade">中${u.grade}</span>
          <span class="unit-card__name">${esc(u.label)}</span>
          <span class="unit-card__count">${n}問</span>
          <span class="unit-card__check" aria-hidden="true">${on ? '✔' : ''}</span>
        </button>`;
    }).join('');

    const auto = isAuto();
    const chips = [`<button type="button" class="chip${auto ? ' is-selected' : ''}" aria-pressed="${auto}"
        data-action="toggle-difficulty" data-difficulty="auto" ${list.length ? '' : 'disabled'}>
        <span class="chip__check" aria-hidden="true">${auto ? '✔' : ''}</span>おまかせ</button>`];
    G.DIFFICULTIES.forEach((d) => {
      const on = app.config.difficulties.has(d);
      const disabled = counts[d] === 0;
      chips.push(`<button type="button" class="chip chip--star${on ? ' is-selected' : ''}" aria-pressed="${on}"
          data-action="toggle-difficulty" data-difficulty="${d}" ${disabled ? 'disabled' : ''}
          aria-label="難易度${d}（${counts[d]}問）${disabled ? '：この単元にはありません' : ''}">
          <span class="chip__check" aria-hidden="true">${on ? '✔' : ''}</span>
          <span class="stars" aria-hidden="true">${'★'.repeat(d)}</span><small>${counts[d]}問</small></button>`);
    });
    $('#difficulty-list').innerHTML = chips.join('');

    $('#count-list').innerHTML = G.COUNT_OPTIONS.map((c) => {
      const on = app.config.count === c;
      return `<button type="button" class="chip${on ? ' is-selected' : ''}" role="radio" aria-checked="${on}"
          data-action="select-count" data-count="${c}">
          <span class="chip__check" aria-hidden="true">${on ? '✔' : ''}</span>${c === 'all' ? 'すべて' : `${c}問`}</button>`;
    }).join('');

    const pool = selectedPool();
    const summaryEl = $('#setting-summary');
    let text;
    if (app.config.difficulties.size === 0) text = '難易度を1つ以上えらんでね。';
    else if (pool.length === 0) text = 'この条件で出題できる問題がありません。';
    else {
      const n = G.resolveCount(app.config.count, pool.length);
      text = `出題できる問題：<strong>${pool.length}問</strong> → 今回は <strong>${n}問</strong> 出題します。`;
      if (app.config.count !== 'all' && pool.length < app.config.count) {
        text += `<br><small>条件に合う問題が${pool.length}問なので、${pool.length}問すべてを出題します。</small>`;
      }
    }
    const unit = currentUnit();
    const invalidHere = app.questions.filter((q) => q && unit && q.unit === unit.unit && G.validateForPlay(q).length).length;
    if (invalidHere) text += `<br><small class="warn">データに不整合がある${invalidHere}問は出題から除いています。</small>`;
    summaryEl.innerHTML = text;
    summaryEl.classList.toggle('is-empty', pool.length === 0);
    $('#start-btn').disabled = pool.length === 0;
  }

  // ============================================================ ③ 問題画面
  function startTraining() {
    const pool = selectedPool();
    if (!pool.length) return;
    try {
      app.session = new G.TrainingSession(app.questions, {
        unit: app.config.unit,
        difficulties: [...app.config.difficulties],
        count: app.config.count,
      }, rng);
    } catch (e) {
      showError(e.message);
      return;
    }
    renderQuestion();
    // 再挑戦（結果画面から）のときは履歴を置きかえる
    show('play', app.screen === 'summary' ? 'replace' : 'push');
    fitAllMath(); // 画面が表示されてから式の幅を調整する（非表示のままでは幅を測れない）
    $('#play-heading').focus({ preventScroll: true });
  }

  function stars(n) {
    return `<span aria-label="難易度${n}">${'★'.repeat(n)}<span class="stars-off">${'★'.repeat(4 - n)}</span></span>`;
  }

  function renderHud() {
    const s = app.session;
    const q = s.current;
    const unit = currentUnit();
    $('#hud-unit').textContent = unit ? unitLabel(unit) : '';
    $('#hud-stars').innerHTML = q ? stars(q.difficulty) : '';
    $('#hud-count').innerHTML = `<span class="visually-hidden">問題</span>${Math.min(s.number, s.total)}<small>/${s.total}</small>`;
    $('#hud-score').innerHTML = `<span aria-hidden="true">✔</span> 正解 ${s.correctCount}`;
    const done = s.results.length;
    $('#progress-fill').style.width = `${(done / s.total) * 100}%`;
  }

  function lineLabel(i) {
    return `${i + 1}行目`;
  }

  function renderQuestion() {
    const s = app.session;
    const q = s.current;
    if (mathObserver) mathObserver.disconnect(); // 前の問題の式の監視をやめる
    renderHud();
    const instruction = q.instruction || S.defaultInstruction(q.unit);
    const rows = q.answerLines.map((latex, i) => {
      if (i === 0) {
        return `<li class="row row--given">
            <span class="row__no">${lineLabel(i)}</span>
            <span class="row__math fit-math">${R.mathHtml(latex, true)}</span>
            <span class="row__note">問題の式</span>
          </li>`;
      }
      return `<li class="row-item">
          <button type="button" class="row row--selectable" data-action="select-line" data-index="${i}" aria-pressed="false">
            <span class="row__no">${lineLabel(i)}</span>
            <span class="row__math fit-math">${R.mathHtml(latex, true)}</span>
            <span class="row__mark" aria-hidden="true"></span>
          </button>
          <span class="row__tags" id="row-tags-${i}"></span>
        </li>`;
    }).join('');

    $('#play-body').innerHTML = `
      <article class="paper" aria-label="添削する答案">
        <div class="paper__problem">
          <p class="paper__instruction"><span class="label-badge">問題</span>${R.richTextHtml(instruction)}</p>
          <div class="paper__question fit-math">${R.mathHtml(q.question, true)}</div>
        </div>
        <div class="paper__answer">
          <p class="paper__guide"><span class="label-badge label-badge--student">生徒の答案</span>
            <span>最初に間違えた行をタップ！</span></p>
          <ol class="sheet" id="sheet">${rows}</ol>
          <div class="all-correct-wrap">
            <button type="button" class="btn-all-correct" id="all-correct-btn" data-action="select-all-correct" aria-pressed="false">
              <span class="btn-all-correct__mark" aria-hidden="true">○</span> 全部正しい！
            </button>
            <span class="row__tags" id="row-tags-all"></span>
          </div>
        </div>
      </article>

      <div class="play-actions" id="play-actions">
        <div class="hint">
          <button type="button" class="btn btn--hint" id="hint-btn" data-action="toggle-hint" aria-expanded="false" aria-controls="hint-panel">
            <span aria-hidden="true">💡</span> <span id="hint-btn-text">ヒント</span>
          </button>
          <div class="hint__panel" id="hint-panel" hidden></div>
        </div>
        <button type="button" class="btn btn--primary btn--xl btn--submit" id="submit-btn" data-action="submit" disabled>
          <span aria-hidden="true">🖍</span> 添削する！
        </button>
        <p class="submit-help" id="submit-help">行か「全部正しい！」をえらんでね</p>
      </div>

      <div class="feedback" id="feedback" hidden></div>
    `;
    renderHint();
    updateSelection();
    fitAllMath(); // 表示直後に調整（以後の大きさの変化は ResizeObserver が追従）
    $('#play-heading').focus({ preventScroll: true });
  }

  function updateSelection() {
    const s = app.session;
    const sel = s.selection;
    document.querySelectorAll('.row--selectable').forEach((btn) => {
      const on = !!sel && sel.type === 'line' && sel.index === Number(btn.dataset.index);
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-pressed', String(on));
      // 採点前だけ呼ばれる。選んだ行に「ここ！」のしるし
      btn.querySelector('.row__mark').textContent = on ? '✏️ ここ！' : '';
    });
    const all = $('#all-correct-btn');
    const allOn = !!sel && sel.type === 'allCorrect';
    all.classList.toggle('is-selected', allOn);
    all.setAttribute('aria-pressed', String(allOn));
    const submit = $('#submit-btn');
    if (submit) submit.disabled = !s.canSubmit;
    const help = $('#submit-help');
    if (help) {
      help.textContent = !sel ? '行か「全部正しい！」をえらんでね'
        : sel.type === 'allCorrect' ? '「全部正しい！」をえらんでいます'
          : `${lineLabel(sel.index)}をえらんでいます`;
    }
  }

  function renderHint() {
    const s = app.session;
    const panel = $('#hint-panel');
    const btn = $('#hint-btn');
    if (!panel || !btn) return;
    panel.hidden = !s.hintOpen;
    btn.setAttribute('aria-expanded', String(s.hintOpen));
    $('#hint-btn-text').textContent = s.hintOpen ? 'ヒントをとじる' : 'ヒント';
    if (s.hintOpen && !panel.innerHTML) panel.innerHTML = `<p>${R.richTextHtml(s.current.hint || '')}</p>`;
    if (s.hintOpen) fitAllMath();
  }

  // ============================================================ ④ 添削結果
  function submitAnswer() {
    const s = app.session;
    if (!s.canSubmit) return;
    let result;
    try {
      result = s.submit();
    } catch (e) {
      if (e instanceof G.GameDataError) { showError(e.message); return; }
      throw e;
    }
    renderHud();
    renderFeedback(result);
  }

  function addTag(id, cls, html) {
    const el = document.getElementById(id);
    if (el) el.insertAdjacentHTML('beforeend', `<span class="tag ${cls}">${html}</span>`);
  }

  function choiceText(choice) {
    return choice.type === 'allCorrect' ? '「全部正しい！」' : lineLabel(choice.index);
  }

  function renderFeedback(result) {
    const s = app.session;
    const q = s.current;
    const isCorrectAnswer = q.errorLine === null;

    // 答案の行を確定状態にする（再選択・再判定はできない）
    document.querySelectorAll('.row--selectable, #all-correct-btn').forEach((b) => {
      b.disabled = true;
      b.classList.add('is-locked');
    });
    $('#play-actions').hidden = true;
    $('.paper').classList.add('is-graded', result.correct ? 'is-correct' : 'is-wrong');

    // 行のしるし：正解の場所と、プレイヤーの選択
    const expectedId = isCorrectAnswer ? 'row-tags-all' : `row-tags-${q.errorLine}`;
    const chosenId = result.choice.type === 'allCorrect' ? 'row-tags-all' : `row-tags-${result.choice.index}`;
    const expectedEl = isCorrectAnswer ? $('#all-correct-btn') : document.querySelector(`.row--selectable[data-index="${q.errorLine}"]`);
    expectedEl.classList.add('is-answer');
    if (result.correct) {
      addTag(expectedId, 'tag--ok', '<span aria-hidden="true">✔</span> 正解！');
    } else {
      const chosenEl = result.choice.type === 'allCorrect' ? $('#all-correct-btn') : document.querySelector(`.row--selectable[data-index="${result.choice.index}"]`);
      chosenEl.classList.add('is-chosen-wrong');
      addTag(chosenId, 'tag--chosen', '<span aria-hidden="true">✖</span> キミの答え');
      addTag(expectedId, 'tag--answer', isCorrectAnswer
        ? '<span aria-hidden="true">✔</span> 正解はこちら'
        : '<span aria-hidden="true">👀</span> ここをもう一度確認しよう！');
    }
    // 誤りのある答案では、最初の誤り行に赤ペンのしるし
    if (!isCorrectAnswer) {
      const mark = expectedEl.querySelector('.row__mark');
      if (mark) mark.textContent = '✖ 最初のミス';
    } else {
      $('#all-correct-btn .btn-all-correct__mark').textContent = '◎';
    }
    document.querySelectorAll('.row--selectable .row__mark').forEach((m) => {
      if (m.textContent === '✏️ ここ！') m.textContent = '';
    });

    const answerText = isCorrectAnswer ? 'この答案は全部正しい！' : `${lineLabel(q.errorLine)}が最初のまちがい`;
    const solutionTitle = isCorrectAnswer && S.canonicalJson(q.correctSolution) !== S.canonicalJson(q.answerLines)
      ? '正しい計算過程（別の解き方の例）' : '正しい計算過程';
    const solution = q.correctSolution.map((latex, i) =>
      `<li class="solution__line"><span class="row__no">${lineLabel(i)}</span><span class="row__math fit-math">${R.mathHtml(latex, true)}</span></li>`).join('');

    const head = result.correct
      ? `<div class="verdict verdict--ok">
          <span class="stamp" aria-hidden="true">✔</span>
          <div><p class="verdict__title">添削成功！</p><p class="verdict__sub">${esc(answerText)}</p></div>
        </div>`
      : `<div class="verdict verdict--ng">
          <span class="stamp stamp--ng" aria-hidden="true">△</span>
          <div><p class="verdict__title">おしい！</p>
          <p class="verdict__sub">キミの答え：${esc(choiceText(result.choice))}<br>正解：${esc(answerText)}</p></div>
        </div>`;

    const reason = isCorrectAnswer
      ? `<h3 class="feedback__title">計算のポイント</h3>`
      : `<h3 class="feedback__title">まちがいの理由${q.errorType ? `<span class="error-type">${esc(q.errorType)}</span>` : ''}</h3>`;

    const fb = $('#feedback');
    fb.innerHTML = `
      ${head}
      <section class="feedback__section">
        ${reason}
        <p class="feedback__text">${R.richTextHtml(q.explanation)}</p>
      </section>
      <section class="feedback__section">
        <h3 class="feedback__title">${solutionTitle}</h3>
        <ol class="solution">${solution}</ol>
      </section>
      <button type="button" class="btn btn--primary btn--xl btn--next" data-action="next">
        ${s.isLast ? '結果を見る' : '次の問題へ'} <span aria-hidden="true">→</span>
      </button>`;
    fb.hidden = false;
    fitAllMath();
    requestAnimationFrame(() => {
      fitAllMath();
      const target = result.correct ? fb : $('.paper');
      target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      const title = fb.querySelector('.verdict__title');
      if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
    });
  }

  function nextQuestion() {
    const s = app.session;
    if (!s || !s.isGraded) return;
    const more = s.next();
    if (more) {
      renderQuestion();
      window.scrollTo(0, 0);
    } else {
      renderSummary();
      show('summary', 'replace');
    }
  }

  // ============================================================ ⑤ 結果画面
  function renderSummary() {
    const s = app.session;
    const sum = s.summary();
    const unit = currentUnit();
    const list = s.results.map((r, i) => {
      const q = s.questions[i];
      return `<li class="review-item ${r.correct ? 'is-ok' : 'is-ng'}">
          <span class="review-item__mark" aria-hidden="true">${r.correct ? '✔' : '✖'}</span>
          <span class="review-item__no">${i + 1}問目</span>
          <span class="review-item__math">${R.mathHtml(q.question, false)}</span>
          <span class="review-item__result">${r.correct ? '正解' : 'まちがい'}</span>
        </li>`;
    }).join('');
    $('#summary-body').innerHTML = `
      <h2 id="summary-heading" class="screen-title" tabindex="-1">トレーニング結果</h2>
      <p class="summary-unit">${unit ? esc(unitLabel(unit)) : ''}</p>
      <div class="score-card">
        <p class="score-card__main"><strong>${sum.total}問中${sum.correct}問正解！</strong></p>
        <p class="score-card__rate">正解率 <span>${sum.rate}</span>%</p>
        <dl class="score-card__stats">
          <div><dt>出題</dt><dd>${sum.total}問</dd></div>
          <div><dt>正解</dt><dd>${sum.correct}問</dd></div>
          <div><dt>まちがい</dt><dd>${sum.wrong}問</dd></div>
        </dl>
        <p class="score-card__comment">${esc(G.evaluationComment(sum.rate))}</p>
      </div>
      <ol class="review-list" aria-label="問題ごとの結果">${list}</ol>`;
  }

  // ============================================================ エラー
  function showError(message) {
    $('#error-message').textContent = `${message} 開発者に連絡してください。`;
    app.session = null;
    show('error', 'replace');
  }

  // ============================================================ 長い式の表示調整
  // 横幅に収まらない式は、文字を少しずつ小さくする（最小 70%）。それでも収まらなければ横スクロール。
  function fitAllMath() {
    document.querySelectorAll('.fit-math').forEach((el) => {
      fitMath(el);
      observeMath(el);
    });
  }

  // 式の枠や式そのものの大きさが変わったら（フォントの読み込み・画面の回転・採点後の印の表示など）、調整し直す。
  // 調整後の大きさが前回と同じなら通知は来ないので、無限ループにはならない。
  const mathObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
      const targets = new Set(entries.map((e) => e.target.closest('.fit-math')).filter(Boolean));
      targets.forEach(fitMath);
    })
    : null;

  function observeMath(el) {
    if (!mathObserver || el.dataset.observed) return;
    el.dataset.observed = '1';
    mathObserver.observe(el);
    const inner = el.querySelector('.katex');
    if (inner) mathObserver.observe(inner);
  }

  function fitMath(el) {
    if (!el.offsetParent) return;
    el.style.fontSize = '';
    el.classList.remove('is-scrollable');
    let size = 100;
    while (el.scrollWidth > el.clientWidth + 1 && size > 70) {
      size -= 5;
      el.style.fontSize = `${size}%`;
    }
    if (el.scrollWidth > el.clientWidth + 1) el.classList.add('is-scrollable');
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // テスト用に状態を参照できるようにする（読み取り専用の用途）
  window.__calcTeacher = { get app() { return app; } };

  init();
})();
