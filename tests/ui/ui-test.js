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
  const visible = (name) => !d.querySelector(`[data-screen="${name}"]`).hidden;
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
  try { localStorage.removeItem('calcTeacher.sound'); } catch (e) { /* 音声設定を初期状態に */ }
  await openGame(1);

  await test('[1] タイトル画面が表示され、トレーニングから設定画面へ進める', async () => {
    check(visible('title'), 'タイトル画面が表示されていない');
    check($('.title-name').textContent.includes('計算ティーチャー！'), 'タイトル文字');
    check($('.title-sub').textContent.includes('キミは計算ミスを見抜けるか'), 'サブタイトル');
    check($$('.coming-soon button').length === 0, '準備中のモードがボタンになっている');
    check($$('.coming-soon__badge').every((b) => b.textContent === '準備中'), '準備中の表示');
    await click('[data-action="go-settings"]');
    check(visible('settings'), '設定画面へ進めない');
  });

  await test('[2] 単元は manifest の3単元から選べ、変更すると対象問題が切り替わる', async () => {
    check($$('.unit-card').length === 3, `単元の数 ${$$('.unit-card').length}`);
    await click('[data-action="select-unit"][data-unit="equation"]');
    check($('[data-unit="equation"]').getAttribute('aria-checked') === 'true', '方程式が選択されていない');
    const eqStar1 = $('[data-difficulty="1"]').textContent;
    check(eqStar1.includes('1問'), `方程式の★の問題数表示: ${eqStar1}`);
    await click('[data-action="select-unit"][data-unit="positive-negative"]');
    check($('[data-difficulty="1"]').textContent.includes('2問'), '正負の数の★の問題数表示');
    check($('#setting-summary').textContent.includes('10問'), '出題できる問題数の表示');
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
    check($('#setting-summary').textContent.includes('7問'), `★★+★★★ の問題数: ${$('#setting-summary').textContent}`);
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
    check(range.min === '1' && range.max === '10', `範囲 ${range.min}〜${range.max}`);
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
    await setCountTo(10);
    check($('[data-action="count-plus"]').disabled, '最大のとき ＋ が押せる');
    // 最大数は選んだ難易度で変わる（★★★ だけ → 4問）
    await click('[data-difficulty="all"]');
    await click('[data-difficulty="3"]');
    check(range.max === '4' && range.value === '4' && $('#count-value').textContent === '4問', `★★★だけの最大 ${range.max} / ${range.value}`);
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
    await configure({ unit: 'positive-negative', count: 5 });
    await click('[data-action="toggle-category-all"]'); // すべて解除
    await click(catChip('累乗'));
    check($('#count-range').max === '2' && $('#count-value').textContent === '2問', `累乗だけの最大 ${$('#count-range').max} / ${$('#count-value').textContent}`);
    check($('#setting-summary').textContent.includes('出題できる問題：2問'), $('#setting-summary').textContent);
    await click(catChip('加法・減法'));
    check($('#count-range').max === '5' && $('#count-value').textContent === '5問', `加法・減法を足したあと ${$('#count-range').max} / ${$('#count-value').textContent}`);
    await click('[data-action="toggle-category-all"]');
    check($('#count-range').max === '10' && $('#count-value').textContent === '5問', '希望の5問に戻らない');
    // 累乗 × ★★★★ は0問
    await configure({ unit: 'positive-negative', categories: ['累乗'], difficulties: [4], count: 5 });
    check($('#start-btn').disabled && $('#count-range').disabled && $('#count-value').textContent === '0問', '0問なのに開始できる');
    check($('#setting-summary').textContent.includes('出題できる問題がありません'), `メッセージ: ${$('#setting-summary').textContent}`);
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
    await configure({ unit: 'equation', difficulties: [4], count: 10 });
    check($('#count-range').max === '1' && $('#count-value').textContent === '1問', `最大 ${$('#count-range').max}`);
    check($('#setting-summary').textContent.includes('出題できる問題：1問'), $('#setting-summary').textContent);
    await click('#start-btn');
    check(visible('play'), '問題画面へ進まない');
    check(app().session.total === 1, `出題数 ${app().session.total}`);
    check($('#hud-count').textContent.includes('1/1'), $('#hud-count').textContent);
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

  await test('[表示] 方程式は全10問で、答案・正しい計算過程とも「＝」の縦の位置がそろう（選択中・採点後も）', async () => {
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

  await test('[表示] 全30問で数式が見切れず、ページが横にはみ出さない。行のタップ領域は48px以上', async () => {
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
    check(report.questions === 30, `確認した問題数 ${report.questions}`);
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
    await waitFor(() => d.querySelectorAll('#question-index .chip').length === 30, 'プレビューの読み込み');
    check(d.querySelector('.meta-id').textContent === 'J1-EQ-0010', 'URL ハッシュでの問題指定');
    check(d.querySelector('.answer-line--error'), '誤り行のハイライト');
    await waitFor(() => /レビュー済/.test(d.querySelector('#review-status').textContent), '手動レビュー状況');
    check(d.querySelector('.dev-note--ok').textContent.includes('データと一致'), '数学的検証の結果');
    d.querySelector('#unit-select').value = 'expressions';
    d.querySelector('#unit-select').dispatchEvent(new Event('change'));
    await sleep(50);
    check(d.querySelectorAll('#question-index .chip').length === 10, '単元の絞り込み');
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
