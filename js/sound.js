/*
 * sound.js
 * 計算ティーチャー！ 効果音（Web Audio API で音を合成する。音声ファイルは不要）
 *
 * 使い方（画面側）：
 *   Sound.play('correct');            // 名前を指定して鳴らす
 *   Sound.play('correct', { delay: 0.12 });
 *   Sound.setEnabled(false);          // ON/OFF（localStorage に保存）
 *   Sound.setVolume(50);              // 音量 0〜100（localStorage に保存）
 *
 * 設計：
 *  - 効果音は名前 → レシピ（音符の並び）で定義する。将来、音声ファイルに置き換えるときは
 *    レシピの代わりに { url: 'sounds/correct.mp3' } のような定義を足し、play() の中で分岐する。
 *  - AudioContext は1つだけ作り、最初のユーザー操作（タップ・クリック・キー入力）で作成・再開する（iOS の制限対策）。
 *  - 音の出口は「効果音ごとの音量」→「全体の音量」→「コンプレッサー」→ スピーカー。
 *    コンプレッサーで、効果音が重なっても音量が大きくなりすぎないようにする。
 *  - 同じ音の連打は一定間隔で間引き、同時に鳴る音の数にも上限を設ける。
 *  - 長い音（グループ 'long'）は、次の長い音を鳴らすときや画面を移るときに短くフェードアウトさせる。
 *  - どんな失敗をしても例外を外に出さない（ゲームの進行や採点に影響させない）。
 *
 * このファイルは game.js と同じく、Node.js から自動テストできるようにしている（tools/test-sound.js）。
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = lib;
  } else {
    root.SoundLib = lib;
    let storage = null;
    try { storage = root.localStorage; } catch (e) { storage = null; } // プライベートモードなどで使えない場合
    root.Sound = lib.createSoundManager({
      AudioContextClass: root.AudioContext || root.webkitAudioContext || null,
      storage,
    });
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'calcTeacher.sound';
  const DEFAULT_SETTINGS = { enabled: true, volume: 50 };
  const MAX_VOICES = 6;          // 同時に鳴らす効果音の最大数
  const ATTACK = 0.006;          // 音の立ち上がり（クリックノイズ防止のフェードイン）
  const FADE_OUT = 0.04;         // 途中で止めるときのフェードアウト

  // 音名 → 周波数（Hz）
  const N = {
    G3: 196.0, B3: 246.94, C4: 261.63, E4: 329.63, G4: 392.0, A4: 440.0,
    C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, B5: 987.77,
    C6: 1046.5, E6: 1318.51, G6: 1567.98, C7: 2093.0, E7: 2637.02,
  };

  /*
   * 効果音のレシピ
   *   group : 'ui'（短い操作音） / 'long'（正解・不正解・開始・結果などの長めの音）
   *   gain  : この効果音の音量（0〜1）
   *   minGap: 同じ音を続けて鳴らせる最小間隔（ミリ秒）。連打の間引き
   *   notes : { f: 周波数, t: 開始秒, d: 長さ秒, type: 波形, v: 音量, to: 終わりの周波数（スライド） }
   */
  const RECIPES = {
    // ① 行選択・「全部正しい！」：軽く明るいクリック
    select: {
      group: 'ui', gain: 0.35, minGap: 50,
      notes: [{ f: N.A5, t: 0, d: 0.07, type: 'triangle', v: 1 }, { f: N.E6, t: 0, d: 0.05, type: 'sine', v: 0.35 }],
    },
    // ⑨ その他の操作（画面移動・ダイアログ）：さらに控えめなクリック
    tap: {
      group: 'ui', gain: 0.25, minGap: 60,
      notes: [{ f: N.E5, t: 0, d: 0.06, type: 'triangle', v: 1 }],
    },
    // ② 添削ボタン：スタンプを押すような短い音（低い「ポン」と、紙に当たる軽い音）
    submit: {
      group: 'ui', gain: 0.6, minGap: 150,
      notes: [
        { f: 240, to: 90, t: 0, d: 0.13, type: 'sine', v: 1 },
        { f: N.A4, t: 0, d: 0.035, type: 'triangle', v: 0.35 },
      ],
    },
    // ③ 正解：明るい上昇チャイム（ピンポーン♪）
    correct: {
      group: 'long', gain: 0.5, minGap: 200,
      notes: [
        { f: N.A5, t: 0, d: 0.16, type: 'triangle', v: 0.9 },
        { f: N.E6, t: 0.11, d: 0.42, type: 'triangle', v: 1 },
        { f: N.E7, t: 0.11, d: 0.3, type: 'sine', v: 0.18 },
      ],
    },
    // ④ 不正解：低めの2音。控えめで短いブザー
    incorrect: {
      group: 'long', gain: 0.42, minGap: 200,
      notes: [
        { f: N.E4, t: 0, d: 0.15, type: 'triangle', v: 1 },
        { f: N.B3, t: 0.15, d: 0.22, type: 'triangle', v: 1 },
        { f: N.B3 / 2, t: 0.15, d: 0.22, type: 'sine', v: 0.4 },
      ],
    },
    // ⑤ ヒント：軽いキラキラ
    hint: {
      group: 'ui', gain: 0.22, minGap: 150,
      notes: [
        { f: N.G6, t: 0, d: 0.14, type: 'sine', v: 1 },
        { f: N.C7, t: 0.07, d: 0.14, type: 'sine', v: 0.9 },
        { f: N.E7, t: 0.14, d: 0.18, type: 'sine', v: 0.8 },
      ],
    },
    // ⑥ 次の問題へ：軽いページ送り（さっと上がる音）
    next: {
      group: 'ui', gain: 0.28, minGap: 120,
      notes: [{ f: N.E5, to: N.B5, t: 0, d: 0.13, type: 'triangle', v: 1 }],
    },
    // ⑦ トレーニング開始：明るい短いチャイム
    start: {
      group: 'long', gain: 0.4, minGap: 300,
      notes: [
        { f: N.C5, t: 0, d: 0.18, type: 'triangle', v: 1 },
        { f: N.E5, t: 0.09, d: 0.18, type: 'triangle', v: 1 },
        { f: N.G5, t: 0.18, d: 0.2, type: 'triangle', v: 1 },
        { f: N.C6, t: 0.27, d: 0.3, type: 'triangle', v: 1 },
      ],
    },
    // ⑧ 結果発表（通常）：和音を含む短い終了チャイム
    result: {
      group: 'long', gain: 0.38, minGap: 500,
      notes: [
        { f: N.G4, t: 0, d: 0.16, type: 'triangle', v: 1 },
        { f: N.C5, t: 0.12, d: 0.16, type: 'triangle', v: 1 },
        { f: N.E5, t: 0.24, d: 0.16, type: 'triangle', v: 1 },
        { f: N.C5, t: 0.36, d: 0.5, type: 'triangle', v: 0.8 },
        { f: N.E5, t: 0.36, d: 0.5, type: 'triangle', v: 0.8 },
        { f: N.G5, t: 0.36, d: 0.5, type: 'triangle', v: 0.8 },
      ],
    },
    // ⑧ 結果発表（全問正解）：豪華なファンファーレ
    perfect: {
      group: 'long', gain: 0.38, minGap: 800,
      notes: [
        { f: N.G4, t: 0, d: 0.12, type: 'triangle', v: 1 },
        { f: N.C5, t: 0.12, d: 0.12, type: 'triangle', v: 1 },
        { f: N.E5, t: 0.24, d: 0.12, type: 'triangle', v: 1 },
        { f: N.G5, t: 0.36, d: 0.22, type: 'triangle', v: 1 },
        { f: N.E5, t: 0.58, d: 0.1, type: 'triangle', v: 0.9 },
        { f: N.G5, t: 0.68, d: 0.12, type: 'triangle', v: 0.9 },
        // 最後の和音（C・E・G・C）と、明るさを足す高い音
        { f: N.C5, t: 0.8, d: 0.62, type: 'triangle', v: 0.75 },
        { f: N.E5, t: 0.8, d: 0.62, type: 'triangle', v: 0.75 },
        { f: N.G5, t: 0.8, d: 0.62, type: 'triangle', v: 0.75 },
        { f: N.C6, t: 0.8, d: 0.62, type: 'triangle', v: 0.85 },
        { f: N.C7, t: 0.8, d: 0.45, type: 'sine', v: 0.15 },
      ],
    },
  };

  // ------------------------------------------------------------ 第3段階：タイムアタック
  // 正解・不正解は既存の音色を短くした版（約0.3秒ごとに次の問題が出るため、長い音が重ならないように）
  Object.assign(RECIPES, {
    quickCorrect: {
      group: 'quick', gain: 0.42, minGap: 60,
      notes: [
        { f: N.A5, t: 0, d: 0.06, type: 'triangle', v: 0.9 },
        { f: N.E6, t: 0.05, d: 0.12, type: 'triangle', v: 1 },
      ],
    },
    quickIncorrect: {
      group: 'quick', gain: 0.38, minGap: 60,
      notes: [
        { f: N.E4, t: 0, d: 0.07, type: 'triangle', v: 1 },
        { f: N.B3, t: 0.07, d: 0.1, type: 'triangle', v: 1 },
      ],
    },
    // 3・2・1 のカウントダウン：短い「ピッ」
    countdown: {
      group: 'ui', gain: 0.35, minGap: 300,
      notes: [{ f: N.A5, t: 0, d: 0.12, type: 'sine', v: 1 }, { f: N.A5 * 2, t: 0, d: 0.08, type: 'sine', v: 0.2 }],
    },
    // START!：1オクターブ高い明るい音
    go: {
      group: 'ui', gain: 0.4, minGap: 300,
      notes: [
        { f: N.C6, t: 0, d: 0.32, type: 'triangle', v: 1 },
        { f: N.E6, t: 0, d: 0.32, type: 'triangle', v: 0.7 },
        { f: N.G6, t: 0, d: 0.28, type: 'sine', v: 0.4 },
      ],
    },
    // 残り10秒：短い2回の警告音
    warning: {
      group: 'ui', gain: 0.3, minGap: 1000,
      notes: [{ f: N.E6, t: 0, d: 0.09, type: 'square', v: 0.35 }, { f: N.E6, t: 0.16, d: 0.09, type: 'square', v: 0.35 }],
    },
    // タイムアップ：下がっていく3音
    timeup: {
      group: 'long', gain: 0.4, minGap: 1000,
      notes: [
        { f: N.G5, t: 0, d: 0.16, type: 'triangle', v: 1 },
        { f: N.E5, t: 0.15, d: 0.16, type: 'triangle', v: 1 },
        { f: N.C5, t: 0.3, d: 0.34, type: 'triangle', v: 1 },
        { f: N.C4, t: 0.3, d: 0.34, type: 'sine', v: 0.5 },
      ],
    },
    // タイムアタックの結果画面に移るときの短いジングル（すばやい上昇音から明るい和音）
    taResult: {
      group: 'long', gain: 0.36, minGap: 800,
      notes: [
        { f: N.G4, t: 0, d: 0.09, type: 'triangle', v: 0.9 },
        { f: N.C5, t: 0.07, d: 0.09, type: 'triangle', v: 0.9 },
        { f: N.E5, t: 0.14, d: 0.09, type: 'triangle', v: 0.9 },
        { f: N.G5, t: 0.21, d: 0.1, type: 'triangle', v: 1 },
        { f: N.C5, t: 0.32, d: 0.42, type: 'triangle', v: 0.75 },
        { f: N.E5, t: 0.32, d: 0.42, type: 'triangle', v: 0.75 },
        { f: N.G5, t: 0.32, d: 0.42, type: 'triangle', v: 0.7 },
        { f: N.C6, t: 0.32, d: 0.42, type: 'sine', v: 0.5 },
      ],
    },
    // 自己ベスト更新：キラキラした上昇音と和音
    best: {
      group: 'long', gain: 0.36, minGap: 1000,
      notes: [
        { f: N.C6, t: 0, d: 0.12, type: 'triangle', v: 1 },
        { f: N.E6, t: 0.09, d: 0.12, type: 'triangle', v: 1 },
        { f: N.G6, t: 0.18, d: 0.12, type: 'triangle', v: 1 },
        { f: N.C7, t: 0.27, d: 0.2, type: 'sine', v: 0.7 },
        { f: N.C6, t: 0.45, d: 0.6, type: 'triangle', v: 0.7 },
        { f: N.E6, t: 0.45, d: 0.6, type: 'triangle', v: 0.7 },
        { f: N.G6, t: 0.45, d: 0.6, type: 'triangle', v: 0.6 },
      ],
    },

    // ------------------------------------------------------------ 第3段階：認定試験
    // 試験開始：落ち着いた鐘の音
    examStart: {
      group: 'long', gain: 0.36, minGap: 500,
      notes: [
        { f: N.G4, t: 0, d: 0.3, type: 'sine', v: 1 },
        { f: N.C5, t: 0.18, d: 0.34, type: 'sine', v: 1 },
        { f: N.G5, t: 0.18, d: 0.34, type: 'sine', v: 0.3 },
      ],
    },
    // 合格：明るい上昇チャイム
    pass: {
      group: 'long', gain: 0.4, minGap: 800,
      notes: [
        { f: N.C5, t: 0, d: 0.14, type: 'triangle', v: 1 },
        { f: N.E5, t: 0.11, d: 0.14, type: 'triangle', v: 1 },
        { f: N.G5, t: 0.22, d: 0.14, type: 'triangle', v: 1 },
        { f: N.C6, t: 0.33, d: 0.42, type: 'triangle', v: 1 },
        { f: N.E6, t: 0.33, d: 0.42, type: 'sine', v: 0.35 },
      ],
    },
    // 不合格：やわらかく下がる音（責めない、落ち着いた音）
    fail: {
      group: 'long', gain: 0.34, minGap: 800,
      notes: [
        { f: N.E4, t: 0, d: 0.2, type: 'sine', v: 1 },
        { f: 293.66, t: 0.18, d: 0.2, type: 'sine', v: 1 },
        { f: N.C4, t: 0.36, d: 0.32, type: 'sine', v: 1 },
      ],
    },
    // ランクアップ：ファンファーレ
    rankup: {
      group: 'long', gain: 0.38, minGap: 1000,
      notes: [
        { f: N.C5, t: 0, d: 0.1, type: 'triangle', v: 1 },
        { f: N.C5, t: 0.12, d: 0.1, type: 'triangle', v: 1 },
        { f: N.C5, t: 0.24, d: 0.1, type: 'triangle', v: 1 },
        { f: N.G5, t: 0.36, d: 0.3, type: 'triangle', v: 1 },
        { f: N.E5, t: 0.66, d: 0.12, type: 'triangle', v: 0.9 },
        { f: N.G5, t: 0.78, d: 0.12, type: 'triangle', v: 0.9 },
        { f: N.C6, t: 0.9, d: 0.4, type: 'triangle', v: 0.85 },
        { f: N.E5, t: 0.9, d: 0.4, type: 'triangle', v: 0.6 },
        { f: N.G5, t: 0.9, d: 0.4, type: 'triangle', v: 0.6 },
      ],
    },
    // 最終試験合格（マスター）：いちばん豪華なファンファーレ
    master: {
      group: 'long', gain: 0.38, minGap: 1500,
      notes: [
        { f: N.G4, t: 0, d: 0.12, type: 'triangle', v: 1 },
        { f: N.C5, t: 0.12, d: 0.12, type: 'triangle', v: 1 },
        { f: N.E5, t: 0.24, d: 0.12, type: 'triangle', v: 1 },
        { f: N.G5, t: 0.36, d: 0.12, type: 'triangle', v: 1 },
        { f: N.C6, t: 0.48, d: 0.3, type: 'triangle', v: 1 },
        { f: N.G5, t: 0.8, d: 0.1, type: 'triangle', v: 0.9 },
        { f: N.C6, t: 0.92, d: 0.1, type: 'triangle', v: 0.9 },
        { f: N.E6, t: 1.04, d: 0.12, type: 'triangle', v: 0.9 },
        { f: N.C5, t: 1.18, d: 0.6, type: 'triangle', v: 0.7 },
        { f: N.E5, t: 1.18, d: 0.6, type: 'triangle', v: 0.7 },
        { f: N.G5, t: 1.18, d: 0.6, type: 'triangle', v: 0.7 },
        { f: N.C6, t: 1.18, d: 0.6, type: 'triangle', v: 0.8 },
        { f: N.C7, t: 1.18, d: 0.45, type: 'sine', v: 0.15 },
      ],
    },
  });

  /** レシピ全体の長さ（秒） */
  function recipeDuration(name) {
    const r = RECIPES[name];
    if (!r) return 0;
    return Math.max(...r.notes.map((n) => n.t + n.d));
  }

  /** 音量（0〜100）→ 実際の音量。人の耳に合わせて小さい値を細かく調整できるようにする */
  function volumeToGain(volume) {
    const v = Math.max(0, Math.min(100, Number(volume) || 0)) / 100;
    return Math.pow(v, 1.6) * 0.9;
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
   * 効果音の管理を作る。
   * @param {{AudioContextClass?: Function, storage?: Storage, now?: () => number}} opts
   */
  function createSoundManager(opts = {}) {
    const AC = opts.AudioContextClass || null;
    const storage = opts.storage || null;
    const now = opts.now || (() => Date.now());

    let settings = loadSettings();
    let targetGain = volumeToGain(settings.volume); // 全体の音量（0〜0.9）
    let ctx = null;
    let master = null;
    let unavailable = !AC;
    let failForTest = false;
    const voices = [];          // 鳴っている効果音 { name, group, gain, oscs, end }
    const lastPlayed = {};      // 名前ごとの最後に鳴らした時刻（ミリ秒）
    const listeners = new Set();
    const log = [];             // 再生要求の記録（自動テスト・不具合調査用）

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
      listeners.forEach((fn) => { try { fn({ ...settings }); } catch (e) { /* 画面側の失敗は無視 */ } });
    }

    /** AudioContext を作る（または再開する）。ユーザー操作のイベントの中で呼ぶ */
    function ensureContext() {
      if (unavailable) return null;
      try {
        if (!ctx) {
          ctx = new AC();
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -14;
          comp.knee.value = 10;
          comp.ratio.value = 8;
          comp.attack.value = 0.003;
          comp.release.value = 0.15;
          master = ctx.createGain();
          master.gain.value = targetGain;
          master.connect(comp);
          comp.connect(ctx.destination);
        }
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
          const p = ctx.resume();
          if (p && typeof p.catch === 'function') p.catch(() => { /* 許可されなければ鳴らないだけ */ });
        }
        return ctx;
      } catch (e) {
        unavailable = true; // この端末では効果音を使わない（ゲームは続ける）
        ctx = null;
        return null;
      }
    }

    function fadeOutVoice(voice) {
      if (!ctx || voice.stopping) return;
      voice.stopping = true;
      const t = ctx.currentTime;
      try {
        voice.gain.gain.cancelScheduledValues(t);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, t);
        voice.gain.gain.linearRampToValueAtTime(0, t + FADE_OUT);
        voice.oscs.forEach((o) => { try { o.stop(t + FADE_OUT + 0.01); } catch (e) { /* すでに停止 */ } });
      } catch (e) { /* 無視 */ }
    }

    function removeVoice(voice) {
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
      try { voice.gain.disconnect(); } catch (e) { /* 無視 */ }
    }

    /** グループ（'long' など）の鳴っている音を短くフェードアウトさせる。省略するとすべて */
    function stop(group) {
      voices.filter((v) => !group || v.group === group).forEach(fadeOutVoice);
    }

    function schedule(name, recipe, delay) {
      const c = ensureContext();
      if (!c) throw new Error('AudioContext を使えません');
      // 長い音は、前の長い音を止めてから鳴らす（重なって騒がしくならないように）
      if (recipe.group === 'long') stop('long');
      // 同時に鳴る数の上限：古いものから止める
      const alive = voices.filter((v) => !v.stopping);
      for (let i = 0; i <= alive.length - MAX_VOICES; i++) fadeOutVoice(alive[i]);

      const t0 = c.currentTime + 0.005 + Math.max(0, delay || 0);
      const voiceGain = c.createGain();
      voiceGain.gain.value = recipe.gain;
      voiceGain.connect(master);
      const voice = { name, group: recipe.group, gain: voiceGain, oscs: [], end: t0 + recipeDuration(name), stopping: false };
      let remaining = recipe.notes.length;
      recipe.notes.forEach((n) => {
        const start = t0 + n.t;
        const end = start + n.d;
        const osc = c.createOscillator();
        const env = c.createGain();
        osc.type = n.type || 'sine';
        osc.frequency.setValueAtTime(n.f, start);
        if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, end);
        // 立ち上がりと終わりに短いフェードを入れて、プツッというノイズを防ぐ
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(n.v, start + ATTACK);
        env.gain.exponentialRampToValueAtTime(0.0008, end);
        env.gain.linearRampToValueAtTime(0, end + 0.01);
        osc.connect(env);
        env.connect(voiceGain);
        osc.onended = () => {
          try { osc.disconnect(); env.disconnect(); } catch (e) { /* 無視 */ }
          remaining -= 1;
          if (remaining === 0) removeVoice(voice); // 鳴り終わったら接続を外して解放する
        };
        osc.start(start);
        osc.stop(end + 0.02);
        voice.oscs.push(osc);
      });
      voices.push(voice);
    }

    /**
     * 効果音を鳴らす。鳴らした（予約した）ら true。OFF・音量0・連打の間引き・失敗のときは false。
     * 例外は外に出さない。
     */
    function play(name, playOpts = {}) {
      const entry = { name, at: now(), played: false, reason: '' };
      log.push(entry);
      if (log.length > 300) log.shift();
      try {
        const recipe = RECIPES[name];
        if (!recipe) { entry.reason = 'unknown'; return false; }
        if (!settings.enabled) { entry.reason = 'off'; return false; }
        if (settings.volume <= 0) { entry.reason = 'mute'; return false; }
        const last = lastPlayed[name];
        if (last !== undefined && entry.at - last < recipe.minGap) { entry.reason = 'throttled'; return false; }
        if (failForTest) throw new Error('テスト用の再生失敗');
        schedule(name, recipe, playOpts.delay);
        lastPlayed[name] = entry.at;
        entry.played = true;
        return true;
      } catch (e) {
        entry.reason = 'error';
        return false;
      }
    }

    function setEnabled(enabled) {
      settings = { ...settings, enabled: !!enabled };
      if (!settings.enabled) stop();
      saveSettings();
    }

    function setVolume(volume) {
      settings = normalizeSettings({ ...settings, volume });
      targetGain = volumeToGain(settings.volume);
      if (ctx && master) {
        try {
          // 急に変えるとプツッと鳴るので、短い時間でなめらかに変える
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.015);
        } catch (e) { /* 無視 */ }
      }
      saveSettings();
    }

    return {
      play,
      stop,
      /** 最初のユーザー操作で呼ぶ（AudioContext の作成・再開） */
      unlock: () => { ensureContext(); },
      setEnabled,
      setVolume,
      getSettings: () => ({ ...settings }),
      onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      names: () => Object.keys(RECIPES),
      // 自動テスト・不具合調査用
      debug: {
        get log() { return log.slice(); },
        clearLog() { log.length = 0; },
        simulateFailure(on) { failForTest = !!on; },
        get activeVoices() { return voices.filter((v) => !v.stopping).length; },
        get contextState() { return ctx ? ctx.state : (unavailable ? 'unavailable' : 'none'); },
        get masterGain() { return targetGain; },
        get contextCreated() { return !!ctx; },
        resetThrottle() { Object.keys(lastPlayed).forEach((k) => delete lastPlayed[k]); },
      },
    };
  }

  return {
    STORAGE_KEY, DEFAULT_SETTINGS, MAX_VOICES, RECIPES,
    recipeDuration, volumeToGain, normalizeSettings, createSoundManager,
  };
});
