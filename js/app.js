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

  // 答案の各行が等式（方程式）になる単元。それ以外は「式の計算」として表示を調整する
  const EQUATION_UNITS = new Set(['equation', 'simultaneous-equations', 'quadratic-equations']);

  const params = new URLSearchParams(location.search);
  const rng = G.createRng(params.get('seed'));

  const app = {
    screen: 'title',
    units: [],          // manifest の単元（label, grade, unit, questions）
    questions: [],      // 全問題
    invalidIds: [],     // 出題できない（データ不整合の）問題
    config: { unit: null, difficulties: new Set(G.DIFFICULTIES), count: G.DEFAULT_COUNT },
    session: null,
    retryBase: null,    // 結果画面から1問解き直しているときの、元のトレーニング
    retryIndex: null,
    retryResults: {},
    ready: false,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const screens = {};
  document.querySelectorAll('[data-screen]').forEach((el) => { screens[el.dataset.screen] = el; });

  // ============================================================ 初期化
  async function init() {
    document.addEventListener('click', onClick);
    initSound();
    // 問題数のスライダー（ドラッグ中も数がすぐ変わる）
    $('#count-range').addEventListener('input', (e) => setCount(Number(e.target.value)));
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
    stopSfx('long'); // 前の画面の長い効果音（正解音・結果発表など）を次の画面に残さない
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
    const compare = $('#compare-dialog');
    if (compare.open && app.screen === 'play') {
      // 並べて表示を開いているときの「戻る」は、それを閉じるだけにする
      history.pushState({ screen: 'play' }, '');
      compare.close();
      return;
    }
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
      case 'go-title': sfx('tap'); app.session = null; clearRetry(); show('title'); break;
      case 'go-howto': sfx('tap'); show('howto'); break;
      case 'go-options': sfx('tap'); renderSoundUi(); show('options'); break;
      case 'go-settings':
        if (!app.ready) return;
        sfx('tap');
        app.session = null;
        clearRetry();
        renderSettings();
        show('settings');
        break;
      case 'select-unit': sfx('tap'); selectUnit(el.dataset.unit); break;
      case 'toggle-difficulty': sfx('tap'); toggleDifficulty(el.dataset.difficulty); break;
      case 'count-minus': sfx('tap'); setCount(effectiveCount(selectedPool().length) - 1); break;
      case 'count-plus': sfx('tap'); setCount(effectiveCount(selectedPool().length) + 1); break;
      case 'start': startTraining(); break;
      case 'retry': clearRetry(); startTraining(); break;
      case 'review-question': startRetryQuestion(Number(el.dataset.index)); break;
      case 'secret-tap': onSecretTap(); break;
      case 'compare-open': sfx('tap'); openCompare(); break;
      case 'compare-close': sfx('tap'); $('#compare-dialog').close(); break;
      case 'select-line':
        if (app.session.selectLine(Number(el.dataset.index))) sfx('select');
        updateSelection();
        break;
      case 'select-all-correct':
        if (app.session.selectAllCorrect()) sfx('select');
        updateSelection();
        break;
      case 'toggle-hint':
        if (app.session.toggleHint()) sfx('hint'); // 開いたときだけ鳴らす
        renderHint();
        break;
      case 'submit': submitAnswer(); break;
      case 'next': nextQuestion(); break;
      case 'toggle-sound': toggleSound(); break;
      case 'sound-test': sfx('correct'); break;
      case 'quit': sfx('tap'); openQuitDialog(); break;
      case 'quit-cancel': sfx('tap'); $('#quit-dialog').close(); break;
      case 'quit-confirm':
        sfx('tap');
        $('#quit-dialog').close();
        if (app.retryBase) { backToSummary(); break; } // 解き直しをやめたときは結果画面へ戻る
        app.session = null;
        show('title', 'replace');
        break;
      default: break;
    }
  }

  // ============================================================ 効果音
  // 実際の再生は js/sound.js が担当する。ここでは「どの場面でどの音を鳴らすか」だけを決める。
  // 効果音が使えない・失敗した場合でも、ゲームの進行や採点には一切影響させない。
  function sfx(name, opts) {
    try { if (window.Sound) window.Sound.play(name, opts); } catch (e) { /* 鳴らなくても続ける */ }
  }

  function stopSfx(group) {
    try { if (window.Sound) window.Sound.stop(group); } catch (e) { /* 無視 */ }
  }

  function initSound() {
    const S2 = window.Sound;
    if (!S2) return;
    // iOS Safari などは、ユーザー操作の中でしか音声を開始できない。最初の操作で AudioContext を作成・再開する。
    // 起動時に自動で音を鳴らすことはしない。
    const unlock = () => { try { S2.unlock(); } catch (e) { /* 無視 */ } };
    ['pointerdown', 'touchend', 'keydown', 'click'].forEach((type) => {
      document.addEventListener(type, unlock, { capture: true, passive: true });
    });
    // 画面が隠れたら（タブの切り替えなど）鳴っている音を止める
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopSfx(); });
    // 設定画面の音量スライダー：動かしている間は音量だけ変え、指を離したら確認の音を鳴らす
    const range = $('#volume-range');
    range.addEventListener('input', () => { S2.setVolume(Number(range.value)); });
    range.addEventListener('change', () => { sfx('select'); });
    S2.onChange(renderSoundUi);
    renderSoundUi();
  }

  function toggleSound() {
    if (!window.Sound) return;
    const on = !window.Sound.getSettings().enabled;
    window.Sound.setEnabled(on);
    if (on) sfx('select'); // ON にしたことが音でわかるように
  }

  /** 設定画面のスイッチ・音量と、プレイ中のスピーカーボタンを、現在の設定に合わせる */
  function renderSoundUi() {
    const s = window.Sound ? window.Sound.getSettings() : { enabled: false, volume: 0 };
    const sw = $('#sound-switch');
    sw.setAttribute('aria-checked', String(s.enabled));
    $('#sound-switch-text').textContent = s.enabled ? 'ON' : 'OFF';
    const range = $('#volume-range');
    range.value = String(s.volume);
    range.style.setProperty('--fill', `${s.volume}%`);
    range.disabled = !s.enabled;
    $('#volume-value').textContent = `${s.volume}%`;
    const hud = $('#hud-sound');
    hud.textContent = s.enabled ? '🔊' : '🔇';
    hud.setAttribute('aria-pressed', String(s.enabled));
    hud.setAttribute('aria-label', s.enabled ? '効果音：ON（押すとOFF）' : '効果音：OFF（押すとON）');
    if (!window.Sound) { sw.disabled = true; hud.disabled = true; }
  }

  // ============================================================ 生徒の答案と正しい計算過程を並べて表示
  // 「行番号｜生徒の答案｜正しい計算過程」の3列。同じ行番号どうしを横に並べる。
  function openCompare() {
    const s = app.session;
    const q = s && s.current;
    if (!q || !s.isGraded) return;
    const isEq = EQUATION_UNITS.has(q.unit);
    const n = Math.max(q.answerLines.length, q.correctSolution.length);
    const cell = (lines, i, col) => {
      if (i >= lines.length) return `<div class="cmp-cell cmp-cell--empty" data-col="${col}"></div>`;
      const cls = ['cmp-cell'];
      if (i === 0) cls.push('cmp-cell--given');
      if (i === 0 && !isEq) cls.push('row--indent');
      const isError = col === 'student' && q.errorLine === i;
      if (isError) cls.push('cmp-cell--error');
      return `<div class="${cls.join(' ')}" data-col="${col}">
          <span class="row__math fit-math">${lineMathHtml(lines[i], isEq)}</span>
        </div>`;
    };
    let rows = '';
    for (let i = 0; i < n; i++) {
      rows += `<div class="cmp-no">${lineLabel(i)}</div>${cell(q.answerLines, i, 'student')}${cell(q.correctSolution, i, 'solution')}`;
    }
    const verdict = q.errorLine === null
      ? '<p class="compare__note"><span aria-hidden="true">◎</span> この答案は全部正しい答案です（正しい計算過程は別の解き方の例です）</p>'
      : `<p class="compare__note"><span aria-hidden="true">✖</span> 生徒の答案は ${lineLabel(q.errorLine)} で最初にまちがえています</p>`;
    $('#compare-body').innerHTML = `
      ${verdict}
      <div class="cmp-grid" role="table" aria-label="生徒の答案と正しい計算過程">
        <div class="cmp-head"></div>
        <div class="cmp-head"><span class="label-badge label-badge--student">生徒の答案</span></div>
        <div class="cmp-head"><span class="label-badge label-badge--ok">正しい計算過程</span></div>
        ${rows}
      </div>`;
    const dialog = $('#compare-dialog');
    if (!dialog.open) dialog.showModal();
    $('#compare-body').scrollTop = 0;
    fitAllMath();
  }

  // 並べて表示の中の方程式は、列ごとに「＝」をそろえる
  function fitCompare() {
    const dialog = $('#compare-dialog');
    if (!dialog || !dialog.open) return;
    ['student', 'solution'].forEach((col) => {
      fitEqLines([...dialog.querySelectorAll(`.cmp-cell[data-col="${col}"] .eq-line`)]);
    });
  }

  // 裏ワザ：タイトル画面の「T.TAKEMOTO」を 3 秒以内に 5 回タップすると、開発者用プレビューを開く
  const SECRET_TAPS = 5;
  const SECRET_WINDOW_MS = 3000;
  let secretTaps = [];
  function onSecretTap() {
    const now = Date.now();
    secretTaps = secretTaps.filter((t) => now - t < SECRET_WINDOW_MS);
    secretTaps.push(now);
    if (secretTaps.length >= SECRET_TAPS) {
      secretTaps = [];
      location.href = 'preview.html';
    }
  }

  function openQuitDialog() {
    const d = $('#quit-dialog');
    $('#quit-title').textContent = app.retryBase ? 'この問題の解き直しをやめますか？' : 'トレーニングをやめますか？';
    $('#quit-text').textContent = app.retryBase ? 'トレーニング結果の画面に戻ります。' : 'ここまでの結果は保存されません。';
    if (!d.open) d.showModal();
  }

  // ============================================================ 結果画面からの解き直し
  // app.retryBase   : 解き直し中のとき、元のトレーニング（結果画面に表示しているもの）
  // app.retryIndex  : 解き直している問題の番号（0始まり）
  // app.retryResults: 解き直しの結果 { 問題番号: true/false }。元の正解数・正解率は変えない
  function clearRetry() {
    app.retryBase = null;
    app.retryIndex = null;
    app.retryResults = {};
  }

  function startRetryQuestion(index) {
    const base = app.retryBase || app.session;
    if (!base || !base.finished || !base.questions[index]) return;
    const q = base.questions[index];
    try {
      // 選んだ1問だけのトレーニングを作る（採点・ヒント・解説はふだんと同じ）
      app.session = new G.TrainingSession([q], { unit: q.unit, difficulties: [q.difficulty], count: 1 }, rng);
    } catch (e) {
      showError(e.message);
      return;
    }
    app.retryBase = base;
    app.retryIndex = index;
    renderQuestion();
    show('play', 'push');
    sfx('start');
    fitAllMath();
    $('#play-heading').focus({ preventScroll: true });
  }

  function backToSummary() {
    const s = app.session;
    if (app.retryBase && s && s.results.length) app.retryResults[app.retryIndex] = s.results[0].correct;
    app.session = app.retryBase;
    const index = app.retryIndex;
    app.retryBase = null;
    app.retryIndex = null;
    renderSummary();
    show('summary', 'replace');
    const card = document.querySelector(`[data-action="review-question"][data-index="${index}"]`);
    if (card) { card.scrollIntoView({ block: 'center' }); card.focus({ preventScroll: true }); }
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

  // 難易度は1つずつ自由に選択・解除できる。「すべて選択」「すべて解除」でまとめて切り替える
  function toggleDifficulty(value) {
    const { list } = availableDifficulties();
    const set = app.config.difficulties;
    if (value === 'all') {
      app.config.difficulties = allDifficultiesSelected() ? new Set() : new Set(list);
    } else {
      const d = Number(value);
      if (!list.includes(d)) return;
      if (set.has(d)) set.delete(d);
      else set.add(d);
    }
    renderSettings();
  }

  /** この単元で選べる難易度が、すべて選ばれているか */
  function allDifficultiesSelected() {
    const { list } = availableDifficulties();
    return list.length > 0 && list.every((d) => app.config.difficulties.has(d));
  }

  // ---------- 問題数（スライダー）
  // app.config.count は「生徒が選んだ数」。出題できる問題数（最大）より多いときは、最大数を出題する。
  // 難易度を変えて最大数が増減しても、選んだ数は覚えておく。
  function effectiveCount(poolSize) {
    return Math.max(1, Math.min(app.config.count, poolSize));
  }

  function setCount(n) {
    const max = selectedPool().length;
    if (!max) return;
    app.config.count = Math.max(1, Math.min(Math.round(n), max));
    updateCountPicker();
    updateSettingSummary();
  }

  function updateCountPicker() {
    const max = selectedPool().length;
    const range = $('#count-range');
    const n = max ? effectiveCount(max) : 0;
    range.max = String(Math.max(max, 1));
    range.value = String(Math.max(n, 1));
    range.disabled = max === 0;
    range.setAttribute('aria-valuetext', max ? `${n}問` : '出題できる問題がありません');
    // つまみより左側を色で示す（スライダーの進み具合）
    const pct = max > 1 ? ((n - 1) / (max - 1)) * 100 : 100;
    range.style.setProperty('--fill', `${max ? pct : 0}%`);
    $('#count-value').textContent = max ? `${n}問` : '0問';
    $('#count-max').textContent = `${Math.max(max, 1)}問`;
    document.querySelector('[data-action="count-minus"]').disabled = !max || n <= 1;
    document.querySelector('[data-action="count-plus"]').disabled = !max || n >= max;
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

    const allOn = allDifficultiesSelected();
    const chips = [];
    G.DIFFICULTIES.forEach((d) => {
      const on = app.config.difficulties.has(d);
      const disabled = counts[d] === 0;
      chips.push(`<button type="button" class="chip chip--star${on ? ' is-selected' : ''}" aria-pressed="${on}"
          data-action="toggle-difficulty" data-difficulty="${d}" ${disabled ? 'disabled' : ''}
          aria-label="難易度${d}（${counts[d]}問）${disabled ? '：この単元にはありません' : ''}">
          <span class="chip__check" aria-hidden="true">${on ? '✔' : ''}</span>
          <span class="stars" aria-hidden="true">${'★'.repeat(d)}</span><small>${counts[d]}問</small></button>`);
    });
    // すべて選ばれているときだけ「すべて解除」、それ以外は「すべて選択」
    chips.push(`<button type="button" class="chip chip--bulk" data-action="toggle-difficulty" data-difficulty="all"
        ${list.length ? '' : 'disabled'}>${allOn ? 'すべて解除' : 'すべて選択'}</button>`);
    $('#difficulty-list').innerHTML = chips.join('');

    updateCountPicker();
    updateSettingSummary();
  }

  function updateSettingSummary() {
    const pool = selectedPool();
    const summaryEl = $('#setting-summary');
    let text;
    if (app.config.difficulties.size === 0) text = '難易度を1つ以上えらんでね。';
    else if (pool.length === 0) text = 'この条件で出題できる問題がありません。';
    else text = `出題できる問題：<strong>${pool.length}問</strong> → 今回は <strong>${effectiveCount(pool.length)}問</strong> 出題します。`;
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
        count: effectiveCount(pool.length),
      }, rng);
    } catch (e) {
      showError(e.message);
      return;
    }
    renderQuestion();
    // 再挑戦（結果画面から）のときは履歴を置きかえる
    show('play', app.screen === 'summary' ? 'replace' : 'push');
    sfx('start'); // トレーニング開始のチャイム（show の後に鳴らす。show は前の長い音を止めるため）
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
    $('#hud-unit').textContent = (unit ? unitLabel(unit) : '') + (app.retryBase ? `・${app.retryIndex + 1}問目をもう一度` : '');
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
    if ($('#compare-dialog').open) $('#compare-dialog').close();
    renderHud();
    const instruction = q.instruction || S.defaultInstruction(q.unit);
    // 方程式以外（式の計算）では、2行目以降が「=」から始まるので、1行目の式を全角スペース1文字分右にずらす
    const indentFirst = !EQUATION_UNITS.has(q.unit);
    // 方程式では、各行の「＝」の縦の位置をそろえる
    const alignEq = EQUATION_UNITS.has(q.unit);
    const rows = q.answerLines.map((latex, i) => {
      if (i === 0) {
        return `<li class="row row--given${indentFirst ? ' row--indent' : ''}">
            <span class="row__no">${lineLabel(i)}</span>
            <span class="row__math fit-math">${lineMathHtml(latex, alignEq)}</span>
          </li>`;
      }
      return `<li class="row-item">
          <button type="button" class="row row--selectable" data-action="select-line" data-index="${i}" aria-pressed="false">
            <span class="row__no">${lineLabel(i)}</span>
            <span class="row__math fit-math">${lineMathHtml(latex, alignEq)}</span>
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
          <ol class="sheet${alignEq ? ' eq-group' : ''}" id="sheet">${rows}</ol>
          <div class="all-correct-wrap">
            <div class="choice-bar">
              <button type="button" class="btn-all-correct" id="all-correct-btn" data-action="select-all-correct" aria-pressed="false">
                <span class="btn-all-correct__mark" aria-hidden="true">○</span> 全部正しい！
              </button>
              <button type="button" class="btn btn--primary btn--submit" id="submit-btn" data-action="submit" disabled>
                <span aria-hidden="true">🖍</span> 添削する！
              </button>
            </div>
            <span class="row__tags" id="row-tags-all"></span>
            <p class="submit-help" id="submit-help">行か「全部正しい！」をえらんでね</p>
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
      btn.setAttribute('aria-pressed', String(on)); // 選んだ行は枠と背景色で示す
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
    // 添削の「スタンプ」の音のあと、少し遅らせて正解・不正解の音につなげる（重なって騒がしくならないように）
    sfx('submit');
    sfx(result.correct ? 'correct' : 'incorrect', { delay: 0.12 });
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
    $('#submit-help').hidden = true; // 「添削する！」は下で「次の問題へ」に変える
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

    const answerText = isCorrectAnswer ? 'この答案は全部正しい！' : `${lineLabel(q.errorLine)}が最初のまちがい`;
    const solutionTitle = isCorrectAnswer && S.canonicalJson(q.correctSolution) !== S.canonicalJson(q.answerLines)
      ? '正しい計算過程（別の解き方の例）' : '正しい計算過程';
    // 答案と同じく、方程式以外では1行目の式を全角スペース1文字分右にずらす
    const indentFirst = !EQUATION_UNITS.has(q.unit);
    const solution = q.correctSolution.map((latex, i) =>
      `<li class="solution__line${i === 0 && indentFirst ? ' row--indent' : ''}"><span class="row__no">${lineLabel(i)}</span><span class="row__math fit-math">${lineMathHtml(latex, !indentFirst)}</span></li>`).join('');

    const head = result.correct
      ? `<div class="verdict verdict--ok">
          <span class="stamp" aria-hidden="true">✔</span>
          <div><p class="verdict__title">添削成功！</p><p class="verdict__sub">${esc(answerText)}</p></div>
        </div>`
      : `<div class="verdict verdict--ng">
          <span class="stamp stamp--ng" aria-hidden="true">✖</span>
          <div><p class="verdict__title">添削失敗…</p>
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
        <ol class="solution${indentFirst ? '' : ' eq-group'}">${solution}</ol>
        <button type="button" class="btn btn--secondary btn--compare" data-action="compare-open">
          <span aria-hidden="true">⇆</span> 生徒の答案と並べて表示
        </button>
      </section>`;
    fb.hidden = false;

    // 「添削する！」ボタンを、同じ位置のまま赤い「次の問題へ」ボタンに変える
    const nextBtn = $('#submit-btn');
    nextBtn.dataset.action = 'next';
    nextBtn.classList.remove('btn--primary');
    nextBtn.classList.add('btn--go-next');
    nextBtn.innerHTML = `${app.retryBase ? '結果にもどる' : s.isLast ? '結果を見る' : '次の問題へ'} <span aria-hidden="true">→</span>`;
    nextBtn.disabled = false;

    fitAllMath();
    requestAnimationFrame(() => {
      fitAllMath();
      // 正解：ボタンのすぐ下に結果が見えるよう、ボタンの位置まで送る。不正解：印の付いた答案を上から見せる
      const target = result.correct ? $('.choice-bar') : $('.paper');
      target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      const title = fb.querySelector('.verdict__title');
      if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
    });
  }

  function nextQuestion() {
    const s = app.session;
    if (!s || !s.isGraded) return;
    if (app.retryBase) { sfx('next'); backToSummary(); return; }
    const more = s.next();
    if (more) {
      stopSfx('long'); // 正解音などの余韻を次の問題に残さない
      sfx('next');
      renderQuestion();
      window.scrollTo(0, 0);
    } else {
      renderSummary();
      show('summary', 'replace');
      // 結果発表：全問正解なら専用のファンファーレだけを鳴らす（通常の終了音は重ねない）
      const sum = s.summary();
      sfx(sum.total > 0 && sum.correct === sum.total ? 'perfect' : 'result');
    }
  }

  // ============================================================ ⑤ 結果画面
  function renderSummary() {
    const s = app.session;
    const sum = s.summary();
    const unit = currentUnit();
    const retried = app.retryResults || {};
    const list = s.results.map((r, i) => {
      const q = s.questions[i];
      const again = i in retried
        ? `<span class="review-item__again ${retried[i] ? 'is-ok' : 'is-ng'}">もう一度：${retried[i] ? '✔ 正解' : '✖ まちがい'}</span>`
        : '';
      return `<li>
          <button type="button" class="review-item ${r.correct ? 'is-ok' : 'is-ng'}" data-action="review-question" data-index="${i}"
            aria-label="${i + 1}問目（${r.correct ? '正解' : 'まちがい'}）をもう一度解く">
            <span class="review-item__mark" aria-hidden="true">${r.correct ? '✔' : '✖'}</span>
            <span class="review-item__no">${i + 1}問目</span>
            <span class="review-item__math">${R.mathHtml(q.question, false)}</span>
            <span class="review-item__result">${r.correct ? '正解' : 'まちがい'}</span>
            <span class="review-item__retry" aria-hidden="true">↻</span>
            ${again}
          </button>
        </li>`;
    }).join('');
    $('#summary-body').innerHTML = `
      <h2 id="summary-heading" class="screen-title" tabindex="-1">トレーニング結果</h2>
      <p class="summary-unit">${unit ? esc(unitLabel(unit)) : ''}</p>
      <div class="score-card">
        <p class="score-card__rate">正解率 <span>${sum.rate}</span>%</p>
        <dl class="score-card__stats">
          <div><dt>出題</dt><dd>${sum.total}問</dd></div>
          <div><dt>正解</dt><dd>${sum.correct}問</dd></div>
          <div><dt>まちがい</dt><dd>${sum.wrong}問</dd></div>
        </dl>
        <p class="score-card__comment">${esc(G.evaluationComment(sum.rate))}</p>
      </div>
      <p class="review-guide">問題をタップすると、もう一度解けます</p>
      <ol class="review-list" aria-label="問題ごとの結果（タップでもう一度解く）">${list}</ol>`;
  }

  // ============================================================ エラー
  function showError(message) {
    $('#error-message').textContent = `${message} 開発者に連絡してください。`;
    app.session = null;
    show('error', 'replace');
  }

  // ============================================================ 方程式の「＝」をそろえる表示
  /**
   * LaTeX の等式を、かっこ・中かっこの外にある「=」で左辺と右辺に分ける。
   * 「=」がちょうど1つでなければ null（そろえずに通常の表示にする）。
   */
  function splitEquation(latex) {
    let depth = 0;
    const at = [];
    for (let i = 0; i < latex.length; i++) {
      const c = latex[i];
      if (c === '\\') { i++; continue; } // \{ \} などのコマンドは読み飛ばす
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') depth--;
      else if (c === '=' && depth === 0) at.push(i);
    }
    if (at.length !== 1) return null;
    const lhs = latex.slice(0, at[0]).trim();
    const rhs = latex.slice(at[0] + 1).trim();
    return lhs && rhs ? { lhs, rhs } : null;
  }

  /** 答案・正しい計算過程の1行分の数式。alignEq のときは「左辺｜＝｜右辺」の3列に分ける */
  function lineMathHtml(latex, alignEq) {
    const parts = alignEq ? splitEquation(latex) : null;
    if (!parts) return R.mathHtml(latex, true);
    // 各部分は文中の数式として描画するが、分数の大きさは別行立ての式と同じにする（\displaystyle）
    return `<span class="eq-line">
        <span class="eq-lhs">${R.mathHtml(`\\displaystyle ${parts.lhs}`, false)}</span>
        <span class="eq-op">${R.mathHtml('=', false)}</span>
        <span class="eq-rhs">${R.mathHtml(`\\displaystyle ${parts.rhs}`, false)}</span>
      </span>`;
  }

  /**
   * 「＝」をそろえるまとまり（答案、または正しい計算過程）を調整する。
   *  1. まとまり全体に同じ倍率をかけて、いちばん長い行が枠に収まるまで縮める（最小 70%）
   *  2. 左辺の列の幅を、いちばん長い左辺に合わせる → 「＝」が縦一列にそろう
   * それでも収まらない行は、これまでどおり横スクロールにする。
   */
  function fitEqGroup(group) {
    fitEqLines([...group.querySelectorAll('.eq-line')]);
  }

  /** 「＝」をそろえたい行（.eq-line）の集まりを調整する。倍率と左辺の幅は各行に設定する */
  function fitEqLines(allLines) {
    const lines = allLines.filter((el) => el.offsetParent);
    if (!lines.length) return;
    const boxes = lines.map((el) => el.parentElement);
    // offsetWidth は回転などの transform の影響を受けない（スマホ縦の「並べて表示」は90°回転しているため）
    const width = (sel) => Math.max(...lines.map((el) => el.querySelector(sel).offsetWidth));
    const setAll = (name, value) => lines.forEach((el) => el.style.setProperty(name, value));
    setAll('--eq-scale', '1');
    setAll('--eq-lhs-w', 'auto');
    const need = width('.eq-lhs') + width('.eq-op') + width('.eq-rhs') + 2;
    const avail = Math.min(...boxes.map((b) => b.clientWidth));
    const scale = need > avail ? Math.max(0.7, Math.floor((avail / need) * 100) / 100) : 1;
    setAll('--eq-scale', String(scale));
    setAll('--eq-lhs-w', `${Math.ceil(width('.eq-lhs'))}px`);
    boxes.forEach((b) => b.classList.toggle('is-scrollable', b.scrollWidth > b.clientWidth + 1));
  }

  // ============================================================ 長い式の表示調整
  // 横幅に収まらない式は、文字を少しずつ小さくする（最小 70%）。それでも収まらなければ横スクロール。
  // 方程式の「＝」をそろえる行は、行ごとではなく、まとまりごとに同じ倍率で縮める（fitEqGroup）。
  function fitAllMath() {
    document.querySelectorAll('.eq-group').forEach(fitEqGroup);
    fitCompare();
    document.querySelectorAll('.fit-math').forEach((el) => {
      fitMath(el);
      observeMath(el);
    });
  }

  // 式の枠や式そのものの大きさが変わったら（フォントの読み込み・画面の回転・採点後の印の表示など）、調整し直す。
  // 調整後の大きさが前回と同じなら通知は来ないので、無限ループにはならない。
  const mathObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
      const groups = new Set();
      const singles = new Set();
      let compare = false;
      entries.forEach((e) => {
        const group = e.target.closest('.eq-group');
        if (group && e.target.closest('.fit-math') && group.querySelector('.eq-line')) groups.add(group);
        else if (e.target.closest('.compare') && e.target.closest('.fit-math') && e.target.closest('.fit-math').querySelector('.eq-line')) compare = true;
        else if (e.target.closest('.fit-math')) singles.add(e.target.closest('.fit-math'));
      });
      groups.forEach(fitEqGroup);
      if (compare) fitCompare();
      singles.forEach(fitMath);
    })
    : null;

  function observeMath(el) {
    if (!mathObserver || el.dataset.observed) return;
    el.dataset.observed = '1';
    mathObserver.observe(el);
    el.querySelectorAll('.eq-lhs, .eq-rhs').forEach((part) => mathObserver.observe(part));
    const inner = el.querySelector('.katex');
    if (inner) mathObserver.observe(inner);
  }

  function fitMath(el) {
    if (!el.offsetParent) return;
    if (el.querySelector('.eq-line')) return; // 「＝」をそろえる行は fitEqGroup で調整する
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
