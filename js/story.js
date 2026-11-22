/*
 * story.js
 * ストーリーモードの進行と表示（全12話「あの日の赤ペンが、未来を変えた。」）。
 *
 * - StoryReader：1話分のセリフを順に進める（次へ・スキップ・最後まで読んだか）。DOM にふれない（Node.js でテストできる）。
 * - createStoryController：ストーリー一覧・会話画面（LINE 風）・エンディング・名前の設定・ログを表示する（ブラウザ用）。
 *   画面の切りかえ（show）と効果音（sfx）は app.js から受け取る。ゲームの記録・採点には一切ふれない。
 *
 * 文字の表示はすべて textContent（名前やセリフを HTML として解釈しない）。
 */
(function (root, factory) {
  const lib = factory(root.StoryData || (typeof require === 'function' ? require('./story-data.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.Story = lib;
})(typeof self !== 'undefined' ? self : this, function (SD) {
  'use strict';

  // ============================================================ 進行（DOM なし）
  class StoryReader {
    constructor(episode) {
      this.episode = episode;
      this.items = SD.flatten(episode);
      this.pos = -1;
    }
    get total() { return this.items.length; }
    get shown() { return this.pos + 1; }
    get finished() { return this.pos >= this.items.length - 1; }
    get current() { return this.pos >= 0 ? this.items[this.pos] : null; }
    /** 次のセリフ。シーンが変わったら sceneChanged が true。最後まで読んだら null */
    next() {
      if (this.finished) return null;
      this.pos += 1;
      const item = this.items[this.pos];
      const prev = this.items[this.pos - 1];
      return { ...item, sceneChanged: !prev || prev.sceneIndex !== item.sceneIndex, last: this.finished };
    }
    /** 最後のセリフまで進める（まだ表示していないセリフを順に返す） */
    skip() {
      const out = [];
      let r;
      while ((r = this.next())) out.push(r);
      return out;
    }
  }

  const MONTH_LABEL = (m) => `${m}月`;

  // ============================================================ 画面（ブラウザ）
  /**
   * @param {{data, store, bgm, show:(name:string, mode?:string)=>void, sfx?:(name:string)=>void, doc?: Document, reducedMotion?: ()=>boolean}} deps
   */
  function createStoryController(deps) {
    const { data, store, bgm } = deps;
    const show = deps.show;
    const sfx = deps.sfx || (() => {});
    const doc = deps.doc || document;
    const reducedMotion = deps.reducedMotion || (() => false);
    const $ = (sel) => doc.querySelector(sel);
    const el = (tag, cls, text) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };

    const state = { reader: null, no: null, scene: -1, bgLayer: 0, ended: false, loadError: null, bgCache: {}, autoScrollUntil: 0, scrollTimer: null };

    const names = () => store.displayNames();
    const fill = (t) => SD.fillText(t, names());

    // ---------------------------------------------------------- 「記録を見る」画面の「📖 ストーリー」の NEW
    function renderTitleBadge() {
      const badge = $('#story-new-badge');
      if (!badge) return;
      const n = store.unreadUnlocked().length;
      badge.hidden = n === 0;
      const btn = badge.closest('button');
      if (btn) btn.setAttribute('aria-label', `ストーリー${n ? `（まだ読んでいない話が${n}話あります）` : ''}`);
    }

    // ---------------------------------------------------------- 背景
    function bgFor(id) {
      const b = data.index && data.index.backgrounds[id];
      return b || { fallback: 'linear-gradient(#fdf6e9, #efe3cf)' };
    }

    /** 背景画像を読み込んで、表示に使う CSS の値を返す（画像がなければ単色・グラデーション） */
    function resolveBackground(id, thumb = false) {
      const key = `${id}${thumb ? ':thumb' : ''}`;
      if (state.bgCache[key]) return state.bgCache[key];
      const b = bgFor(id);
      const tryImage = (url) => new Promise((resolve) => {
        if (!url || typeof Image === 'undefined') { resolve(false); return; }
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
      });
      const p = (async () => {
        const own = data.backgroundUrl(id, thumb);
        if (await tryImage(own)) return { image: own, overlay: null, fallback: b.fallback };
        // その場面の画像がまだないとき：近い場面の画像に演出（雨など）を重ねる。それもなければグラデーション
        if (b.baseImage) {
          const base = data.backgroundUrl(b.baseImage, thumb);
          if (await tryImage(base)) return { image: base, overlay: b.overlay || null, fallback: b.fallback };
        }
        return { image: null, overlay: b.overlay || null, fallback: b.fallback };
      })();
      state.bgCache[key] = p;
      return p;
    }

    function paintLayer(layer, res, tint) {
      layer.style.backgroundImage = res.image ? `url("${res.image}"), ${res.fallback}` : res.fallback;
      layer.classList.toggle('story-bg--rain', res.overlay === 'rain');
      layer.classList.toggle('story-bg--night', tint === 'night');
      layer.dataset.image = res.image || '';
    }

    /** 背景を切りかえる。新しい層にまずグラデーションを塗り、画像が読めたら重ね、短いフェードで入れかえる */
    function setBackground(id, tint) {
      const layers = [$('#story-bg-0'), $('#story-bg-1')];
      const next = layers[1 - state.bgLayer];
      const cur = layers[state.bgLayer];
      const b = bgFor(id);
      next.dataset.bg = id;
      paintLayer(next, { image: null, overlay: b.baseImage ? b.overlay : null, fallback: b.fallback }, tint);
      next.classList.add('is-shown');
      cur.classList.remove('is-shown');
      state.bgLayer = 1 - state.bgLayer;
      $('#story-stage').dataset.bg = id;
      resolveBackground(id).then((res) => { if (next.dataset.bg === id) paintLayer(next, res, tint); });
    }

    /** BGM の曲（ファイルの場所とループの位置）を BGM プレーヤーに知らせる */
    function syncTracks() {
      const tracks = {};
      Object.entries(data.index.bgm.tracks).forEach(([id, t]) => {
        tracks[id] = { url: data.bgmUrl(id), loopStart: t.loopStart || 0, loopEnd: t.loopEnd || null };
      });
      bgm.setTracks(tracks);
    }

    // ---------------------------------------------------------- 一覧
    async function openList(historyMode = 'push') {
      const body = $('#story-list-body');
      show('story-list', historyMode);
      if (!data.index) body.replaceChildren(el('p', 'story-loading', 'ストーリーを読み込んでいます…'));
      try {
        await data.loadAll();
        syncTracks();
        state.loadError = null;
      } catch (e) {
        state.loadError = e;
        body.replaceChildren(el('p', 'story-error', 'ストーリーを読み込めませんでした。通信状態を確かめて、もう一度開いてください。'));
        return;
      }
      renderList();
    }

    function renderList() {
      const idx = data.index;
      const body = $('#story-list-body');
      if (!idx) return;
      const frag = doc.createDocumentFragment();
      const head = el('div', 'story-head');
      // 物語のタイトルは、裏ワザ（4秒以内に7回タップで全話解放）の場所。見た目は変えない
      const titleEl = el('p', 'story-head__title', idx.title);
      titleEl.dataset.action = 'story-secret';
      head.append(titleEl);
      head.append(el('p', 'story-head__sub', fill(idx.subtitle)));
      const prog = el('div', 'story-progress');
      const total = el('p', 'story-progress__total');
      total.append('累積正解数：', el('strong', null, `${store.totalCorrect}問`));
      prog.append(total);
      const nu = store.nextUnlock();
      const nextText = nu ? `次の話まで：あと${nu.remaining}問` : `全${idx.episodes.length}話が解放されています！`;
      prog.append(el('p', `story-progress__next${nu ? '' : ' is-complete'}`, nextText));
      head.append(prog);
      const tools = el('div', 'story-tools');
      const nameBtn = el('button', 'btn btn--secondary', '✏️ 名前を変える');
      nameBtn.type = 'button';
      nameBtn.dataset.action = 'story-names';
      tools.append(nameBtn);
      head.append(tools);
      frag.append(head);

      const list = el('ol', 'story-list');
      list.setAttribute('aria-label', '全12話');
      idx.episodes.forEach((ep) => {
        const unlocked = store.isUnlocked(ep.no);
        const read = store.isRead(ep.no);
        const li = el('li');
        const card = el('button', `story-card${unlocked ? '' : ' is-locked'}${read ? ' is-read' : ''}`);
        card.type = 'button';
        card.dataset.action = 'story-open';
        card.dataset.no = String(ep.no);
        if (!unlocked) { card.disabled = true; card.setAttribute('aria-disabled', 'true'); }
        const thumb = el('span', 'story-card__thumb');
        thumb.setAttribute('aria-hidden', 'true');
        thumb.style.backgroundImage = bgFor(ep.thumb).fallback;
        if (unlocked) {
          resolveBackground(ep.thumb, true).then((res) => {
            thumb.style.backgroundImage = res.image ? `url("${res.image}"), ${res.fallback}` : res.fallback;
            thumb.classList.toggle('story-bg--rain', res.overlay === 'rain');
          });
        } else {
          thumb.append(el('span', 'story-card__lock', '🔒'));
        }
        const info = el('span', 'story-card__info');
        info.append(el('span', 'story-card__no', `${MONTH_LABEL(ep.month)}・第${ep.no}話`));
        info.append(el('span', 'story-card__title', unlocked ? ep.title : ep.title));
        const badge = unlocked
          ? (read ? el('span', 'story-badge story-badge--read', '既読') : el('span', 'story-badge story-badge--new', 'NEW'))
          : el('span', 'story-badge story-badge--lock', `あと${store.remainingFor(ep.no)}問`);
        info.append(badge); // バッジ（NEW・既読・あと○問）はタイトルの下
        card.append(thumb, info);
        const status = unlocked ? (read ? '既読' : '未読（NEW）') : `未解放（あと${store.remainingFor(ep.no)}問）`;
        card.setAttribute('aria-label', `${MONTH_LABEL(ep.month)}・第${ep.no}話「${ep.title}」${status}`);
        li.append(card);
        list.append(li);
      });
      frag.append(list);

      const foot = el('div', 'story-foot');
      const credit = el('p', 'story-credit');
      credit.append('音楽：');
      const a = el('a', null, 'BGMer');
      a.href = idx.bgm.credit.url;
      a.target = '_blank';
      a.rel = 'noopener';
      credit.append(a, '（曲名は設定画面の「ストーリーBGM」に記載）');
      const reset = el('button', 'btn btn--danger-outline', '🗑 ストーリーの記録をリセット');
      reset.type = 'button';
      reset.dataset.action = 'story-reset';
      foot.append(credit, reset);
      frag.append(foot);
      body.replaceChildren(frag);
    }

    // ---------------------------------------------------------- 会話画面
    /** 話を最初から開く。クリックの中で呼ぶ（BGM を操作の中で始めるため、データは読み込み済みであること） */
    function openEpisode(no) {
      const ep = data.episode(no);
      if (!ep || !store.isUnlocked(no)) return false;
      state.reader = new StoryReader(ep);
      state.no = no;
      state.scene = -1;
      state.ended = false;
      const meta = data.index.episodes.find((e) => e.no === no);
      $('#story-read-no').textContent = `第${no}話・${MONTH_LABEL(meta.month)}`;
      $('#story-read-heading').textContent = ep.title;
      $('#story-log').replaceChildren();
      $('#story-ending').hidden = true;
      $('#story-ending').classList.remove('is-playing');
      $('#story-stage').classList.remove('is-bright');
      $('section[data-screen="story-read"]').classList.remove('is-ending');
      setControls('reading');
      renderBgmButton();
      // 背景画像を先に読み込んでおく
      ep.scenes.forEach((s) => resolveBackground(s.background));
      try { syncTracks(); bgm.unlock(); } catch (e) { /* 鳴らなくてもストーリーは進む */ }
      show('story-read');
      advance();
      return true;
    }

    function setControls(mode) {
      const reading = mode === 'reading';
      $('#story-next').hidden = !reading;
      $('#story-skip').disabled = !reading;
      $('#story-skip').setAttribute('aria-disabled', String(!reading));
    }

    function atBottom() {
      const log = $('#story-log');
      return log.scrollHeight - log.scrollTop - log.clientHeight < 32;
    }
    // 新しいセリフへの自動スクロール中か（その間のスクロールは「過去のログを読んでいる」とみなさない）
    const autoScrolling = () => Date.now() < state.autoScrollUntil;
    function scrollToBottom(smooth = true) {
      const log = $('#story-log');
      const top = log.scrollHeight;
      const useSmooth = smooth && !reducedMotion();
      state.autoScrollUntil = Date.now() + (useSmooth ? 700 : 0);
      if (typeof log.scrollTo === 'function') log.scrollTo({ top, behavior: useSmooth ? 'smooth' : 'auto' });
      else log.scrollTop = top;
      $('#story-newer').hidden = true;
      if (useSmooth) {
        clearTimeout(state.scrollTimer);
        // なめらかなスクロールが途中で止まっても、最後は必ずいちばん下にそろえる
        state.scrollTimer = setTimeout(() => {
          if (!state.autoScrollUntil) return; // 利用者が自分でスクロールした
          log.scrollTop = log.scrollHeight;
          state.autoScrollUntil = 0;
          $('#story-newer').hidden = true;
        }, 720);
      }
    }
    /** 利用者が自分でスクロールし始めたら、自動スクロールをやめる */
    function onUserScrollStart() {
      if (!autoScrolling()) return;
      state.autoScrollUntil = 0;
      clearTimeout(state.scrollTimer);
    }

    function enterScene(item, animate) {
      const scene = item.scene;
      state.scene = item.sceneIndex;
      setBackground(scene.background, scene.tint);
      try { bgm.play(scene.bgm); } catch (e) { /* 鳴らなくても続ける */ }
      if (scene.label && item.sceneIndex > 0) {
        const div = el('p', 'story-scene', `― ${scene.label} ―`);
        if (animate) div.classList.add('is-new');
        $('#story-log').append(div);
      }
    }

    function lineNode(line, animate) {
      const nm = names();
      const text = fill(line.text);
      let node;
      if (line.speaker === 'narration') {
        node = el('p', `story-narration${line.effect === 'announce' ? ' story-narration--announce' : ''}`, text);
      } else {
        const side = line.speaker === 'teacher' ? 'right' : 'left';
        node = el('div', `story-msg story-msg--${line.speaker} story-msg--${side}${line.effect === 'thought' ? ' story-msg--thought' : ''}`);
        if (side === 'left') {
          const face = el('span', 'story-face', data.index.characters[line.speaker].icon);
          face.setAttribute('aria-hidden', 'true');
          node.append(face);
        }
        const bodyEl = el('div', 'story-msg__body');
        const name = el('p', 'story-msg__name', SD.speakerLabel(line.speaker, nm) + (line.effect === 'thought' ? '（心の声）' : ''));
        bodyEl.append(name, el('p', 'story-bubble', text));
        node.append(bodyEl);
      }
      node.dataset.speaker = line.speaker;
      if (animate && !reducedMotion()) node.classList.add('is-new');
      return node;
    }

    /** 次のセリフを1つ表示する */
    function advance() {
      if (!state.reader || state.ended) return;
      const item = state.reader.next();
      if (!item) return;
      if (item.sceneChanged) enterScene(item, true);
      $('#story-log').append(lineNode(item.line, true));
      scrollToBottom(true);
      if (item.last) finish();
    }

    function skip() {
      if (!state.reader || state.ended) return;
      const items = state.reader.skip();
      const frag = doc.createDocumentFragment();
      let lastScene = null;
      items.forEach((item) => {
        if (item.sceneChanged) {
          lastScene = item;
          if (item.scene.label && item.sceneIndex > 0) frag.append(el('p', 'story-scene', `― ${item.scene.label} ―`));
        }
        frag.append(lineNode(item.line, false));
      });
      if (lastScene) {
        state.scene = lastScene.sceneIndex;
        setBackground(lastScene.scene.background, lastScene.scene.tint);
        try { bgm.play(lastScene.scene.bgm); } catch (e) { /* 無視 */ }
      }
      $('#story-log').append(frag);
      scrollToBottom(false);
      if (items.length) finish();
    }

    /** 最後のセリフまで来た：既読にして、おわりの表示（最終話はエンディング） */
    function finish() {
      state.ended = true;
      store.markRead(state.no);
      renderTitleBadge();
      setControls('ended');
      if (state.reader.episode.ending) { showEnding(); return; }
      $('#story-log').append(endCard());
      scrollToBottom(true);
    }

    function endCard() {
      const card = el('div', 'story-end');
      card.append(el('p', 'story-end__title', `第${state.no}話　おわり`));
      const next = data.index.episodes.find((e) => e.no === state.no + 1);
      const actions = el('div', 'story-end__actions');
      if (next && store.isUnlocked(next.no)) {
        const b = el('button', 'btn btn--primary', `次の話へ（第${next.no}話）`);
        b.type = 'button';
        b.dataset.action = 'story-open';
        b.dataset.no = String(next.no);
        actions.append(b);
      } else if (next) {
        card.append(el('p', 'story-end__note', `次の話（第${next.no}話）まで あと${store.remainingFor(next.no)}問。ゲームで正解すると読めるようになります。`));
      }
      const back = el('button', `btn ${next && store.isUnlocked(next.no) ? 'btn--secondary' : 'btn--primary'}`, 'ストーリー一覧へ');
      back.type = 'button';
      back.dataset.action = 'story-back';
      actions.append(back);
      card.append(actions);
      return card;
    }

    function showEnding() {
      const end = $('#story-ending');
      const idx = data.index;
      const box = $('#story-ending-messages');
      box.replaceChildren(...idx.ending.messages.map((m, i) => {
        const p = el('p', 'story-ending__msg', m);
        p.style.setProperty('--delay', `${0.8 + i * 1.6}s`);
        return p;
      }));
      const theEnd = el('p', 'story-ending__end', idx.ending.theEnd);
      theEnd.style.setProperty('--delay', `${0.8 + idx.ending.messages.length * 1.6 + 0.4}s`);
      box.append(theEnd);
      end.hidden = false;
      $('#story-stage').classList.add('is-bright');
      $('section[data-screen="story-read"]').classList.add('is-ending');
      // 次のフレームで演出を始める（フェードインのため）
      const start = () => end.classList.add('is-playing');
      if (typeof requestAnimationFrame === 'function' && !reducedMotion()) requestAnimationFrame(() => requestAnimationFrame(start)); else start();
      const btn = $('#story-ending-close');
      if (btn) btn.focus({ preventScroll: true });
    }

    function backToList() {
      state.reader = null;
      try { bgm.stop(); } catch (e) { /* 無視 */ }
      openList('replace');
    }

    /** 会話エリアのタップ：過去のセリフを読んでいる（いちばん下にいない）ときは進めず、いちばん下へ戻すだけ */
    function onLogTap(e) {
      if (!state.reader || state.ended) return;
      if (e && e.target && e.target.closest && e.target.closest('button, a')) return;
      const sel = doc.getSelection && doc.getSelection();
      if (sel && String(sel).length > 0) return; // 文字を選んでいるとき
      if (!autoScrolling() && !atBottom()) { scrollToBottom(true); return; }
      advance();
    }

    function onLogScroll() {
      if (!state.reader || autoScrolling()) return;
      $('#story-newer').hidden = atBottom();
    }

    // ---------------------------------------------------------- ログ（これまでのセリフ）
    function openLog() {
      if (!state.reader) return;
      const list = $('#story-log-list');
      const nm = names();
      const items = state.reader.items.slice(0, state.reader.shown);
      list.replaceChildren(...items.map((it) => {
        const li = el('li', `story-loglist__item story-loglist__item--${it.line.speaker}`);
        const who = SD.speakerLabel(it.line.speaker, nm);
        if (who) li.append(el('span', 'story-loglist__who', `${who}${it.line.effect === 'thought' ? '（心の声）' : ''}`));
        li.append(el('span', 'story-loglist__text', fill(it.line.text)));
        return li;
      }));
      const dlg = $('#story-log-dialog');
      if (!dlg.open) dlg.showModal();
      list.scrollTop = list.scrollHeight;
    }

    // ---------------------------------------------------------- 名前の設定
    function openNames() {
      const n = store.names();
      $('#story-name-teacher').value = n.teacher;
      $('#story-name-kei').value = n.kei;
      $('#story-name-shiho').value = n.shiho;
      renderNamePreview();
      const dlg = $('#story-names-dialog');
      if (!dlg.open) dlg.showModal();
    }
    function onNameInput(role, value) {
      store.setName(role, value);
      renderNamePreview();
    }
    function renderNamePreview() {
      const nm = names();
      $('#story-name-preview').textContent = `会話での表示：${nm.teacher}・${nm.kei}くん・${nm.shiho}さん`;
    }

    // ---------------------------------------------------------- BGM ボタン（会話画面の上）
    function renderBgmButton() {
      const b = $('#story-bgm-toggle');
      if (!b) return;
      const on = bgm.getSettings().enabled;
      b.textContent = on ? '♪ BGM ON' : '♪ BGM OFF';
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'ストーリーBGM：ON（押すとOFF）' : 'ストーリーBGM：OFF（押すとON）');
      b.classList.toggle('is-off', !on);
    }

    // ---------------------------------------------------------- 裏ワザ：全話の解放
    // 一覧の物語のタイトルを、4秒以内に7回タップする。途中では何も表示しない（気づかれにくくする）
    const SECRET_TAPS = 7;
    const SECRET_WINDOW = 4000;
    const secretTaps = [];
    function onSecretTap() {
      const t = Date.now();
      secretTaps.push(t);
      while (secretTaps.length && t - secretTaps[0] > SECRET_WINDOW) secretTaps.shift();
      if (secretTaps.length < SECRET_TAPS) return;
      secretTaps.length = 0;
      if (store.unlockedCount() >= store.thresholds.length) return;
      store.unlockAllEpisodes();
      sfx('rankup');
      renderList();
      renderTitleBadge();
      const next = $('.story-progress__next');
      if (next) next.textContent = '✨ 全12話が解放されました！';
    }

    /** app.js のクリック処理から呼ぶ（data-action が story- で始まるもの） */
    function handleAction(action, target) {
      switch (action) {
        case 'story-go': sfx('tap'); openList(); return true;
        case 'story-open': {
          sfx('tap');
          openEpisode(Number(target.dataset.no));
          return true;
        }
        case 'story-next': advance(); return true;
        case 'story-skip': sfx('tap'); skip(); return true;
        case 'story-log-open': sfx('tap'); openLog(); return true;
        case 'story-log-close': sfx('tap'); $('#story-log-dialog').close(); return true;
        case 'story-newer': scrollToBottom(true); return true;
        case 'story-back': sfx('tap'); backToList(); return true;
        case 'story-ending-close': sfx('tap'); backToList(); return true;
        case 'story-bgm-toggle': bgm.setEnabled(!bgm.getSettings().enabled); renderBgmButton(); return true;
        case 'story-secret': onSecretTap(); return true;
        case 'story-names': sfx('tap'); openNames(); return true;
        case 'story-names-close': sfx('tap'); $('#story-names-dialog').close(); renderList(); return true;
        case 'story-reset': sfx('tap'); if (!$('#story-reset-dialog').open) $('#story-reset-dialog').showModal(); return true;
        case 'story-reset-cancel': sfx('tap'); $('#story-reset-dialog').close(); return true;
        case 'story-reset-confirm': {
          sfx('tap');
          $('#story-reset-dialog').close();
          store.resetProgress();
          renderTitleBadge();
          renderList();
          return true;
        }
        default: return false;
      }
    }

    function bind() {
      $('#story-log').addEventListener('click', onLogTap);
      $('#story-log').addEventListener('scroll', onLogScroll, { passive: true });
      ['wheel', 'touchmove'].forEach((type) => $('#story-log').addEventListener(type, onUserScrollStart, { passive: true }));
      [['teacher', '#story-name-teacher'], ['kei', '#story-name-kei'], ['shiho', '#story-name-shiho']].forEach(([role, sel]) => {
        const input = $(sel);
        input.maxLength = 10;
        input.addEventListener('input', () => {
          // 貼り付けなどで10文字をこえたときは、入力欄も10文字にそろえる（絵文字も1文字として数える）
          const chars = Array.from(input.value);
          if (chars.length > 10) input.value = chars.slice(0, 10).join('');
          onNameInput(role, input.value);
        });
        input.addEventListener('change', () => onNameInput(role, input.value));
      });
      $('#story-names-dialog').addEventListener('close', () => { if (state.reader === null && data.index) renderList(); });
      doc.addEventListener('keydown', (e) => {
        if (doc.body.dataset.currentScreen !== 'story-read' || !state.reader || state.ended) return;
        if (doc.querySelector('dialog[open]')) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
          if (e.target && e.target.closest && e.target.closest('button, a, input')) return;
          e.preventDefault();
          advance();
        }
      });
      bgm.onChange(renderBgmButton);
    }

    /** 画面が変わったとき（app.js の show から呼ぶ）：会話画面を出たら BGM を止める */
    function onScreen(name) {
      if (name !== 'story-read') {
        if (state.reader) state.reader = null;
        try { bgm.stop(); } catch (e) { /* 無視 */ }
      }
      if (name === 'title' || name === 'records') renderTitleBadge();
    }

    return {
      bind, handleAction, onScreen, openList, openEpisode, renderTitleBadge, renderList,
      advance, skip,
      get reading() { return !!state.reader && !state.ended; },
      get state() { return { no: state.no, shown: state.reader ? state.reader.shown : 0, total: state.reader ? state.reader.total : 0, ended: state.ended, scene: state.scene }; },
    };
  }

  return { StoryReader, createStoryController };
});
