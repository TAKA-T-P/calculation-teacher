/*
 * ゲーム画面（index.html）の自動操作テスト。
 * iframe に画面を読み込み、実際にボタンをクリックして表示と状態を確かめる。
 */
(async function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const W = Number(params.get('w') || 390);
  const H = Number(params.get('h') || 844);
  const SHOT = params.get('shot');
  const frame = document.getElementById('frame');
  frame.style.width = W + 'px';
  frame.style.height = H + 'px';

  const results = [];
  const out = document.getElementById('results');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let w, d;
  async function load(url) {
    await new Promise((resolve) => { frame.onload = resolve; frame.src = url; });
    w = frame.contentWindow;
    d = frame.contentDocument;
  }
  async function waitFor(cond, label, timeout = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (cond()) return; } catch (e) { /* まだ準備中 */ }
      await sleep(30);
    }
    throw new Error(`タイムアウト: ${label}`);
  }
  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];
  const app = () => w.__calcTeacher.app;
  // 問題データから件数を数える（問題を追加しても、テストを書き直さずに済むように）
  const cnt = (c) => app().questions.filter((q) => q.unit === c.unit && (!c.categories || c.categories.includes(q.category)) && (!c.difficulties || c.difficulties.includes(q.difficulty))).length;
  // 画面の <section> の中だけを探す（同じ部品がほかの画面にもあるため）
  const inScreen = (name, sel) => d.querySelector(`section[data-screen="${name}"] ${sel}`);
  const visible = (name) => !d.querySelector(`section[data-screen="${name}"]`).hidden;
  async function click(sel) {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) throw new Error(`要素がありません: ${sel}`);
    el.click();
    await sleep(40);
  }
  function check(cond, msg) { if (!cond) throw new Error(msg); }
  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, detail: e.message });
    }
  }

  async function openGame(seed = 1) {
    await load(`../../index.html?seed=${seed}`);
    await waitFor(() => w.__calcTeacher && app().ready, 'データ読み込み');
  }
  async function configure({ unit, categories, difficulties, count }) {
    if (!visible('settings')) await click('[data-action="go-settings"]');
    await click(`[data-action="select-unit"][data-unit="${unit}"]`);
    // カテゴリ：まず全部選び、指定があればすべて解除してから指定のカテゴリだけ選ぶ
    const catBulk = () => $('[data-action="toggle-category-all"]');
    if (catBulk().textContent.includes('すべて選択')) await click(catBulk());
    if (categories) {
      await click(catBulk());
      for (const name of categories) await click(catChip(name));
    }
    const bulk = () => $('[data-action="toggle-difficulty"][data-difficulty="all"]');
    if (bulk().textContent.includes('すべて選択')) await click(bulk()); // まず全部選ぶ
    if (difficulties) {
      await click(bulk()); // すべて解除してから、指定の難易度だけ選ぶ
      for (const dd of difficulties) await click(`[data-action="toggle-difficulty"][data-difficulty="${dd}"]`);
    }
    await setCountTo(count);
  }
  const catChip = (name) => $$('[data-action="toggle-category"]').find((b) => b.querySelector('.cat-chip__name').textContent === name);
  const catPressed = () => $$('[data-action="toggle-category"]').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.querySelector('.cat-chip__name').textContent);
  // 問題数のスライダーを動かす（'all' は最大）
  async function setCountTo(count) {
    const range = $('#count-range');
    range.value = String(count === 'all' ? range.max : count);
    range.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(30);
  }
  const rowBtn = (i) => $(`.row--selectable[data-index="${i}"]`);
  async function answer(correct) {
    const q = app().session.current;
    if (correct) {
      if (q.errorLine === null) await click('#all-correct-btn'); else await click(rowBtn(q.errorLine));
    } else if (q.errorLine === null) await click(rowBtn(1));
    else if (q.errorLine !== 1) await click(rowBtn(1));
    else if (q.answerLines.length > 2) await click(rowBtn(2));
    else await click('#all-correct-btn'); // 2行だけの答案で、誤り行が2行目のとき
    await click('#submit-btn');
    await sleep(60);
  }
  function mathOverflowReport() {
    const els = $$('.fit-math').filter((el) => el.offsetParent);
    // 右へのはみ出し（scrollWidth で分かる）に加え、「＝」をそろえた行で左辺が列の幅より広く、左へはみ出していないか
    const lhsOverflow = (el) => [...el.querySelectorAll('.eq-line')].some((line) => {
      const col = parseFloat(w.getComputedStyle(line).gridTemplateColumns.split(' ')[0]);
      return line.querySelector('.eq-lhs').offsetWidth > col + 1;
    });
    const cut = els.filter((el) => (el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('is-scrollable')) || lhsOverflow(el));
    const scrollable = els.filter((el) => el.classList.contains('is-scrollable'));
    const info = cut.map((el) => `${el.className}(${el.scrollWidth}>${el.clientWidth}, font ${el.style.fontSize || '100%'})`).join(' / ');
    return { total: els.length, cut: cut.length, scrollable: scrollable.length, info };
  }
  function pageOverflow() {
    return d.documentElement.scrollWidth - w.innerWidth;
  }

  // ================================================================== スクリーンショット用
  if (SHOT) {
    await openGame(Number(params.get('seed') || 3));
    const goto = {
      title: async () => {},
      howto: async () => click('[data-action="go-howto"]'),
      settings: async () => { await click('[data-action="go-settings"]'); await click('[data-action="toggle-difficulty"][data-difficulty="1"]'); await click('[data-action="toggle-difficulty"][data-difficulty="4"]'); },
      'settings-few': async () => configure({ unit: 'equation', difficulties: [4], count: 10 }),
      play: async () => { await configure({ unit: 'equation', count: 5 }); await click('#start-btn'); },
      'play-selected': async () => { await configure({ unit: 'equation', count: 5 }); await click('#start-btn'); await click(rowBtn(2)); await click('#hint-btn'); },
      'play-correct': async () => { await configure({ unit: 'expressions', difficulties: [4], count: 5 }); await click('#start-btn'); await answer(true); },
      'play-wrong': async () => { await configure({ unit: 'positive-negative', difficulties: [3], count: 5 }); await click('#start-btn'); await answer(false); },
      'play-allcorrect': async () => { await configure({ unit: 'equation', difficulties: [3], count: 'all' }); await click('#start-btn');
        while (app().session.current.errorLine !== null) { await answer(true); await click('[data-action="next"]'); }
        await answer(true); },
      'long-math': async () => { await configure({ unit: 'positive-negative', difficulties: [4], count: 5 }); await click('#start-btn'); await answer(true); },
      summary: async () => { await configure({ unit: 'expressions', count: 5 }); await click('#start-btn');
        for (const ok of [true, false, true, true, true]) { await answer(ok); await click('[data-action="next"]'); } },
      'summary-retried': async () => { await configure({ unit: 'expressions', count: 5 }); await click('#start-btn');
        for (const ok of [true, false, true, true, true]) { await answer(ok); await click('[data-action="next"]'); }
        await click('[data-action="review-question"][data-index="1"]'); await answer(true); await click('[data-action="next"]'); },
      compare: async () => { await configure({ unit: 'equation', difficulties: [4], count: 5 }); await click('#start-btn'); await answer(false); await click('[data-action="compare-open"]'); },
      'compare-pn': async () => { await configure({ unit: 'positive-negative', difficulties: [3], count: 5 }); await click('#start-btn'); await answer(false); await click('[data-action="compare-open"]'); },
      options: async () => click('[data-action="go-options"]'),
      'transfer-make': async () => {
        w.__calcTeacher.records.recordOfficial('equation', { score: 2450, maxStreak: 11 }, w.TimeAttack.titleForScore);
        w.__calcTeacher.records.recordExam('expressions', 1, true);
        await click('[data-action="go-options"]'); await click('[data-action="transfer-make"]'); await click('[data-action="transfer-issue"]');
      },
      'transfer-confirm': async () => {
        w.__calcTeacher.records.recordOfficial('square-roots', { score: 500, maxStreak: 2 }, w.TimeAttack.titleForScore);
        const rec = { timeAttack: { official: {
          'positive-negative': { bestScore: 2450, bestDate: '2026-11-20T10:00:00.000Z', maxStreak: 11, plays: 4 },
          expressions: { bestScore: 1860, bestDate: '2026-11-21T10:00:00.000Z', maxStreak: 8, plays: 3 },
          equation: { bestScore: 3120, bestDate: '2026-11-22T10:00:00.000Z', maxStreak: 14, plays: 9 } } },
        certification: { equation: { highestCleared: 5, exams: Object.fromEntries([1, 2, 3, 4, 5].map((k) => [k, { cleared: true, attempts: 1, firstClearedAt: '2026-11-23T10:00:00.000Z' }])) } } };
        await click('[data-action="go-options"]'); await click('[data-action="transfer-load"]');
        $('#transfer-input').value = w.RecordTransfer.createCode(rec);
        await click('[data-action="transfer-check"]');
      },
      'reset-dialog': async () => { await click('[data-action="go-options"]'); await click('[data-screen="options"] [data-action="reset-records"]'); },
      // ---- 第3段階（スクリーンショット用）
      'ta-menu': async () => click('[data-action="go-ta-menu"]'),
      'ta-official': async () => { await click('[data-action="go-ta-menu"]'); await click('[data-action="ta-mode"][data-mode="official"]'); },
      'ta-custom': async () => { await click('[data-action="go-ta-menu"]'); await click('[data-action="ta-mode"][data-mode="custom"]'); await click(d.querySelectorAll('[data-action="ta-toggle-category"]')[3]); },
      'ta-play': async () => {
        await click('[data-action="go-ta-menu"]'); await click('[data-action="ta-mode"][data-mode="official"]'); await click('#ta-start-btn');
        await waitFor(() => app().ta.session.started, 'START', 6000);
        for (let i = 0; i < 4; i++) {
          const q = app().ta.session.current;
          d.querySelector(`section[data-screen="ta-play"] [data-action="ta-answer"][data-index="${q.errorLine === null ? 'all' : q.errorLine}"]`).click();
          await sleep(380);
        }
      },
      'ta-countdown': async () => { // 「3」の表示で止める
        await click('[data-action="go-ta-menu"]'); await click('[data-action="ta-mode"][data-mode="official"]'); await click('#ta-start-btn');
        await sleep(100); app().ta.timers.forEach((t) => w.clearTimeout(t));
      },
      'ta-result': async () => {
        await click('[data-action="go-ta-menu"]'); await click('[data-action="ta-mode"][data-mode="official"]'); await click('#ta-start-btn');
        await waitFor(() => app().ta.session.started, 'START', 6000);
        for (let i = 0; i < 12; i++) {
          const q = app().ta.session.current;
          const idx = i === 5 ? (q.errorLine === null ? 1 : 'all') : (q.errorLine === null ? 'all' : q.errorLine);
          d.querySelector(`section[data-screen="ta-play"] [data-action="ta-answer"][data-index="${idx}"]`).click();
          await sleep(380);
        }
        await waitFor(() => !d.querySelector('section[data-screen="ta-result"]').hidden, 'result', 70000);
      },
      'cert-units': async () => click('[data-action="go-cert-units"]'),
      'cert-list': async () => { await click('[data-action="go-cert-units"]'); await click('[data-action="cert-unit"][data-unit="equation"]'); },
      'cert-pass': async () => {
        await click('[data-action="go-cert-units"]'); await click('[data-action="cert-unit"][data-unit="equation"]');
        await click('[data-action="cert-start"][data-exam="1"]');
        for (let i = 0; i < 3; i++) { await answer(true); await click('[data-action="next"]'); }
      },
      'cert-play': async () => { // 試験中のヘッダー（1問正解して2問目）
        await click('[data-action="go-cert-units"]'); await click('[data-action="cert-unit"][data-unit="positive-negative"]');
        await click('[data-action="cert-start"][data-exam="1"]');
        await answer(true); await click('[data-action="next"]');
      },
      'cert-list-cleared': async () => { // 第1試験に合格したあとの試験一覧
        await click('[data-action="go-cert-units"]'); await click('[data-action="cert-unit"][data-unit="equation"]');
        await click('[data-action="cert-start"][data-exam="1"]');
        for (let i = 0; i < 3; i++) { await answer(true); await click('[data-action="next"]'); }
        await click('[data-action="go-cert-list"]');
      },
      records: async () => click('[data-action="go-records"]'),
      dialog: async () => { await configure({ unit: 'equation', count: 5 }); await click('#start-btn'); await click('[data-action="quit"]'); },
    }[SHOT];
    await goto();
    await sleep(600); // アニメーション終了待ち
    if (!SHOT.startsWith('play-correct') && !SHOT.startsWith('play-wrong') && !SHOT.startsWith('play-allcorrect') && !SHOT.startsWith('long-math')) w.scrollTo(0, 0);
    const eqPos = $$('#sheet .eq-op').map((op) => Math.round(op.getBoundingClientRect().left));
    out.textContent = 'shot ready' + (eqPos.length ? ` / 「＝」の位置 ${eqPos.join(',')}` : '');
    return;
  }

  // ================================================================== テスト本体
  try { ['calcTeacher.sound', 'calcTeacher.records', 'calcTeacher.records.backup'].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* 音声設定・記録を初期状態に */ }
  await openGame(1);
  // プレビューの確認用に、問題数を先に数えておく（プレビューを開くとゲームの状態は参照できなくなるため）
  const DATA = { total: app().questions.length, expressions: cnt({ unit: 'expressions' }) };

  await test('[1] タイトル画面が表示され、トレーニングから設定画面へ進める', async () => {
    check(visible('title'), 'タイトル画面が表示されていない');
    check($('.title-name').textContent.includes('計算ティーチャー！'), 'タイトル文字');
    check($('.title-sub').textContent.includes('キミは計算ミスを見抜けるか'), 'サブタイトル');
    // 第3段階：タイムアタック・認定試験・記録が選べる（「準備中」ではない）
    ['go-ta-menu', 'go-cert-units', 'go-records'].forEach((a) => check(inScreen('title', `button[data-action="${a}"]`), `${a} のボタンがない`));
    check(!$('.coming-soon'), '「準備中」の表示が残っている');
    await click('[data-action="go-settings"]');
    check(visible('settings'), '設定画面へ進めない');
  });

  await test('[2] 単元は manifest の3単元から選べ、変更すると対象問題が切り替わる', async () => {
    check($$('section[data-screen="settings"] .unit-card').length === 3, `単元の数 ${$$('section[data-screen="settings"] .unit-card').length}`);
    await click('[data-action="select-unit"][data-unit="equation"]');
    check($('[data-unit="equation"]').getAttribute('aria-checked') === 'true', '方程式が選択されていない');
    const eqStar1 = $('[data-difficulty="1"]').textContent;
    check(eqStar1.includes(`${cnt({ unit: 'equation', difficulties: [1] })}問`), `方程式の★の問題数表示: ${eqStar1}`);
    await click('[data-action="select-unit"][data-unit="positive-negative"]');
    check($('[data-difficulty="1"]').textContent.includes(`${cnt({ unit: 'positive-negative', difficulties: [1] })}問`), '正負の数の★の問題数表示');
    check($('#setting-summary').textContent.includes(`出題できる問題：${cnt({ unit: 'positive-negative' })}問`), '出題できる問題数の表示');
  });

  await test('[3] 難易度を複数選択でき、「すべて選択」⇔「すべて解除」が切り替わる（おまかせはない）', async () => {
    const pressed = () => $$('[data-action="toggle-difficulty"]').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.difficulty);
    const bulk = () => $('[data-difficulty="all"]');
    check(!$('#difficulty-list').textContent.includes('おまかせ'), '「おまかせ」が残っている');
    // 初期状態はすべて選択 → ボタンは「すべて解除」
    check(pressed().join() === '1,2,3,4', `初期状態: ${pressed()}`);
    check(bulk().textContent.trim() === 'すべて解除', `全部選ばれているときの表示: ${bulk().textContent.trim()}`);
    // 1つ外すと「すべて選択」に変わる
    await click('[data-difficulty="1"]');
    check(pressed().join() === '2,3,4', `★を外した: ${pressed()}`);
    check(bulk().textContent.trim() === 'すべて選択', `1つ外したときの表示: ${bulk().textContent.trim()}`);
    // すべて選択 → 全部オン、すべて解除 → 全部オフ
    await click(bulk());
    check(pressed().join() === '1,2,3,4' && bulk().textContent.trim() === 'すべて解除', `すべて選択: ${pressed()}`);
    await click(bulk());
    check(pressed().length === 0 && bulk().textContent.trim() === 'すべて選択', `すべて解除: ${pressed()}`);
    check($('#start-btn').disabled, '難易度0個で開始できてしまう');
    check($('#setting-summary').textContent.includes('1つ以上'), '難易度未選択のメッセージ');
    check($('#count-range').disabled, '難易度0個で問題数のスライダーが動かせる');
    // 個別に複数選べる
    await click('[data-difficulty="2"]');
    await click('[data-difficulty="3"]');
    check(pressed().join() === '2,3', `★★と★★★: ${pressed()}`);
    check($('#setting-summary').textContent.includes(`出題できる問題：${cnt({ unit: 'positive-negative', difficulties: [2, 3] })}問`), `★★+★★★ の問題数: ${$('#setting-summary').textContent}`);
    // 最後の1つを選ぶと全部そろい、「すべて解除」に変わる
    await click('[data-difficulty="1"]');
    await click('[data-difficulty="4"]');
    check(pressed().join() === '1,2,3,4' && bulk().textContent.trim() === 'すべて解除', `全部そろったときの表示: ${bulk().textContent.trim()}`);
  });

  await test('[3] 単元にない難易度は選択できない（無効表示）', async () => {
    // 現行データでは全単元に★〜★★★★がある。単元ごとの件数に応じて disabled が付くことを確かめる
    const counts = w.Game.countByDifficulty(app().questions, app().config.unit);
    [1, 2, 3, 4].forEach((n) => check($(`[data-difficulty="${n}"]`).disabled === (counts[n] === 0), `★${n}`));
  });

  await test('[4] 問題数はスライダーで1問〜最大数まで選べ、初期値は5問。−／＋でも1問ずつ変えられる', async () => {
    const range = $('#count-range');
    check(range && range.type === 'range', 'スライダーがない');
    check(!$('[data-action="select-count"]'), '5問・10問・すべてのボタンが残っている');
    check(range.min === '1' && range.max === String(cnt({ unit: 'positive-negative' })), `範囲 ${range.min}〜${range.max}`);
    check(range.value === '5' && $('#count-value').textContent === '5問', `初期値 ${range.value} / ${$('#count-value').textContent}`);
    await setCountTo(1);
    check($('#count-value').textContent === '1問' && $('#setting-summary').textContent.includes('今回は 1問'), '1問');
    check($('[data-action="count-minus"]').disabled, '1問のとき − が押せる');
    await setCountTo(7);
    check($('#count-value').textContent === '7問' && $('#setting-summary').textContent.includes('今回は 7問'), $('#setting-summary').textContent);
    await click('[data-action="count-plus"]');
    check(range.value === '8' && $('#count-value').textContent === '8問', `＋ ${range.value}`);
    await click('[data-action="count-minus"]');
    await click('[data-action="count-minus"]');
    check(range.value === '6', `− ${range.value}`);
    await setCountTo('all');
    check($('[data-action="count-plus"]').disabled, '最大のとき ＋ が押せる');
    // 最大数は選んだ難易度で変わる（★★★ だけ → ★★★ の問題数）
    await click('[data-difficulty="all"]');
    await click('[data-difficulty="3"]');
    const n3 = String(cnt({ unit: 'positive-negative', difficulties: [3] }));
    check(range.max === n3 && range.value === n3 && $('#count-value').textContent === `${n3}問`, `★★★だけの最大 ${range.max} / ${range.value}`);
    await click('[data-difficulty="all"]'); // すべて選択に戻す
    await setCountTo(5);
  });

  // ================================================================ カテゴリ選択
  const EXPECTED_CATS = {
    'positive-negative': ['加法・減法', '乗法・除法', '累乗', '四則混合'],
    expressions: ['文字式の表し方', '式の値', '同類項の計算', '分配法則など'],
    equation: ['移項', 'かっこを含む方程式', '小数を含む方程式', '分数を含む方程式'],
  };
  const catBulkText = () => $('[data-action="toggle-category-all"]').textContent.trim();

  await test('[カテゴリ 1・2・6] 単元ごとに正しいカテゴリが出て、最初はすべて選択。単元を変えると新しい単元のカテゴリがすべて選択になる', async () => {
    if (!visible('settings')) await click('[data-action="go-settings"]');
    const order = [...$('[data-screen="settings"]').querySelectorAll('.setting__label')].map((l) => l.textContent.trim().slice(0, 4));
    check(order.join() === '単元をえ,カテゴリ,難易度を,問題数', `項目の順番: ${order}`);
    for (const unit of ['positive-negative', 'expressions', 'equation']) {
      await click(`[data-action="select-unit"][data-unit="${unit}"]`);
      const names = $$('[data-action="toggle-category"] .cat-chip__name').map((n) => n.textContent);
      check(names.join() === EXPECTED_CATS[unit].join(), `${unit} のカテゴリ: ${names}`);
      check(catPressed().join() === EXPECTED_CATS[unit].join(), `${unit} の初期選択: ${catPressed()}`);
      check(catBulkText() === 'すべて解除', `${unit} のボタン表示: ${catBulkText()}`);
    }
    // 正負の数で一部を外してから単元を変えて戻ると、すべて選択に戻る（前の選択を引き継がない）
    await click('[data-action="select-unit"][data-unit="positive-negative"]');
    await click(catChip('累乗'));
    await click('[data-action="select-unit"][data-unit="equation"]');
    check(catPressed().length === 4, `方程式に切り替えたあと: ${catPressed()}`);
    await click(catChip('移項'));
    await click('[data-action="select-unit"][data-unit="equation"]'); // 同じ単元を押し直しても選択は保つ
    check(catPressed().join() === 'かっこを含む方程式,小数を含む方程式,分数を含む方程式', `同じ単元を押し直したあと: ${catPressed()}`);
    await click('[data-action="select-unit"][data-unit="positive-negative"]');
    check(catPressed().join() === EXPECTED_CATS['positive-negative'].join(), `正負の数に戻したあと: ${catPressed()}`);
  });

  await test('[カテゴリ 3・4・5・7] 複数選択・個別の解除・すべて選択⇔すべて解除。1つも選ばないと開始できない', async () => {
    await click(catChip('乗法・除法'));
    await click(catChip('四則混合'));
    check(catPressed().join() === '加法・減法,累乗', `2つ外したあと: ${catPressed()}`);
    check(catBulkText() === 'すべて選択', 'すべて選ばれていないときの表示');
    await click(catChip('四則混合'));
    check(catPressed().join() === '加法・減法,累乗,四則混合', `選び直し: ${catPressed()}`);
    await click('[data-action="toggle-category-all"]');
    check(catPressed().length === 4 && catBulkText() === 'すべて解除', 'すべて選択');
    await click('[data-action="toggle-category-all"]');
    check(catPressed().length === 0 && catBulkText() === 'すべて選択', 'すべて解除');
    check($('#start-btn').disabled && $('#count-range').disabled, '0個で開始できてしまう');
    check($('#setting-summary').textContent.includes('カテゴリを1つ以上'), `メッセージ: ${$('#setting-summary').textContent}`);
    await click('[data-action="toggle-category-all"]');
  });

  await test('[カテゴリ 9・10・11] スライダーの最大がカテゴリで変わり、希望問題数は保持される。0問なら開始できない', async () => {
    // 難易度を★だけにしぼって、カテゴリ1つの問題数が希望の10問より少ない条件にする（問題データが増えても成り立つように）
    await configure({ unit: 'positive-negative', difficulties: [1], count: 10 });
    await click('[data-action="toggle-category-all"]'); // すべて解除
    await click(catChip('累乗'));
    const nPow = cnt({ unit: 'positive-negative', categories: ['累乗'], difficulties: [1] });
    check(nPow > 0 && nPow < 10, `このテストには累乗×★が10問未満である必要がある（${nPow}問）`);
    check($('#count-range').max === String(nPow) && $('#count-value').textContent === `${nPow}問`, `累乗だけの最大 ${$('#count-range').max} / ${$('#count-value').textContent}`);
    check($('#setting-summary').textContent.includes(`出題できる問題：${nPow}問`), $('#setting-summary').textContent);
    await click(catChip('加法・減法'));
    const nPA = cnt({ unit: 'positive-negative', categories: ['累乗', '加法・減法'], difficulties: [1] });
    check($('#count-range').max === String(nPA) && $('#count-value').textContent === `${Math.min(10, nPA)}問`, `加法・減法を足したあと ${$('#count-range').max} / ${$('#count-value').textContent}`);
    await click('[data-action="toggle-category-all"]');
    check($('#count-range').max === String(cnt({ unit: 'positive-negative', difficulties: [1] })) && $('#count-value').textContent === '10問', '希望の10問に戻らない');
    // 0問の条件：問題データにはすべてのカテゴリ×難易度の問題があるので、「文字式の表し方」×★★ を一時的に取り除いて確かめる
    const all = app().questions;
    const saved = all.slice();
    for (let i = all.length - 1; i >= 0; i--) if (all[i].unit === 'expressions' && all[i].category === '文字式の表し方' && all[i].difficulty === 2) all.splice(i, 1);
    check(cnt({ unit: 'expressions', categories: ['文字式の表し方'], difficulties: [2] }) === 0, 'テストの前提（0問の条件）をつくれない');
    await configure({ unit: 'expressions', categories: ['文字式の表し方'], difficulties: [2], count: 5 });
    check($('#start-btn').disabled && $('#count-range').disabled && $('#count-value').textContent === '0問', '0問なのに開始できる');
    check($('#setting-summary').textContent.includes('出題できる問題がありません'), `メッセージ: ${$('#setting-summary').textContent}`);
    all.length = 0; saved.forEach((q) => all.push(q)); // 元に戻す
    await configure({ unit: 'expressions', count: 5 });
    check(!$('#start-btn').disabled, '問題データを元に戻したのに開始できない');
  });

  await test('[カテゴリ 8・12・13] 出題はカテゴリと難易度の両方に一致し、重複しない。再挑戦・単元選択に戻るで設定が引き継がれる', async () => {
    const cats = ['加法・減法', '累乗'];
    await configure({ unit: 'positive-negative', categories: cats, difficulties: [2, 3], count: 'all' });
    const expected = app().questions.filter((q) => q.unit === 'positive-negative' && cats.includes(q.category) && [2, 3].includes(q.difficulty)).map((q) => q.id).sort();
    check($('#count-range').max === String(expected.length), `最大 ${$('#count-range').max} / ${expected.length}`);
    await click('#start-btn');
    const s = app().session;
    check(s.questionIds.slice().sort().join() === expected.join(), `出題: ${s.questionIds}`);
    check(new Set(s.questionIds).size === s.total, '重複');
    while (!s.finished) { await answer(true); await click('[data-action="next"]'); }
    await click('[data-action="retry"]');
    const s2 = app().session;
    check(JSON.stringify(s2.config.categories) === JSON.stringify(cats.slice().sort()) && s2.config.difficulties.join() === '2,3', `再挑戦の条件 ${JSON.stringify(s2.config)}`);
    check(s2.questionIds.slice().sort().join() === expected.join(), '再挑戦の出題');
    while (!s2.finished) { await answer(true); await click('[data-action="next"]'); }
    await click('.summary-actions [data-action="go-settings"]');
    check(catPressed().join() === cats.join(), `単元選択に戻ったあとのカテゴリ: ${catPressed()}`);
    check($$('[data-action="toggle-difficulty"]').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.difficulty).join() === '2,3', '難易度が引き継がれていない');
  });

  await test('[カテゴリ 16] カテゴリの選択・解除で設定の操作音が鳴り、効果音 OFF では鳴らない', async () => {
    const S2 = w.Sound;
    S2.debug.clearLog(); S2.debug.resetThrottle();
    await click(catChip('累乗'));
    check(S2.debug.log.filter((e) => e.played).map((e) => e.name).join() === 'tap', `カテゴリの操作音: ${S2.debug.log.map((e) => e.name)}`);
    S2.setEnabled(false);
    S2.debug.clearLog(); S2.debug.resetThrottle();
    await click(catChip('累乗'));
    await click('[data-action="toggle-category-all"]');
    check(S2.debug.log.length > 0 && S2.debug.log.every((e) => !e.played && e.reason === 'off'), 'OFF なのに鳴った');
    S2.setEnabled(true);
  });

  await test('[5] 条件に合う問題が少ないときは、スライダーの最大がその数になり、その数だけ出題する', async () => {
    // カテゴリ×難易度を1つにしぼると、希望の10問より少なくなる（問題データが増えても成り立つように）
    await configure({ unit: 'equation', categories: ['移項'], difficulties: [4], count: 10 });
    const n4 = cnt({ unit: 'equation', categories: ['移項'], difficulties: [4] });
    check(n4 > 0 && n4 < 10, `このテストには10問未満の条件が必要（${n4}問）`);
    check($('#count-range').max === String(n4) && $('#count-value').textContent === `${n4}問`, `最大 ${$('#count-range').max}`);
    check($('#setting-summary').textContent.includes(`出題できる問題：${n4}問`), $('#setting-summary').textContent);
    await click('#start-btn');
    check(visible('play'), '問題画面へ進まない');
    check(app().session.total === n4, `出題数 ${app().session.total}`);
    check($('#hud-count').textContent.includes(`1/${n4}`), $('#hud-count').textContent);
  });

  await test('やめるボタン：確認ダイアログで「つづける」と「やめる」が動く', async () => {
    await click('[data-action="quit"]');
    check($('#quit-dialog').open, 'ダイアログが開かない');
    await click('[data-action="quit-cancel"]');
    check(!$('#quit-dialog').open && visible('play'), 'つづけるで戻れない');
    await click('[data-action="quit"]');
    await click('[data-action="quit-confirm"]');
    check(visible('title') && app().session === null, 'やめるでタイトルに戻らない');
  });

  await test('ブラウザの「戻る」：プレイ中は確認ダイアログを出し、進行状態を壊さない', async () => {
    await configure({ unit: 'equation', count: 5 });
    await click('#start-btn');
    await click(rowBtn(1));
    w.history.back();
    await waitFor(() => $('#quit-dialog').open, '戻る操作でダイアログ');
    await click('[data-action="quit-cancel"]');
    check(visible('play'), '問題画面が消えた');
    check(app().session.selection && app().session.selection.index === 1, '選択状態が失われた');
  });

  await test('[9] 何も選んでいないときは「添削する！」を押せない', async () => {
    await click(rowBtn(1)); // 解除
    check(app().session.selection === null, '選択解除');
    check($('#submit-btn').disabled, '未選択なのに押せる');
  });

  await test('[7] 答案の行は1つだけ選択でき、1行目（問題の式）は選べない', async () => {
    check(!$('.row--given').matches('button') && !$('.row--given [data-action]'), '1行目が選択可能');
    await click(rowBtn(1));
    await click(rowBtn(2));
    const sel = $$('.row--selectable.is-selected');
    check(sel.length === 1 && sel[0].dataset.index === '2', `選択中の行: ${sel.map((s) => s.dataset.index)}`);
    check(rowBtn(2).getAttribute('aria-pressed') === 'true', 'aria-pressed');
    check(!$$('.row--selectable').some((b) => b.textContent.includes('ここ！')), '選んだ行に「ここ！」が表示されている');
    check(!$('#submit-btn').disabled, '選択後に添削ボタンが押せない');
  });

  await test('[8] 「全部正しい！」を選ぶと行の選択が解除され、行を選ぶと「全部正しい！」が解除される', async () => {
    await click('#all-correct-btn');
    check($$('.row--selectable.is-selected').length === 0, '行の選択が残っている');
    check($('#all-correct-btn').getAttribute('aria-pressed') === 'true', '全部正しいが選択されていない');
    await click(rowBtn(1));
    check($('#all-correct-btn').getAttribute('aria-pressed') === 'false', '全部正しいが解除されない');
    await click(rowBtn(1));
  });

  await test('[16] ヒントを表示・非表示にできる（最初の誤り行は書かれていない）', async () => {
    check($('#hint-panel').hidden, '最初から開いている');
    await click('#hint-btn');
    check(!$('#hint-panel').hidden && $('#hint-panel').textContent.trim().length > 5, 'ヒントが表示されない');
    check($('#hint-btn').getAttribute('aria-expanded') === 'true', 'aria-expanded');
    await click('#hint-btn');
    check($('#hint-panel').hidden, 'ヒントが閉じない');
  });

  await test('[10][14][15] 正解の行を選ぶと「添削成功！」。解説と正しい計算過程が出て、再判定できない', async () => {
    const s = app().session;
    const q = s.current;
    await answer(true);
    check($('.verdict--ok') && $('.verdict__title').textContent === '添削成功！', '添削成功の表示');
    check($('.tag--ok') && $('.tag--ok').textContent.includes('正解'), '正解の印（色以外の表示）');
    check(s.correctCount === 1 && $('#hud-score').textContent.includes('1'), 'HUD の正解数');
    check($('.feedback__text').textContent.trim().length > 10, '解説');
    check($$('.solution__line').length === q.correctSolution.length, '正しい計算過程の行数');
    if (q.explanation.includes('$')) check($('.feedback__text .katex'), '解説の数式が KaTeX で表示されていない');
    // 再判定できない
    check($('#play-actions').hidden && $$('.row--selectable').every((b) => b.disabled), '確定後も操作できる');
    rowBtn(1).click();
    await sleep(50);
    check(s.results.length === 1 && s.correctCount === 1 && s.index === 0, '二重に採点された');
    // 「添削する！」が同じ位置で赤い「次の問題へ」に変わる（解説の下には出ない）
    const btn = $('#submit-btn');
    check(btn.dataset.action === 'next' && btn.textContent.includes('次の問題へ'), `ボタンの役割・文言: ${btn.dataset.action} / ${btn.textContent.trim()}`);
    check(btn.closest('.choice-bar') && $$('[data-action="next"]').length === 1 && !$('#feedback [data-action="next"]'), '次の問題へボタンの位置');
    check(!btn.disabled && !btn.hidden, '次の問題へボタンが押せない');
    const bg = w.getComputedStyle(btn).backgroundColor;
    const red = w.getComputedStyle(d.documentElement).getPropertyValue('--red-pen').trim();
    const probe = d.createElement('span'); probe.style.color = red; d.body.appendChild(probe);
    const redRgb = w.getComputedStyle(probe).color; probe.remove();
    check(bg === redRgb, `ボタンの色が赤ではない（${bg} / 期待 ${redRgb}）`);
  });

  await test('[11] 間違った行を選ぶと「添削失敗…」。キミの答えと最初の誤り行が文字でも示される', async () => {
    await click('[data-action="next"]');
    const s = app().session;
    // 誤りのある問題が出るまで進める（正しい答案なら正解して次へ）
    while (s.current.errorLine === null) { await answer(true); await click('[data-action="next"]'); }
    const q = s.current;
    await answer(false);
    check($('.verdict--ng') && $('.verdict__title').textContent === '添削失敗…', `不正解の表示: ${$('.verdict__title').textContent}`);
    check($('.stamp--ng').textContent === '✖', '不正解のスタンプ');
    check($('.verdict__sub').textContent.includes(`${q.errorLine + 1}行目が最初のまちがい`), $('.verdict__sub').textContent);
    check($('.tag--chosen').textContent.includes('キミの答え'), 'キミの答えの印');
    check($('.tag--answer').textContent.includes('ここをもう一度確認しよう'), '確認をうながす表示');
    check(rowBtn(q.errorLine).classList.contains('is-answer'), '誤り行の強調');
    check($('.error-type') && $('.error-type').textContent === q.errorType, '誤りの種類');
  });

  await test('[17][18] 指定数を解き終えると結果画面へ進み、正解数・正解率が正しい', async () => {
    const s = app().session;
    await click('[data-action="next"]');
    while (!s.finished) {
      await answer(s.results.length % 2 === 0);
      const last = s.isLast;
      check($('[data-action="next"]').textContent.includes(last ? '結果を見る' : '次の問題へ'), 'ボタンの文言');
      await click('[data-action="next"]');
    }
    check(visible('summary'), '結果画面が表示されない');
    const sum = s.summary();
    const rate = Math.round((sum.correct / sum.total) * 100);
    check(sum.total === 5 && sum.answered === 5, `出題数 ${sum.total}`);
    check(!$('#summary-body').textContent.includes('問中'), '「○問中○問正解！」の表示が残っている');
    check($('.score-card__rate').textContent.includes(`${rate}`), '正解率');
    check(sum.rate === rate, '正解率の計算');
    const stats = $('.score-card__stats').textContent;
    check(stats.includes(`${sum.total}問`) && stats.includes(`${sum.correct}問`) && stats.includes(`${sum.wrong}問`), `出題・正解・まちがいの数: ${stats}`);
    check($$('.review-item').length === 5, '問題ごとの結果');
    check($('.score-card__comment').textContent.length > 5, '評価コメント');
  });

  await test('結果画面の問題カードをタップすると、同じ問題をもう一度解ける（元の成績は変わらない）', async () => {
    const base = app().session;
    const before = { ...base.summary() };
    const target = base.questions[1];
    const card = $('[data-action="review-question"][data-index="1"]');
    check(card && card.matches('button'), 'カードが押せる要素になっていない');
    await click(card);
    const s = app().session;
    check(visible('play'), '問題画面に進まない');
    check(s !== base && s.total === 1 && s.current.id === target.id, `タップした問題と違う（${s.current && s.current.id} / ${target.id}）`);
    check($('#hud-unit').textContent.includes('2問目をもう一度'), `解き直し中の表示: ${$('#hud-unit').textContent}`);
    await answer(true);
    check($('.verdict--ok'), '解き直しで正解にならない');
    check($('[data-action="next"]').textContent.includes('結果にもどる'), 'ボタンの文言');
    await click('[data-action="next"]');
    check(visible('summary') && app().session === base, '結果画面に戻らない');
    check(JSON.stringify(base.summary()) === JSON.stringify(before), '元の成績が変わった');
    check($('.score-card__rate').textContent.includes(`${before.rate}`), '正解率の表示が変わった');
    const again = $('[data-action="review-question"][data-index="1"] .review-item__again');
    check(again && again.textContent.includes('もう一度：✔ 正解'), `解き直しの結果の表示: ${again && again.textContent}`);
    // 解き直しの途中で「やめる」→ 結果画面に戻る
    await click('[data-action="review-question"][data-index="0"]');
    await click('[data-action="quit"]');
    check($('#quit-title').textContent.includes('解き直し'), 'ダイアログの文言');
    await click('[data-action="quit-confirm"]');
    check(visible('summary') && app().session === base, 'やめたあと結果画面に戻らない');
    check(!$('[data-action="review-question"][data-index="0"] .review-item__again'), '途中でやめた問題に結果が付いた');
  });

  await test('[19] もう一度チャレンジ：同じ条件で新しい問題順になり、状態がリセットされる', async () => {
    const before = app().session.questionIds.join();
    const cfgBefore = JSON.stringify(app().session.config);
    await click('[data-action="retry"]');
    const s = app().session;
    check(visible('play'), '問題画面へ進まない');
    check(s.index === 0 && s.correctCount === 0 && s.results.length === 0, '状態がリセットされていない');
    check(JSON.stringify(s.config) === cfgBefore, '条件が変わった');
    check(s.questionIds.join() !== before, '問題順が同じ');
    check($('#hud-count').textContent.includes('1/5') && $('#hud-score').textContent.includes('0'), 'HUD');
  });

  await test('[12][13] 正しい答案：「全部正しい！」で正解、行を選ぶと不正解', async () => {
    await click('[data-action="quit"]');
    await click('[data-action="quit-confirm"]');
    await configure({ unit: 'equation', difficulties: [3], count: 'all' });
    await click('#start-btn');
    const s = app().session;
    let ok = false, ng = false;
    while (!s.finished) {
      const q = s.current;
      if (q.errorLine === null && !ok) {
        await answer(true);
        check($('.verdict--ok') && $('#all-correct-btn').classList.contains('is-answer'), '全部正しいで正解にならない');
        check($('.verdict__sub').textContent.includes('全部正しい'), '全部正しいの表示');
        ok = true;
      } else if (q.errorLine === null) {
        await answer(false);
        check($('.verdict--ng') && $('.tag--answer').textContent.includes('正解はこちら'), '行を選んでも不正解にならない');
        ng = true;
      } else {
        await answer(true);
      }
      await click('[data-action="next"]');
    }
    check(ok && ng, `正しい答案が2問以上必要（ok=${ok}, ng=${ng}）`);
  });

  await test('[20] 結果画面から単元選択・タイトルに戻れる', async () => {
    await click('#screen-summary [data-action="go-settings"], .summary-actions [data-action="go-settings"]');
    check(visible('settings'), '単元選択に戻れない');
    check(app().config.unit === 'equation', '前回の単元が残っていない');
    await click('.screen--settings [data-action="go-title"]');
    check(visible('title'), 'タイトルに戻れない');
  });

  await test('[表示] 方程式以外では答案の1行目だけ全角スペース1文字分右にずれ、方程式ではずれない', async () => {
    const indentOf = (el) => parseFloat(w.getComputedStyle(el.querySelector('.katex-display > .katex')).paddingLeft);
    for (const [unit, expectIndent] of [['positive-negative', true], ['expressions', true], ['equation', false]]) {
      await configure({ unit, count: 5 });
      await click('#start-btn');
      const first = $('.row--given');
      if (expectIndent) {
        const fontSize = parseFloat(w.getComputedStyle(first.querySelector('.katex-display > .katex')).fontSize);
        const pad = indentOf(first);
        check(Math.abs(pad - fontSize) < 0.5, `${unit}: 1行目のずれ ${pad}px（数式の文字サイズ ${fontSize}px）`);
        check($$('.row--selectable').every((b) => indentOf(b) === 0), `${unit}: 2行目以降がずれている`);
      } else {
        check(!$('.row--indent'), `${unit}: 方程式の1行目がずれている`);
      }
      // 添削後の「正しい計算過程」も同じ
      await answer(true);
      const sol = $$('.solution__line');
      if (expectIndent) {
        const fontSize = parseFloat(w.getComputedStyle(sol[0].querySelector('.katex-display > .katex')).fontSize);
        check(Math.abs(indentOf(sol[0]) - fontSize) < 0.5, `${unit}: 正しい計算過程の1行目のずれ ${indentOf(sol[0])}px`);
        check(sol.slice(1).every((li) => indentOf(li) === 0), `${unit}: 正しい計算過程の2行目以降がずれている`);
      } else {
        check(!$('.solution .row--indent'), `${unit}: 方程式の正しい計算過程の1行目がずれている`);
      }
      await click('[data-action="quit"]');
      await click('[data-action="quit-confirm"]');
    }
  });

  await test('並べて表示：生徒の答案と正しい計算過程が同じ行どうし横に並び、「閉じる」で閉じる（スマホ縦は90°回転）', async () => {
    const phonePortrait = W <= 600 && H > W;
    for (const unit of ['positive-negative', 'equation']) {
      await configure({ unit, count: 'all' });
      await click('#start-btn');
      const s = app().session;
      let checkedError = false, checkedEq = false;
      for (let k = 0; k < 4 && !s.finished; k++) {
        const q = s.current;
        await answer(false);
        const btn = $('[data-action="compare-open"]');
        check(btn && btn.closest('.feedback__section') && btn.previousElementSibling.matches('.solution'), '「並べて表示」ボタンが正しい計算過程の下にない');
        await click(btn);
        const dlg = $('#compare-dialog');
        check(dlg.open, 'ポップアップが開かない');
        await d.fonts.ready; await sleep(100);
        const n = Math.max(q.answerLines.length, q.correctSolution.length);
        check($$('.cmp-no').length === n, `${q.id}: 行数 ${$$('.cmp-no').length} / ${n}`);
        const stu = $$('.cmp-cell[data-col="student"]');
        const sol = $$('.cmp-cell[data-col="solution"]');
        check(stu.length === n && sol.length === n, `${q.id}: 列のセル数`);
        // 同じ行どうしが横に並ぶ（回転していても、画面上で同じ高さ／同じ横位置にある）
        for (let i = 0; i < n; i++) {
          const a = stu[i].getBoundingClientRect(), b = sol[i].getBoundingClientRect();
          const same = phonePortrait ? Math.abs(a.left - b.left) < 1 : Math.abs(a.top - b.top) < 1;
          check(same, `${q.id}: ${i + 1}行目が横に並んでいない`);
        }
        check(stu.filter((c) => !c.classList.contains('cmp-cell--empty')).length === q.answerLines.length, `${q.id}: 生徒の答案の行数`);
        check(sol.filter((c) => !c.classList.contains('cmp-cell--empty')).length === q.correctSolution.length, `${q.id}: 正しい計算過程の行数`);
        if (q.errorLine !== null) {
          check(stu[q.errorLine].classList.contains('cmp-cell--error'), `${q.id}: 誤り行の強調`);
          check(!$('#compare-body .tag') && !$('#compare-body .cmp-grid').textContent.includes('最初のミス'), `${q.id}: 「最初のミス」バッジが残っている`);
          check($$('.cmp-cell--error').length === 1, `${q.id}: 誤り行の印が複数`);
          checkedError = true;
        }
        if (unit === 'equation') {
          for (const col of ['student', 'solution']) {
            const ops = $$(`.cmp-cell[data-col="${col}"] .eq-op`).map((op) => (phonePortrait ? op.getBoundingClientRect().top : op.getBoundingClientRect().left));
            check(ops.length >= 2 && Math.max(...ops) - Math.min(...ops) <= 1, `${q.id}: ${col} の「＝」がそろっていない ${ops.map(Math.round)}`);
          }
          checkedEq = true;
        }
        check(mathOverflowReport().cut === 0, `${q.id}: ポップアップの数式が見切れている`);
        // スマホ縦だけ90°回転し、画面からはみ出さない
        const tf = w.getComputedStyle($('#compare')).transform;
        if (phonePortrait) {
          check(/^matrix\(0, 1, -1, 0/.test(tf), `回転していない（${tf}）`);
          const r = $('#compare').getBoundingClientRect();
          check(Math.abs(r.left) < 1 && Math.abs(r.top) < 1 && Math.abs(r.width - w.innerWidth) < 1 && Math.abs(r.height - w.innerHeight) < 1, `回転後の位置・大きさ ${[r.left, r.top, r.width, r.height].map(Math.round)}`);
        } else {
          check(tf === 'none', `スマホ縦以外で回転している（${tf}）`);
          const r = dlg.getBoundingClientRect();
          check(r.right <= w.innerWidth && r.bottom <= w.innerHeight, 'ポップアップが画面からはみ出す');
        }
        await click('[data-action="compare-close"]');
        check(!dlg.open, '「閉じる」で閉じない');
        await click('[data-action="next"]');
      }
      check(checkedError, `${unit}: 誤りのある問題を確認できなかった`);
      if (unit === 'equation') check(checkedEq, '方程式を確認できなかった');
      await click('[data-action="quit"]');
      await click('[data-action="quit-confirm"]');
    }
  });

  await test('並べて表示：開いているときのブラウザの「戻る」はポップアップを閉じるだけ', async () => {
    await configure({ unit: 'expressions', count: 5 });
    await click('#start-btn');
    await answer(true);
    await click('[data-action="compare-open"]');
    w.history.back();
    await waitFor(() => !$('#compare-dialog').open, '戻る操作で閉じる');
    check(visible('play') && !$('#quit-dialog').open && app().session && app().session.isGraded, '問題画面と進行状態が保たれていない');
    await click('[data-action="quit"]');
    await click('[data-action="quit-confirm"]');
  });

  await test('[表示] 1行目の「問題の式」バッジがなく、式の表示領域が右端まで広い', async () => {
    await configure({ unit: 'positive-negative', count: 5 });
    await click('#start-btn');
    check(!$('.row__note') && !$('.row--given').textContent.includes('問題の式'), 'バッジが残っている');
    const given = $('.row--given');
    const math = given.querySelector('.row__math').getBoundingClientRect();
    const box = given.getBoundingClientRect();
    check(box.right - math.right < 20, `式の表示領域の右端に余白がある（${Math.round(box.right - math.right)}px）`);
    await click('[data-action="quit"]');
    await click('[data-action="quit-confirm"]');
  });

  await test('[表示] 方程式の全問題で、答案・正しい計算過程とも「＝」の縦の位置がそろう（選択中・採点後も）', async () => {
    const eqX = (group) => $$(`${group} .eq-op`).map((op) => op.getBoundingClientRect().left);
    const aligned = (xs) => xs.length >= 2 && Math.max(...xs) - Math.min(...xs) <= 1;
    await configure({ unit: 'equation', count: 'all' });
    await click('#start-btn');
    const s = app().session;
    while (!s.finished) {
      const q = s.current;
      await d.fonts.ready; await sleep(120);
      check(aligned(eqX('#sheet')), `${q.id}: 答案の「＝」の位置 ${eqX('#sheet').map(Math.round)}`);
      check($$('#sheet .eq-op').length === q.answerLines.length, `${q.id}: 「＝」で分けられていない行がある`);
      await click(rowBtn(1)); // 選択中は枠の見た目が変わる
      check(aligned(eqX('#sheet')), `${q.id}: 行を選んだあと「＝」がずれた ${eqX('#sheet').map(Math.round)}`);
      await click(rowBtn(1));
      await answer(s.results.length % 2 === 0);
      await d.fonts.ready; await sleep(120);
      check(aligned(eqX('#sheet')), `${q.id}: 採点後に答案の「＝」がずれた ${eqX('#sheet').map(Math.round)}`);
      check(aligned(eqX('.solution')), `${q.id}: 正しい計算過程の「＝」の位置 ${eqX('.solution').map(Math.round)}`);
      check(mathOverflowReport().cut === 0, `${q.id}: 見切れている数式がある`);
      await click('[data-action="next"]');
    }
  });

  await test('[表示] 全問題で数式が見切れず、ページが横にはみ出さない。行のタップ領域は48px以上', async () => {
    const report = { questions: 0, scrollable: 0, minRow: 999 };
    for (const unit of ['positive-negative', 'expressions', 'equation']) {
      await configure({ unit, count: 'all' });
      await click('#start-btn');
      const s = app().session;
      while (!s.finished) {
        await d.fonts.ready;
        await sleep(150);
        const m = mathOverflowReport();
        check(m.cut === 0, `${s.current.id}: 見切れている数式 ${m.cut} ${m.info}`);
        check(pageOverflow() <= 0, `${s.current.id}: ページが横に ${pageOverflow()}px はみ出す`);
        report.scrollable += m.scrollable;
        $$('.row--selectable').forEach((b) => { report.minRow = Math.min(report.minRow, b.getBoundingClientRect().height); });
        await answer(s.results.length % 3 !== 0);
        await d.fonts.ready;
        await sleep(150);
        const m3 = mathOverflowReport();
        check(m3.cut === 0, `${s.current.id}: 解説表示後に見切れている数式 ${m3.cut} ${m3.info}`);
        check(pageOverflow() <= 0, `${s.current.id}: 解説表示でページがはみ出す`);
        report.questions++;
        await click('[data-action="next"]');
      }
      await click('.summary-actions [data-action="go-settings"]');
    }
    check(report.questions === app().questions.length, `確認した問題数 ${report.questions}`);
    check(report.minRow >= 48, `行の高さの最小 ${report.minRow}px`);
    results.push({ name: `  情報: 横スクロールになった数式 ${report.scrollable} 個 / 行の高さの最小 ${Math.round(report.minRow)}px`, ok: true });
  });

  await test('タイトル画面の最下部にクレジット表記があり、「T.TAKEMOTO」を5回連打すると開発者用画面が開く', async () => {
    await openGame(1);
    const footer = $('.title-footer');
    check(footer && footer.textContent.includes('©2026 T.TAKEMOTO / KEC Glows'), `表記: ${footer && footer.textContent}`);
    const fs = parseFloat(w.getComputedStyle(footer).fontSize);
    check(fs < parseFloat(w.getComputedStyle($('.title-sub')).fontSize), `目立たないサイズになっていない（${fs}px）`);
    const tap = $('.secret-tap');
    for (let i = 0; i < 4; i++) tap.click();
    await sleep(200);
    check(w.location.pathname.endsWith('/index.html') || w.location.pathname.endsWith('/'), '4回で開いてしまった');
    check(visible('title'), '4回でタイトル画面から移動した');
    const navigated = new Promise((resolve) => { frame.onload = resolve; });
    tap.click();
    await navigated;
    check(frame.contentWindow.location.pathname.endsWith('/preview.html'), `開いた画面: ${frame.contentWindow.location.pathname}`);
  });

  // ================================================================ 第3段階：タイムアタック
  const recs = () => w.__calcTeacher.records;
  const sndNow = () => w.Sound;
  // ================================================================ 生徒キャラクター（共通の確認）
  /** scope の中の生徒とセリフを確かめる（キャラクター・場面に合うセリフ・吹き出しが見切れない） */
  function checkTalk(scope, group, label) {
    const el = $(`${scope} .student-talk`);
    check(el, `${label}: 生徒が表示されない`);
    const t = { el, id: el.dataset.character, group: el.dataset.group, text: el.querySelector('.student-talk__bubble').textContent, face: el.querySelector('.student-talk__face').textContent };
    const DD = w.CharacterDialogue;
    const ch = DD.CHARACTERS.find((c) => c.id === t.id);
    check(ch && ch.emoji === t.face, `${label}: キャラクター ${t.id} ${t.face}`);
    check(!group || t.group === group, `${label}: セリフの種類 ${t.group}（期待 ${group}）`);
    check(DD.linesFor(t.group, t.id).includes(t.text), `${label}: 場面に合わないセリフ「${t.text}」`);
    const b = el.querySelector('.student-talk__bubble');
    const r = b.getBoundingClientRect();
    const fr = el.querySelector('.student-talk__face').getBoundingClientRect();
    check(r.left >= 0 && r.right <= w.innerWidth + 0.5 && b.scrollWidth <= b.clientWidth + 1 && fr.width > 0 && fr.right <= r.left + 1,
      `${label}: 吹き出しが見切れる・顔と重なる（${Math.round(fr.left)}〜${Math.round(fr.right)} / ${Math.round(r.left)}〜${Math.round(r.right)}・幅 ${w.innerWidth}）`);
    return { id: t.id, text: t.text, group: t.group };
  }
  const sameTalk = (a, b) => a.id === b.id && a.text === b.text;

  const ta = () => app().ta;
  const taRow = (i) => inScreen('ta-play', `[data-action="ta-answer"][data-index="${i}"]`);
  const taCorrectEl = () => { const q = ta().session.current; return q.errorLine === null ? taRow('all') : taRow(q.errorLine); };
  const taWrongEl = () => {
    const q = ta().session.current;
    if (q.errorLine === null) return taRow(1);
    return q.errorLine !== 1 ? taRow(1) : (q.answerLines.length > 2 ? taRow(2) : taRow('all'));
  };
  /** タイムアタックを最後まで遊ぶ（pattern(i) が true なら正解、false なら不正解、null なら回答しない） */
  async function playTA(pattern) {
    await waitFor(() => ta().session && ta().session.started, 'START!', 8000);
    let i = 0;
    while (!ta().session.ended) {
      const want = pattern(i);
      if (want === null) { await sleep(500); continue; }
      const el = want ? taCorrectEl() : taWrongEl();
      if (el && !el.disabled) { el.click(); i++; }
      await sleep(TA_FEEDBACK + 60);
    }
    await waitFor(() => visible('ta-result'), '結果画面', 5000);
  }
  const TA_FEEDBACK = 300;

  await test('[TA] 公式：カウントダウン中は時間が減らず、行のタップ・全部正しいで即時判定。二重回答できず、60秒でタイムアップして記録される', async () => {
    await openGame(11);
    await click('[data-action="go-ta-menu"]');
    check(visible('ta-menu'), 'モード選択画面');
    await click('[data-action="ta-mode"][data-mode="official"]');
    check(visible('ta-settings') && inScreen('ta-settings', '#ta-custom-fields').hidden, '公式でカテゴリ・難易度が選べてしまう');
    check($('#ta-official-info').textContent.includes('全カテゴリ・全難易度'), '公式ルールの表示');
    await click('[data-action="ta-select-unit"][data-unit="equation"]');
    sndNow().debug.clearLog(); sndNow().debug.resetThrottle();
    await click('#ta-start-btn');
    check(visible('ta-play'), 'プレイ画面へ進まない');
    const s = ta().session;
    check(s.isOfficial && s.criteria.categories === null && s.criteria.difficulties.join() === '1,2,3,4', '公式の条件');
    check(!s.started && $('#ta-overlay-text').textContent === '3', 'カウントダウンが出ない');
    check(!$('#ta-overlay-note').hidden && $('#ta-overlay-note').textContent === 'タップした瞬間に判定！3回ミスでゲームオーバー！', 'カウントダウン中に説明が出ない');
    await sleep(1500);
    check(!s.started && s.remaining() === 60000 && $('#ta-timer-num').textContent === '60', 'カウントダウン中に時間が減った');
    await waitFor(() => s.started, 'START!', 5000);
    // 即時判定（「添削する！」はない）
    check(!inScreen('ta-play', '#submit-btn') && !inScreen('ta-play', '#hint-btn'), '添削ボタンやヒントがある');
    check(!inScreen('ta-play', '.paper__guide') && !$('#ta-body').textContent.includes('生徒の答案'), 'タイムアタックに「生徒の答案」の案内が出ている');
    check($('#ta-overlay').hidden || $('#ta-overlay-note').hidden, 'START! のあとも説明が残っている');
    const q1 = s.current;
    const el = taCorrectEl();
    el.click();
    check(s.results.length === 1 && s.results[0].correct && s.score === 200, '即時判定されない');
    el.click(); taRow('all').click(); // 演出中の連打
    check(s.results.length === 1, '二重に回答された');
    await sleep(TA_FEEDBACK + 80);
    check(s.current !== q1 || s.pool.length === 1, '次の問題に進まない');
    // 残りは全問正解で最後まで
    await playTA(() => true);
    check(s.ended && s.remaining() === 0, 'タイムアップしていない');
    check(s.answer({ type: 'allCorrect' }) === null, 'タイムアップ後に回答できた');
    const sum = s.summary();
    check(sum.score === s.results.reduce((a, r) => a + r.points, 0) && sum.wrong === 0 && sum.maxStreak === sum.correct, '得点の集計');
    check($('#ta-result-body').textContent.includes(`${sum.score}`) && $('#ta-result-body').textContent.includes('初めての公式記録'), '結果画面のスコア');
    check($('#ta-result-body').textContent.includes(`称号：${w.TimeAttack.titleForScore(sum.score)}`), '称号の表示');
    check(/称号：(🔰|✏️|🔍|📘|⚡|🏅|💥|🎯|🌟|👑)/u.test($('#ta-result-body').textContent), '称号にアイコンがない');
    // 公式は決められた難易度の順に出題する（1→2→1→2→3→1→2→3→4→2→3→4、以降3→4）
    const diffs = s.results.map((r) => r.question.difficulty);
    check(diffs.length >= 5 && diffs.every((d, i) => d === w.TimeAttack.officialDifficultyAt(i)), `公式の難易度の順: ${diffs.join(',')}`);
    check(diffs[4] === 3, '5問目が★★★ではない');
    const taTalk = checkTalk('#ta-result-body', 'ta-best', 'タイムアタック（初記録）');
    const rec = recs().officialFor('equation');
    check(rec.bestScore === sum.score && rec.plays === 1 && rec.maxStreak === sum.maxStreak, `公式記録 ${JSON.stringify(rec)}`);
    const names = sndNow().debug.log.filter((e) => e.played).map((e) => e.name);
    ['countdown', 'go', 'quickCorrect', 'warning', 'timeup'].forEach((n) => check(names.includes(n), `効果音 ${n} が鳴っていない`));
    check(names.filter((n) => n === 'countdown').length === 3, 'カウントダウン音の回数');
    // 問題ごとの解説（スコアは変わらない）
    check($$('#ta-result-body .review-item').length === sum.answered, '問題ごとの結果の数');
    await click('#ta-result-body [data-action="ta-explain"][data-index="0"]');
    check($('#explain-dialog').open && $('#explain-body').textContent.length > 20, '解説が開かない');
    check(w.getComputedStyle($('#explain-dialog .compare')).transform === 'none', '解説のポップアップが回転している');
    await click('[data-action="explain-close"]');
    check(!$('#explain-dialog').open && recs().officialFor('equation').bestScore === sum.score, '解説を見たら記録が変わった');
    check(sameTalk(checkTalk('#ta-result-body', 'ta-best', '解説を閉じたあと'), taTalk), '解説を開閉したらセリフが変わった');
  });

  await test('[TA] 不正解で連続が切れ、得点は連続数で変わる。自己ベストを下回った回は更新しない（プレイ回数は増える）', async () => {
    const best = recs().officialFor('equation').bestScore;
    await click('[data-action="ta-retry"]');
    const s = ta().session;
    await playTA((i) => (i < 4 ? [true, true, false, true][i] : null)); // 4問だけ回答して、あとは時間切れ
    check(s.results.map((r) => r.points).join() === '200,210,0,200', `得点 ${s.results.map((r) => r.points)}`);
    check(s.summary().maxStreak === 2, '最大連続');
    checkTalk('#ta-result-body', 'ta-low', 'タイムアタック（1000点未満）');
    const rec = recs().officialFor('equation');
    check(rec.bestScore === best && rec.plays === 2, `自己ベストが変わった／回数 ${JSON.stringify(rec)}`);
    check($('#ta-result-body').textContent.includes(`自己ベスト：${best}点`) && !$('#ta-result-body').textContent.includes('自己ベスト更新'), '自己ベストの表示');
  });

  await test('[TA] 3回ミスでゲームオーバー：時間が残っていても強制終了し、ハートが減り、結果画面に表示・記録される', async () => {
    await click('[data-action="ta-retry"]');
    const s = ta().session;
    await waitFor(() => s.started, 'START!', 8000);
    check($$('#ta-lives span').length === 3 && $$('#ta-lives .is-lost').length === 0, 'ハートが3つ出ない');
    sndNow().debug.clearLog(); sndNow().debug.resetThrottle();
    taWrongEl().click();
    check($('#ta-popup').textContent.includes('ミス 1/3') && $$('#ta-lives .is-lost').length === 1, 'ミスの表示');
    await sleep(TA_FEEDBACK + 80);
    await playTA(() => false);
    check(s.ended && s.endReason === 'gameover' && s.results.length === 3 && s.remaining() > 30000, `ゲームオーバーにならない（${s.results.length}問・残り${s.remaining()}）`);
    check(s.answer({ type: 'allCorrect' }) === null, 'ゲームオーバー後に回答できた');
    const body = $('#ta-result-body').textContent;
    check(body.includes('3回ミスでゲームオーバー'), '結果画面にゲームオーバーの表示がない');
    checkTalk('#ta-result-body', 'ta-gameover', 'タイムアタック（ゲームオーバー）');
    check(recs().officialFor('equation').plays === 3, 'ゲームオーバーの回が記録されない');
    const names = sndNow().debug.log.filter((e) => e.played).map((e) => e.name);
    check(names.includes('fail') && !names.includes('timeup'), `ゲームオーバーの効果音 ${names}`);
  });

  await test('[TA] カスタム：カテゴリ・難易度をしぼれる。公式記録は変わらず、履歴に残る。履歴から同じ条件で再挑戦できる', async () => {
    await click('[data-action="ta-back-settings"]');
    await click('[data-action="go-ta-menu"]');
    await click('[data-action="ta-mode"][data-mode="custom"]');
    check(!inScreen('ta-settings', '#ta-custom-fields').hidden, 'カスタムでカテゴリ・難易度が出ない');
    await click('[data-action="ta-select-unit"][data-unit="positive-negative"]');
    await click('[data-action="ta-toggle-category-all"]'); // すべて解除
    check(inScreen('ta-settings', '#ta-start-btn').disabled, 'カテゴリ0個で開始できる');
    const catBtn = $$('[data-action="ta-toggle-category"]').find((b) => b.textContent.includes('累乗'));
    await click(catBtn);
    await click('[data-action="ta-toggle-difficulty"][data-difficulty="all"]'); // すべて解除
    await click('[data-action="ta-toggle-difficulty"][data-difficulty="1"]');
    await click('[data-action="ta-toggle-difficulty"][data-difficulty="4"]');
    const n = cnt({ unit: 'positive-negative', categories: ['累乗'], difficulties: [1, 4] });
    check($('#ta-summary').textContent.includes(`出題できる問題：${n}問`), $('#ta-summary').textContent);
    const officialBefore = JSON.stringify(recs().officialFor('positive-negative'));
    await click('#ta-start-btn');
    const s = ta().session;
    check(!s.isOfficial && s.criteria.categories.join() === '累乗' && s.criteria.difficulties.join() === '1,4', '条件');
    await playTA((i) => (i < 6 ? i % 2 === 0 : null));
    check(s.results.every((r) => r.question.category === '累乗' && [1, 4].includes(r.question.difficulty)), '条件外の問題が出た');
    // 一巡したら並べ直して続ける（同じ問題は続けて出ない）
    const ids = s.results.map((r) => r.question.id);
    for (let i = 1; i < ids.length; i++) check(n === 1 || ids[i] !== ids[i - 1], '同じ問題が続いた');
    check(JSON.stringify(recs().officialFor('positive-negative')) === officialBefore, 'カスタムで公式記録が変わった');
    const h = recs().customHistory();
    check(h.length === 1 && h[0].categories.join() === '累乗' && h[0].score === s.score, `履歴 ${JSON.stringify(h[0])}`);
    check($('#ta-result-body').textContent.includes('公式の記録・称号は変わりません'), 'カスタムの説明');
    // 記録画面のカスタム履歴から同じ条件で再挑戦 → 途中でやめると記録しない
    await click('[data-action="go-title"]');
    await click('[data-action="go-records"]');
    await click('[data-action="records-tab"][data-tab="custom"]');
    check($$('#records-panel .history-item').length === 1, '履歴の表示');
    await click('#records-panel [data-action="ta-replay"][data-index="0"]');
    check(visible('ta-play') && !ta().session.isOfficial && ta().session.criteria.categories.join() === '累乗', '同じ条件で再挑戦できない');
    await waitFor(() => ta().session.started, 'START!', 5000);
    taCorrectEl().click();
    await click('[data-action="quit"]');
    await click('[data-action="quit-confirm"]');
    check(visible('ta-settings') && recs().customHistory().length === 1, '途中でやめた回が記録された');
  });

  await test('[TA] カウントダウン中に「戻る」を押すと確認ダイアログが出て、やめると記録しない', async () => {
    await click('#ta-start-btn');
    w.history.back();
    await waitFor(() => $('#quit-dialog').open, '戻る操作でダイアログ');
    await click('[data-action="quit-confirm"]');
    await sleep(3500); // カウントダウンが残っていても始まらない
    check(visible('ta-settings') && ta().session === null, 'やめたのに続いている');
  });

  // ================================================================ 第3段階：認定試験
  const examCard = (id) => $(`#exam-list [data-exam-id="${id}"]`);
  async function answerExam(correct) {
    await answer(correct);
  }

  await test('[認定] 最初は第1試験だけ挑戦できる。ヒントは使えない。3問正解で合格し、昇格・次の試験の解放が表示・保存される', async () => {
    await click('[data-action="go-title"]');
    await click('[data-action="go-cert-units"]');
    check($$('#cert-unit-list .cert-unit').length === 3 && $('#cert-unit-list').textContent.includes('ティーチャー見習い'), '単元の一覧');
    await click('[data-action="cert-unit"][data-unit="equation"]');
    check(visible('cert-list'), '試験一覧');
    check(examCard(1).querySelector('[data-action="cert-start"]') && !examCard(1).querySelector('button').disabled, '第1試験が始められない');
    [2, 3, 4, 5].forEach((id) => check(!examCard(id).querySelector('[data-action="cert-start"]') && examCard(id).textContent.includes('🔒'), `第${id}試験が解放されている`));
    sndNow().debug.clearLog(); sndNow().debug.resetThrottle();
    await click(examCard(1).querySelector('[data-action="cert-start"]'));
    check(visible('play') && app().mode === 'exam' && $('#play-actions').hidden, 'ヒントが使える');
    check($('#hud-unit').textContent.includes('第1試験'), 'HUD に試験名がない');
    check(sndNow().debug.log.some((e) => e.played && e.name === 'examStart'), '試験開始音');
    const s = app().session;
    check(s.questions.length === 5 && s.questions.every((q) => q.difficulty === 1 && q.unit === 'equation'), '第1試験の出題');
    // ヘッダー：「1/5」は出さず、正解数は★の右。問題のバッジは「第○問」。どれも重ならない
    const hudCheck = (n, correct) => {
      const es = $('#hud-exam-score');
      check($('#hud-count').hidden && $('#hud-score').hidden && !es.hidden, 'HUD：「1/5」や右側の正解数が出ている');
      check(es.textContent.replace(/\s+/g, '').includes(`✔${correct}/3`), `HUD の正解数: ${es.textContent}`);
      check($('#play-body .paper__instruction .label-badge').textContent === `第${n}問`, `問題のバッジ: ${$('#play-body .paper__instruction .label-badge').textContent}`);
      const st = $('#hud-stars').getBoundingClientRect();
      const er = es.getBoundingClientRect();
      const unitR = $('#hud-unit').getBoundingClientRect();
      const right = $('#hud-sound').getBoundingClientRect();
      check(er.left >= st.right - 1 && Math.abs((er.top + er.bottom) / 2 - (st.top + st.bottom) / 2) < 12, `正解数が★の右にない（★ ${Math.round(st.right)}・正解数 ${Math.round(er.left)}）`);
      check(unitR.right <= right.left + 1 && er.right <= right.left + 1, `HUD の表示が音ボタンと重なる（単元 ${Math.round(unitR.right)}・正解数 ${Math.round(er.right)}・ボタン ${Math.round(right.left)}）`);
    };
    hudCheck(1, 0);
    for (let i = 0; i < 3; i++) {
      await answerExam(true);
      if (i === 0) { check($('#hud-exam-score').textContent.replace(/\s+/g, '').includes('✔1/3'), '正解後に正解数が増えない'); }
      const label = $('[data-action="next"]').textContent;
      check(i < 2 ? label.includes('次の問題へ') : label.includes('結果を見る'), `${i + 1}問目のボタン: ${label}`);
      check($('.feedback__text').textContent.length > 5, '解説が出ない');
      sndNow().debug.resetThrottle();
      if (i < 2) { await click('[data-action="next"]'); hudCheck(i + 2, i + 1); }
    }
    sndNow().debug.clearLog();
    await click('[data-action="next"]');
    check(visible('cert-result') && s.results.length === 3, '3問で合格して終わらない');
    const body = $('#cert-result-body').textContent;
    check(body.includes('第1試験 合格！') && body.includes('新人ティーチャーに昇格') && body.includes('第2試験が解放されました'), `合格・昇格の表示: ${body.slice(0, 120)}`);
    check(sndNow().debug.log.some((e) => e.played && e.name === 'rankup'), 'ランクアップの効果音');
    const certTalk = checkTalk('#cert-result-body', 'cert-rankup', '認定試験（初合格）');
    check(!$('#cert-result-body .promotion .rank-badge'), '昇格の下にランクのバッジが出ている');
    check(!body.includes('まちがえると不合格'), '結果画面に不合格の条件が出ている');
    // 「○○に昇格！」が1行に収まる（いちばん長いランク名でも）
    const promo = $('#cert-result-body .promotion__title');
    const promoText = promo.textContent;
    const longest = w.Certification.RANKS.map((r) => r.name).sort((a, b) => b.length - a.length)[0];
    promo.textContent = `🎉 ${longest}に昇格！`;
    const lh = parseFloat(w.getComputedStyle(promo).fontSize) * 1.8;
    const box = $('#cert-result-body .promotion').getBoundingClientRect();
    const area = $('#cert-result-body').getBoundingClientRect();
    check(promo.scrollWidth <= promo.clientWidth + 1 && promo.getBoundingClientRect().height < lh && box.left >= area.left - 1 && box.right <= area.right + 1,
      `昇格の表示が1行に収まらない（文字 ${promo.scrollWidth}/${promo.clientWidth}・枠 ${Math.round(box.left)}〜${Math.round(box.right)}／画面 ${Math.round(area.left)}〜${Math.round(area.right)}）`);
    promo.textContent = promoText;
    check(recs().certFor('equation').highestCleared === 1 && recs().certFor('equation').exams['1'].attempts === 1, '認定記録');
    check($$('#cert-result-body .review-item').length === 3, '問題ごとの結果');
    await click('#cert-result-body [data-action="cert-explain"][data-index="0"]');
    check($('#explain-dialog').open, '解説が開かない');
    await click('[data-action="explain-close"]');
    check($('#cert-result-actions').textContent.includes('次の試験へ'), '「次の試験へ」がない');
    await click('[data-action="go-cert-list"]');
    check(examCard(2).querySelector('[data-action="cert-start"]'), '第2試験が解放されていない');
    check(examCard(1).textContent.includes('合格済み'), '合格済みの表示');
  });

  await test('[認定] 3問不正解で不合格（残りは出題しない）。不合格でもランクは下がらず、別の単元には影響しない', async () => {
    await click(examCard(2).querySelector('[data-action="cert-start"]'));
    const s = app().session;
    check(s.questions.length === 6, '第2試験の問題数');
    for (let i = 0; i < 3; i++) {
      await answerExam(false);
      if (i < 2) await click('[data-action="next"]');
    }
    check($('[data-action="next"]').textContent.includes('結果を見る'), '不合格が決まったのに次の問題へ');
    sndNow().debug.clearLog(); sndNow().debug.resetThrottle();
    await click('[data-action="next"]');
    check(visible('cert-result') && s.results.length === 3 && $('#cert-result-body').textContent.includes('第2試験 不合格'), '不合格の表示');
    check($('#cert-result-body').textContent.includes('ランクは下がりません') && $('#cert-result-body').textContent.includes('新人ティーチャー'), 'ランクの表示');
    check(sndNow().debug.log.some((e) => e.played && e.name === 'fail'), '不合格の効果音');
    checkTalk('#cert-result-body', 'cert-fail', '認定試験（不合格）');
    const c = recs().certFor('equation');
    check(c.highestCleared === 1 && c.exams['2'].attempts === 1 && !c.exams['2'].cleared, `記録 ${JSON.stringify(c)}`);
    check(recs().certFor('expressions').highestCleared === 0, '別の単元に影響した');
  });

  await test('[認定] 途中でやめた試験は記録しない（挑戦回数も増えない）。問題が足りない試験は始められない', async () => {
    await click('[data-action="go-cert-list"]');
    await click(examCard(2).querySelector('[data-action="cert-start"]'));
    await answerExam(true);
    await click('[data-action="quit"]');
    await click('[data-action="quit-confirm"]');
    check(visible('cert-list') && recs().certFor('equation').exams['2'].attempts === 1, '途中でやめた試験が記録された');
    // 問題が足りない状態をつくる（★の方程式を一時的に2問だけにする。第1試験は★が5問必要なので3問不足）
    const all = app().questions;
    const saved = all.slice();
    const removeIdx = all.map((q, i) => (q.unit === 'equation' && q.difficulty === 1 ? i : -1)).filter((i) => i >= 0).slice(2);
    removeIdx.reverse().forEach((i) => all.splice(i, 1));
    await click('[data-action="go-cert-list"]');
    check(examCard(1).textContent.includes('★の問題が3問不足しているため、現在この試験には挑戦できません。'), `不足の表示: ${examCard(1).textContent.replace(/\s+/g, ' ')}`);
    check(!examCard(1).querySelector('[data-action="cert-start"]'), '不足しているのに始められる');
    all.length = 0; saved.forEach((q) => all.push(q)); // 元に戻す
    await click('[data-action="go-cert-list"]');
    check(examCard(1).querySelector('[data-action="cert-start"]'), '元に戻らない');
  });

  await test('[認定] 試験のあとでトレーニングを始めると、ヘッダーと問題のバッジがトレーニングの表示に戻る', async () => {
    await click('[data-action="go-title"]');
    await configure({ unit: 'expressions', count: 5 });
    await click('#start-btn');
    check(app().mode === 'training' && !$('#hud-count').hidden && $('#hud-count').textContent.includes('1/5'), 'トレーニングで「1/5」が出ない');
    check(!$('#hud-score').hidden && $('#hud-exam-score').hidden, 'トレーニングで試験用の正解数が出ている');
    check($('#play-body .paper__instruction .label-badge').textContent === '問題', 'トレーニングのバッジが「問題」でない');
  });

  await test('[記録] 3つのタブで公式記録・カスタム履歴・認定状況が見られ、再読み込みしても残っている', async () => {
    await openGame(2);
    check(recs().officialFor('equation').plays === 3 && recs().customHistory().length === 1 && recs().certFor('equation').highestCleared === 1, '再読み込みで記録が消えた');
    await click('[data-action="go-records"]');
    check($('#tab-official').getAttribute('aria-selected') === 'true', '最初のタブ');
    const official = $('#records-panel').textContent;
    check(official.includes(`${recs().officialFor('equation').bestScore}`) && official.includes('まだ記録がありません'), '公式記録の表示');
    await click('[data-action="records-tab"][data-tab="cert"]');
    const cert = $('#records-panel').textContent;
    check(cert.includes('新人ティーチャー') && cert.includes('第1試験') && cert.includes('ティーチャー見習い'), '認定の表示');
    await click('[data-action="records-tab"][data-tab="custom"]');
    check($$('#records-panel .history-item').length === 1, 'カスタム履歴の表示');
  });

  await test('[設定] タイトルの「あそびかた」「記録を見る」は横並び。設定画面の下に「KEC数学科ラボへ」と「記録を消す」（確認してから消す）', async () => {
    await click('[data-action="go-title"]');
    const how = $('[data-screen="title"] [data-action="go-howto"]').getBoundingClientRect();
    const rec = $('[data-screen="title"] [data-action="go-records"]').getBoundingClientRect();
    const last = $$('[data-screen="title"] .title-menu > .btn').pop().getBoundingClientRect();
    check(Math.abs(how.top - rec.top) < 2 && how.right <= rec.left && how.top > last.bottom, `横並び・一番下になっていない（あそびかた ${Math.round(how.left)},${Math.round(how.top)}／記録 ${Math.round(rec.left)},${Math.round(rec.top)}）`);
    await click('[data-action="go-options"]');
    const link = $('#lab-link');
    check(visible('options') && link && link.getAttribute('href') === 'https://taka-t-p.github.io/math-app-portal/' && link.textContent.includes('KEC数学科ラボへ'), 'ラボへのリンク');
    const resetBtn = inScreen('options', '[data-action="reset-records"]');
    check(resetBtn && resetBtn.textContent.includes('記録を消す'), '記録を消すボタン');
    check(link.getBoundingClientRect().top > $('#sound-switch').getBoundingClientRect().bottom, '設定の一番下にない');
    const otherKeys = () => Object.keys(w.localStorage).filter((k) => k !== w.Records.STORAGE_KEY).sort().map((k) => `${k}=${w.localStorage.getItem(k)}`).join('|');
    const othersBefore = otherKeys();
    // 「いいえ」なら消えない
    await click(resetBtn);
    check($('#reset-dialog').open && $('#reset-title').textContent === '本当に消しますか？', '確認画面が出ない');
    check(recs().officialFor('equation').plays === 3, '確認画面の前に消えた');
    await click('[data-action="reset-cancel"]');
    check(!$('#reset-dialog').open && recs().officialFor('equation').plays === 3 && recs().customHistory().length === 1, '「いいえ」で消えた');
    // 「はい」で消える（再読み込みしても空のまま。効果音の設定などは残る）
    await click(resetBtn);
    await click('[data-action="reset-confirm"]');
    check(!$('#reset-dialog').open && $('#reset-status').textContent.includes('記録を消しました'), '消したメッセージ');
    check(recs().officialFor('equation').plays === 0 && recs().customHistory().length === 0 && recs().certFor('equation').highestCleared === 0, '記録が消えない');
    check(otherKeys() === othersBefore, '記録以外の保存データが変わった');
    await openGame(2);
    check(recs().officialFor('equation').bestScore === null && recs().customHistory().length === 0 && recs().certFor('equation').highestCleared === 0, '再読み込みで記録が戻った');
  });

  // ================================================================ 記録の引継ぎ
  await test('[引継ぎ] 設定画面に「記録の引継ぎ」があり、コードをつくってコピーでき、別の端末（記録を作り直した状態）で確認してから引き継げる', async () => {
    const RTw = w.RecordTransfer;
    const SOUND_KEY = 'calcTeacher.sound';
    // ---- 元の端末の記録をつくる
    await openGame(2);
    recs().clearAll();
    recs().recordOfficial('equation', { score: 2450, maxStreak: 11 }, w.TimeAttack.titleForScore);
    recs().recordOfficial('positive-negative', { score: 1860, maxStreak: 7 }, w.TimeAttack.titleForScore);
    recs().recordExam('expressions', 1, true);
    recs().recordExam('expressions', 2, true);
    recs().recordExam('expressions', 3, false);
    recs().addCustom({ unit: 'equation', categories: ['移項'], difficulties: [1], score: 400, correct: 2, wrong: 1, maxStreak: 2 });
    const srcSnap = JSON.stringify(recs().snapshot());
    await click('[data-action="go-options"]');
    // ---- 設定画面：KEC数学科ラボ → 記録の引継ぎ → 記録を消す の順
    const lab = $('#lab-link').getBoundingClientRect();
    const card = inScreen('options', '.transfer-card');
    const reset = inScreen('options', '[data-action="reset-records"]').getBoundingClientRect();
    check(card && card.textContent.includes('記録の引継ぎ') && card.textContent.includes('別の端末でも、今までの記録を使えるようにできます。'), '記録の引継ぎの見出し・説明');
    check(card.textContent.includes('公式タイムアタックとティーチャー認定試験の記録を引き継ぎます。') && card.textContent.includes('カスタムタイムアタックの履歴は引き継ぎません。'), '補足説明');
    check(!/エクスポート|インポート/.test(card.textContent), '専門用語が出ている');
    const cr = card.getBoundingClientRect();
    check(lab.bottom <= cr.top + 1 && cr.bottom <= reset.top + 1, `並び順（ラボ ${Math.round(lab.bottom)} / 引継ぎ ${Math.round(cr.top)}〜${Math.round(cr.bottom)} / 記録を消す ${Math.round(reset.top)}）`);
    $$('.transfer-card .btn').forEach((b) => check(b.getBoundingClientRect().height >= 44, `ボタンが小さい: ${b.textContent}`));
    check(pageOverflow() <= 0, '設定画面が横にはみ出す');
    // ---- 引継ぎコードをつくる
    await click('[data-action="transfer-make"]');
    const mk = $('#transfer-make-dialog');
    check(mk.open && mk.textContent.includes('引継ぎコードをつくる') && !$('[data-step="intro"]', mk).hidden, 'つくるダイアログ');
    await click('[data-action="transfer-close"]');
    check(!mk.open, 'キャンセルで閉じない');
    await click('[data-action="transfer-make"]');
    await click('[data-action="transfer-issue"]');
    const code = $('#transfer-code').value;
    check(code.startsWith('CT1-') && code === RTw.createCode(recs().snapshot()), `コード: ${code}`);
    check(mk.textContent.includes('引継ぎコードができました！') && mk.textContent.includes('コピーしたコードを、引き継ぎたい端末に送ってください。'), '発行後の表示');
    check($('#transfer-empty').hidden, '記録があるのに「まだ引き継ぐ記録がありません」');
    check(JSON.stringify(recs().snapshot()) === srcSnap, 'コードをつくったら記録が変わった');
    const ta = $('#transfer-code').getBoundingClientRect();
    const dr = mk.getBoundingClientRect();
    check(ta.left >= dr.left && ta.right <= dr.right + 0.5 && $('#transfer-code').scrollWidth <= $('#transfer-code').clientWidth + 1, 'コードが横に見切れる');
    check(dr.left >= 0 && dr.right <= w.innerWidth + 0.5 && dr.height <= w.innerHeight + 0.5, 'ダイアログが画面に収まらない');
    await click('[data-action="transfer-copy"]');
    await waitFor(() => $('#transfer-copy-status').textContent.length > 0, 'コピーの結果', 3000);
    const copyMsg = $('#transfer-copy-status').textContent;
    check(['コピーしました！', 'コピーできませんでした。コードを選択してコピーしてください。'].includes(copyMsg), `コピーの表示: ${copyMsg}`);
    check($('#transfer-code').value === code, 'コピーしたあとコードが消えた');
    if (copyMsg.startsWith('コピーできません')) {
      const t = $('#transfer-code');
      check(t.selectionStart === 0 && t.selectionEnd === code.length, 'コピーできないときにコードが選択されていない');
    }
    await click('#transfer-make-dialog [data-step="result"] [data-action="transfer-close"]');
    check(!mk.open, '閉じない');

    // ---- 別の端末（この端末の記録を、別の記録・カスタム履歴に作り直す）
    recs().clearAll();
    recs().recordOfficial('equation', { score: 9990, maxStreak: 40 }, w.TimeAttack.titleForScore);
    recs().recordOfficial('square-roots', { score: 500, maxStreak: 2 }, w.TimeAttack.titleForScore);
    recs().addCustom({ unit: 'positive-negative', categories: null, difficulties: [1, 2, 3, 4], score: 777, correct: 3, wrong: 0, maxStreak: 3 });
    const myCustom = JSON.stringify(recs().customHistory());
    const soundBefore = w.localStorage.getItem(SOUND_KEY);
    const destBefore = JSON.stringify(recs().snapshot());
    await click('[data-action="transfer-load"]');
    const ld = $('#transfer-load-dialog');
    check(ld.open && ld.textContent.includes('別の端末でつくった引継ぎコードを貼り付けてください。'), '読み込むダイアログ');
    const input = $('#transfer-input');
    check(input.tagName === 'TEXTAREA' && input.getBoundingClientRect().height >= 80, '入力欄');
    const tryCode = async (text) => { input.value = text; await click('[data-action="transfer-check"]'); return $('#transfer-input-error').textContent; };
    check((await tryCode('こんにちは')).includes('引継ぎコードが正しくありません'), '形式違いのメッセージ');
    check((await tryCode(code.slice(0, code.length - 3))).includes('コードの一部が足りないか'), '途中で切れたコードのメッセージ');
    check((await tryCode(code.replace('CT1-', 'CT2-'))).includes('アプリを更新してから'), '非対応バージョンのメッセージ');
    const body = code.slice(4);
    const flipped = `CT1-${body.slice(0, 5)}${body[5] === 'A' ? 'B' : 'A'}${body.slice(6)}`;
    check((await tryCode(flipped)).includes('記録を読み込めませんでした'), '壊れたコードのメッセージ');
    check(!$('[data-step="input"]', ld).hidden && JSON.stringify(recs().snapshot()) === destBefore, '不正なコードで記録が変わった');
    // 空白・改行が混じったコードを貼り付けて確認する → まだ書き換えない
    await tryCode(`  ${code.replace(/(.{9})/g, '$1\n')}  `);
    check($('#transfer-input-error').textContent === '' && !$('[data-step="confirm"]', ld).hidden, '確認画面に進まない');
    const pv = $('#transfer-preview').textContent;
    check(pv.includes('方程式：最高2,450点（🎯赤ペンマスター）') && pv.includes('正負の数：最高1,860点'), `公式の確認: ${pv}`);
    check(pv.includes('文字式：第2試験までクリア（一人前ティーチャー）') && pv.includes('記録なし'), `認定の確認: ${pv}`);
    check(!$('#transfer-warning').hidden && $('#transfer-warning').textContent.includes('引継ぎコードの内容に置き換えます') && $('#transfer-warning').textContent.includes('カスタムタイムアタックの履歴と効果音設定は変更されません'), '上書きの注意が出ない');
    check(JSON.stringify(recs().snapshot()) === destBefore, '確認しただけで記録が変わった');
    // キャンセル → 変わらない
    await click('#transfer-load-dialog [data-step="confirm"] [data-action="transfer-close"]');
    check(!ld.open && JSON.stringify(recs().snapshot()) === destBefore, 'キャンセルで記録が変わった');
    // ブラウザの「戻る」でもダイアログが閉じるだけ
    await click('[data-action="transfer-load"]');
    w.history.back();
    await waitFor(() => !ld.open, '戻るで閉じる', 3000);
    check(visible('options') && JSON.stringify(recs().snapshot()) === destBefore, '戻るで画面が変わった・記録が変わった');
    // 引き継ぐ
    await click('[data-action="transfer-load"]');
    await tryCode(code);
    await click('[data-action="transfer-apply"]');
    check(!$('[data-step="done"]', ld).hidden && ld.textContent.includes('記録の引継ぎが完了しました！'), '完了の表示');
    check(recs().officialFor('equation').bestScore === 2450 && recs().officialFor('positive-negative').bestScore === 1860, '公式記録が置き換わらない');
    check(recs().officialFor('square-roots').bestScore === null, 'コードにない単元の公式記録が残った');
    check(recs().certFor('expressions').highestCleared === 2 && recs().certFor('expressions').exams['3'].attempts === 1, '認定記録');
    check(JSON.stringify(recs().customHistory()) === myCustom, 'カスタム履歴が変わった');
    check(w.localStorage.getItem(SOUND_KEY) === soundBefore, '効果音の設定が変わった');
    check(RTw.createCode(recs().snapshot()) === code, '引き継いだ記録から同じコードにならない（正確に復元できていない）');
    // 記録を確認する → 記録画面に新しい記録・称号が出る（再起動せずに反映）
    await click('[data-action="transfer-show-records"]');
    check(!ld.open && visible('records'), '記録画面に移らない');
    const rp = $('#records-panel').textContent;
    check(rp.includes('2450') && rp.includes('🎯赤ペンマスター'), `記録画面: ${rp.slice(0, 200)}`);
    await click('[data-action="records-tab"][data-tab="cert"]');
    check($('#records-panel').textContent.includes('一人前ティーチャー'), '認定のランクが反映されない');
    // 再読み込みしても残る
    await openGame(2);
    check(recs().officialFor('equation').bestScore === 2450 && JSON.stringify(recs().customHistory()) === myCustom, '再読み込みで記録が戻った');
  });

  await test('[引継ぎ] 記録がないときもコードをつくれる（「まだ引き継ぐ記録がありません」）。記録のない端末では上書きの注意を出さない', async () => {
    recs().clearAll();
    await click('[data-action="go-options"]');
    await click('[data-action="transfer-make"]');
    await click('[data-action="transfer-issue"]');
    const code = $('#transfer-code').value;
    check(code.startsWith('CT1-') && !$('#transfer-empty').hidden && $('#transfer-empty').textContent.includes('まだ引き継ぐ記録がありません'), '空の記録のコード');
    await click('#transfer-make-dialog [data-step="result"] [data-action="transfer-close"]');
    const full = w.RecordTransfer.createCode({ timeAttack: { official: { equation: { bestScore: 600, bestDate: '2026-11-20T00:00:00.000Z', maxStreak: 3, plays: 1 } } } });
    await click('[data-action="transfer-load"]');
    $('#transfer-input').value = full;
    await click('[data-action="transfer-check"]');
    check($('#transfer-warning').hidden, '記録のない端末で上書きの注意が出た');
    await click('[data-action="transfer-apply"]');
    check(recs().officialFor('equation').bestScore === 600, '記録のない端末へ引き継げない');
    await click('#transfer-load-dialog [data-step="done"] [data-action="transfer-close"]');
    recs().clearAll();
  });

  // ================================================================ 生徒キャラクター
  await test('[生徒] タイトル：男の子か女の子がセリフを話す。抽選は固定でき、どちらでもレイアウトが崩れない', async () => {
    await openGame(3);
    check(visible('title'), 'タイトル');
    checkTalk('#title-talk', 'title', 'タイトル');
    const seen = new Set();
    for (const [v, id] of [[0, 'boy'], [0.99, 'girl']]) {
      w.__calcTeacher.setDialogueRng(() => v);
      w.__calcTeacher.rerenderTitleTalk();
      const t = checkTalk('#title-talk', 'title', `タイトル（${id}）`);
      check(t.id === id, `抽選を固定できない: ${t.id}`);
      seen.add(t.id);
      // ほかの表示と重ならない
      const talkR = $('#title-talk .student-talk').getBoundingClientRect();
      const logoR = $('.title-logo').getBoundingClientRect();
      const nameR = $('#title-heading').getBoundingClientRect();
      const optR = $('.title-options').getBoundingClientRect();
      const ov = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      check(!ov(talkR, logoR) && !ov(talkR, nameR) && !ov(talkR, optR), `${id}: タイトルの表示と重なる`);
      check(pageOverflow() <= 0, `${id}: 横スクロールが出る`);
    }
    // 1つずつ順に返す乱数で、男の子・女の子・一人称のセリフがそれぞれ出る
    const DD = w.CharacterDialogue;
    for (const line of DD.LINES.title) {
      const text = typeof line === 'string' ? line : line.text;
      const who = typeof line === 'string' ? ['boy', 'girl'] : [line.only];
      for (const id of who) {
        const ci = DD.CHARACTERS.findIndex((c) => c.id === id);
        const li = DD.linesFor('title', id).indexOf(text);
        const vals = [(ci + 0.5) / DD.CHARACTERS.length, (li + 0.5) / DD.linesFor('title', id).length];
        let k = 0;
        w.__calcTeacher.setDialogueRng(() => vals[k++ % 2]);
        w.__calcTeacher.rerenderTitleTalk();
        const t = checkTalk('#title-talk', 'title', `タイトル「${text}」`);
        // どのセリフでも（2行になっても）右上の「設定」ボタンと重ならない
        const tr = $('#title-talk .student-talk').getBoundingClientRect();
        const or = $('.title-options').getBoundingClientRect();
        check(tr.top >= or.bottom + 2 || tr.right <= or.left - 2, `「${text}」が設定ボタンと重なる（吹き出しの上 ${Math.round(tr.top)}・ボタンの下 ${Math.round(or.bottom)}）`);
        check(t.id === id && t.text === text, `${id}「${text}」にならない`);
      }
    }
    w.__calcTeacher.setDialogueRng(null);
    // 設定を開いて戻ると選び直す（同じ結果になってもよいので、表示されていることだけ確かめる）
    await click('[data-action="go-options"]');
    await click('[data-screen="options"] [data-action="go-title"]');
    checkTalk('#title-talk', 'title', 'タイトルに戻ったとき');
    check(seen.size === 2, '男の子と女の子の両方を確かめていない');
  });

  await test('[生徒] トレーニング結果：正解率でセリフが変わり、評価コメントも残る。解き直しから戻ってもセリフは変わらない', async () => {
    const cases = [
      [[true, true, true, true, true], 'training-perfect'],
      [[true, true, true, true, false], 'training-high'],
      [[true, true, true, false, false], 'training-mid'],
      [[true, false, false, false, false], 'training-low'],
    ];
    let last = null;
    for (const [pattern, group] of cases) {
      await click('[data-action="go-title"]').catch(() => {});
      if (!visible('title')) await openGame(4);
      await configure({ unit: 'expressions', count: 5 });
      await click('#start-btn');
      for (const ok of pattern) { await answer(ok); await click('[data-action="next"]'); }
      check(visible('summary'), '結果画面');
      check($('.score-card__comment').textContent.length > 5, '評価コメントが消えた');
      last = checkTalk('#summary-body', group, `トレーニング ${group}`);
    }
    // 1問だけ解き直して戻る → 同じキャラクター・セリフ
    await click('[data-action="review-question"][data-index="1"]');
    check(visible('play'), '解き直しが始まらない');
    await answer(true);
    await click('[data-action="next"]');
    check(visible('summary'), '結果画面に戻らない');
    check(sameTalk(checkTalk('#summary-body', 'training-low', '解き直しのあと'), last), '解き直しのあとでセリフが変わった');
  });

  await test('[生徒] 認定試験：最終試験に初合格すると専用のセリフ。もう一度合格すると通常の合格のセリフ', async () => {
    // 第1〜第4試験は合格済みにしておく（記録の仕組みはそのまま使う）
    for (let id = 1; id <= 4; id++) recs().recordExam('expressions', id, true);
    await click('[data-action="go-title"]').catch(() => {});
    await click('[data-action="go-cert-units"]');
    await click('[data-action="cert-unit"][data-unit="expressions"]');
    const plays = async () => {
      await click('[data-action="cert-start"][data-exam="5"]');
      const s = app().session;
      for (let i = 0; i < s.exam.maxQuestions; i++) {
        await answerExam(true);
        await click('[data-action="next"]');
        if (visible('cert-result')) break;
      }
      check(visible('cert-result') && $('#cert-result-body').textContent.includes('最終試験 合格'), '最終試験に合格しない');
    };
    await plays();
    checkTalk('#cert-result-body', 'cert-master', '最終試験の初合格');
    check(recs().certFor('expressions').highestCleared === 5, 'ランクが記録されない');
    await click('#cert-result-actions [data-action="cert-start"][data-exam="5"]');
    const s = app().session;
    for (let i = 0; i < s.exam.maxQuestions && !visible('cert-result'); i++) { await answerExam(true); await click('[data-action="next"]'); }
    checkTalk('#cert-result-body', 'cert-pass', '最終試験の再合格');
  });

  await test('[生徒] キャラクターの抽選は出題順（?seed=）に影響しない', async () => {
    const order = async (v) => {
      await openGame(5);
      w.__calcTeacher.setDialogueRng(() => v);
      w.__calcTeacher.rerenderTitleTalk();
      await click('[data-action="go-options"]');
      await click('[data-screen="options"] [data-action="go-title"]');
      await configure({ unit: 'positive-negative', count: 'all' });
      await click('#start-btn');
      return app().session.questions.map((q) => q.id).join();
    };
    const a = await order(0);
    const b = await order(0.99);
    check(a === b && a.length > 0, `出題順が変わった\n${a}\n${b}`);
  });

  // ================================================================ 効果音
  // 実際に聞こえるかはヘッドレスでは確かめられないため、js/sound.js の再生記録で「どの操作で、どの音を鳴らしたか」を確かめる
  const snd = () => w.Sound;
  const played = () => snd().debug.log.filter((e) => e.played).map((e) => e.name);
  const resetSnd = () => { snd().debug.clearLog(); snd().debug.resetThrottle(); };

  await test('[効果音 1〜9] 行選択・全部正しい・ヒント・添削・正解・不正解・次の問題・開始・結果の各場面で音が鳴る', async () => {
    await openGame(3);
    check(snd() && snd().getSettings().enabled === true && snd().getSettings().volume === 50, `初期設定 ${JSON.stringify(snd() && snd().getSettings())}`);
    check(snd().debug.log.length === 0, '起動しただけで音を鳴らそうとした');
    await configure({ unit: 'expressions', count: 4 });
    resetSnd();
    await click('#start-btn');
    check(played().join() === 'start', `開始: ${played()}`);
    resetSnd();
    await click(rowBtn(1));
    check(played().join() === 'select', `行選択: ${played()}`);
    resetSnd();
    await click('#all-correct-btn');
    check(played().join() === 'select', `全部正しい: ${played()}`);
    resetSnd();
    await click('#hint-btn');
    check(played().join() === 'hint', `ヒントを開く: ${played()}`);
    resetSnd();
    await click('#hint-btn');
    check(snd().debug.log.length === 0, `ヒントを閉じたときに鳴った: ${snd().debug.log.map((e) => e.name)}`);
    await click('#all-correct-btn'); // 「全部正しい！」の選択を外しておく
    const s = app().session;
    let sawCorrect = false, sawWrong = false;
    while (!s.finished) {
      const ok = !sawCorrect || sawWrong; // 正解 → 不正解 → 正解… の順
      resetSnd();
      await answer(ok);
      check(played().join() === `select,submit,${ok ? 'correct' : 'incorrect'}`, `添削（${ok ? '正解' : '不正解'}）: ${played()}`);
      if (ok) sawCorrect = true; else sawWrong = true;
      resetSnd();
      const last = s.isLast;
      await click('[data-action="next"]');
      if (!last) check(played().join() === 'next', `次の問題へ: ${played()}`);
      else check(played().join() === 'result', `通常の結果発表: ${played()}`);
    }
    check(sawCorrect && sawWrong, '正解と不正解の両方を確かめられなかった');
  });

  await test('[効果音 10] 全問正解のときは専用のファンファーレだけが鳴る（通常の終了音は重ねない）', async () => {
    await configure({ unit: 'equation', difficulties: [4], count: 1 });
    await click('#start-btn');
    await answer(true);
    resetSnd();
    await click('[data-action="next"]');
    check(played().join() === 'perfect', `全問正解の結果発表: ${played()}`);
  });

  await test('[効果音 11] プレイ中のスピーカーボタンで OFF にすると、どの音も鳴らない。ON に戻すと鳴る', async () => {
    await configure({ unit: 'positive-negative', count: 3 });
    await click('#start-btn');
    const hud = $('#hud-sound');
    check(hud.textContent === '🔊' && hud.getAttribute('aria-pressed') === 'true', 'スピーカーボタンの初期表示');
    await click(hud);
    check(hud.textContent === '🔇' && hud.getAttribute('aria-pressed') === 'false', 'OFF の表示');
    check(snd().getSettings().enabled === false, 'OFF になっていない');
    resetSnd();
    await click(rowBtn(1));
    await click(rowBtn(1)); // 選択を外しておく（このあとの answer() が選び直すため）
    await click('#hint-btn');
    await answer(true);
    await click('[data-action="next"]');
    check(snd().debug.log.length > 0 && played().length === 0, `OFF なのに鳴った: ${played()}`);
    check(snd().debug.log.every((e) => e.reason === 'off'), 'OFF 以外の理由で鳴らなかった');
    resetSnd();
    await click(hud);
    check(snd().getSettings().enabled === true && played().join() === 'select', `ON に戻したとき: ${played()}`);
    await click('[data-action="quit"]');
    await click('[data-action="quit-confirm"]');
  });

  await test('[効果音 12〜14] 設定画面で ON/OFF・音量を変えると反映され、ブラウザに保存され、再読み込み後も維持される', async () => {
    await click('[data-action="go-options"]');
    check(visible('options'), '設定画面が開かない');
    const range = $('#volume-range');
    check(range.value === '50' && $('#volume-value').textContent === '50%', '音量の初期表示');
    range.value = '20';
    range.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(30);
    check(snd().getSettings().volume === 20 && $('#volume-value').textContent === '20%', '音量が変わらない');
    check(snd().debug.masterGain === w.SoundLib.volumeToGain(20), `全体の音量 ${snd().debug.masterGain}`);
    await click('#sound-switch');
    check($('#sound-switch').getAttribute('aria-checked') === 'false' && $('#sound-switch-text').textContent === 'OFF', 'スイッチが OFF にならない');
    const saved = JSON.parse(w.localStorage.getItem('calcTeacher.sound'));
    check(saved.enabled === false && saved.volume === 20, `保存内容 ${JSON.stringify(saved)}`);
    // 再読み込み
    await openGame(1);
    check(snd().getSettings().enabled === false && snd().getSettings().volume === 20, `再読み込み後の設定 ${JSON.stringify(snd().getSettings())}`);
    check($('#volume-range').value === '20' && $('#sound-switch').getAttribute('aria-checked') === 'false' && $('#hud-sound').textContent === '🔇', '再読み込み後の表示');
    // 音量0%は無音
    await click('[data-action="go-options"]');
    await click('#sound-switch');
    $('#volume-range').value = '0';
    $('#volume-range').dispatchEvent(new w.Event('input', { bubbles: true }));
    resetSnd();
    await click('[data-action="sound-test"]');
    check(played().length === 0 && snd().debug.log[0].reason === 'mute', '音量0%で鳴った');
    // 初期設定に戻す
    $('#volume-range').value = '50';
    $('#volume-range').dispatchEvent(new w.Event('input', { bubbles: true }));
    resetSnd();
    await click('[data-action="sound-test"]');
    check(played().join() === 'correct', '音をためすボタン');
    await click('.screen--options [data-action="go-title"]');
  });

  await test('[効果音 15] 連打しても音が重なりすぎない（間引き・同時発音数の上限）', async () => {
    await configure({ unit: 'equation', count: 3 });
    await click('#start-btn');
    resetSnd();
    for (let i = 0; i < 12; i++) rowBtn(1).click(); // 待たずに連打
    check(played().length <= 1, `連打で ${played().length} 回鳴った`);
    check(snd().debug.activeVoices <= w.SoundLib.MAX_VOICES, `同時に ${snd().debug.activeVoices} 個鳴っている`);
    check(app().session.selection === null || app().session.selection.index === 1, '選択状態がおかしい');
    await click('[data-action="quit"]');
    await click('[data-action="quit-confirm"]');
  });

  await test('[効果音 16・17] 音の再生に失敗しても、出題・採点・結果表示はふつうに進む', async () => {
    resetSnd();
    snd().debug.simulateFailure(true);
    try {
      await configure({ unit: 'positive-negative', count: 2 });
      await click('#start-btn');
      const s = app().session;
      await answer(true);
      check($('.verdict--ok') && s.correctCount === 1, '採点されない');
      await click('[data-action="next"]');
      await answer(false);
      check($('.verdict--ng'), '不正解の採点');
      await click('[data-action="next"]');
      check(visible('summary') && s.summary().rate === 50, '結果画面へ進まない');
      check(snd().debug.log.some((e) => e.reason === 'error') && played().length === 0, '失敗の記録');
    } finally {
      snd().debug.simulateFailure(false);
    }
  });

  await test('[20] 開発者用プレビュー（preview.html）が従来どおり動く', async () => {
    await load('../../preview.html?reveal=1#J1-EQ-0010');
    check(!w.Sound, 'プレビューに効果音が読み込まれている');
    await waitFor(() => d.querySelectorAll('#question-index .chip').length === DATA.total, 'プレビューの読み込み');
    check(d.querySelector('.meta-id').textContent === 'J1-EQ-0010', 'URL ハッシュでの問題指定');
    check(d.querySelector('.answer-line--error'), '誤り行のハイライト');
    await waitFor(() => /レビュー済/.test(d.querySelector('#review-status').textContent), '手動レビュー状況');
    check(d.querySelector('.dev-note--ok').textContent.includes('データと一致'), '数学的検証の結果');
    d.querySelector('#unit-select').value = 'expressions';
    d.querySelector('#unit-select').dispatchEvent(new Event('change'));
    await sleep(50);
    check(d.querySelectorAll('#question-index .chip').length === DATA.expressions, '単元の絞り込み');
    const before = d.querySelector('.meta-id').textContent;
    d.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(50);
    const after = d.querySelector('.meta-id').textContent;
    check(after.startsWith('J1-EX-') && after !== before, `キーボードでの切り替え（${before} → ${after}）`);
    d.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    await sleep(50);
    check(d.querySelector('.hint'), 'ヒントの表示');
  });

  out.textContent = 'RESULTS:' + JSON.stringify({ width: W, height: H, results });
})().catch((e) => {
  document.getElementById('results').textContent = 'RESULTS:' + JSON.stringify({ fatal: e.message, results: [] });
});
