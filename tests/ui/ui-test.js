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
  async function pickUnit(selectSel, unit) {
    const sel = $(selectSel);
    if (!sel) throw new Error(`要素がありません: ${selectSel}`);
    if (![...sel.options].some((o) => o.value === unit)) throw new Error(`単元の選択肢がありません: ${unit}`);
    sel.value = unit;
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(40);
  }
  async function pickCertUnit(unit) {
    await click(`#cert-unit-list [data-action="cert-unit"][data-unit="${unit}"]`);
  }
  /** 公式タイムアタックの単元カードを押す */
  async function pickTAUnitCard(unit) {
    await click(`#ta-unit-list [data-action="ta-unit"][data-unit="${unit}"]`);
  }
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
    await pickUnit('#unit-select', unit);
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

  /** スクリーンショット用：ストーリーの画面を開く */
  async function storyShot(kind) {
    const total = Number(params.get('total') || 120);
    const longNames = params.get('names') === '1';
    w.localStorage.setItem('calcTeacher.story', JSON.stringify({
      version: 1, totalCorrect: total, readEpisodes: [1, 2, 3].filter((n) => n < Number(params.get('ep') || 99)),
      teacherName: longNames ? 'たかおみたかおみたか' : '田中', boyName: longNames ? 'ジョナサンジョースター' : 'ケイ', girlName: longNames ? 'エリザベスあいうえお' : 'シホ',
    }));
    await openGame(3);
    if (kind === 'title') return;
    await click('[data-action="go-records"]');
    if (kind === 'records') return;
    await click('[data-action="story-go"]');
    await waitFor(() => $('.story-card'), 'ストーリー一覧');
    if (kind === 'list') return;
    if (kind === 'names') { await click('[data-action="story-names"]'); return; }
    const no = Number(params.get('ep') || 9);
    await click(`[data-action="story-open"][data-no="${no}"]`);
    const n = Number(params.get('lines') || 8);
    for (let i = 1; i < n; i++) await click('#story-next');
    if (kind === 'end') { await click('#story-skip'); await sleep(7000); }
    await sleep(900);
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
      // 指定した問題（?q=J2-SE-0006）を表示する。&answered=1 なら答え合わせのあと（不正解の答え）を表示
      question: async () => {
        const id = params.get('q');
        const q = app().questions.find((x) => x.id === id);
        await configure({ unit: q.unit, count: 'all' });
        await click('#start-btn');
        const s = app().session;
        while (s.current.id !== id) { await answer(true); await click('[data-action="next"]'); }
        if (params.get('answered')) await answer(false);
      },
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
        // ?best=3200 で、先に自己ベストを入れておく（今回の結果と最高記録の称号がちがう表示を見るため）
        if (params.get('best')) w.__calcTeacher.records.recordOfficial(app().config.unit, { score: Number(params.get('best')), maxStreak: 10 }, w.TimeAttack.titleForScore);
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
      'cert-list': async () => { await click('[data-action="go-cert-units"]'); await pickCertUnit('equation'); },
      'cert-pass': async () => {
        await click('[data-action="go-cert-units"]'); await pickCertUnit('equation');
        await click('[data-action="cert-start"][data-exam="1"]');
        for (let i = 0; i < 3; i++) { await answer(true); await click('[data-action="next"]'); }
      },
      'cert-play': async () => { // 試験中のヘッダー（1問正解して2問目）
        await click('[data-action="go-cert-units"]'); await pickCertUnit('positive-negative');
        await click('[data-action="cert-start"][data-exam="1"]');
        await answer(true); await click('[data-action="next"]');
      },
      'cert-list-cleared': async () => { // 第1試験に合格したあとの試験一覧
        await click('[data-action="go-cert-units"]'); await pickCertUnit('equation');
        await click('[data-action="cert-start"][data-exam="1"]');
        for (let i = 0; i < 3; i++) { await answer(true); await click('[data-action="next"]'); }
        await click('[data-action="go-cert-list"]');
      },
      records: async () => click('[data-action="go-records"]'),
      'records-cert': async () => { await click('[data-action="go-records"]'); await click('[data-action="records-tab"][data-tab="cert"]'); },
      // ストーリー（?shot=story-list / story-read-9 / story-end-12 など。?total= で累積正解数、?names=1 で長い名前）
      'story-title': async () => storyShot('title'),
      'story-list': async () => storyShot('list'),
      'story-records': async () => storyShot('records'),
      // 指定した問題を出すまで進める（?shot=question&id=J2-PO-0035&v=wrong|correct&graded=1）。横スクロールの式を結果に出す
      question: async () => {
        const id = params.get('id');
        const q0 = app().questions.find((x) => x.id === id);
        w.__calcTeacher.setVariantRng(params.get('v') === 'correct' ? () => 0 : () => 0.99);
        await configure({ unit: q0.unit, categories: [q0.category], difficulties: [q0.difficulty], count: 'all' });
        await click('#start-btn');
        const s = app().session;
        while (s.current.id !== id) { await answer(true); await click('[data-action="next"]'); }
        if (params.get('graded')) await answer(true);
        await d.fonts.ready; await sleep(300);
        const sc = $$('.fit-math').filter((el) => el.offsetParent && el.classList.contains('is-scrollable')).map((el) => `${el.closest('[class]').className}:${el.textContent.slice(0, 40)}`);
        w.__scrollInfo = sc;
      },
      'story-read': async () => storyShot('read'),
      'story-end': async () => storyShot('end'),
      'story-names': async () => storyShot('names'),
      dialog: async () => { await configure({ unit: 'equation', count: 5 }); await click('#start-btn'); await click('[data-action="quit"]'); },
    }[SHOT];
    if (params.get('tiers')) {
      // ?tiers=1：金・銀・銅のカードを見るための記録を入れておく
      const R = w.__calcTeacher.records;
      [['positive-negative', 3200], ['expressions', 2400], ['equation', 1600], ['polynomials', 900]].forEach(([u, sc]) => R.recordOfficial(u, { score: sc, maxStreak: 5 }, w.TimeAttack.titleForScore));
      [['positive-negative', 5], ['expressions', 4], ['equation', 3], ['polynomials', 2]].forEach(([u, h]) => { for (let id = 1; id <= h; id++) R.recordExam(u, id, true); });
    }
    await goto();
    await sleep(600); // アニメーション終了待ち
    if (!SHOT.startsWith('play-correct') && !SHOT.startsWith('play-wrong') && !SHOT.startsWith('play-allcorrect') && !SHOT.startsWith('long-math')) w.scrollTo(0, 0);
    const eqPos = $$('#sheet .eq-op').map((op) => Math.round(op.getBoundingClientRect().left));
    out.textContent = 'shot ready' + (eqPos.length ? ` / 「＝」の位置 ${eqPos.join(',')}` : '');
    if (w.__scrollInfo) out.textContent += ` / 横スクロール: ${w.__scrollInfo.join(' | ') || 'なし'}`;
    return;
  }

  // ================================================================== テスト本体
  try { ['calcTeacher.sound', 'calcTeacher.records', 'calcTeacher.records.backup', 'calcTeacher.story', 'calcTeacher.story.backup', 'calcTeacher.storySound'].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* 音声設定・記録を初期状態に */ }
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

  await test('[2] 単元は manifest のすべての単元をプルダウン（学年ごとのグループつき）から選べ、変更すると対象問題が切り替わる', async () => {
    const sel = $('#unit-select');
    check(sel && sel.tagName === 'SELECT' && sel.options.length === app().units.length, `単元の数 ${sel && sel.options.length}`);
    check(!$('section[data-screen="settings"] [data-action="select-unit"]'), '単元のボタンが残っている');
    const grades = [...new Set(app().units.map((u) => u.grade))];
    check(grades.every((g) => [...sel.querySelectorAll('optgroup')].some((o) => o.label === `中学${g}年生`)), '学年のグループがない');
    check(sel.getBoundingClientRect().height >= 48, 'プルダウンが押しにくい');
    // 選択肢は「中1・正負の数」のように単元名だけ（「（100問）」などの問題数は出さない）
    check([...sel.options].every((o, i) => o.textContent === `中${app().units[i].grade}・${app().units[i].label}`), `選択肢の文字: ${[...sel.options].map((o) => o.textContent).join('/')}`);
    await pickUnit('#unit-select', 'equation');
    check(app().config.unit === 'equation' && $('#unit-select').value === 'equation', '方程式が選択されていない');
    // カテゴリ・難易度のボタンには問題数を書かない（「✓ 加法・減法」「✓ ★」だけ）
    const noCount = () => $$('#category-list .cat-chip, #difficulty-list .chip--star').every((b) => !/\d+問/.test(b.textContent) && !/問/.test(b.getAttribute('aria-label') || ''));
    check(noCount(), `ボタンに問題数が残っている: ${$$('#category-list .cat-chip, #difficulty-list .chip--star').map((b) => b.textContent.replace(/\s+/g, '')).join('/')}`);
    await pickUnit('#unit-select', 'positive-negative');
    check(noCount() && $$('#category-list .cat-chip__name').map((n) => n.textContent).join() === '加法・減法,乗法・除法,累乗,四則混合', '正負の数のカテゴリのボタン');
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
      await pickUnit('#unit-select', unit);
      const names = $$('[data-action="toggle-category"] .cat-chip__name').map((n) => n.textContent);
      check(names.join() === EXPECTED_CATS[unit].join(), `${unit} のカテゴリ: ${names}`);
      check(catPressed().join() === EXPECTED_CATS[unit].join(), `${unit} の初期選択: ${catPressed()}`);
      check(catBulkText() === 'すべて解除', `${unit} のボタン表示: ${catBulkText()}`);
    }
    // 正負の数で一部を外してから単元を変えて戻ると、すべて選択に戻る（前の選択を引き継がない）
    await pickUnit('#unit-select', 'positive-negative');
    await click(catChip('累乗'));
    await pickUnit('#unit-select', 'equation');
    check(catPressed().length === 4, `方程式に切り替えたあと: ${catPressed()}`);
    await click(catChip('移項'));
    await pickUnit('#unit-select', 'equation'); // 同じ単元を押し直しても選択は保つ
    check(catPressed().join() === 'かっこを含む方程式,小数を含む方程式,分数を含む方程式', `同じ単元を押し直したあと: ${catPressed()}`);
    await pickUnit('#unit-select', 'positive-negative');
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
    check(s.correctCount === 1 && $('#hud-exam-score').textContent.replace(/\s+/g, '').includes(`✔1/${s.total}`), `HUD の正解数: ${$('#hud-exam-score').textContent}`);
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
    check($('#hud-exam-score').hidden && $('#hud-count').hidden && $('#hud-score').hidden, '解き直し中に「✔0/1」などが出ている');
    check($('#play-body .paper__instruction .label-badge').textContent === '第2問', `解き直しのバッジ: ${$('#play-body .paper__instruction .label-badge').textContent}`);
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
    check($('#hud-exam-score').textContent.replace(/\s+/g, '').includes('✔0/5') && $('#hud-count').hidden && $('#play-body .paper__instruction .label-badge').textContent === '第1問', 'HUD（✔0/5・第1問）');
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

  await test('[第7段階] 正答版・誤答版の答案が出て、表示した答案のとおりに採点・解説される。解き直しは同じ答案、もう一度チャレンジで抽選し直す', async () => {
    const QVw = w.QuestionVariants;
    const bases = new Map(app().questions.map((q) => [q.id, q]));
    await click('#screen-summary [data-action="go-settings"], .summary-actions [data-action="go-settings"]');
    await configure({ unit: 'simultaneous-equations', count: 'all' });
    await click('#start-btn');
    const s = app().session;
    const seen = { modelOk: 0, modelNg: 0, addedOk: 0, addedNg: 0 };
    let correctShown = 0;
    while (!s.finished) {
      const q = s.current;
      const base = bases.get(q.id);
      const v = QVw.variantsOf(base).find((x) => x.id === q.variantId);
      check(v && JSON.stringify(v.answerLines) === JSON.stringify(q.answerLines) && v.errorLine === q.errorLine, `${q.id}: 登録した答案パターンと違う（${q.variantId}）`);
      check($$('#play-body .row').length === q.answerLines.length, `${q.id}: 表示した答案の行数 ${$$('#play-body .row').length} / ${q.answerLines.length}`);
      if (q.errorLine === null) correctShown++;
      if (base.errorLine !== null && q.errorLine === null && seen.modelOk + seen.modelNg < 2) {
        // 誤答の問題の正答版：「全部正しい！」で正解、元の誤り行を選ぶと不正解
        if (!seen.modelOk) {
          await answer(true);
          check($('.verdict--ok') && $('.verdict__sub').textContent.includes('全部正しい'), `${q.id}: 正答版が「全部正しい！」で正解にならない`);
          check($$('#feedback .feedback__title')[0].textContent.includes('計算のポイント') && !$('#feedback .error-type'), `${q.id}: 正答版に誤答の解説が出ている`);
          seen.modelOk++;
        } else {
          await click(rowBtn(base.errorLine)); await click('#submit-btn'); await sleep(60);
          check($('.verdict--ng'), `${q.id}: 正答版で元の誤り行を選んだのに正解になった`);
          seen.modelNg++;
        }
      } else if (base.errorLine === null && q.errorLine !== null && seen.addedOk + seen.addedNg < 2) {
        // 正答の問題に追加した誤答版：設定した行が正解、「全部正しい！」は不正解
        if (!seen.addedOk) {
          await answer(true);
          check($('.verdict--ok') && $('#feedback .error-type') && $('#feedback .error-type').textContent === q.errorType, `${q.id}: 誤答版の採点・誤りの種類`);
          seen.addedOk++;
        } else {
          await click('#all-correct-btn'); await click('#submit-btn'); await sleep(60);
          check($('.verdict--ng') && $('.verdict__sub').textContent.includes(`${q.errorLine + 1}行目が最初のまちがい`), `${q.id}: 誤答版で「全部正しい！」が正解になった`);
          seen.addedNg++;
        }
      } else {
        await answer(true);
        check($('.verdict--ok'), `${q.id}（${q.variantId}）: 表示した答案の正しい選択で正解にならない`);
      }
      await click('[data-action="next"]');
    }
    check(Object.values(seen).every((n) => n === 1), `正答版・誤答版の両方を確認できていない ${JSON.stringify(seen)}`);
    check(correctShown >= 10 && correctShown <= 45, `100問中の正答版 ${correctShown}問（約25%のはず）`);
    // 結果画面から解き直すと、同じ答案パターンが出る
    const base = app().session;
    const idx = base.questions.findIndex((q) => bases.get(q.id).errorLine !== q.errorLine);
    const target = base.questions[idx];
    await click(`[data-action="review-question"][data-index="${idx}"]`);
    check(app().session.current.id === target.id && app().session.current.variantId === target.variantId
      && JSON.stringify(app().session.current.answerLines) === JSON.stringify(target.answerLines), `解き直しの答案が違う（${app().session.current.variantId} / ${target.variantId}）`);
    await click('[data-action="quit"]');
    await click('[data-action="quit-confirm"]');
    check(visible('summary') && app().session === base, '解き直しをやめて結果画面に戻らない');
    // もう一度チャレンジ：答案パターンを抽選し直す
    const before = new Map(base.questions.map((q) => [q.id, q.variantId]));
    await click('[data-action="retry"]');
    const again = app().session;
    const diff = again.questions.filter((q) => before.get(q.id) !== q.variantId).length;
    check(again !== base && diff >= 10, `もう一度チャレンジで答案パターンが抽選し直されていない（違う答案 ${diff}問）`);
    await click('[data-action="quit"]');
    await click('[data-action="quit-confirm"]');
    // 次のテスト（[20]）のために、方程式で1問解いて結果画面にしておく
    await configure({ unit: 'equation', difficulties: [1], count: 1 });
    await click('#start-btn');
    await answer(true);
    await click('[data-action="next"]');
    check(visible('summary'), '結果画面へ戻れない');
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

  await test('並べて表示：全部正しい答案の「（正しい計算過程は別の解き方の例です）」は、生徒の答案と正しい計算過程がちがう（別解の）ときだけ出す', async () => {
    w.__calcTeacher.setVariantRng(() => 0); // 正答版を出す
    await configure({ unit: 'equation', count: 'all' });
    await click('#start-btn');
    w.__calcTeacher.setVariantRng(null);
    const s = app().session;
    const seen = { same: 0, alt: [] };
    const noteText = async () => { await click('[data-action="compare-open"]'); const t = $('#compare-body .compare__note').textContent; await click('[data-action="compare-close"]'); return t; };
    while (!s.finished) {
      const q = s.current;
      const alt = JSON.stringify(q.answerLines) !== JSON.stringify(q.correctSolution);
      await answer(true);
      if (q.errorLine === null && (alt || seen.same < 2)) {
        const t = await noteText();
        check(t.includes('この答案は全部正しい答案です'), `${q.id}: ${t}`);
        check(t.includes('別の解き方の例です') === alt, `${q.id}（${alt ? '別解' : '模範解答と同じ'}）: ${t}`);
        if (alt) seen.alt.push(q.id); else seen.same++;
      }
      await click('[data-action="next"]');
    }
    check(seen.same === 2 && seen.alt.sort().join() === 'J1-EQ-0003,J1-EQ-0016', `確認した問題（同じ ${seen.same}・別解 ${seen.alt}）`);
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
    // 誤答版の答案で確認する（正答版の答案＝正しい計算過程は、採点後の表示で確認する）
    w.__calcTeacher.setVariantRng(() => 0.99);
    await configure({ unit: 'equation', count: 'all' });
    await click('#start-btn');
    w.__calcTeacher.setVariantRng(null);
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
    const report = { questions: 0, scrollable: 0, minRow: 999, added: 0, ids: new Set(), afterIds: new Set() };
    // 第7段階：誤答版を出題して確認する（追加した誤答の答案は、ここでしか画面に出ない。正答版の答案は、採点後の「正しい計算過程」と同じ）
    w.__calcTeacher.setVariantRng(() => 0.99);
    for (const unit of app().units.map((u) => u.unit)) {
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
        if (m.scrollable) report.ids.add(s.current.id);
        $$('.row--selectable').forEach((b) => { report.minRow = Math.min(report.minRow, b.getBoundingClientRect().height); });
        await answer(s.results.length % 3 !== 0);
        await d.fonts.ready;
        await sleep(150);
        const m3 = mathOverflowReport();
        check(m3.cut === 0, `${s.current.id}: 解説表示後に見切れている数式 ${m3.cut} ${m3.info}`);
        check(pageOverflow() <= 0, `${s.current.id}: 解説表示でページがはみ出す`);
        if (m3.scrollable > m.scrollable && !report.ids.has(s.current.id)) report.afterIds.add(s.current.id); // 採点後だけ（誤り行の印・正しい計算過程）
        report.questions++;
        if (s.current.variantId === 'wrong-1' && app().questions.find((x) => x.id === s.current.id).errorLine === null) report.added++;
        await click('[data-action="next"]');
      }
      await click('.summary-actions [data-action="go-settings"]');
    }
    w.__calcTeacher.setVariantRng(null);
    check(report.questions === app().questions.length, `確認した問題数 ${report.questions}`);
    check(report.added === 221, `確認した追加の誤答 ${report.added}`);
    check(report.minRow >= 48, `行の高さの最小 ${report.minRow}px`);
    results.push({ name: `  情報: 横スクロールになった数式 ${report.scrollable} 個（プレイ中の答案: ${[...report.ids].join(', ') || 'なし'}／採点後だけ: ${[...report.afterIds].join(', ') || 'なし'}） / 行の高さの最小 ${Math.round(report.minRow)}px`, ok: true });
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
  const TA_FEEDBACK = 600;

  await test('[TA] 公式：カウントダウン中は時間が減らず、行のタップ・全部正しいで即時判定。二重回答できず、90秒（＋ロスタイム）でタイムアップして記録される', async () => {
    await openGame(11);
    await click('[data-action="go-ta-menu"]');
    check(visible('ta-menu'), 'モード選択画面');
    await click('[data-action="ta-mode"][data-mode="official"]');
    check(visible('ta-settings') && inScreen('ta-settings', '#ta-custom-fields').hidden, '公式でカテゴリ・難易度が選べてしまう');
    check(!$('#ta-official-info').textContent.includes('ルール') && !$('#ta-official-info').textContent.includes('全カテゴリ・全難易度') && $('#ta-official-info').textContent.includes('この単元の記録はまだありません'), `公式の説明: ${$('#ta-official-info').textContent}`);
    // 単元はプルダウンではなく、8単元のカードから選ぶ。「出題できる問題：○問」のカードは出さない
    const unitCards = $$('#ta-unit-list .unit-card');
    check(!$('#ta-unit-select') && unitCards.length === app().units.length && unitCards.length === 8, `公式の単元カード ${unitCards.length}`);
    check(unitCards.every((c, i) => c.querySelector('.unit-card__name').textContent === `中${app().units[i].grade}・${app().units[i].label}` && c.querySelector('.unit-card__sub').textContent === '記録なし'), '単元カードの表示');
    check($('#ta-summary').hidden, '公式で「出題できる問題」のカードが出ている');
    await pickTAUnitCard('equation');
    const sel = $('#ta-unit-list .unit-card.is-selected');
    check(sel && sel.dataset.unit === 'equation' && sel.getAttribute('aria-checked') === 'true' && $$('#ta-unit-list .unit-card.is-selected').length === 1, '選んだカードが選択表示にならない');
    check($('#ta-summary').hidden && !$('#ta-start-btn').disabled, '公式で「出題できる問題」が出る・スタートできない');
    // 単元名は改行せず1行に収まり、見切れない（「中3・展開・因数分解」もスマホ縦で1行）
    $$('#ta-unit-list .unit-card__name').forEach((nm) => {
      const lh = parseFloat(w.getComputedStyle(nm).lineHeight);
      const card = nm.closest('.unit-card').getBoundingClientRect();
      const nr = nm.getBoundingClientRect();
      check(nr.height <= lh * 1.2 && nr.right <= card.right - 2, `単元名が1行に収まらない: ${nm.textContent}（高さ ${Math.round(nr.height)}・右端 ${Math.round(nr.right)} / カード ${Math.round(card.right)}）`);
    });
    $$('#ta-unit-list .unit-card').forEach((c) => { const r = c.getBoundingClientRect(); check(r.height >= 48 && r.right <= w.innerWidth, `単元カードの大きさ・はみ出し ${c.textContent}`); });
    check(pageOverflow() <= 0, '公式の設定画面が横にはみ出す');
    sndNow().debug.clearLog(); sndNow().debug.resetThrottle();
    await click('#ta-start-btn');
    check(visible('ta-play'), 'プレイ画面へ進まない');
    const s = ta().session;
    check(s.isOfficial && s.criteria.categories === null && s.criteria.difficulties.join() === '1,2,3,4', '公式の条件');
    check(!s.started && $('#ta-overlay-text').textContent === '3', 'カウントダウンが出ない');
    check(!$('#ta-overlay-note').hidden && $('#ta-overlay-note').textContent === 'タップした瞬間に判定！3回ミスでゲームオーバー！', 'カウントダウン中に説明が出ない');
    await sleep(1500);
    check(!s.started && s.remaining() === 90000 && $('#ta-timer-num').textContent === '90', 'カウントダウン中に時間が減った');
    await waitFor(() => s.started, 'START!', 5000);
    // 即時判定（「添削する！」はない）
    check(!inScreen('ta-play', '#submit-btn') && !inScreen('ta-play', '#hint-btn'), '添削ボタンやヒントがある');
    check(!inScreen('ta-play', '.paper__guide') && !$('#ta-body').textContent.includes('生徒の答案'), 'タイムアタックに「生徒の答案」の案内が出ている');
    check($('#ta-overlay').hidden || $('#ta-overlay-note').hidden, 'START! のあとも説明が残っている');
    const q1 = s.current;
    check($('#ta-body .paper__instruction .label-badge').textContent === '第1問', `タイムアタックのバッジ: ${$('#ta-body .paper__instruction .label-badge').textContent}`);
    const el = taCorrectEl();
    el.click();
    check(s.results.length === 1 && s.results[0].correct && s.score === w.TimeAttack.basePointsFor('equation') && s.score === 250, '即時判定されない（方程式の基礎点250点）');
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
    // 称号は「今回の結果」と「最高記録」の2つ（初めての記録では同じ称号）
    const nowT = $('#ta-result-body .ta-title--now');
    const bestT = $('#ta-result-body .ta-title--best');
    check(nowT && bestT && nowT.querySelector('.ta-title__label').textContent === '今回の結果' && bestT.querySelector('.ta-title__label').textContent === '最高記録', '称号の2行（今回の結果・最高記録）');
    check(nowT.querySelector('strong').textContent === w.TimeAttack.titleForScore(sum.score) && bestT.querySelector('strong').textContent === w.TimeAttack.titleForScore(sum.score), '称号の表示');
    check(/^(🔰|✏️|🔍|📘|⚡|🏅|💥|🎯|🌟|👑)/u.test(nowT.querySelector('strong').textContent), '称号にアイコンがない');
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
    // 第7段階：結果の解説は、実際に出題した答案パターン（正答版・誤答版）のもの
    const types = new Set();
    for (let i = 0; i < Math.min(12, s.results.length); i++) {
      const r = s.results[i];
      const v = w.QuestionVariants.variantsOf(app().questions.find((q) => q.id === r.question.id)).find((x) => x.id === r.question.variantId);
      check(v && JSON.stringify(v.answerLines) === JSON.stringify(r.question.answerLines), `${r.question.id}: 結果の答案が出題した答案パターンと違う`);
      types.add(v.type);
      await click(`#ta-result-body [data-action="ta-explain"][data-index="${i}"]`);
      const lines = $$('#explain-body .solution')[0].querySelectorAll('.solution__line');
      check(lines.length === v.answerLines.length, `${r.question.id}: 解説の答案の行数`);
      const head = $$('#explain-body .feedback__title')[1].textContent;
      check(v.errorLine === null ? head.includes('計算のポイント') && $('#explain-body').textContent.includes('全部正しい')
        : head.includes('まちがいの理由') && $('#explain-body .error-type').textContent === v.errorType
          && lines[v.errorLine].classList.contains('explain-line--error'), `${r.question.id}（${v.id}）: 解説が出題した答案と合っていない`);
      await click('[data-action="explain-close"]');
    }
    check(types.size === 2 || s.results.length < 6, `正答版・誤答版の両方の解説を確認できていない（${[...types]}）`);
    check(sameTalk(checkTalk('#ta-result-body', 'ta-best', '解説を閉じたあと'), taTalk), '解説を開閉したらセリフが変わった');
  });

  await test('[TA] 不正解で連続が切れ、得点は連続数で変わる。自己ベストを下回った回は更新しない（プレイ回数は増える）', async () => {
    const best = recs().officialFor('equation').bestScore;
    sndNow().debug.clearLog(); sndNow().debug.resetThrottle();
    await click('[data-action="ta-retry"]');
    const s = ta().session;
    // 4問だけ回答して、あとは時間切れ。残り0秒のあとのロスタイム（5秒）は、表示中の問題に回答でき、表示は「0」のまま
    let lossSeen = false;
    let lossSoundOk = true;
    await playTA((i) => {
      if (s.inLossTime()) {
        if (!lossSeen) {
          lossSeen = true;
          lossSoundOk = $('#ta-timer-num').textContent === '0' && !$$('#ta-body [data-action="ta-answer"]')[0].disabled;
          sndNow().debug.clearLog();
        }
      }
      return i < 4 ? [true, true, false, true][i] : null;
    });
    check(lossSeen && lossSoundOk, 'ロスタイム中に「0秒」のまま回答できる状態にならない');
    const lossSounds = sndNow().debug.log.filter((e) => e.played).map((e) => e.name);
    check(!lossSounds.includes('countdown') && !lossSounds.includes('warning'), `ロスタイム中にカウントダウンの音が鳴った: ${lossSounds}`);
    check(lossSounds.includes('timeup'), 'ロスタイムのあとにタイムアップにならない');
    check(s.results.map((r) => r.points).join() === '250,260,-100,250', `得点 ${s.results.map((r) => r.points)}`);
    check(s.summary().maxStreak === 2, '最大連続');
    checkTalk('#ta-result-body', 'ta-low', 'タイムアタック（1000点未満）');
    const rec = recs().officialFor('equation');
    check(rec.bestScore === best && rec.plays === 2, `自己ベストが変わった／回数 ${JSON.stringify(rec)}`);
    check($('#ta-result-body').textContent.includes(`自己ベスト：${best}点`) && !$('#ta-result-body').textContent.includes('自己ベスト更新'), '自己ベストの表示');
    // 自己ベストを下回った回：「今回の結果」は今回のスコアの称号、「最高記録」は自己ベストの称号（称号アップは出ない）
    const nowTitle = $('#ta-result-body .ta-title--now strong').textContent;
    const bestTitle = $('#ta-result-body .ta-title--best strong').textContent;
    check(nowTitle === w.TimeAttack.titleForScore(s.summary().score) && bestTitle === w.TimeAttack.titleForScore(best) && nowTitle !== bestTitle, `今回の結果と最高記録の称号: ${nowTitle} / ${bestTitle}`);
    check(!$('#ta-result-body .ta-title__up'), '下回った回に称号アップが出た');
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
    // 「称号アップ！」のバッジは途中で折り返さない（いちばん長い称号名でも、バッジは1行のまま）
    const longest = [...w.TimeAttack.TITLES].sort((a, b) => b.name.length - a.name.length)[0];
    const sample = d.createElement('div');
    sample.className = 'score-card';
    sample.innerHTML = `<div class="ta-titles"><p class="ta-title ta-title--best"><span class="ta-title__label">最高記録</span><strong>${longest.icon}${longest.name}</strong><span class="ta-title__up">称号アップ！</span></p></div>`;
    $('#ta-result-body').prepend(sample);
    const up = sample.querySelector('.ta-title__up');
    check(up.getClientRects().length === 1 && up.getBoundingClientRect().height < 30, `「称号アップ！」が2行に分かれた（${up.getClientRects().length}）`);
    const nameBox = sample.querySelector('strong').getBoundingClientRect();
    check(Math.abs(up.getBoundingClientRect().top + up.getBoundingClientRect().height / 2 - (nameBox.top + nameBox.height / 2)) < 8,
      '「最高記録 〇〇」と「称号アップ！」が同じ行にない');
    const lab = sample.querySelector('.ta-title__label').getBoundingClientRect();
    check(Math.abs(lab.top + lab.height / 2 - (nameBox.top + nameBox.height / 2)) < 8, '「最高記録」のラベルと称号が同じ行にない');
    check(pageOverflow() <= 0, '称号の行が横にはみ出す');
    sample.remove();
  });

  await test('[TA] カスタム：カテゴリ・難易度をしぼれる。公式記録は変わらず、履歴に残る。履歴から同じ条件で再挑戦できる', async () => {
    await click('[data-action="ta-back-settings"]');
    // 公式の設定画面：記録がある単元は「自己ベスト ○点」と「称号「…」」を2行で表示（ルールの文は出さない）
    const bestEl = $('#ta-official-info .official-info__best');
    const best = recs().officialFor(ta().unit).bestScore;
    check(best !== null && bestEl.querySelector('br') && bestEl.textContent === `自己ベスト ${best}点称号「${w.TimeAttack.titleForScore(best)}」` && !$('#ta-official-info').textContent.includes('ルール'), `自己ベストと称号: ${bestEl.innerHTML}`);
    await click('[data-action="go-ta-menu"]');
    await click('[data-action="ta-mode"][data-mode="custom"]');
    check(!inScreen('ta-settings', '#ta-custom-fields').hidden, 'カスタムでカテゴリ・難易度が出ない');
    await pickUnit('#ta-unit-select', 'positive-negative');
    check($$('#ta-category-list .cat-chip, #ta-difficulty-list .chip--star').every((b) => !/\d+問/.test(b.textContent)), 'カスタムのカテゴリ・難易度のボタンに問題数が残っている');
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
    // モード選択画面の「カスタムタイムアタックの履歴」から確認し、「同じ設定で再挑戦」できる
    await click('[data-action="go-ta-menu"]');
    const histBtn = $('[data-screen="ta-menu"] [data-action="go-ta-history"]');
    const customCard = $('[data-screen="ta-menu"] [data-mode="custom"]');
    check(histBtn && histBtn.textContent.includes('カスタムタイムアタックの履歴'), '履歴ボタンがない');
    check(histBtn.getBoundingClientRect().top >= customCard.getBoundingClientRect().bottom - 1
      && Math.abs(histBtn.getBoundingClientRect().left - customCard.getBoundingClientRect().left) <= 1, '履歴ボタンがカスタムのカードの下にない');
    await click('[data-action="go-ta-history"]');
    check(visible('ta-history') && $$('#ta-history-panel .history-item').length === 1, '履歴画面が出ない');
    const replay = $('#ta-history-panel [data-action="ta-replay"][data-index="0"]');
    check(replay && replay.textContent.includes('同じ設定で再挑戦'), '「同じ設定で再挑戦」ボタンがない');
    check(pageOverflow() <= 0, '履歴画面が横にはみ出す');
    await click('#ta-history-panel [data-action="ta-replay"][data-index="0"]');
    check(visible('ta-play') && !ta().session.isOfficial && ta().session.criteria.categories.join() === '累乗', '履歴画面から同じ設定で再挑戦できない');
    await waitFor(() => ta().session.started, 'START!', 5000);
    await click('[data-action="quit"]');
    await click('[data-action="quit-confirm"]');
    check(recs().customHistory().length === 1, '途中でやめた回が記録された（履歴画面から）');
    await click('[data-action="go-ta-menu"]');
    await click('[data-action="go-ta-history"]');
    await click('[data-screen="ta-history"] [data-action="go-ta-menu"]');
    check(visible('ta-menu'), '履歴画面から戻れない');
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
    const certCards = $$('#cert-unit-list .cert-unit');
    check(!$('#cert-unit-select') && certCards.length === app().units.length && certCards.length === 8, `単元のカードが8つ並ばない（${certCards.length}）`);
    check(certCards.every((c, i) => c.dataset.unit === app().units[i].unit && c.querySelector('.cert-unit__name').textContent === `中${app().units[i].grade}・${app().units[i].label}` && c.textContent.includes('ティーチャー見習い')), '単元カードの表示');
    check(pageOverflow() <= 0 && certCards.every((c) => c.getBoundingClientRect().right <= w.innerWidth), '認定試験の単元カードが横にはみ出す');
    await pickCertUnit('equation');
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
    const es = $('#hud-exam-score').textContent.replace(/\s+/g, '');
    check(app().mode === 'training' && !$('#hud-exam-score').hidden && es.includes('✔0/5') && !es.includes('/3'), `トレーニングで「✔0/5」が出ない: ${es}`);
    check($('#hud-count').hidden && $('#hud-score').hidden, 'トレーニングで「1/5」や「正解」の表示が残っている');
    check($('#play-body .paper__instruction .label-badge').textContent === '第1問', 'トレーニングのバッジが「第1問」でない');
  });

  await test('[記録] 3つのタブで公式記録・カスタム履歴・認定状況が見られ、再読み込みしても残っている', async () => {
    await openGame(2);
    check(recs().officialFor('equation').plays === 3 && recs().customHistory().length === 1 && recs().certFor('equation').highestCleared === 1, '再読み込みで記録が消えた');
    await click('[data-action="go-records"]');
    check($('#tab-official').getAttribute('aria-selected') === 'true', '最初のタブ');
    const official = $('#records-panel').textContent;
    check(official.includes(`${recs().officialFor('equation').bestScore}`) && official.includes('まだ記録がありません'), '公式記録の表示');
    check(!official.includes('達成日') && official.includes('最大連続') && official.includes('プレイ回数'), '公式記録に「達成日」が残っている');
    // ベストスコアは「最大連続」「プレイ回数」の左に、同じ文字の大きさで並ぶ
    const eqCard = $('#records-panel .record-card[data-unit="equation"]');
    const items = [...eqCard.querySelectorAll('.record-card__stats > div')];
    const labels = items.map((x) => x.querySelector('dt').textContent);
    check(labels.join() === 'ベストスコア,最大連続,プレイ回数' && items[0].querySelector('dd').textContent === `${recs().officialFor('equation').bestScore}点`, `記録カードの並び: ${labels}`);
    const fs0 = items.map((x) => w.getComputedStyle(x.querySelector('dd')).fontSize);
    check(new Set(fs0).size === 1, `文字の大きさがそろっていない: ${fs0}`);
    const rs = items.map((x) => x.getBoundingClientRect());
    check(Math.abs(rs[0].top - rs[1].top) < 2 && rs[0].right <= rs[1].left, 'ベストスコアが「最大連続」の左にない');
    check(!eqCard.querySelector('.record-card__score'), '大きなスコアの表示が残っている');
    await click('[data-action="records-tab"][data-tab="cert"]');
    const cert = $('#records-panel').textContent;
    check(cert.includes('新人ティーチャー') && cert.includes('第1試験') && cert.includes('ティーチャー見習い'), '認定の表示');
    check(!cert.includes('合格済み') && !cert.includes('回挑戦'), '認定に「合格済み：…」が残っている');
    await click('[data-action="records-tab"][data-tab="custom"]');
    check($$('#records-panel .history-item').length === 1, 'カスタム履歴の表示');
  });

  await test('[設定] タイトル：右上に「？ 遊び方」と「⚙ 設定」が横並び。「記録を見る」は上の3つと同じ大きさ。設定画面の下に「KEC数学科ラボへ」と「記録を消す」（確認してから消す）', async () => {
    await click('[data-action="go-title"]');
    const btnR = (a) => $(`[data-screen="title"] [data-action="${a}"]`).getBoundingClientRect();
    const how = btnR('go-howto');
    const opt = btnR('go-options');
    const howBtn = $('[data-screen="title"] [data-action="go-howto"]');
    // 「？ 遊び方」は小さいボタンで、「設定」の左に同じ高さで並ぶ
    check(howBtn.classList.contains('btn-icon') && howBtn.textContent.replace(/\s+/g, '') === '？遊び方', `遊び方のボタン: ${howBtn.textContent}`);
    check(Math.abs(how.top - opt.top) < 2 && how.right <= opt.left && opt.left - how.right < 16 && Math.abs(how.height - opt.height) < 2 && opt.right <= w.innerWidth, `「遊び方」が「設定」の左にない（遊び方 ${Math.round(how.left)}〜${Math.round(how.right)}／設定 ${Math.round(opt.left)}〜${Math.round(opt.right)}）`);
    check(!$('[data-screen="title"] .title-menu [data-action="go-howto"]'), 'メニューに「あそびかた」が残っている');
    // 「記録を見る」は「タイムアタック」「ティーチャー認定試験」と同じ幅・高さで、いちばん下
    const ta = btnR('go-ta-menu');
    const cert = btnR('go-cert-units');
    const rec = btnR('go-records');
    check(Math.abs(rec.width - ta.width) < 1 && Math.abs(rec.width - cert.width) < 1 && Math.abs(rec.height - cert.height) < 1 && Math.abs(rec.left - ta.left) < 1 && rec.top > cert.bottom, `「記録を見る」の大きさ・位置（記録 ${Math.round(rec.width)}×${Math.round(rec.height)}／認定 ${Math.round(cert.width)}×${Math.round(cert.height)}）`);
    // タイトルのボタンは縦を少し短め（トレーニング 56px・ほかは 50px）。押しやすさのため 48px 以上
    const hs = ['go-settings', 'go-ta-menu', 'go-cert-units', 'go-records'].map((x) => Math.round(btnR(x).height));
    check(hs[0] >= 52 && hs[0] <= 60 && hs.slice(1).every((h) => h >= 48 && h <= 54), `タイトルのボタンの高さ ${hs}`);
    check(pageOverflow() <= 0, 'タイトル画面が横にはみ出す');
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
    const storyW = () => w.__calcTeacher.storyStore;
    storyW().replaceTotalCorrect(260); // ストーリーの累積正解数（CT2 で引き継ぐ）
    const srcSnap = JSON.stringify(recs().snapshot());
    await click('[data-action="go-options"]');
    // ---- 設定画面：KEC数学科ラボ → 記録の引継ぎ → 記録を消す の順
    const lab = $('#lab-link').getBoundingClientRect();
    const card = inScreen('options', '.transfer-card');
    const reset = inScreen('options', '[data-action="reset-records"]').getBoundingClientRect();
    check(card && card.textContent.includes('記録の引継ぎ') && card.textContent.includes('別の端末でも、今までの記録を使えるようにできます。'), '記録の引継ぎの見出し・説明');
    check(card.textContent.includes('公式タイムアタック・ティーチャー認定試験の記録と、ストーリーの累積正解数を引き継ぎます。') && card.textContent.includes('カスタムタイムアタックの履歴は引き継ぎません。'), '補足説明');
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
    check(code.startsWith('CT2-') && code === RTw.createCode(recs().snapshot(), storyW().snapshot()), `コード: ${code}`);
    check(RTw.decode(code).data.story.totalCorrect === 260, 'コードに累積正解数が入っていない');
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
    storyW().replaceTotalCorrect(5); // 別の端末の累積正解数
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
    check((await tryCode(code.replace('CT2-', 'CT3-'))).includes('アプリを更新してから'), '非対応バージョンのメッセージ');
    const body = code.slice(4);
    const flipped = `CT2-${body.slice(0, 5)}${body[5] === 'A' ? 'B' : 'A'}${body.slice(6)}`;
    check((await tryCode(flipped)).includes('記録を読み込めませんでした'), '壊れたコードのメッセージ');
    check(!$('[data-step="input"]', ld).hidden && JSON.stringify(recs().snapshot()) === destBefore, '不正なコードで記録が変わった');
    // 空白・改行が混じったコードを貼り付けて確認する → まだ書き換えない
    await tryCode(`  ${code.replace(/(.{9})/g, '$1\n')}  `);
    check($('#transfer-input-error').textContent === '' && !$('[data-step="confirm"]', ld).hidden, '確認画面に進まない');
    const pv = $('#transfer-preview').textContent;
    check(pv.includes('方程式：最高2,450点（🎯赤ペンマスター）') && pv.includes('正負の数：最高1,860点'), `公式の確認: ${pv}`);
    check(pv.includes('文字式：第2試験までクリア（一人前ティーチャー）') && pv.includes('記録なし'), `認定の確認: ${pv}`);
    check(pv.includes('ストーリー') && $('#transfer-story').textContent === '累積正解数：260問（第7話まで読めます）', `ストーリーの確認: ${$('#transfer-story') && $('#transfer-story').textContent}`);
    check(!$('#transfer-warning').hidden && $('#transfer-warning').textContent.includes('ストーリーの累積正解数を、引継ぎコードの内容に置き換えます') && $('#transfer-warning').textContent.includes('カスタムタイムアタックの履歴・効果音の設定・ストーリーの既読と名前は変更されません'), '上書きの注意が出ない');
    check(storyW().totalCorrect === 5, '確認しただけで累積正解数が変わった');
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
    check(storyW().totalCorrect === 260 && storyW().unlockedCount() === 7, `累積正解数が引き継がれない（${storyW().totalCorrect}）`);
    check(RTw.createCode(recs().snapshot(), storyW().snapshot()) === code, '引き継いだ記録から同じコードにならない（正確に復元できていない）');
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
    check(storyW().totalCorrect === 260, '再読み込みで累積正解数が戻った');
    // ストーリー追加前のコード（CT1）も読める。累積正解数は入っていないので、この端末の正解数はそのまま
    await click('[data-action="go-options"]');
    await click('[data-action="transfer-load"]');
    $('#transfer-input').value = 'CT1-AQOTE_eV25jQAQsEAQcCAfaPjK8BA4HwslIBAwErVXW-';
    await click('[data-action="transfer-check"]');
    check($('#transfer-story').textContent.includes('このコードには入っていません'), `CT1 のコードのストーリーの表示: ${$('#transfer-story') && $('#transfer-story').textContent}`);
    await click('[data-action="transfer-apply"]');
    check(!$('[data-step="done"]', $('#transfer-load-dialog')).hidden && recs().certFor('square-roots').highestCleared === 2 && storyW().totalCorrect === 260, 'CT1 のコードの引継ぎ');
    await click('#transfer-load-dialog [data-step="done"] [data-action="transfer-close"]');
  });

  await test('[引継ぎ] 記録がないときもコードをつくれる（「まだ引き継ぐ記録がありません」）。記録のない端末では上書きの注意を出さない', async () => {
    recs().clearAll();
    w.__calcTeacher.storyStore.resetProgress(); // 累積正解数も0（記録のない端末）
    await click('[data-action="go-options"]');
    await click('[data-action="transfer-make"]');
    await click('[data-action="transfer-issue"]');
    const code = $('#transfer-code').value;
    check(code.startsWith('CT2-') && !$('#transfer-empty').hidden && $('#transfer-empty').textContent.includes('まだ引き継ぐ記録がありません'), '空の記録のコード');
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
      const optR = $('.title-actions').getBoundingClientRect();
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
        const or = $('.title-actions').getBoundingClientRect();
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
    await pickCertUnit('expressions');
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

  await test('[表示] 「← もどる」などの戻るボタンは、せまい画面（360px）でも改行しない。長い見出しも画面に収まる', async () => {
    const before = frame.style.width;
    frame.style.width = '360px';
    await sleep(100);
    try {
      await openGame(4);
      const backOk = (where) => {
        const b = $$('.btn--back').find((x) => x.offsetParent);
        check(b, `${where}: 戻るボタンがない`);
        const lh = parseFloat(w.getComputedStyle(b).lineHeight) || 24;
        const r = b.getBoundingClientRect();
        const text = b.textContent.trim();
        check(r.height <= Math.max(48, lh * 1.5 + 12) && b.scrollWidth <= b.clientWidth + 1, `${where}: 「${text}」が改行している（高さ ${Math.round(r.height)}）`);
        const h = b.closest('.screen-header').querySelector('.screen-title');
        if (h) check(h.getBoundingClientRect().right <= w.innerWidth + 1 && pageOverflow() <= 0, `${where}: 見出しが画面からはみ出す`);
      };
      const screens = [
        ['遊び方', async () => click('[data-action="go-howto"]')],
        ['設定', async () => click('[data-action="go-options"]')],
        ['トレーニング', async () => click('[data-action="go-settings"]')],
        ['タイムアタック', async () => click('[data-action="go-ta-menu"]')],
        ['公式タイムアタック', async () => { await click('[data-action="go-ta-menu"]'); await click('[data-action="ta-mode"][data-mode="official"]'); }],
        ['カスタムタイムアタック', async () => { await click('[data-action="go-ta-menu"]'); await click('[data-action="ta-mode"][data-mode="custom"]'); }],
        ['認定試験', async () => click('[data-action="go-cert-units"]')],
        ['認定試験の一覧', async () => { await click('[data-action="go-cert-units"]'); await pickCertUnit('expansion-factorization'); }],
        ['記録', async () => click('[data-action="go-records"]')],
      ];
      for (const [name, go] of screens) {
        if (!visible('title')) await click('[data-action="go-title"]');
        await go();
        await sleep(50);
        backOk(name);
      }
    } finally {
      frame.style.width = before;
      await sleep(100);
    }
    await openGame(4);
  });

  await test('[単元カード] 公式タイムアタックは自己ベスト3000点以上で金・2200点以上で銀・1500点以上で銅。認定試験は最終試験で金・第4試験で銀・第3試験で銅（金は光る）', async () => {
    await openGame(4);
    recs().clearAll();
    const titleFor = w.TimeAttack.titleForScore;
    const scores = { 'positive-negative': 3000, expressions: 2999, equation: 2200, polynomials: 2199, 'simultaneous-equations': 1500, 'expansion-factorization': 1499 };
    Object.entries(scores).forEach(([u, sc]) => recs().recordOfficial(u, { score: sc, maxStreak: 5 }, titleFor));
    const cleared = { 'positive-negative': 5, expressions: 4, equation: 3, polynomials: 2, 'square-roots': 1 };
    Object.entries(cleared).forEach(([u, h]) => { for (let id = 1; id <= h; id++) recs().recordExam(u, id, true); });
    // 公式タイムアタック
    await click('[data-action="go-ta-menu"]');
    await click('[data-action="ta-mode"][data-mode="official"]');
    const taTier = (u) => $(`#ta-unit-list .unit-card[data-unit="${u}"]`).dataset.tier || 'none';
    const expectTA = { 'positive-negative': 'gold', expressions: 'silver', equation: 'silver', polynomials: 'bronze', 'simultaneous-equations': 'bronze', 'expansion-factorization': 'none', 'square-roots': 'none', 'quadratic-equations': 'none' };
    Object.entries(expectTA).forEach(([u, t]) => check(taTier(u) === t, `公式タイムアタック ${u}（${scores[u] ?? '記録なし'}点）: ${taTier(u)}（期待 ${t}）`));
    const gold = $('#ta-unit-list .unit-card.tier-gold');
    const bg = w.getComputedStyle(gold).backgroundImage;
    check(/gradient/.test(bg) && w.getComputedStyle(gold, '::before').animationName === 'tier-shine', `金色のカードが光らない（${w.getComputedStyle(gold, '::before').animationName}）`);
    check(!/gradient/.test(w.getComputedStyle($('#ta-unit-list .unit-card[data-unit="square-roots"]')).backgroundImage), '記録のないカードに色がついた');
    // 選んでいる金のカードも、選択（✔・青い枠）がわかる
    await pickTAUnitCard('positive-negative');
    const sel = $('#ta-unit-list .unit-card.is-selected');
    check(sel.dataset.tier === 'gold' && w.getComputedStyle(sel, '::after').content.includes('✔'), '金のカードを選んだときの表示');
    check(pageOverflow() <= 0, '公式の設定画面が横にはみ出す');
    // 認定試験
    await click('[data-action="go-title"]');
    await click('[data-action="go-cert-units"]');
    const certTier = (u) => $(`#cert-unit-list .cert-unit[data-unit="${u}"]`).dataset.tier || 'none';
    const expectCert = { 'positive-negative': 'gold', expressions: 'silver', equation: 'bronze', polynomials: 'none', 'square-roots': 'none', 'quadratic-equations': 'none' };
    Object.entries(expectCert).forEach(([u, t]) => check(certTier(u) === t, `認定試験 ${u}（第${cleared[u] || 0}試験まで）: ${certTier(u)}（期待 ${t}）`));
    check(w.getComputedStyle($('#cert-unit-list .cert-unit.tier-gold'), '::before').animationName === 'tier-shine', '認定試験の金色のカードが光らない');
    check(pageOverflow() <= 0, '認定試験の画面が横にはみ出す');
    // 公式タイムアタックの結果画面：最高記録（自己ベスト）でスコアのカードが金・銀・銅になる（3回ミスですぐ終える）
    for (const [u, t] of [['positive-negative', 'gold'], ['expressions', 'silver'], ['square-roots', 'none']]) {
      await click('[data-action="go-title"]');
      await click('[data-action="go-ta-menu"]');
      await click('[data-action="ta-mode"][data-mode="official"]');
      await pickTAUnitCard(u);
      await click('#ta-start-btn');
      await playTA(() => false);
      const card = $('#ta-result-body .score-card');
      check((card.dataset.tier || 'none') === t, `結果画面 ${u}（自己ベスト ${recs().officialFor(u).bestScore}点）: ${card.dataset.tier || 'none'}（期待 ${t}）`);
      if (t === 'gold') check(w.getComputedStyle(card, '::before').animationName === 'tier-shine', '結果画面の金色のカードが光らない');
      check(pageOverflow() <= 0, '結果画面が横にはみ出す');
    }
    // 記録画面：公式タイムアタックのタブ（最高記録）と、ティーチャー認定のタブ（クリアした試験）のカードも金・銀・銅
    await click('[data-action="go-title"]');
    await click('[data-action="go-records"]');
    await click('[data-action="records-tab"][data-tab="official"]');
    const recTier = (u) => $(`#records-panel .record-card[data-unit="${u}"]`).dataset.tier || 'none';
    Object.entries(expectTA).forEach(([u, t]) => check(recTier(u) === t, `記録画面（公式） ${u}: ${recTier(u)}（期待 ${t}）`));
    check(w.getComputedStyle($('#records-panel .record-card.tier-gold'), '::before').animationName === 'tier-shine', '記録画面（公式）の金色のカードが光らない');
    check(!$('#records-panel').textContent.includes('達成日'), '達成日が残っている');
    await click('[data-action="records-tab"][data-tab="cert"]');
    Object.entries(expectCert).forEach(([u, t]) => check(recTier(u) === t, `記録画面（認定） ${u}: ${recTier(u)}（期待 ${t}）`));
    check(w.getComputedStyle($('#records-panel .record-card.tier-gold'), '::before').animationName === 'tier-shine', '記録画面（認定）の金色のカードが光らない');
    check(!$('#records-panel').textContent.includes('合格済み'), '「合格済み：…」が残っている');
    check(pageOverflow() <= 0, '記録画面が横にはみ出す');
    recs().clearAll();
    await click('[data-action="go-title"]');
  });

  // ================================================================ ストーリーモード
  const story = () => w.__calcTeacher.storyStore;
  const bgmNow = () => w.__calcTeacher.bgm;
  async function setStory(obj = {}) {
    localStorage.setItem('calcTeacher.story', JSON.stringify({ version: 1, totalCorrect: 0, readEpisodes: [], teacherName: '', boyName: 'ケイ', girlName: 'シホ', ...obj }));
    await openGame(7);
  }
  async function openStoryList() {
    if (!visible('records')) {
      if (!visible('title')) await click('[data-action="go-title"]');
      await click('[data-action="go-records"]');
    }
    await click('[data-action="story-go"]');
    await waitFor(() => visible('story-list') && $$('.story-card').length === 12, 'ストーリー一覧');
  }
  async function openEpisode(no) {
    await click(`[data-action="story-open"][data-no="${no}"]`);
    await waitFor(() => visible('story-read') && $$('#story-log > *').length > 0, `第${no}話を開く`);
  }
  const logItems = () => $$('#story-log .story-msg, #story-log .story-narration');
  const storyCard = (no) => $(`.story-card[data-no="${no}"]`);

  await test('[ストーリー 24] 累積正解数：トレーニング・1問の解き直し・認定試験・公式／カスタムのタイムアタックの正解だけ +1（不正解・選んだだけ・ヒント・解説・結果画面では増えない。途中でやめても採点済みの正解は残る）', async () => {
    await setStory({ totalCorrect: 0 });
    const recBefore = JSON.stringify(recs().snapshot());
    check(story().totalCorrect === 0, '最初は0');
    // トレーニング
    await configure({ unit: 'equation', difficulties: [1], count: 3 });
    await click('#start-btn');
    await click(rowBtn(1)); await click(rowBtn(1));
    await click('#hint-btn');
    check(story().totalCorrect === 0, '行を選ぶ・ヒントで増えた');
    await answer(true);
    check(story().totalCorrect === 1, `トレーニングの正解 ${story().totalCorrect}`);
    await click('[data-action="compare-open"]'); await click('[data-action="compare-close"]');
    await click('[data-action="next"]');
    await answer(false);
    check(story().totalCorrect === 1, '不正解で増えた');
    await click('[data-action="next"]');
    await answer(true);
    await click('[data-action="next"]');
    check(visible('summary') && story().totalCorrect === 2, `結果画面 ${story().totalCorrect}`);
    // 1問の解き直し（まちがえた2問目）
    await click('[data-action="review-question"][data-index="1"]');
    await answer(true);
    check(story().totalCorrect === 3, `解き直しの正解 ${story().totalCorrect}`);
    await click('[data-action="next"]');
    // 認定試験（不合格の試験でも、それまでの正解は数える）
    await click('[data-action="go-title"]');
    await click('[data-action="go-cert-units"]');
    await pickCertUnit('square-roots');
    await click(examCard(1).querySelector('[data-action="cert-start"]'));
    await answerExam(true); await click('[data-action="next"]');
    for (let i = 0; i < 3 && app().session; i++) { await answerExam(false); await click('[data-action="next"]'); }
    check(visible('cert-result') && story().totalCorrect === 4, `認定試験（不合格）の正解 ${story().totalCorrect}`);
    // 公式タイムアタック：2問正解・1問不正解でやめる（記録はしないが、採点済みの正解は残る）
    await click('[data-action="go-title"]');
    await click('[data-action="go-ta-menu"]');
    await click('[data-action="ta-mode"][data-mode="official"]');
    await pickTAUnitCard('polynomials');
    await click('#ta-start-btn');
    await waitFor(() => ta().session && ta().session.started, 'START!', 8000);
    for (const ok of [true, true, false]) { (ok ? taCorrectEl() : taWrongEl()).click(); await sleep(TA_FEEDBACK + 60); }
    check(!$('section[data-screen="ta-play"] .story-unlock'), 'タイムアタック中に知らせが出た');
    await click('[data-action="quit"]'); await click('[data-action="quit-confirm"]');
    check(story().totalCorrect === 6, `公式タイムアタックの正解 ${story().totalCorrect}`);
    // カスタムタイムアタック
    await click('[data-action="go-ta-menu"]');
    await click('[data-action="ta-mode"][data-mode="custom"]');
    await click('#ta-start-btn');
    await waitFor(() => ta().session && ta().session.started, 'START!', 8000);
    taCorrectEl().click(); await sleep(TA_FEEDBACK + 60);
    await click('[data-action="quit"]'); await click('[data-action="quit-confirm"]');
    check(story().totalCorrect === 7, `カスタムタイムアタックの正解 ${story().totalCorrect}`);
    // 再読み込み後も残る・ゲームの記録は途中でやめた回を記録していない
    await openGame(7);
    check(story().totalCorrect === 7, '再読み込みで消えた');
    const recAfter = recs().snapshot();
    check(JSON.stringify(recAfter.timeAttack.official) === JSON.stringify(JSON.parse(recBefore).timeAttack.official), '公式記録が変わった（途中でやめた回が記録された）');
    // ストーリーを読んでも増えない
    await openStoryList();
    await openEpisode(1);
    await click('#story-skip');
    check(story().totalCorrect === 7, 'ストーリーを読んで増えた');
    await click('#story-log [data-action="story-back"]');
  });

  await test('[ストーリー 22] 解放の知らせ：トレーニングは判定のあと、タイムアタック・認定試験は結果画面で出す（プレイ中には出さない）。ストーリーのボタンに NEW', async () => {
    await setStory({ totalCorrect: 19, readEpisodes: [1] });
    check($('#story-new-badge').hidden, '読める話を全部読んだのに NEW が出ている');
    await configure({ unit: 'equation', difficulties: [1], count: 2 });
    await click('#start-btn');
    await answer(true);
    const n1 = $('#feedback .story-unlock');
    check(n1 && n1.textContent.includes('📖 第2話『赤ペンの本当の役目』が解放されました！'), `トレーニングの知らせ: ${n1 && n1.textContent}`);
    await click('[data-action="next"]');
    check(!$('#feedback .story-unlock') || $('#feedback').hidden, '同じ知らせがくり返し出た');
    await click('[data-action="quit"]'); await click('[data-action="quit-confirm"]');
    check(!$('#story-new-badge').hidden, 'ストーリーのボタンに NEW が出ない');
    // タイムアタック：正解で解放 → プレイ中は出さず、ゲームオーバーの結果画面で出す
    await setStory({ totalCorrect: 49, readEpisodes: [1, 2] });
    await click('[data-action="go-ta-menu"]');
    await click('[data-action="ta-mode"][data-mode="custom"]');
    await click('#ta-start-btn');
    await waitFor(() => ta().session && ta().session.started, 'START!', 8000);
    taCorrectEl().click(); await sleep(TA_FEEDBACK + 60);
    check(story().totalCorrect === 50 && !$('section[data-screen="ta-play"] .story-unlock'), 'タイムアタック中に知らせが出た');
    for (let i = 0; i < 3; i++) { taWrongEl().click(); await sleep(TA_FEEDBACK + 60); }
    await waitFor(() => visible('ta-result'), '結果画面', 6000);
    check($('#ta-result-body .story-unlock') && $('#ta-result-body .story-unlock').textContent.includes('第3話『間違いノートの秘密』'), 'タイムアタックの結果画面で知らせない');
    // 認定試験：合否が決まった結果画面で出す
    await setStory({ totalCorrect: 99, readEpisodes: [1, 2, 3] });
    await click('[data-action="go-cert-units"]');
    await pickCertUnit('quadratic-equations');
    await click(examCard(1).querySelector('[data-action="cert-start"]'));
    await answerExam(true);
    check(!$('#feedback .story-unlock'), '認定試験の途中で知らせが出た');
    await click('[data-action="next"]');
    while (app().session) { await answerExam(true); await click('[data-action="next"]'); }
    check(visible('cert-result') && $('#cert-result-body .story-unlock').textContent.includes('第4話『夏の作戦会議』'), '認定試験の結果画面で知らせない');
  });

  await test('[ストーリー 8] 一覧：タイトル・累積正解数・次の話まで。全12話の月・話数・タイトル・解放条件と、NEW／既読／未解放（鍵・あと○問・開けない）', async () => {
    await setStory({ totalCorrect: 120, readEpisodes: [1, 2, 3] });
    // 「ストーリー」のボタンはタイトル画面にはなく、「記録を見る」画面にある（薄い桃色・サブタイトルなし）
    check(!inScreen('title', '[data-action="story-go"]'), 'タイトル画面にストーリーのボタンが残っている');
    await click('[data-action="go-records"]');
    const btn = inScreen('records', '[data-action="story-go"]');
    check(btn && btn.textContent.replace(/\s+/g, '') === '📖ストーリー' && btn.getAttribute('aria-label').includes('まだ読んでいない話'), `記録画面のボタン: ${btn && btn.textContent}`);
    const bg = w.getComputedStyle(btn).backgroundColor.match(/\d+/g).map(Number);
    check(w.matchMedia('(prefers-color-scheme: dark)').matches || (bg[0] >= 240 && bg[0] > bg[1] + 15 && bg[2] > bg[1]), `薄い桃色ではない: ${bg}`);
    check(!$('#story-new-badge').hidden, '記録画面のボタンの NEW');
    const br = btn.getBoundingClientRect();
    // 「ティーチャー認定」のタブと同じ行の右側に、1行で収まる
    const cr = $('#tab-cert').getBoundingClientRect();
    const lh = parseFloat(w.getComputedStyle(btn).lineHeight) || 30;
    check(Math.abs((br.top + br.bottom) / 2 - (cr.top + cr.bottom) / 2) < 4 && br.left >= cr.right, `「ティーチャー認定」の右にない（タブ ${Math.round(cr.right)},${Math.round(cr.top)}・ボタン ${Math.round(br.left)},${Math.round(br.top)}）`);
    check(br.height <= Math.max(cr.height, lh * 1.6) + 4 && br.height >= 44, `ボタンが1行に収まらない（高さ ${Math.round(br.height)}）`);
    check(br.right <= w.innerWidth && pageOverflow() <= 0, '記録画面のボタンがはみ出す');
    // 「NEW」はボタンの右上に小さく重なる。バッジがあってもなくても、ボタンの大きさは同じ
    const nb = $('#story-new-badge').getBoundingClientRect();
    check(nb.top < br.top && nb.right > br.right - 4 && nb.height < br.height / 2 && nb.right <= w.innerWidth, `NEW が右上に重なっていない（NEW ${Math.round(nb.left)},${Math.round(nb.top)}〜${Math.round(nb.right)}・ボタン ${Math.round(br.left)},${Math.round(br.top)}〜${Math.round(br.right)}）`);
    $('#story-new-badge').hidden = true;
    const br2 = btn.getBoundingClientRect();
    check(Math.abs(br2.width - br.width) < 0.5 && Math.abs(br2.height - br.height) < 0.5, `NEW の有無でボタンの大きさが変わる（${Math.round(br.width)}×${Math.round(br.height)} → ${Math.round(br2.width)}×${Math.round(br2.height)}）`);
    $('#story-new-badge').hidden = false;
    await openStoryList();
    const head = $('.story-head').textContent;
    check(head.includes('あの日の赤ペンが、未来を変えた。') && head.includes('ケイくん、シホさんと歩む1年間の物語'), 'タイトル');
    check(head.includes('累積正解数：120問') && head.includes('次の話まで：あと30問'), `進行状況: ${head}`);
    check(!head.includes('正解すると、正解数がふえて'), '説明の文が残っている');
    const SPEC = [['4月', 1, 'はじめまして、先生', 0], ['5月', 2, '赤ペンの本当の役目', 20], ['6月', 3, '間違いノートの秘密', 50], ['7月', 4, '夏の作戦会議', 100],
      ['8月', 5, 'あきらめない夏', 150], ['9月', 6, '小さな成長、大きな壁', 200], ['10月', 7, 'E判定からの挑戦', 250], ['11月', 8, 'もう一度、前を向いて', 300],
      ['12月', 9, 'リアル入試、開幕！', 350], ['1月', 10, '自分を信じる練習', 400], ['2月', 11, '最後の一問まで', 450], ['3月', 12, '桜の咲く教室で', 500]];
    $$('.story-card').forEach((c, i) => {
      const [m, no, title, need] = SPEC[i];
      check(c.dataset.no === String(no) && c.querySelector('.story-card__no').textContent === `${m}・第${no}話` && c.querySelector('.story-card__title').textContent === title, `第${no}話の表示`);
      check(!c.textContent.includes('解放条件') && !c.textContent.includes('最初から読めます'), `第${no}話に解放条件の文が残っている`);
      // バッジ（NEW・既読・あと○問）はタイトルの下（情報の中）にあり、カードの右側には置かない
      const badge = c.querySelector('.story-card__info > .story-badge');
      check(badge && badge.getBoundingClientRect().top >= c.querySelector('.story-card__title').getBoundingClientRect().bottom - 1, `第${no}話のバッジの位置`);
    });
    check(storyCard(1).querySelector('.story-badge--read') && storyCard(3).querySelector('.story-badge--read'), '既読');
    check(storyCard(4).querySelector('.story-badge--new') && !storyCard(4).disabled, '解放済み・未読は NEW');
    check(storyCard(5).disabled && storyCard(5).querySelector('.story-card__lock') && storyCard(5).textContent.includes('あと30問'), '未解放は鍵とあと○問');
    check(storyCard(12).textContent.includes('あと380問'), '第12話まであと380問');
    storyCard(5).click(); await sleep(60);
    check(visible('story-list'), '未解放の話が開いた');
    check(pageOverflow() <= 0, '一覧が横にはみ出す');
    // 一覧のサムネイル（背景画像）
    await waitFor(() => /classroom-spring\.webp/.test(storyCard(1).querySelector('.story-card__thumb').style.backgroundImage), 'サムネイル');
  });

  await test('[ストーリー 9・10・27] 会話：LINE 風（生徒は左・顔アイコンと名前、先生は右・アイコンなし・「先生」）。次へ・タップ・ログ・スキップ・戻る。最後まで読むと既読', async () => {
    await setStory({ totalCorrect: 25, readEpisodes: [] });
    await openStoryList();
    await openEpisode(1);
    check($('#story-read-no').textContent === '第1話・4月' && $('#story-read-heading').textContent === 'はじめまして、先生', 'ヘッダー');
    check(logItems().length === 1 && $('#story-log .story-narration').textContent.includes('4月'), '最初のセリフ');
    check(bgmNow().debug.desired === 'daily', `BGM ${bgmNow().debug.desired}`);
    check($('#story-stage').dataset.bg === 'classroom-spring', '背景');
    await waitFor(() => /classroom-spring\.webp/.test($('.story-bg.is-shown').style.backgroundImage), '背景画像');
    await click('#story-next');
    const t = $('#story-log .story-msg--teacher');
    check(t && t.classList.contains('story-msg--right') && !t.querySelector('.story-face') && t.querySelector('.story-msg__name').textContent === '先生', '先生の吹き出し');
    await click('#story-next');
    const k = $('#story-log .story-msg--kei');
    check(k && k.classList.contains('story-msg--left') && k.querySelector('.story-face').textContent === '👦' && k.querySelector('.story-msg__name').textContent === 'ケイ', 'ケイの吹き出し');
    check(k.querySelector('.story-bubble').textContent.includes('オレ、ケイです'), 'ケイの名前の差し込み');
    // 会話エリアをタップして進む
    $('#story-log').click(); await sleep(60);
    const s = $('#story-log .story-msg--shiho');
    check(s && s.querySelector('.story-face').textContent === '👧' && s.querySelector('.story-msg__name').textContent === 'シホ', 'シホの吹き出し（タップで進む）');
    check($$('#story-log .story-face').length === $$('#story-log .story-msg--kei, #story-log .story-msg--shiho').length, '顔アイコンの数');
    // 吹き出しと顔アイコンが重ならず、画面からはみ出さない
    [...$$('#story-log .story-msg--left')].forEach((m) => {
      const f = m.querySelector('.story-face').getBoundingClientRect();
      const b = m.querySelector('.story-bubble').getBoundingClientRect();
      check(f.right <= b.left + 1 && b.right <= w.innerWidth + 1, '吹き出しと顔アイコンが重なる・はみ出す');
    });
    for (let i = 0; i < 6; i++) await click('#story-next');
    const shown = app().screen === 'story-read' && w.__calcTeacher.story.state.shown;
    // 過去のセリフを読んでいるとき（いちばん下にいない）は、タップしても進まない
    const log = $('#story-log');
    await sleep(800);
    log.scrollTop = 0; log.dispatchEvent(new w.Event('scroll')); await sleep(60);
    if (log.scrollHeight > log.clientHeight + 40) {
      check(!$('#story-newer').hidden, '「新しいセリフへ」が出ない');
      log.click(); await sleep(60);
      check(w.__calcTeacher.story.state.shown === shown, '過去ログを読んでいるのに進んだ');
    }
    // ログを見る
    await click('[data-action="story-log-open"]');
    check($('#story-log-dialog').open && $$('#story-log-list li').length === w.__calcTeacher.story.state.shown, 'ログの数');
    await click('[data-action="story-log-close"]');
    // 戻る：一覧へ。BGM は止まり、途中なので未読のまま
    await click('.story-bar__back');
    check(visible('story-list') && bgmNow().debug.desired === null && !story().isRead(1), '戻る');
    check(storyCard(1).querySelector('.story-badge--new'), '途中でやめた話が既読になった');
    // スキップ：最後のセリフまで進み、既読になる。次の話へ進める
    await openEpisode(1);
    await click('#story-skip');
    check(w.__calcTeacher.story.state.ended && logItems().length === 20 && story().isRead(1), 'スキップで最後まで');
    check($('#story-next').hidden && $('.story-end').textContent.includes('第1話　おわり'), 'おわりの表示');
    await click('.story-end [data-action="story-open"][data-no="2"]');
    check($('#story-read-heading').textContent === '赤ペンの本当の役目', '次の話へ');
    for (let i = 0; i < 40 && !w.__calcTeacher.story.state.ended; i++) await click('#story-next');
    check(story().isRead(2) && $('.story-end').textContent.includes('あと25問'), `最後まで読むと既読・次の話まであと○問: ${$('.story-end').textContent}`);
    await click('.story-end [data-action="story-back"]');
    check(storyCard(2).querySelector('.story-badge--read'), '一覧に既読が出ない');
    // ブラウザの「戻る」でも一覧へ（BGM は止まる）
    await openEpisode(1);
    w.history.back();
    await waitFor(() => visible('story-list'), '戻る操作で一覧へ');
    check(bgmNow().debug.desired === null, '戻る操作で BGM が止まらない');
    await click('section[data-screen="story-list"] [data-action="go-records"]');
    check(visible('records') && $('#story-new-badge').hidden, '「← 記録」で記録画面に戻らない・全部読んだのに NEW が残る');
  });

  await test('[ストーリー 15・18・19] 第9話：合宿会場→試験室（静寂）→漢太鼓→合宿会場。第12話：エンディングのメッセージと THE END、一覧へ戻れる', async () => {
    await setStory({ totalCorrect: 500 });
    await openStoryList();
    check(!$$('.story-card').some((c) => c.disabled) && $('.story-head').textContent.includes('全12話が解放されています'), '500問で全話解放');
    await openEpisode(9);
    const seen = [];
    const note = () => { const x = `${$('#story-stage').dataset.bg}:${bgmNow().debug.desired}`; if (seen[seen.length - 1] !== x) seen.push(x); };
    note();
    while (!w.__calcTeacher.story.state.ended) { await click('#story-next'); note(); }
    check(seen.join(' > ') === 'winter-camp:friendship > exam-room:null > exam-room:exam > winter-camp:growth', `第9話の場面と BGM: ${seen.join(' > ')}`);
    check($('#story-log .story-narration--announce').textContent === '「それでは、試験を始めてください。」', '試験開始のアナウンス');
    check($$('#story-log .story-msg--thought').length === 4 && $$('#story-log .story-scene').length === 3, '心の声・場面の区切り');
    await click('.story-end [data-action="story-back"]');
    await openEpisode(12);
    check(bgmNow().debug.desired === 'congratulations', '第12話の BGM');
    await click('#story-skip');
    check(bgmNow().debug.desired === 'ending', 'エンディングの BGM');
    check(!$('#story-ending').hidden, 'エンディングが出ない');
    const end = $('#story-ending').textContent;
    check(end.includes('間違いは、できるようになるための第一歩。') && end.includes('あなたの赤ペンが、誰かの未来を変える。') && end.includes('― THE END ―'), `エンディングのメッセージ: ${end}`);
    check(story().isRead(12), '最終話が既読にならない');
    await sleep(300);
    check($('#story-stage').classList.contains('is-bright'), '背景が明るくならない');
    await click('#story-ending-close');
    check(visible('story-list') && bgmNow().debug.desired === null, 'エンディングから一覧へ');
  });

  await test('[ストーリー 26] 名前：先生は「○○先生」（重ねない）、生徒の名前は本文にも反映。HTML の文字はそのまま表示。長い名前でも崩れず、再読み込み後も残り、進行度は変わらない', async () => {
    await setStory({ totalCorrect: 60, readEpisodes: [1] });
    await openStoryList();
    await click('[data-action="story-names"]');
    check($('#story-names-dialog').open && $('#story-names-dialog').textContent.includes('入力した名前のうしろに『先生』がつきます。'), '名前のダイアログ');
    const typeName = async (sel, v) => { const input = $(sel); input.value = v; input.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(30); };
    await typeName('#story-name-teacher', '田中');
    check($('#story-name-preview').textContent.includes('田中先生'), 'プレビュー');
    await typeName('#story-name-teacher', '田中先生');
    check(story().displayNames().teacher === '田中先生', '先生が重なった');
    await typeName('#story-name-kei', '<b>ユウト</b>');
    await typeName('#story-name-shiho', 'ミサキさん');
    await click('[data-action="story-names-close"]');
    check($('.story-head__sub').textContent === '<b>ユウト</b>くん、ミサキさんと歩む1年間の物語', `一覧のサブタイトル: ${$('.story-head__sub').textContent}`);
    await openEpisode(1);
    await click('#story-next'); await click('#story-next'); await click('#story-next'); await click('#story-next');
    check($('#story-log .story-msg--teacher .story-msg__name').textContent === '田中先生', '先生の名前');
    check($('#story-log .story-msg--kei .story-msg__name').textContent === '<b>ユウト</b>' && !$('#story-log b'), 'HTML として解釈された');
    check($('#story-log .story-msg--kei .story-bubble').textContent.includes('オレ、<b>ユウト</b>です'), '本文の名前');
    check($$('#story-log .story-msg--kei .story-bubble')[1].textContent.includes('田中先生！'), '本文の先生の名前');
    await click('.story-bar__back');
    // 長い名前（10文字）
    await click('[data-action="story-names"]');
    await typeName('#story-name-teacher', 'たかおみたかおみたかおみ');
    await typeName('#story-name-kei', 'ジョナサンジョースター');
    check(story().names().teacher === 'たかおみたかおみたか' && $('#story-name-teacher').value.length <= 10, '10文字まで');
    await click('[data-action="story-names-close"]');
    await openEpisode(1);
    for (let i = 0; i < 8; i++) await click('#story-next');
    check(pageOverflow() <= 0 && $$('#story-log .story-msg').every((m) => m.getBoundingClientRect().right <= w.innerWidth + 1), '長い名前で横にはみ出す');
    const bar = $('.story-bar').getBoundingClientRect();
    check(bar.right <= w.innerWidth + 1 && $('.story-bar__bgm').getBoundingClientRect().right <= w.innerWidth + 1, '上のバーがはみ出す');
    await click('.story-bar__back');
    // 再読み込みしても残り、進行度は変わらない。空欄は初期名
    await openGame(7);
    check(story().displayNames().teacher === 'たかおみたかおみたか先生' && story().totalCorrect === 60 && story().isRead(1), '再読み込み後の名前・進行度');
    await openStoryList();
    await click('[data-action="story-names"]');
    await typeName('#story-name-teacher', '   ');
    await typeName('#story-name-kei', '');
    await click('[data-action="story-names-close"]');
    check(JSON.stringify(story().displayNames()) === JSON.stringify({ teacher: '先生', kei: 'ケイ', shiho: 'ミサキ' }), `空欄は初期名: ${JSON.stringify(story().displayNames())}`);
  });

  await test('[ストーリー 16・28] BGM：設定画面で ON/OFF・音量（効果音とは別に保存・再読み込み後も維持）。会話画面のボタンでも切りかえ。ほかの画面では流さない。音声がなくても進む', async () => {
    await setStory({ totalCorrect: 0 });
    localStorage.removeItem('calcTeacher.storySound');
    await openGame(7);
    await click('[data-action="go-options"]');
    check($('#bgm-switch').getAttribute('aria-checked') === 'true' && $('#bgm-volume-range').value === '25', 'BGM の初期設定（ON・25%）');
    check($('.bgm-credit').textContent.includes('BGMer') && $('.bgm-credit').textContent.includes('漢太鼓'), 'クレジット');
    const soundBefore = JSON.stringify(w.Sound.getSettings());
    await click('#bgm-switch');
    const r = $('#bgm-volume-range');
    await click('#bgm-switch');
    r.value = '60'; r.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(30);
    await click('#bgm-switch');
    check(JSON.stringify(JSON.parse(localStorage.getItem('calcTeacher.storySound'))) === JSON.stringify({ enabled: false, volume: 60 }), 'BGM の設定が保存されない');
    check(JSON.stringify(w.Sound.getSettings()) === soundBefore, '効果音の設定が変わった');
    await openGame(7);
    check(bgmNow().getSettings().enabled === false && bgmNow().getSettings().volume === 60, '再読み込みで BGM の設定が戻った');
    // OFF のときは鳴らさず、会話画面のボタンで ON にすると今の場面の曲が鳴る
    await openStoryList();
    await openEpisode(1);
    check(bgmNow().debug.playing === null && $('#story-bgm-toggle').textContent.includes('OFF'), 'OFF なのに鳴った');
    await click('#story-bgm-toggle');
    check(bgmNow().debug.playing === 'daily' && $('#story-bgm-toggle').textContent.includes('ON'), 'ON にしても鳴らない');
    await sleep(300);
    const v = bgmNow().debug.voices.find((x) => x.track === 'daily');
    check(v && /assets\/story\/bgm\/daily\.mp3$/.test(v.src), `音声ファイル ${v && v.src}`);
    await click('.story-bar__back');
    check(bgmNow().debug.playing === null && bgmNow().debug.desired === null, '一覧に戻っても鳴っている');
    // ほかのモードでは流さない
    await click('[data-action="go-title"]');
    await click('[data-action="go-settings"]');
    check(bgmNow().debug.playing === null, 'トレーニングで BGM が流れた');
    // 音声ファイルがないときも、ストーリーは止まらない
    await openStoryList();
    w.__calcTeacher.storyData.index.bgm.tracks.daily.file = 'not-found.mp3';
    await openEpisode(1);
    await click('#story-next'); await click('#story-next');
    check(logItems().length === 3, '音声ファイルがないと進まない');
    await waitFor(() => bgmNow().debug.lastError === 'load-failed' || bgmNow().debug.lastError === 'play-failed', '再生の失敗を記録する', 5000);
    await click('.story-bar__back');
  });

  await test('[ストーリー F] 記録：ゲームの「記録を消す」ではストーリーは消えない。ストーリーのリセットは確認してから、名前を残して正解数と既読だけ0に', async () => {
    await setStory({ totalCorrect: 80, readEpisodes: [1, 2], teacherName: '田中' });
    await click('[data-action="go-options"]');
    await click('[data-action="reset-records"]');
    check($('#reset-dialog').textContent.includes('ストーリーの記録は消えません'), '記録を消すの説明');
    await click('[data-action="reset-confirm"]');
    check(story().totalCorrect === 80 && story().isRead(2), 'ゲームの記録を消したらストーリーも消えた');
    await click('[data-action="go-title"]');
    await openStoryList();
    await click('[data-action="story-reset"]');
    check($('#story-reset-dialog').open, '確認ダイアログが出ない');
    await click('[data-action="story-reset-cancel"]');
    check(story().totalCorrect === 80, 'いいえで消えた');
    await click('[data-action="story-reset"]');
    await click('[data-action="story-reset-confirm"]');
    check(story().totalCorrect === 0 && !story().isRead(1) && story().names().teacher === '田中', 'リセットの内容');
    check($('.story-head').textContent.includes('累積正解数：0問') && storyCard(2).disabled, '一覧に反映されない');
    // 裏ワザ：物語のタイトルを4秒以内に7回タップすると全話解放（6回では何も起きない。正解数は変えない）
    const tapTitle = async (n) => { for (let i = 0; i < n; i++) { $('.story-head__title').click(); await sleep(60); } };
    await tapTitle(6);
    check(storyCard(12).disabled && !$('.story-head').textContent.includes('解放されました'), '6回で解放された・途中で何か表示された');
    await sleep(4200);
    await tapTitle(6);
    check(storyCard(12).disabled, '時間をあけたタップも数えている');
    await tapTitle(1);
    check(!$$('.story-card').some((c) => c.disabled) && $('.story-head').textContent.includes('全12話が解放されました') && story().totalCorrect === 0, '7回で全話解放されない');
    await openGame(7);
    check(story().unlockedCount() === 12 && story().totalCorrect === 0, '再読み込みで裏ワザの解放が消えた');
    await openStoryList();
    await click('[data-action="story-reset"]');
    await click('[data-action="story-reset-confirm"]');
    check(story().unlockedCount() === 1 && storyCard(12).disabled, 'リセットで裏ワザの解放が戻らない');
  });

  await test('[20] 開発者用プレビュー（preview.html）が従来どおり動く', async () => {
    await load('../../preview.html?reveal=1#J1-EQ-0010');
    check(!w.Sound, 'プレビューに効果音が読み込まれている');
    await waitFor(() => d.querySelectorAll('#question-index .chip').length === DATA.total, 'プレビューの読み込み');
    check(d.querySelector('.meta-id').textContent === 'J1-EQ-0010', 'URL ハッシュでの問題指定');
    check(d.querySelector('.answer-line--error'), '誤り行のハイライト');
    await waitFor(() => /レビュー済/.test(d.querySelector('#review-status').textContent), '手動レビュー状況');
    check(d.querySelector('.dev-note--ok').textContent.includes('データと一致'), '数学的検証の結果');
    // 第7段階：答案パターン（誤答・正答）をボタンで切り替えて確認できる（乱数は使わない）
    const vbtn = (id) => d.querySelector(`[data-variant="${id}"]`);
    check(vbtn('wrong-1') && vbtn('correct-1') && vbtn('wrong-1').getAttribute('aria-pressed') === 'true', '答案パターンの切替ボタン');
    check(/wrong-1.*誤答.*出題確率 75%/.test(d.querySelector('.variant-info').textContent), `誤答パターンの情報: ${d.querySelector('.variant-info').textContent}`);
    vbtn('correct-1').click();
    await sleep(50);
    check(/correct-1.*正答.*出題確率 25%/.test(d.querySelector('.variant-info').textContent), '正答パターンの情報');
    check(!d.querySelector('.answer-line--error') && d.querySelector('.verdict--correct'), '正答パターンで誤り行が出ている');
    check(d.querySelector('.dev-note--ok').textContent.includes('データと一致'), '正答パターンの数学的検証');
    check(d.querySelector('.explanation').textContent.includes('すべての行が正しい計算です'), '正答パターンの解説');
    await waitFor(() => /AI による確認/.test(d.querySelector('#review-status').textContent), 'レビュー状況（AI と数学講師の区別）');
    vbtn('wrong-1').click();
    await sleep(50);
    check(d.querySelector('.answer-line--error'), '誤答パターンに戻らない');
    w.location.hash = '#J1-EQ-0003'; // 別解の正答問題は切り替えない
    await sleep(80);
    check(d.querySelector('.meta-id').textContent === 'J1-EQ-0003' && !vbtn('wrong-1') && /別解の正答/.test(d.querySelector('.variant-info').textContent), '別解の正答問題の表示');
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
