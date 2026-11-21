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
      'summary-retried': async () => { await configure({ unit: 'expressions', count: 5 }); await click('#start-btn');
        for (const ok of [true, false, true, true, true]) { await answer(ok); await click('[data-action="next"]'); }
        await click('[data-action="review-question"][data-index="1"]'); await answer(true); await click('[data-action="next"]'); },
      compare: async () => { await configure({ unit: 'equation', difficulties: [4], count: 5 }); await click('#start-btn'); await answer(false); await click('[data-action="compare-open"]'); },
      'compare-pn': async () => { await configure({ unit: 'positive-negative', difficulties: [3], count: 5 }); await click('#start-btn'); await answer(false); await click('[data-action="compare-open"]'); },
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
          check(stu[q.errorLine].classList.contains('cmp-cell--error') && stu[q.errorLine].textContent.includes('最初のミス'), `${q.id}: 誤り行の印`);
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
