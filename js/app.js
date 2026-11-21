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
  const TA = window.TimeAttack;
  const C = window.Certification;
  // 記録（公式・カスタム・認定）。localStorage が使えない環境でも、メモリ上で動く
  const records = window.Records.createRecordStore({
    storage: (() => { try { return window.localStorage; } catch (e) { return null; } })(),
  });

  const app = {
    screen: 'title',
    units: [],          // manifest の単元（label, grade, unit, questions）
    questions: [],      // 全問題
    invalidIds: [],     // 出題できない（データ不整合の）問題
    // 出題条件。トレーニングの設定画面で選ぶ。再挑戦・「単元選択に戻る」でもそのまま引き継ぐ
    config: { unit: null, categories: new Set(), difficulties: new Set(G.DIFFICULTIES), count: G.DEFAULT_COUNT },
    session: null,
    retryBase: null,    // 結果画面から1問解き直しているときの、元のトレーニング
    retryIndex: null,
    retryResults: {},
    mode: 'training',   // 添削画面（play）を使っているモード：'training'（トレーニング）／'exam'（認定試験）
    // タイムアタック：mode は 'official'／'custom'。カテゴリ・難易度はカスタムだけで使う
    ta: { mode: null, unit: null, categories: new Set(), difficulties: new Set(G.DIFFICULTIES), session: null, timers: [], tickId: null, warned: false, result: null },
    cert: { unit: null, last: null },  // 認定試験：選んだ単元と、直前の試験の結果
    ready: false,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const screens = {};
  document.querySelectorAll('[data-screen]').forEach((el) => { screens[el.dataset.screen] = el; });

  // ============================================================ 初期化
  async function init() {
    document.addEventListener('click', onClick);
    initSound();
    // タイムアタック中に画面が表に戻ったら、すぐに残り時間を更新する（裏にいた間も時間は減っている）
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tickTA(); });
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
      app.config.categories = new Set(availableCategories().map((c) => c.name)); // 最初はすべてのカテゴリ
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
    document.body.dataset.currentScreen = name; // 画面の <section data-screen> と区別するため、別の名前にする
    if (historyMode === 'push') history.pushState({ screen: name }, '');
    else if (historyMode === 'replace') history.replaceState({ screen: name }, '');
    window.scrollTo(0, 0);
    const heading = screens[name].querySelector('h1, h2');
    if (heading && name !== 'title') heading.focus({ preventScroll: true });
  }

  function inProgress() {
    if (app.screen === 'play') return !!app.session && !app.session.finished;
    if (app.screen === 'ta-play') return !!(app.ta.session && !app.ta.session.ended);
    return false;
  }

  // ブラウザの「戻る」：プレイ中は確認してから終了する
  function onPopState(e) {
    const target = (e.state && e.state.screen) || 'title';
    // 並べて表示・解説のポップアップを開いているときの「戻る」は、それを閉じるだけにする
    const popup = ['#compare-dialog', '#explain-dialog'].map((sel) => $(sel)).find((d) => d.open);
    if (popup) {
      history.pushState({ screen: app.screen }, '');
      popup.close();
      return;
    }
    if (inProgress()) {
      history.pushState({ screen: app.screen }, '');
      openQuitDialog();
      return;
    }
    // 進行中の状態がない画面（プレイ・結果）へは戻らない
    if (['ta-play', 'ta-result'].includes(target)) { renderTASettings(); show(app.ta.mode ? 'ta-settings' : 'ta-menu', 'replace'); return; }
    if (target === 'cert-result' || (target === 'play' && app.mode === 'exam')) { renderCertList(); show(app.cert.unit ? 'cert-list' : 'cert-units', 'replace'); return; }
    if (target === 'cert-list') { if (!app.cert.unit) { renderCertUnits(); show('cert-units', 'replace'); return; } renderCertList(); }
    if (target === 'cert-units') renderCertUnits();
    if (target === 'records') renderRecords();
    if (target === 'ta-settings') renderTASettings();
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
      case 'go-options': sfx('tap'); renderSoundUi(); setResetStatus(''); show('options'); break;
      case 'reset-records': sfx('tap'); setResetStatus(''); if (!$('#reset-dialog').open) $('#reset-dialog').showModal(); break;
      case 'reset-cancel': sfx('tap'); $('#reset-dialog').close(); break;
      case 'reset-confirm': sfx('tap'); $('#reset-dialog').close(); resetRecords(); break;
      case 'go-settings':
        if (!app.ready) return;
        sfx('tap');
        app.session = null;
        clearRetry();
        renderSettings();
        show('settings');
        break;
      case 'select-unit': sfx('tap'); selectUnit(el.dataset.unit); break;
      case 'toggle-category': sfx('tap'); toggleCategory(Number(el.dataset.index)); break;
      case 'toggle-category-all': sfx('tap'); toggleAllCategories(); break;
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
        if (app.screen === 'ta-play') { abortTA(); renderTASettings(); show('ta-settings', 'replace'); break; } // 記録しない
        if (app.mode === 'exam') { app.session = null; app.mode = 'training'; renderCertList(); show('cert-list', 'replace'); break; } // 合格扱いにしない・記録しない
        if (app.retryBase) { backToSummary(); break; } // 解き直しをやめたときは結果画面へ戻る
        app.session = null;
        show('title', 'replace');
        break;
      // ---------- タイムアタック
      case 'go-ta-menu': sfx('tap'); show('ta-menu'); break;
      case 'ta-mode': sfx('tap'); selectTAMode(el.dataset.mode); break;
      case 'ta-select-unit': sfx('tap'); selectTAUnit(el.dataset.unit); break;
      case 'ta-toggle-category': sfx('tap'); toggleTACategory(Number(el.dataset.index)); break;
      case 'ta-toggle-category-all': sfx('tap'); toggleTACategoryAll(); break;
      case 'ta-toggle-difficulty': sfx('tap'); toggleTADifficulty(el.dataset.difficulty); break;
      case 'ta-start': startTA(); break;
      case 'ta-answer': answerTA(el.dataset.index); break;
      case 'ta-retry': startTA(); break;
      case 'ta-back-settings': sfx('tap'); renderTASettings(); show('ta-settings'); break;
      case 'ta-explain': sfx('tap'); openTAExplain(Number(el.dataset.index)); break;
      case 'ta-replay': replayCustom(Number(el.dataset.index)); break;
      // ---------- 認定試験
      case 'go-cert-units': if (!app.ready) return; sfx('tap'); renderCertUnits(); show('cert-units'); break;
      case 'cert-unit': sfx('tap'); app.cert.unit = el.dataset.unit; renderCertList(); show('cert-list'); break;
      case 'go-cert-list': sfx('tap'); renderCertList(); show('cert-list'); break;
      case 'cert-start': startExam(Number(el.dataset.exam)); break;
      case 'cert-explain': sfx('tap'); openCertExplain(Number(el.dataset.index)); break;
      // ---------- 記録・解説
      case 'go-records': if (!app.ready) return; sfx('tap'); renderRecords('official'); show('records'); break;
      case 'records-tab': sfx('tap'); renderRecords(el.dataset.tab); break;
      case 'explain-close': sfx('tap'); $('#explain-dialog').close(); break;
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
    // 各プレイ画面（トレーニング・認定試験・タイムアタック）の上部にあるスピーカーボタン
    document.querySelectorAll('.js-sound-toggle').forEach((hud) => {
      hud.textContent = s.enabled ? '🔊' : '🔇';
      hud.setAttribute('aria-pressed', String(s.enabled));
      hud.setAttribute('aria-label', s.enabled ? '効果音：ON（押すとOFF）' : '効果音：OFF（押すとON）');
      if (!window.Sound) hud.disabled = true;
    });
    if (!window.Sound) sw.disabled = true;
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

  // ============================================================ 記録を消す（設定画面）
  function setResetStatus(text, isError = false) {
    const el = $('#reset-status');
    el.textContent = text;
    el.classList.toggle('is-error', isError);
  }

  function resetRecords() {
    const r = records.clearAll();
    if (r.ok) setResetStatus('記録を消しました。');
    else if (r.reason === 'newer-version') setResetStatus('新しい版のアプリで保存された記録のため、消せませんでした。', true);
    else setResetStatus('記録を消せませんでした。ブラウザの設定を確認してください。', true);
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
    app.mode = 'training';
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
    if (unit === app.config.unit) { renderSettings(); return; } // 同じ単元を押し直したときは、選択をそのまま保つ
    app.config.unit = unit;
    // カテゴリは単元ごとに違うので、新しい単元のカテゴリをすべて選んだ状態にする（前の単元の選択は引き継がない）
    app.config.categories = new Set(availableCategories().map((c) => c.name));
    // 新しい単元に存在しない難易度は選択から外す。何も残らなければすべて選ぶ。
    const { list } = availableDifficulties();
    const kept = [...app.config.difficulties].filter((d) => list.includes(d));
    app.config.difficulties = new Set(kept.length ? kept : list);
    renderSettings();
  }

  // ---------- カテゴリ
  // 一覧は question-schema.js の定義と問題データの category から作る（画面には固定で書かない）
  function availableCategories() {
    const def = S.UNITS[app.config.unit];
    return G.listCategories(app.questions, app.config.unit, def ? def.categories : []);
  }

  // カテゴリは1つずつ自由に選択・解除できる。「すべて選択」「すべて解除」の動きは難易度と同じ
  function toggleCategory(index) {
    const cat = availableCategories()[index];
    if (!cat) return;
    const set = app.config.categories;
    if (set.has(cat.name)) set.delete(cat.name);
    else set.add(cat.name);
    renderSettings();
  }

  function toggleAllCategories() {
    const list = availableCategories().map((c) => c.name);
    app.config.categories = allCategoriesSelected() ? new Set() : new Set(list);
    renderSettings();
  }

  function allCategoriesSelected() {
    const list = availableCategories();
    return list.length > 0 && list.every((c) => app.config.categories.has(c.name));
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

  /** 画面で選んだ出題条件（game.js の filterPool・TrainingSession にそのまま渡せる形） */
  function selectedCriteria() {
    return {
      unit: app.config.unit,
      categories: [...app.config.categories],
      difficulties: [...app.config.difficulties],
    };
  }

  function selectedPool() {
    // 設定画面では「カテゴリ／難易度を1つも選んでいない」＝出題なし（game.js の「空＝すべて」とは区別する）
    if (app.config.categories.size === 0 || app.config.difficulties.size === 0) return [];
    return G.filterPool(app.questions, selectedCriteria());
  }

  function renderSettings() {
    const { counts, list } = availableDifficulties();
    // 選択中の難易度のうち、この単元にないものは外しておく
    app.config.difficulties = new Set([...app.config.difficulties].filter((d) => list.includes(d)));
    // 選択中のカテゴリのうち、この単元にないものは外しておく
    const cats = availableCategories();
    app.config.categories = new Set([...app.config.categories].filter((name) => cats.some((c) => c.name === name)));

    // カテゴリ・難易度・単元のボタンは、カスタムタイムアタックと共通の部品で作る。
    // ボタンに出す問題数は単元全体での数。すべて選ばれているときだけ「すべて解除」、それ以外は「すべて選択」
    $('#category-list').innerHTML = categoryChipsHtml(cats, app.config.categories, 'toggle-category');
    $('#category-bulk').innerHTML = `<button type="button" class="chip chip--bulk" data-action="toggle-category-all"
        ${cats.length ? '' : 'disabled'}>${allCategoriesSelected() ? 'すべて解除' : 'すべて選択'}</button>`;
    $('#unit-list').innerHTML = unitCardsHtml(app.config.unit, 'select-unit',
      (u) => `${G.filterPool(app.questions, { unit: u.unit, difficulties: G.DIFFICULTIES }).length}問`);
    $('#difficulty-list').innerHTML = difficultyChipsHtml(counts, app.config.difficulties, 'toggle-difficulty');

    updateCountPicker();
    updateSettingSummary();
  }

  function updateSettingSummary() {
    const pool = selectedPool();
    const summaryEl = $('#setting-summary');
    let text;
    if (app.config.categories.size === 0) text = 'カテゴリを1つ以上えらんでね。';
    else if (app.config.difficulties.size === 0) text = '難易度を1つ以上えらんでね。';
    else if (pool.length === 0) text = 'この条件で出題できる問題がありません。カテゴリや難易度を変えてみよう。';
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
    app.mode = 'training';
    try {
      app.session = new G.TrainingSession(app.questions, {
        ...selectedCriteria(),
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
    if (app.mode === 'exam') {
      // 認定試験：単元と試験名、正解数と合格に必要な数
      $('#hud-unit').textContent = `${unitLabelById(s.unit)}・${s.exam.name}`;
      // 正解数は難易度の★の右に出す。何問目かは問題のバッジ（第○問）で示すので、右上の「1/7」は出さない
      const es = $('#hud-exam-score');
      es.innerHTML = `<span aria-hidden="true">✔</span> ${s.correctCount}<small>/${s.exam.requiredCorrect}</small>`;
      es.setAttribute('aria-label', `正解 ${s.correctCount}問（合格に必要なのは${s.exam.requiredCorrect}問）`);
      es.hidden = false;
      $('#hud-score').hidden = true;
      $('#hud-count').hidden = true;
    } else {
      $('#hud-unit').textContent = (unit ? unitLabel(unit) : '') + (app.retryBase ? `・${app.retryIndex + 1}問目をもう一度` : '');
      $('#hud-score').innerHTML = `<span aria-hidden="true">✔</span> 正解 ${s.correctCount}`;
      $('#hud-score').removeAttribute('aria-label');
      $('#hud-score').hidden = false;
      $('#hud-count').hidden = false;
      $('#hud-exam-score').hidden = true;
    }
    $('#hud-stars').innerHTML = q ? stars(q.difficulty) : '';
    $('#hud-count').innerHTML = `<span class="visually-hidden">問題</span>${Math.min(s.number, s.total)}<small>/${s.total}</small>`;
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
          <p class="paper__instruction"><span class="label-badge">${app.mode === 'exam' ? `第${s.number}問` : '問題'}</span>${R.richTextHtml(instruction)}</p>
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
    // 認定試験ではヒントを使えない
    $('#play-actions').hidden = app.mode === 'exam';
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
    const nextLabel = app.mode === 'exam'
      ? (s.decided ? '結果を見る' : '次の問題へ') // 合否が決まったら残りは出題しない
      : app.retryBase ? '結果にもどる' : s.isLast ? '結果を見る' : '次の問題へ';
    nextBtn.innerHTML = `${nextLabel} <span aria-hidden="true">→</span>`;
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
    if (app.mode === 'exam') {
      if (s.next()) { stopSfx('long'); sfx('next'); renderQuestion(); window.scrollTo(0, 0); }
      else finishExam();
      return;
    }
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

  // ============================================================ 共通の部品
  function unitLabelById(unitId) {
    const u = app.units.find((x) => x.unit === unitId);
    return u ? unitLabel(u) : unitId;
  }

  function unitCardsHtml(selectedUnit, action, extra) {
    return app.units.map((u) => {
      const on = u.unit === selectedUnit;
      return `<button type="button" class="unit-card${on ? ' is-selected' : ''}" role="radio" aria-checked="${on}"
          data-action="${action}" data-unit="${esc(u.unit)}">
          <span class="unit-card__grade">中${u.grade}</span>
          <span class="unit-card__name">${esc(u.label)}</span>
          <span class="unit-card__count">${extra ? extra(u) : ''}</span>
          <span class="unit-card__check" aria-hidden="true">${on ? '✔' : ''}</span>
        </button>`;
    }).join('');
  }

  /** カテゴリのボタン（トレーニング・カスタムタイムアタック共通） */
  function categoryChipsHtml(cats, selected, action) {
    return cats.map((c, i) => {
      const on = selected.has(c.name);
      return `<button type="button" class="cat-chip${on ? ' is-selected' : ''}" aria-pressed="${on}"
          data-action="${action}" data-index="${i}" aria-label="${esc(c.name)}（${c.count}問）">
          <span class="cat-chip__check" aria-hidden="true">${on ? '✔' : ''}</span>
          <span class="cat-chip__name">${esc(c.name)}</span>
          <span class="cat-chip__count">${c.count}問</span>
        </button>`;
    }).join('');
  }

  /** 難易度のボタンと「すべて選択／すべて解除」（トレーニング・カスタムタイムアタック共通） */
  function difficultyChipsHtml(counts, selected, action) {
    const list = G.DIFFICULTIES.filter((d) => counts[d] > 0);
    const allOn = list.length > 0 && list.every((d) => selected.has(d));
    const chips = G.DIFFICULTIES.map((d) => {
      const on = selected.has(d);
      const disabled = counts[d] === 0;
      return `<button type="button" class="chip chip--star${on ? ' is-selected' : ''}" aria-pressed="${on}"
          data-action="${action}" data-difficulty="${d}" ${disabled ? 'disabled' : ''}
          aria-label="難易度${d}（${counts[d]}問）${disabled ? '：この単元にはありません' : ''}">
          <span class="chip__check" aria-hidden="true">${on ? '✔' : ''}</span>
          <span class="stars" aria-hidden="true">${'★'.repeat(d)}</span><small>${counts[d]}問</small></button>`;
    });
    chips.push(`<button type="button" class="chip chip--bulk" data-action="${action}" data-difficulty="all"
        ${list.length ? '' : 'disabled'}>${allOn ? 'すべて解除' : 'すべて選択'}</button>`);
    return chips.join('');
  }

  function categoriesOf(unitId) {
    const def = S.UNITS[unitId];
    return G.listCategories(app.questions, unitId, def ? def.categories : []);
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function difficultyText(list) {
    const ds = (list || G.DIFFICULTIES).slice().sort();
    return ds.length === 4 ? 'すべての難易度' : ds.map((d) => '★'.repeat(d)).join('・');
  }

  function saveWarningHtml() {
    if (!records.status.lastError) return '';
    const msg = records.status.readOnly
      ? '新しい版のアプリで保存された記録があるため、記録を上書きしませんでした。'
      : '記録を保存できませんでした（ブラウザの設定や空き容量を確かめてください）。ゲームはそのまま続けられます。';
    return `<p class="save-warning" role="status">⚠ ${msg}</p>`;
  }

  /** 結果画面の、問題ごとの ✔／✖ カード（押すと解説のポップアップ） */
  function resultCardsHtml(items, action) {
    if (!items.length) return '<p class="screen-note">回答した問題はありません。</p>';
    return `<p class="review-guide">問題をタップすると、解説が見られます</p>
      <ol class="review-list" aria-label="問題ごとの結果（タップで解説）">${items.map((r, i) => `
        <li>
          <button type="button" class="review-item ${r.correct ? 'is-ok' : 'is-ng'}" data-action="${action}" data-index="${i}"
            aria-label="${i + 1}問目（${r.correct ? '正解' : 'まちがい'}）の解説を見る">
            <span class="review-item__mark" aria-hidden="true">${r.correct ? '✔' : '✖'}</span>
            <span class="review-item__no">${i + 1}問目</span>
            <span class="review-item__math">${R.mathHtml(r.question.question, false)}</span>
            <span class="review-item__result">${r.correct ? (r.points ? `+${r.points}` : '正解') : 'まちがい'}</span>
            <span class="review-item__retry" aria-hidden="true">📖</span>
          </button>
        </li>`).join('')}</ol>`;
  }

  /**
   * 1問の解説をポップアップで見せる（タイムアタック・認定試験の結果画面から）。
   * 生徒の答案（キミの答えと最初の誤り行の印つき）・解説・正しい計算過程を表示する。スコアや記録は変わらない。
   */
  function openExplain(no, r) {
    const q = r.question;
    const isEq = EQUATION_UNITS.has(q.unit);
    const chosen = r.choice;
    const lines = q.answerLines.map((latex, i) => {
      const isError = q.errorLine === i;
      const isChosen = chosen && chosen.type === 'line' && chosen.index === i;
      const tags = [];
      if (isChosen) tags.push(`<span class="tag ${r.correct ? 'tag--ok' : 'tag--chosen'}">${r.correct ? '✔' : '✖'} キミの答え</span>`);
      if (isError && !r.correct) tags.push('<span class="tag tag--answer">✖ 最初のミス</span>');
      return `<li class="solution__line${isError ? ' explain-line--error' : ''}${i === 0 && !isEq ? ' row--indent' : ''}">
          <span class="row__no">${lineLabel(i)}</span>
          <span class="row__math fit-math">${lineMathHtml(latex, isEq)}</span>
          ${tags.length ? `<span class="explain-tags">${tags.join('')}</span>` : ''}
        </li>`;
    }).join('');
    const allCorrectNote = q.errorLine === null
      ? `<p class="explain-note">この答案は<strong>全部正しい</strong>答案です。${chosen && chosen.type === 'allCorrect' ? '（キミの答え：○ 全部正しい！）' : ''}</p>`
      : (chosen && chosen.type === 'allCorrect' ? '<p class="explain-note">キミの答え：○ 全部正しい！</p>' : '');
    const solution = q.correctSolution.map((latex, i) =>
      `<li class="solution__line${i === 0 && !isEq ? ' row--indent' : ''}"><span class="row__no">${lineLabel(i)}</span><span class="row__math fit-math">${lineMathHtml(latex, isEq)}</span></li>`).join('');
    $('#explain-title').textContent = `${no}問目　${r.correct ? '✔ 正解' : '✖ まちがい'}`;
    $('#explain-body').innerHTML = `
      <p class="paper__instruction">${R.richTextHtml(q.instruction || S.defaultInstruction(q.unit))}</p>
      <div class="paper__question fit-math">${R.mathHtml(q.question, true)}</div>
      <h3 class="feedback__title">生徒の答案</h3>
      <ol class="solution${isEq ? ' eq-group' : ''}">${lines}</ol>
      ${allCorrectNote}
      <h3 class="feedback__title">${q.errorLine === null ? '計算のポイント' : 'まちがいの理由'}${q.errorType ? `<span class="error-type">${esc(q.errorType)}</span>` : ''}</h3>
      <p class="feedback__text">${R.richTextHtml(q.explanation)}</p>
      <h3 class="feedback__title">正しい計算過程</h3>
      <ol class="solution${isEq ? ' eq-group' : ''}">${solution}</ol>`;
    const d = $('#explain-dialog');
    if (!d.open) d.showModal();
    $('#explain-body').scrollTop = 0;
    fitAllMath();
  }

  // ============================================================ タイムアタック：設定
  function selectTAMode(mode) {
    app.ta.mode = mode === 'official' ? TA.MODES.OFFICIAL : TA.MODES.CUSTOM; // 公式は明示的に選んだときだけ
    if (!app.ta.unit) app.ta.unit = app.config.unit;
    if (!app.ta.categories.size) app.ta.categories = new Set(categoriesOf(app.ta.unit).map((c) => c.name));
    renderTASettings();
    show('ta-settings');
  }

  function selectTAUnit(unit) {
    if (unit === app.ta.unit) { renderTASettings(); return; }
    app.ta.unit = unit;
    app.ta.categories = new Set(categoriesOf(unit).map((c) => c.name)); // 単元を変えたらカテゴリはすべて選択
    const counts = G.countByDifficulty(app.questions, unit);
    const list = G.DIFFICULTIES.filter((d) => counts[d] > 0);
    const kept = [...app.ta.difficulties].filter((d) => list.includes(d));
    app.ta.difficulties = new Set(kept.length ? kept : list);
    renderTASettings();
  }

  function toggleTACategory(index) {
    const cat = categoriesOf(app.ta.unit)[index];
    if (!cat) return;
    if (app.ta.categories.has(cat.name)) app.ta.categories.delete(cat.name);
    else app.ta.categories.add(cat.name);
    renderTASettings();
  }

  function toggleTACategoryAll() {
    const names = categoriesOf(app.ta.unit).map((c) => c.name);
    const allOn = names.length > 0 && names.every((n) => app.ta.categories.has(n));
    app.ta.categories = allOn ? new Set() : new Set(names);
    renderTASettings();
  }

  function toggleTADifficulty(value) {
    const counts = G.countByDifficulty(app.questions, app.ta.unit);
    const list = G.DIFFICULTIES.filter((d) => counts[d] > 0);
    if (value === 'all') {
      const allOn = list.length > 0 && list.every((d) => app.ta.difficulties.has(d));
      app.ta.difficulties = allOn ? new Set() : new Set(list);
    } else {
      const d = Number(value);
      if (!list.includes(d)) return;
      if (app.ta.difficulties.has(d)) app.ta.difficulties.delete(d);
      else app.ta.difficulties.add(d);
    }
    renderTASettings();
  }

  /** タイムアタックの出題条件（公式はすべてに固定。カスタムは選んだ条件） */
  function taConfig() {
    return {
      mode: app.ta.mode,
      unit: app.ta.unit,
      categories: [...app.ta.categories],
      difficulties: [...app.ta.difficulties],
    };
  }

  function taPoolSize() {
    if (!app.ta.unit) return 0;
    if (app.ta.mode === TA.MODES.CUSTOM && (app.ta.categories.size === 0 || app.ta.difficulties.size === 0)) return 0;
    return G.filterPool(app.questions, TA.criteriaFor(app.ta.mode, taConfig())).length;
  }

  function renderTASettings() {
    if (!app.ta.mode) return;
    const official = app.ta.mode === TA.MODES.OFFICIAL;
    if (!app.ta.unit) app.ta.unit = app.config.unit;
    $('#ta-settings-heading').textContent = official ? '🏅 公式タイムアタック' : '🎯 カスタムタイムアタック';
    $('#ta-unit-list').innerHTML = unitCardsHtml(app.ta.unit, 'ta-select-unit', (u) => {
      if (!official) return `${G.filterPool(app.questions, { unit: u.unit }).length}問`;
      const best = records.officialFor(u.unit).bestScore;
      return best === null ? '記録なし' : `ベスト ${best}点`;
    });
    $('#ta-custom-fields').hidden = official;
    const info = $('#ta-official-info');
    info.hidden = !official;
    if (official) {
      const rec = records.officialFor(app.ta.unit);
      info.innerHTML = `
        <p class="official-info__rule">ルール：<strong>全カテゴリ・全難易度（★〜★★★★）・60秒</strong>（変更できません）</p>
        <p class="official-info__best">${rec.bestScore === null
          ? 'この単元の記録はまだありません。最初の記録をつくろう！'
          : `自己ベスト <strong>${rec.bestScore}点</strong>　称号「${esc(rec.title || TA.titleForScore(rec.bestScore))}」`}</p>`;
    } else {
      const cats = categoriesOf(app.ta.unit);
      app.ta.categories = new Set([...app.ta.categories].filter((n) => cats.some((c) => c.name === n)));
      $('#ta-category-list').innerHTML = categoryChipsHtml(cats, app.ta.categories, 'ta-toggle-category');
      const allCats = cats.length > 0 && cats.every((c) => app.ta.categories.has(c.name));
      $('#ta-category-bulk').innerHTML = `<button type="button" class="chip chip--bulk" data-action="ta-toggle-category-all"
          ${cats.length ? '' : 'disabled'}>${allCats ? 'すべて解除' : 'すべて選択'}</button>`;
      $('#ta-difficulty-list').innerHTML = difficultyChipsHtml(G.countByDifficulty(app.questions, app.ta.unit), app.ta.difficulties, 'ta-toggle-difficulty');
    }
    const n = taPoolSize();
    let text;
    if (!official && app.ta.categories.size === 0) text = 'カテゴリを1つ以上えらんでね。';
    else if (!official && app.ta.difficulties.size === 0) text = '難易度を1つ以上えらんでね。';
    else if (n === 0) text = 'この条件で出題できる問題がありません。';
    else text = `出題できる問題：<strong>${n}問</strong>（60秒のあいだ、くり返し出題されます）${official ? '' : '<br><small>カスタムの結果は履歴に残ります。公式の記録・称号は変わりません。</small>'}`;
    $('#ta-summary').innerHTML = text;
    $('#ta-summary').classList.toggle('is-empty', n === 0);
    $('#ta-start-btn').disabled = n === 0;
  }

  // ============================================================ タイムアタック：プレイ
  function clearTATimers() {
    app.ta.timers.forEach((t) => clearTimeout(t));
    app.ta.timers = [];
    if (app.ta.tickId) clearInterval(app.ta.tickId);
    app.ta.tickId = null;
  }

  function later(fn, ms) {
    app.ta.timers.push(setTimeout(fn, ms));
  }

  function startTA() {
    if (!app.ta.mode || taPoolSize() === 0) return;
    clearTATimers();
    try {
      app.ta.session = new TA.TimeAttackSession(app.questions, taConfig(), {
        rng,
        now: () => performance.now(), // 単調増加の時計（PCの時刻を変えても影響しない）
      });
    } catch (e) {
      showError(e.message);
      return;
    }
    app.ta.warned = false;
    app.ta.result = null;
    $('#ta-body').innerHTML = '';
    updateTAHud();
    show('ta-play', app.screen === 'ta-result' ? 'replace' : 'push');
    // 3・2・1・START!（START! の瞬間から60秒を数える。カウントダウン中は時間が減らない）
    const steps = ['3', '2', '1'];
    steps.forEach((label, i) => later(() => { showTAOverlay(label, 'count'); sfx('countdown'); }, i * 800));
    later(() => {
      showTAOverlay('START!', 'go');
      sfx('go');
      app.ta.session.start();
      renderTAQuestion();
      app.ta.tickId = setInterval(tickTA, 100);
      later(() => hideTAOverlay(), 450);
    }, steps.length * 800);
  }

  function showTAOverlay(text, kind) {
    const o = $('#ta-overlay');
    o.hidden = false;
    o.className = `ta-overlay ta-overlay--${kind}`;
    $('#ta-overlay-text').textContent = text;
    $('#ta-overlay-note').hidden = kind !== 'count'; // 3・2・1 のあいだだけ説明を出す
  }

  function hideTAOverlay() {
    $('#ta-overlay').hidden = true;
  }

  function updateTAHud() {
    const s = app.ta.session;
    if (!s) return;
    const rem = s.started ? s.remaining() : TA.CONFIG.durationMs;
    $('#ta-timer-num').textContent = String(Math.ceil(rem / 1000));
    $('#ta-gauge-fill').style.width = `${(rem / TA.CONFIG.durationMs) * 100}%`;
    const timer = $('#ta-timer');
    timer.classList.toggle('is-warning', s.started && rem <= TA.CONFIG.warningAtMs);
    timer.classList.toggle('is-urgent', s.started && rem <= TA.CONFIG.urgentAtMs);
    $('.screen--ta-play').classList.toggle('is-urgent', s.started && rem <= TA.CONFIG.urgentAtMs && rem > 0);
    $('#ta-score').innerHTML = `${s.score}<small>点</small>`;
    $('#ta-streak').textContent = s.streak >= 2 ? `🔥${s.streak}連続` : '';
    // のこりミス（❤ が減っていく）
    const lives = $('#ta-lives');
    lives.innerHTML = Array.from({ length: s.maxMisses }, (_, i) => `<span class="${i < s.livesLeft ? '' : 'is-lost'}">❤️</span>`).join('');
    lives.setAttribute('aria-label', `あと${s.livesLeft}回ミスでゲームオーバー`);
  }

  function tickTA() {
    const s = app.ta.session;
    if (!s || s.ended) return;
    updateTAHud();
    if (!app.ta.warned && s.remaining() <= TA.CONFIG.warningAtMs) {
      app.ta.warned = true;
      sfx('warning'); // 残り10秒
    }
    // 演出中でなければ、時間切れでその場で終了（演出中なら、演出のあとで終了する）
    if (s.isTimeUp() && !s.locked) endTA();
  }

  function renderTAQuestion() {
    const s = app.ta.session;
    const q = s.current;
    if (mathObserver) mathObserver.disconnect();
    const isEq = EQUATION_UNITS.has(q.unit);
    const rows = q.answerLines.map((latex, i) => {
      if (i === 0) {
        return `<li class="row row--given${isEq ? '' : ' row--indent'}">
            <span class="row__no">${lineLabel(i)}</span>
            <span class="row__math fit-math">${lineMathHtml(latex, isEq)}</span>
          </li>`;
      }
      return `<li class="row-item">
          <button type="button" class="row row--selectable" data-action="ta-answer" data-index="${i}">
            <span class="row__no">${lineLabel(i)}</span>
            <span class="row__math fit-math">${lineMathHtml(latex, isEq)}</span>
            <span class="row__mark" aria-hidden="true"></span>
          </button>
        </li>`;
    }).join('');
    $('#ta-body').innerHTML = `
      <article class="paper paper--ta" aria-label="添削する答案">
        <div class="paper__problem">
          <p class="paper__instruction"><span class="label-badge">${s.results.length + 1}問目</span>${R.richTextHtml(q.instruction || S.defaultInstruction(q.unit))}</p>
          <div class="paper__question fit-math">${R.mathHtml(q.question, true)}</div>
        </div>
        <div class="paper__answer">
          <ol class="sheet${isEq ? ' eq-group' : ''}">${rows}</ol>
          <div class="all-correct-wrap">
            <button type="button" class="btn-all-correct btn-all-correct--wide" data-action="ta-answer" data-index="all">
              <span class="btn-all-correct__mark" aria-hidden="true">○</span> 全部正しい！
            </button>
          </div>
        </div>
      </article>
      <p class="ta-popup" id="ta-popup" aria-live="polite"></p>`;
    fitAllMath();
  }

  /** 即時判定：行（または「全部正しい！」）をタップした瞬間に採点する。演出が終わるまで次の回答は受け付けない */
  function answerTA(indexValue) {
    const s = app.ta.session;
    if (!s || s.ended || s.locked || !s.started) return;
    const choice = indexValue === 'all' ? { type: 'allCorrect' } : { type: 'line', index: Number(indexValue) };
    const r = s.answer(choice);
    if (!r) { if (s.ended) endTA(); return; }
    sfx(r.correct ? 'quickCorrect' : 'quickIncorrect');
    const body = $('#ta-body');
    body.classList.add('is-locked');
    body.querySelectorAll('[data-action="ta-answer"]').forEach((b) => { b.disabled = true; });
    const chosenEl = choice.type === 'allCorrect' ? body.querySelector('[data-index="all"]') : body.querySelector(`[data-index="${choice.index}"]`);
    chosenEl.classList.add(r.correct ? 'ta-ok' : 'ta-ng');
    const mark = chosenEl.querySelector('.row__mark');
    if (mark) mark.textContent = r.correct ? '✔' : '✖';
    if (!r.correct) {
      // 正しい答え（最初の誤り行、または全部正しい）を一瞬見せる
      const expectedEl = r.question.errorLine === null ? body.querySelector('[data-index="all"]') : body.querySelector(`[data-index="${r.question.errorLine}"]`);
      if (expectedEl) expectedEl.classList.add('ta-answer');
    }
    const popup = $('#ta-popup');
    popup.textContent = r.correct ? `✔ +${r.points}${r.streak >= 3 ? `　🔥${r.streak}連続` : ''}` : `✖ ミス ${r.misses}/${s.maxMisses}`;
    popup.className = `ta-popup ${r.correct ? 'is-ok' : 'is-ng'}`;
    updateTAHud();
    later(() => {
      if (!app.ta.session || app.ta.session !== s) return;
      if (s.advance()) renderTAQuestion();
      else endTA();
    }, TA.CONFIG.feedbackMs);
  }

  /** 途中でやめた（記録しない） */
  function abortTA() {
    clearTATimers();
    hideTAOverlay();
    if (app.ta.session) app.ta.session.finish();
    app.ta.session = null;
  }

  /** タイムアップ・ゲームオーバー：回答を受け付けず、記録して結果画面へ */
  function endTA() {
    const s = app.ta.session;
    if (!s || app.ta.result) return;
    clearTATimers();
    s.finish();
    updateTAHud();
    if ($('#quit-dialog').open) $('#quit-dialog').close();
    $('#ta-body').querySelectorAll('[data-action="ta-answer"]').forEach((b) => { b.disabled = true; });
    const sum = s.summary();
    let rec;
    if (s.isOfficial) rec = records.recordOfficial(s.criteria.unit, sum, TA.titleForScore);
    else rec = records.addCustom({ unit: s.criteria.unit, categories: s.criteria.categories, difficulties: s.criteria.difficulties, ...sum });
    app.ta.result = { session: s, summary: sum, record: rec };
    if (sum.gameOver) { showTAOverlay('ゲームオーバー', 'gameover'); sfx('fail'); }
    else { showTAOverlay('タイムアップ！', 'timeup'); sfx('timeup'); }
    later(() => {
      hideTAOverlay();
      renderTAResult();
      show('ta-result', 'replace');
      if (s.isOfficial && rec.isBest && !rec.firstPlay && sum.score > 0) sfx('best'); // 自己ベスト更新
    }, 1100);
  }

  function renderTAResult() {
    const { session: s, summary: sum, record: rec } = app.ta.result;
    const unit = unitLabelById(s.criteria.unit);
    let bestHtml = '';
    let titleHtml = '';
    if (s.isOfficial) {
      const best = rec.record.bestScore;
      if (rec.firstPlay) bestHtml = '<p class="best-badge">🎉 初めての公式記録！</p>';
      else if (rec.isBest) bestHtml = `<p class="best-badge best-badge--new">🎉 自己ベスト更新！<small>（これまで ${rec.prevBest}点）</small></p>`;
      else bestHtml = `<p class="best-line">自己ベスト：${best}点</p>`;
      const changed = rec.prevTitle && rec.prevTitle !== rec.record.title;
      titleHtml = `<p class="ta-title">称号：<strong>${esc(rec.record.title)}</strong>${changed ? '<span class="ta-title__up">称号アップ！</span>' : ''}</p>`;
    } else {
      const cats = s.criteria.categories ? s.criteria.categories.join('・') : 'すべてのカテゴリ';
      bestHtml = `<p class="best-line">カスタム：${esc(cats)}／${difficultyText(s.criteria.difficulties)}</p>
        <p class="screen-note">カスタムの結果は履歴に保存されました（公式の記録・称号は変わりません）。</p>`;
    }
    const items = s.results.map((r) => ({ ...r }));
    $('#ta-result-body').innerHTML = `
      <h2 id="ta-result-heading" class="screen-title" tabindex="-1">${s.isOfficial ? '🏅 公式' : '🎯 カスタム'}タイムアタック結果</h2>
      <p class="summary-unit">${esc(unit)}</p>
      <div class="score-card">
        ${sum.gameOver ? `<p class="gameover-badge">💥 ${s.maxMisses}回ミスでゲームオーバー</p>` : ''}
        <p class="score-card__rate">スコア <span>${sum.score}</span>点</p>
        ${bestHtml}
        <dl class="score-card__stats">
          <div><dt>正解</dt><dd>${sum.correct}問</dd></div>
          <div><dt>不正解</dt><dd>${sum.wrong}問</dd></div>
          <div><dt>正解率</dt><dd>${sum.rate}%</dd></div>
          <div><dt>最大連続</dt><dd>${sum.maxStreak}問</dd></div>
        </dl>
        ${titleHtml}
      </div>
      ${saveWarningHtml()}
      ${resultCardsHtml(items, 'ta-explain')}`;
  }

  function openTAExplain(index) {
    const r = app.ta.result && app.ta.result.session.results[index];
    if (r) openExplain(index + 1, r);
  }

  /** 記録画面のカスタム履歴から、同じ条件で再挑戦する */
  function replayCustom(index) {
    const e = records.customHistory()[index];
    if (!e) return;
    app.ta.mode = TA.MODES.CUSTOM;
    app.ta.unit = e.unit;
    app.ta.categories = new Set(e.categories || categoriesOf(e.unit).map((c) => c.name));
    app.ta.difficulties = new Set(e.difficulties || G.DIFFICULTIES);
    renderTASettings();
    if (taPoolSize() === 0) { show('ta-settings'); return; } // 問題データが変わって出題できないときは設定画面へ
    startTA();
  }

  // ============================================================ 認定試験
  function rankBadgeHtml(rank, extraClass = '') {
    return `<span class="rank-badge ${extraClass}" style="--rank-color:${rank.color}"><span class="rank-badge__icon" aria-hidden="true">${rank.icon}</span>${esc(rank.name)}</span>`;
  }

  function examRangeText(exam) {
    const ds = G.DIFFICULTIES.filter((d) => exam.distribution[d] > 0);
    const lo = '★'.repeat(ds[0]);
    const hi = '★'.repeat(ds[ds.length - 1]);
    return ds.length === 1 ? `${lo}のみ` : `${lo}〜${hi}`;
  }

  function examRuleText(exam) {
    return `${exam.maxQuestions}問中${exam.requiredCorrect}問正解で合格`;
  }

  function renderCertUnits() {
    $('#cert-unit-list').innerHTML = app.units.map((u) => {
      const c = records.certFor(u.unit);
      const rank = C.rankFor(c.highestCleared);
      const next = C.EXAMS.find((e) => e.id === c.highestCleared + 1);
      return `<button type="button" class="cert-unit" data-action="cert-unit" data-unit="${esc(u.unit)}" style="--rank-color:${rank.color}">
          <span class="cert-unit__icon" aria-hidden="true">${rank.icon}</span>
          <span class="cert-unit__body">
            <span class="cert-unit__name">中${u.grade}・${esc(u.label)}</span>
            <span class="cert-unit__rank">${esc(rank.name)}</span>
            <span class="cert-unit__next">${next ? `次は ${next.name}` : '🎉 すべての試験に合格！'}</span>
          </span>
          <span class="cert-unit__arrow" aria-hidden="true">›</span>
        </button>`;
    }).join('');
  }

  function renderCertList(message) {
    const unit = app.cert.unit || app.config.unit;
    app.cert.unit = unit;
    const c = records.certFor(unit);
    const rank = C.rankFor(c.highestCleared);
    $('#cert-list-heading').textContent = `🎓 ${unitLabelById(unit)}`;
    $('#cert-rank').innerHTML = `<p class="rank-card__label">現在のランク</p>${rankBadgeHtml(rank, 'rank-badge--lg')}
      ${message ? `<p class="save-warning">${esc(message)}</p>` : ''}`;
    $('#exam-list').innerHTML = C.EXAMS.map((exam) => {
      const e = c.exams[String(exam.id)] || { cleared: false, attempts: 0 };
      const unlocked = C.isUnlocked(c.highestCleared, exam.id);
      const avail = C.checkAvailability(app.questions, unit, exam);
      let status;
      let button;
      if (!unlocked) {
        status = `<span class="exam__status exam__status--locked">🔒 ${C.EXAMS[exam.id - 2].name}に合格すると挑戦できます</span>`;
        button = '<button type="button" class="btn btn--secondary" disabled>挑戦できません</button>';
      } else if (!avail.ok) {
        status = `<span class="exam__status exam__status--short">⚠ ${esc(C.shortageMessage(avail.shortages))}</span>`;
        button = '<button type="button" class="btn btn--secondary" disabled>挑戦できません</button>';
      } else {
        status = e.cleared
          ? `<span class="exam__status exam__status--cleared">✔ 合格済み</span>`
          : '<span class="exam__status exam__status--open">挑戦できます</span>';
        button = `<button type="button" class="btn ${e.cleared ? 'btn--secondary' : 'btn--primary'}" data-action="cert-start" data-exam="${exam.id}">${e.cleared ? 'もう一度挑戦' : '挑戦する'}</button>`;
      }
      return `<li class="exam${e.cleared ? ' is-cleared' : ''}${unlocked ? '' : ' is-locked'}" data-exam-id="${exam.id}">
          <div class="exam__head">
            <span class="exam__name">${exam.name}</span>
            <span class="exam__range">${examRangeText(exam)}</span>
          </div>
          <p class="exam__rule">${examRuleText(exam)}</p>
          <div class="exam__foot">${status}<span class="exam__attempts">挑戦 ${e.attempts}回</span>${button}</div>
        </li>`;
    }).join('');
  }

  function startExam(examId) {
    const unit = app.cert.unit;
    const c = records.certFor(unit);
    if (!C.isUnlocked(c.highestCleared, examId)) return; // 解放されていない試験は始めない
    let s;
    try {
      s = new C.CertificationSession(app.questions, { unit, examId }, rng);
    } catch (e) {
      // 問題が足りない：重複や難易度の変更で埋めずに、始めない
      renderCertList(e.message);
      if (app.screen !== 'cert-list') show('cert-list');
      return;
    }
    clearRetry();
    app.mode = 'exam';
    app.session = s;
    renderQuestion();
    show('play', app.screen === 'cert-result' ? 'replace' : 'push');
    sfx('examStart');
    fitAllMath();
    $('#play-heading').focus({ preventScroll: true });
  }

  /** 合否が決まった：記録して試験結果画面へ */
  function finishExam() {
    const s = app.session;
    const sum = s.summary();
    const passed = sum.outcome === C.OUTCOME.PASS;
    const rec = records.recordExam(s.unit, s.exam.id, passed);
    app.cert.last = { session: s, summary: sum, record: rec };
    app.session = null;
    app.mode = 'training';
    renderCertResult();
    show('cert-result', 'replace');
    if (!passed) sfx('fail');
    else if (rec.firstClear && s.exam.id === C.EXAMS[C.EXAMS.length - 1].id) sfx('master'); // 最終試験に初合格
    else if (rec.rankUp) sfx('rankup');
    else sfx('pass');
  }

  function renderCertResult() {
    const { session: s, summary: sum, record: rec } = app.cert.last;
    const passed = sum.outcome === C.OUTCOME.PASS;
    const rank = C.rankFor(rec.highestCleared);
    const nextExam = C.EXAMS.find((e) => e.id === s.exam.id + 1);
    const isFinal = !nextExam;
    let celebrate = '';
    if (passed && rec.firstClear && rec.rankUp) {
      celebrate = `<div class="promotion">
          <p class="promotion__title">🎉 ${esc(rank.name)}に昇格！</p>
          ${isFinal ? '<p class="promotion__sub">すべての試験に合格しました。マスターティーチャー認定です！</p>' : `<p class="promotion__sub">${nextExam.name}が解放されました！</p>`}
        </div>`;
    }
    const remaining = s.exam.requiredCorrect - sum.correct;
    const verdict = passed
      ? `<div class="verdict verdict--ok"><span class="stamp" aria-hidden="true">合</span><div><p class="verdict__title">${s.exam.name} 合格！</p><p class="verdict__sub">${rec.firstClear ? 'はじめての合格です！' : 'もう一度合格しました！'}</p></div></div>`
      : `<div class="verdict verdict--ng"><span class="stamp stamp--ng" aria-hidden="true">…</span><div><p class="verdict__title">${s.exam.name} 不合格</p><p class="verdict__sub">合格まで あと${Math.max(remaining, 1)}問 でした。まちがえた問題の解説を読んで、もう一度挑戦しよう！<br><small>いまのランクは下がりません。</small></p></div></div>`;
    $('#cert-result-body').innerHTML = `
      <h2 id="cert-result-heading" class="screen-title" tabindex="-1">試験結果</h2>
      <p class="summary-unit">${esc(unitLabelById(s.unit))}・${s.exam.name}</p>
      ${verdict}
      ${celebrate}
      <div class="score-card">
        <dl class="score-card__stats">
          <div><dt>回答</dt><dd>${sum.answered}問</dd></div>
          <div><dt>正解</dt><dd>${sum.correct}問</dd></div>
          <div><dt>不正解</dt><dd>${sum.wrong}問</dd></div>
        </dl>
        <p class="exam__rule">判定条件：${examRuleText(s.exam)}</p>
        <p class="rank-card__label">現在のランク</p>
        ${rankBadgeHtml(rank, 'rank-badge--lg')}
      </div>
      ${saveWarningHtml()}
      ${resultCardsHtml(s.results.map((r, i) => ({ ...r, question: s.questions[i] })), 'cert-explain')}`;
    // 合格して次の試験があるときは「次の試験へ」を主なボタンにし、「もう一度挑戦」は控えめにする
    const retryClass = passed && nextExam ? 'btn--secondary' : 'btn--primary';
    const actions = [`<button type="button" class="btn ${retryClass} btn--lg" data-action="cert-start" data-exam="${s.exam.id}">もう一度挑戦</button>`];
    if (passed && nextExam) actions.unshift(`<button type="button" class="btn btn--primary btn--lg" data-action="cert-start" data-exam="${nextExam.id}">次の試験へ（${nextExam.name}）</button>`);
    actions.push('<button type="button" class="btn btn--secondary btn--lg" data-action="go-cert-list">認定試験一覧に戻る</button>');
    actions.push('<button type="button" class="btn btn--ghost btn--lg" data-action="go-title">タイトルへ</button>');
    $('#cert-result-actions').innerHTML = actions.join('');
  }

  function openCertExplain(index) {
    const last = app.cert.last;
    if (!last) return;
    const r = last.session.results[index];
    if (r) openExplain(index + 1, { ...r, question: last.session.questions[index] });
  }

  // ============================================================ 記録画面
  function renderRecords(tab) {
    app.recordsTab = tab || app.recordsTab || 'official';
    document.querySelectorAll('[data-action="records-tab"]').forEach((b) => {
      const on = b.dataset.tab === app.recordsTab;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('is-selected', on);
    });
    const panel = $('#records-panel');
    panel.setAttribute('aria-labelledby', `tab-${app.recordsTab}`);
    if (app.recordsTab === 'official') {
      panel.innerHTML = `<div class="record-cards">${app.units.map((u) => {
        const r = records.officialFor(u.unit);
        return `<div class="record-card">
            <p class="record-card__unit">中${u.grade}・${esc(u.label)}</p>
            ${r.bestScore === null ? '<p class="record-card__empty">まだ記録がありません</p>' : `
            <p class="record-card__score"><span>${r.bestScore}</span>点</p>
            <p class="record-card__title">称号「${esc(r.title || TA.titleForScore(r.bestScore))}」</p>
            <dl class="record-card__stats">
              <div><dt>最大連続</dt><dd>${r.maxStreak}問</dd></div>
              <div><dt>プレイ回数</dt><dd>${r.plays}回</dd></div>
              <div><dt>達成日</dt><dd>${formatDate(r.bestDate)}</dd></div>
            </dl>`}
          </div>`;
      }).join('')}</div>`;
    } else if (app.recordsTab === 'custom') {
      const list = records.customHistory();
      panel.innerHTML = list.length ? `<ol class="history-list">${list.map((e, i) => `
          <li class="history-item">
            <div class="history-item__head"><span>${formatDate(e.playedAt)}</span><span class="history-item__score">${e.score}点</span></div>
            <p class="history-item__cond">${esc(unitLabelById(e.unit))}｜${esc(e.categories ? e.categories.join('・') : 'すべてのカテゴリ')}｜${difficultyText(e.difficulties)}</p>
            <p class="history-item__stats">正解 ${e.correct}問・不正解 ${e.wrong}問・最大連続 ${e.maxStreak}問</p>
            <button type="button" class="btn btn--secondary" data-action="ta-replay" data-index="${i}">この条件で挑戦</button>
          </li>`).join('')}</ol>` : '<p class="record-card__empty">カスタムタイムアタックの履歴はまだありません（直近20回まで残ります）。</p>';
    } else {
      panel.innerHTML = `<div class="record-cards">${app.units.map((u) => {
        const c = records.certFor(u.unit);
        const rank = C.rankFor(c.highestCleared);
        const cleared = C.EXAMS.filter((e) => c.exams[String(e.id)] && c.exams[String(e.id)].cleared);
        const next = C.EXAMS.find((e) => e.id === c.highestCleared + 1);
        return `<div class="record-card">
            <p class="record-card__unit">中${u.grade}・${esc(u.label)}</p>
            ${rankBadgeHtml(rank, 'rank-badge--lg')}
            <dl class="record-card__stats">
              <div><dt>最高クリア</dt><dd>${c.highestCleared ? C.examById(c.highestCleared).name : 'なし'}</dd></div>
              <div><dt>次に挑戦</dt><dd>${next ? next.name : '—'}</dd></div>
            </dl>
            <p class="record-card__cleared">合格済み：${cleared.length ? cleared.map((e) => `${e.name}（${c.exams[String(e.id)].attempts}回挑戦）`).join('、') : 'なし'}</p>
          </div>`;
      }).join('')}</div>`;
    }
    const note = $('#records-note');
    note.textContent = records.status.lastError === 'corrupt'
      ? '保存されていた記録が壊れていたため、新しく記録を始めました（もとのデータは別の場所に残しています）。'
      : !records.status.available ? 'このブラウザでは記録を保存できません。記録はこの画面を閉じると消えます。'
        : '記録はこの端末のブラウザに保存されます。';
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
  window.__calcTeacher = { get app() { return app; }, get records() { return records; } };

  init();
})();
