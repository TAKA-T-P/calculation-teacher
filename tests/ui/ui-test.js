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
  async function configure({ unit, difficulties, count }) {
    if (!visible('settings')) await click('[data-action="go-settings"]');
    await click(`[data-action="select-unit"][data-unit="${unit}"]`);
    await click('[data-action="toggle-difficulty"][data-difficulty="auto"]');
    if (difficulties) {
      // おまかせ → 1つ目を押すとその難易度だけになり、2つ目以降は追加
      for (const dd of difficulties) await click(`[data-action="toggle-difficulty"][data-difficulty="${dd}"]`);
    }
    await click(`[data-action="select-count"][data-count="${count}"]`);
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
    const cut = els.filter((el) => el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('is-scrollable'));
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
      settings: async () => { await click('[data-action="go-settings"]'); await click('[data-action="toggle-difficulty"][data-difficulty="2"]'); await click('[data-action="toggle-difficulty"][data-difficulty="3"]'); },
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
      dialog: async () => { await configure({ unit: 'equation', count: 5 }); await click('#start-btn'); await click('[data-action="quit"]'); },
    }[SHOT];
    await goto();
    await sleep(600); // アニメーション終了待ち
    if (!SHOT.startsWith('play-correct') && !SHOT.startsWith('play-wrong') && !SHOT.startsWith('play-allcorrect') && !SHOT.startsWith('long-math')) w.scrollTo(0, 0);
    out.textContent = 'shot ready';
    return;
  }

  // ================================================================== テスト本体
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

  await test('[3] 難易度を複数選択でき、「おまかせ」で全難易度になる', async () => {
    await click('[data-difficulty="2"]'); // おまかせ → ★★だけ
    const pressed = () => $$('[data-action="toggle-difficulty"]').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.difficulty);
    check(pressed().join() === '2', `★★だけ: ${pressed()}`);
    await click('[data-difficulty="3"]');
    check(pressed().join() === '2,3', `★★と★★★: ${pressed()}`);
    check($('#setting-summary').textContent.includes('7問'), `★★+★★★ の問題数: ${$('#setting-summary').textContent}`);
    await click('[data-difficulty="2"]');
    await click('[data-difficulty="3"]');
    check(pressed().length === 0 && $('#start-btn').disabled, '難易度0個で開始できてしまう');
    check($('#setting-summary').textContent.includes('1つ以上'), '難易度未選択のメッセージ');
    await click('[data-difficulty="auto"]');
    check(pressed().join() === 'auto,1,2,3,4', `おまかせ: ${pressed()}`);
  });

  await test('[3] 単元にない難易度は選択できない（無効表示）', async () => {
    // 現行データでは全単元に★〜★★★★がある。単元ごとの件数に応じて disabled が付くことを確かめる
    const counts = w.Game.countByDifficulty(app().questions, app().config.unit);
    [1, 2, 3, 4].forEach((n) => check($(`[data-difficulty="${n}"]`).disabled === (counts[n] === 0), `★${n}`));
  });

  await test('[4] 問題数は5問・10問・すべてから選べ、初期値は5問', async () => {
    const checked = () => $$('[data-action="select-count"]').find((b) => b.getAttribute('aria-checked') === 'true').dataset.count;
    check($$('[data-action="select-count"]').map((b) => b.dataset.count).join() === '5,10,all', '選択肢');
    check(checked() === '5', `初期値 ${checked()}`);
    await click('[data-count="10"]');
    check(checked() === '10', '10問');
    check($('#setting-summary').textContent.includes('今回は 10問'), $('#setting-summary').textContent);
    await click('[data-count="all"]');
    check(checked() === 'all', 'すべて');
    await click('[data-count="5"]');
  });

  await test('[5] 条件に合う問題が少ないときは利用可能数を表示し、その数だけ出題する', async () => {
    await configure({ unit: 'equation', difficulties: [4], count: 10 });
    check($('#setting-summary').textContent.includes('1問すべて'), $('#setting-summary').textContent);
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
    $('#submit-btn').click();
    await sleep(50);
    check(s.results.length === 1 && s.correctCount === 1, '二重に採点された');
  });

  await test('[11] 間違った行を選ぶと「おしい！」。キミの答えと最初の誤り行が文字でも示される', async () => {
    await click('[data-action="next"]');
    const s = app().session;
    // 誤りのある問題が出るまで進める（正しい答案なら正解して次へ）
    while (s.current.errorLine === null) { await answer(true); await click('[data-action="next"]'); }
    const q = s.current;
    await answer(false);
    check($('.verdict--ng') && $('.verdict__title').textContent === 'おしい！', 'おしいの表示');
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
    check($('.score-card__main').textContent.includes(`5問中${sum.correct}問正解！`), $('.score-card__main').textContent);
    check($('.score-card__rate').textContent.includes(`${rate}`), '正解率');
    check(sum.rate === rate, '正解率の計算');
    check($$('.review-item').length === 5, '問題ごとの結果');
    check($('.score-card__comment').textContent.length > 5, '評価コメント');
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

  await test('[20] 開発者用プレビュー（preview.html）が従来どおり動く', async () => {
    await load('../../preview.html?reveal=1#J1-EQ-0010');
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
