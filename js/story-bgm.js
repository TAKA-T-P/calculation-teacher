/*
 * story-bgm.js
 * ストーリーモードの BGM（BGMer の SHORT 版7曲）。効果音（sound.js）とは別に、ON/OFF・音量を管理する。
 *
 * - 再生はストーリーの会話画面だけ。画面を閉じたら止める（呼び出し側が stop() を呼ぶ）。
 * - 同じ曲が続くときは再生を続け、別の曲に変わるときは古い曲を約1秒でフェードアウト、新しい曲を約1秒でフェードイン。
 * - ループ：曲の終わりの CROSSFADE 秒前に、もう1つの audio 要素で曲の頭から鳴らし始め、なめらかにつなぐ。
 *   （素材は tools/build-story-assets.js で先頭・末尾の無音を切ってあるので、無音のすき間ができない）
 *   タイマーが止まっていて間に合わなかったときは、曲の終わり（ended）で頭から再生し直す。
 * - 音量：Web Audio の GainNode で変える（iPad の Safari は audio 要素の volume を変えられないため）。
 *   Web Audio が使えないときは audio 要素の volume を使う。
 * - iPad などの自動再生の制限：最初の再生は「ストーリーを開く」などの操作の中で始める（unlock()・play() を操作の中で呼ぶ）。
 *   2つの audio 要素を、その操作の中で両方とも一度再生しておき、あとからタイマーでループさせても鳴るようにする。
 * - 音声ファイルがない・再生できないときも、例外を外に出さない（ストーリーはそのまま進む）。
 * - 音声ファイルは、その曲を再生するときに初めて読み込む（起動時に7曲を読み込まない）。
 *
 * 保存キー：calcTeacher.storySound（効果音の calcTeacher.sound とは別）
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = lib;
  } else {
    root.StoryBgmLib = lib;
    let storage = null;
    try { storage = root.localStorage; } catch (e) { storage = null; }
    root.StoryBgm = lib.createBgmPlayer({
      storage,
      AudioContextClass: root.AudioContext || root.webkitAudioContext || null,
      createAudio: () => new root.Audio(),
    });
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'calcTeacher.storySound';
  const DEFAULT_SETTINGS = { enabled: true, volume: 25 };
  const FADE_MS = 1000;        // 曲の切りかえのフェード
  const CROSSFADE = 1.2;       // ループのつなぎ目のクロスフェード（秒）
  const TICK_MS = 50;

  /** 音量（0〜100）→ 実際の音量（0〜1）。小さい音量を細かく調整できるようにする */
  function volumeToGain(volume) {
    const v = Math.max(0, Math.min(100, Number(volume) || 0)) / 100;
    return Math.pow(v, 1.3);
  }

  function normalizeSettings(raw) {
    const s = { ...DEFAULT_SETTINGS };
    if (raw && typeof raw === 'object') {
      if (typeof raw.enabled === 'boolean') s.enabled = raw.enabled;
      const v = Number(raw.volume);
      if (Number.isFinite(v)) s.volume = Math.round(Math.max(0, Math.min(100, v)));
    }
    return s;
  }

  /**
   * @param {{storage?: Storage, AudioContextClass?: Function, createAudio?: () => HTMLAudioElement,
   *          setInterval?: Function, clearInterval?: Function, now?: () => number}} opts
   */
  function createBgmPlayer(opts = {}) {
    const storage = opts.storage || null;
    const AC = opts.AudioContextClass || null;
    const createAudio = opts.createAudio || null;
    const setTimer = opts.setInterval || ((fn, ms) => setInterval(fn, ms));
    const clearTimer = opts.clearInterval || ((id) => clearInterval(id));
    const now = opts.now || (() => Date.now());

    let settings = loadSettings();
    let tracks = {};           // id → { url, loopStart, loopEnd }
    let desired = null;        // 鳴らしたい曲（OFF のときも覚えておき、ON にしたら鳴らす）
    let ctx = null;
    let ctxFailed = !AC;
    let timer = null;
    let hiddenPaused = false;
    const voices = [];         // { el, node, track, level, from, to, t0, dur, state, loopSpawned, unlocked }
    const listeners = new Set();
    const log = [];
    let lastError = null;

    function loadSettings() {
      try {
        const raw = storage && storage.getItem(STORAGE_KEY);
        return normalizeSettings(raw ? JSON.parse(raw) : null);
      } catch (e) {
        return { ...DEFAULT_SETTINGS };
      }
    }
    function saveSettings() {
      try { if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* 保存できなくても続ける */ }
      listeners.forEach((fn) => { try { fn({ ...settings }); } catch (e) { /* 無視 */ } });
    }

    function ensureContext() {
      if (ctxFailed) return null;
      try {
        if (!ctx) ctx = new AC();
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
          const p = ctx.resume();
          if (p && typeof p.catch === 'function') p.catch(() => { /* 許可されなければ鳴らないだけ */ });
        }
        return ctx;
      } catch (e) {
        ctxFailed = true;
        ctx = null;
        return null;
      }
    }

    function makeVoice() {
      if (!createAudio) return null;
      let el;
      try { el = createAudio(); } catch (e) { return null; }
      const v = { el, node: null, track: null, level: 0, from: 0, to: 0, t0: 0, dur: 0, state: 'idle', loopSpawned: false, unlocked: false };
      try {
        el.preload = 'auto';
        el.crossOrigin = 'anonymous';
        el.addEventListener('error', () => {
          if (v.state === 'idle') return;
          lastError = 'load-failed';
          log.push({ type: 'error', track: v.track });
          setIdle(v);
        });
        el.addEventListener('ended', () => onEnded(v));
      } catch (e) { /* 偽の要素など */ }
      const c = ensureContext();
      if (c) {
        try {
          const src = c.createMediaElementSource(el);
          v.node = c.createGain();
          v.node.gain.value = 0;
          src.connect(v.node);
          v.node.connect(c.destination);
        } catch (e) { v.node = null; }
      }
      voices.push(v);
      return v;
    }

    function ensureVoices() {
      while (voices.length < 2) { if (!makeVoice()) break; }
    }

    function outputGain(v) {
      return settings.enabled && !hiddenPaused ? v.level * volumeToGain(settings.volume) : 0;
    }
    function applyGain(v) {
      const g = outputGain(v);
      try {
        if (v.node) {
          if (ctx && typeof v.node.gain.setTargetAtTime === 'function') v.node.gain.setTargetAtTime(g, ctx.currentTime, 0.02);
          else v.node.gain.value = g;
          v.el.volume = 1;
        } else {
          v.el.volume = Math.max(0, Math.min(1, g));
        }
      } catch (e) { /* 無視 */ }
    }

    function setIdle(v) {
      v.state = 'idle';
      v.level = 0;
      v.track = null;
      v.loopSpawned = false;
      try { v.el.pause(); } catch (e) { /* 無視 */ }
      applyGain(v);
    }

    function fade(v, to, ms) {
      v.from = v.level;
      v.to = to;
      v.t0 = now();
      v.dur = Math.max(0, ms);
      if (v.dur === 0) v.level = to;
      if (to === 0) v.state = 'fading-out';
      ensureTimer();
    }

    function startVoice(v, id, fadeMs, at) {
      const t = tracks[id];
      v.track = id;
      v.state = 'playing';
      v.loopSpawned = false;
      v.level = 0;
      applyGain(v);
      try {
        const url = t.url;
        if (v.el.getAttribute ? v.el.getAttribute('src') !== url : v.el.src !== url) v.el.src = url;
        try { v.el.currentTime = at; } catch (e) { /* 読み込み前は 0 から */ }
        const p = v.el.play();
        v.unlocked = true;
        if (p && typeof p.catch === 'function') {
          p.catch((e) => {
            if (v.track !== id) return;
            lastError = e && e.name === 'NotAllowedError' ? 'not-allowed' : 'play-failed';
            log.push({ type: 'play-failed', track: id, reason: lastError });
            setIdle(v);
          });
        }
      } catch (e) {
        lastError = 'play-failed';
        setIdle(v);
        return;
      }
      fade(v, 1, fadeMs);
      log.push({ type: 'start', track: id, at });
    }

    /** 鳴っている曲（フェードアウト中でないもの） */
    function lead() {
      return voices.find((v) => v.state === 'playing');
    }

    function freeVoice(exclude) {
      ensureVoices();
      let v = voices.find((x) => x !== exclude && x.state === 'idle');
      if (!v) {
        // 2つとも使っているとき（すばやく曲が変わったとき）は、小さいほうを止めて使う
        v = voices.filter((x) => x !== exclude).sort((a, b) => a.level - b.level)[0];
        if (v) setIdle(v);
      }
      return v || null;
    }

    function fadeOutAll(ms, except) {
      voices.forEach((v) => { if (v !== except && v.state !== 'idle') fade(v, 0, ms); });
    }

    function onEnded(v) {
      // タイマーでのクロスフェードが間に合わなかった：同じ要素で曲の頭から再生し直す
      if (v.state !== 'playing' || v.loopSpawned) return;
      const t = tracks[v.track];
      if (!t) return;
      log.push({ type: 'loop', track: v.track, mode: 'ended' });
      try { v.el.currentTime = t.loopStart || 0; const p = v.el.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 無視 */ }
    }

    function checkLoop(v) {
      if (v.state !== 'playing' || v.loopSpawned || hiddenPaused) return;
      const t = tracks[v.track];
      if (!t) return;
      const end = t.loopEnd || v.el.duration;
      const cur = Number(v.el.currentTime) || 0;
      if (!Number.isFinite(end) || end <= CROSSFADE * 2 || cur < end - CROSSFADE) return;
      const next = freeVoice(v);
      if (!next) return;
      v.loopSpawned = true;
      startVoice(next, v.track, CROSSFADE * 1000, t.loopStart || 0);
      fade(v, 0, CROSSFADE * 1000);
      log.push({ type: 'loop', track: v.track, mode: 'crossfade' });
    }

    function tick() {
      const t = now();
      let active = false;
      voices.forEach((v) => {
        if (v.state === 'idle') return;
        active = true;
        if (v.level !== v.to || v.t0) {
          const k = v.dur ? Math.min(1, (t - v.t0) / v.dur) : 1;
          v.level = v.from + (v.to - v.from) * k;
          if (k >= 1) { v.level = v.to; v.t0 = 0; }
        }
        if (v.state === 'fading-out' && v.level <= 0 && !v.t0) { setIdle(v); return; }
        applyGain(v);
        checkLoop(v);
      });
      if (!active && timer !== null) { clearTimer(timer); timer = null; }
    }

    function ensureTimer() {
      if (timer === null) timer = setTimer(tick, TICK_MS);
    }

    // ------------------------------------------------------------ 公開する操作
    /**
     * 曲を鳴らす（同じ曲が鳴っていれば何もしない）。id が null なら無音にする（フェードアウト）。
     * ユーザーの操作（タップ）の中で呼ぶと、iPad でも鳴らせる。
     */
    function play(id, playOpts = {}) {
      const fadeMs = playOpts.fadeMs === undefined ? FADE_MS : playOpts.fadeMs;
      if (id !== null && !tracks[id]) { lastError = 'unknown-track'; return false; }
      desired = id;
      log.push({ type: 'request', track: id });
      if (!settings.enabled) return false;
      const cur = lead();
      if (id === null) { fadeOutAll(fadeMs); return true; }
      if (cur && cur.track === id) { fadeOutAll(fadeMs, cur); return true; } // 同じ曲：続ける
      const v = freeVoice(cur);
      if (!v) { lastError = 'unavailable'; return false; }
      fadeOutAll(fadeMs, v);
      startVoice(v, id, fadeMs, (tracks[id].loopStart) || 0);
      primeOther(v, id);
      return true;
    }

    /** もう1つの audio 要素も、操作の中で一度再生しておく（あとでタイマーからループ再生できるように。音量は0） */
    function primeOther(v, id) {
      const other = voices.find((x) => x !== v && !x.unlocked && x.state === 'idle');
      if (!other) return;
      try {
        other.el.src = tracks[id].url;
        other.level = 0;
        applyGain(other);
        const p = other.el.play();
        other.unlocked = true;
        const stop = () => { if (other.state === 'idle') { try { other.el.pause(); } catch (e) { /* 無視 */ } } };
        if (p && typeof p.then === 'function') p.then(stop, () => {}); else stop();
      } catch (e) { /* 無視 */ }
    }

    /** ストーリーを閉じたとき：止める */
    function stop(fadeMs = 600) {
      desired = null;
      fadeOutAll(fadeMs);
      log.push({ type: 'stop' });
    }

    function setEnabled(enabled) {
      settings = { ...settings, enabled: !!enabled };
      if (!settings.enabled) fadeOutAll(300);
      else if (desired) { const want = desired; desired = null; play(want, { fadeMs: 600 }); }
      voices.forEach(applyGain);
      saveSettings();
    }

    function setVolume(volume) {
      settings = normalizeSettings({ ...settings, volume });
      voices.forEach(applyGain);
      saveSettings();
    }

    /** 画面が隠れたら一時停止し、戻ったら続きから鳴らす */
    function setHidden(hidden) {
      hiddenPaused = !!hidden;
      voices.forEach((v) => {
        if (v.state === 'idle') return;
        try {
          if (hidden) v.el.pause();
          else { const p = v.el.play(); if (p && p.catch) p.catch(() => {}); }
        } catch (e) { /* 無視 */ }
        applyGain(v);
      });
    }

    return {
      play,
      stop,
      /** 操作の中で呼ぶ：AudioContext と audio 要素を準備する */
      unlock: () => { ensureContext(); ensureVoices(); },
      setTracks: (t) => { tracks = { ...t }; },
      setEnabled,
      setVolume,
      setHidden,
      getSettings: () => ({ ...settings }),
      onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      /** 自動テスト・不具合調査用 */
      debug: {
        get desired() { return desired; },
        get playing() { const v = lead(); return v ? v.track : null; },
        get voices() { return voices.map((v) => ({ track: v.track, state: v.state, level: v.level, paused: !!(v.el && v.el.paused), src: v.el && (v.el.getAttribute ? v.el.getAttribute('src') : v.el.src) })); },
        get lastError() { return lastError; },
        get log() { return log.slice(); },
        get webAudio() { return !!(voices[0] && voices[0].node); },
        outputGain: () => { const v = lead(); return v ? outputGain(v) : 0; },
        tick,
        clearLog() { log.length = 0; },
      },
    };
  }

  return { STORAGE_KEY, DEFAULT_SETTINGS, FADE_MS, CROSSFADE, volumeToGain, normalizeSettings, createBgmPlayer };
});
