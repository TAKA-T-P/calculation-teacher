/*
 * story-data.js
 * ストーリーのデータ（data/story/episodes.json と episode-01〜12.json）の読み込み・確認・名前の差し込み。
 *
 * - 本文の名前は {teacher}・{kei}・{shiho} の3つのプレースホルダーだけを置きかえる（それ以外の { } は置きかえない）。
 *   敬称（くん・さん）は本文に書き、名前の側には付けない（「{kei}くん」→「ケイくん」）。先生は「○○先生」で置きかわる。
 * - 置きかえた文字列は、表示側で必ず文字（textContent）として表示する（HTML として解釈しない）。
 * - 読み込みは fetch を外から渡せる（Node.js のテストではファイルから読む）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StoryData = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SPEAKERS = ['teacher', 'kei', 'shiho', 'narration'];
  const EFFECTS = ['thought', 'announce'];
  const TINTS = ['night'];
  const PLACEHOLDER = /\{(teacher|kei|shiho)\}/g;
  const ANY_PLACEHOLDER = /\{([^{}]*)\}/g;
  const BG_DIR = 'assets/story/backgrounds/';
  const BGM_DIR = 'assets/story/bgm/';

  /** 本文の {teacher}・{kei}・{shiho} を表示名に置きかえる */
  function fillText(text, names) {
    return String(text).replace(PLACEHOLDER, (m, key) => names[key]);
  }

  /** 吹き出しの話者名（先生は「○○先生」、生徒は名前だけ。地の文は名前なし） */
  function speakerLabel(speaker, names) {
    if (speaker === 'narration') return '';
    return names[speaker] || '';
  }

  // ------------------------------------------------------------ データの確認（読み込み時とテストで使う）
  function validateIndex(index) {
    const errors = [];
    if (!index || typeof index !== 'object') return ['episodes.json が読めません'];
    if (!Array.isArray(index.episodes) || !index.episodes.length) errors.push('episodes がありません');
    (index.episodes || []).forEach((e, i) => {
      if (e.no !== i + 1) errors.push(`${i + 1}番目の話の no が ${e.no} です`);
      if (!(e.month >= 1 && e.month <= 12)) errors.push(`第${e.no}話の month が不正です`);
      if (typeof e.title !== 'string' || !e.title) errors.push(`第${e.no}話の title がありません`);
      if (!Number.isInteger(e.required) || e.required < 0) errors.push(`第${e.no}話の required が不正です`);
      if (i > 0 && e.required < index.episodes[i - 1].required) errors.push(`第${e.no}話の required が前の話より小さいです`);
      if (typeof e.file !== 'string' || !/^episode-\d{2}\.json$/.test(e.file)) errors.push(`第${e.no}話の file が不正です`);
      if (e.thumb && !(index.backgrounds || {})[e.thumb]) errors.push(`第${e.no}話の thumb「${e.thumb}」が backgrounds にありません`);
    });
    Object.entries(index.backgrounds || {}).forEach(([id, b]) => {
      if (!b.file || !b.fallback) errors.push(`背景 ${id} に file・fallback がありません`);
      if (b.baseImage && !(index.backgrounds || {})[b.baseImage]) errors.push(`背景 ${id} の baseImage「${b.baseImage}」がありません`);
    });
    Object.entries(((index.bgm || {}).tracks) || {}).forEach(([id, t]) => {
      if (!t.title || !t.file) errors.push(`BGM ${id} に title・file がありません`);
    });
    return errors;
  }

  function validateEpisode(ep, index) {
    const errors = [];
    const where = `第${ep && ep.no}話`;
    if (!ep || typeof ep !== 'object') return ['話のデータが読めません'];
    const meta = (index.episodes || []).find((e) => e.no === ep.no);
    if (!meta) errors.push(`${where} は episodes.json にありません`);
    else ['month', 'title', 'required'].forEach((k) => { if (ep[k] !== meta[k]) errors.push(`${where} の ${k} が episodes.json と違います`); });
    if (!Array.isArray(ep.scenes) || !ep.scenes.length) { errors.push(`${where} に scenes がありません`); return errors; }
    const ids = new Set();
    ep.scenes.forEach((s, si) => {
      const sw = `${where} シーン${si + 1}`;
      if (!s.id || ids.has(s.id)) errors.push(`${sw} の id がないか重複しています`);
      ids.add(s.id);
      if (!(index.backgrounds || {})[s.background]) errors.push(`${sw} の背景「${s.background}」がありません`);
      if (s.bgm !== null && !(((index.bgm || {}).tracks) || {})[s.bgm]) errors.push(`${sw} の BGM「${s.bgm}」がありません`);
      if (s.tint && !TINTS.includes(s.tint)) errors.push(`${sw} の tint「${s.tint}」は使えません`);
      if (!Array.isArray(s.lines) || !s.lines.length) { errors.push(`${sw} にセリフがありません`); return; }
      s.lines.forEach((l, li) => {
        const lw = `${sw} ${li + 1}行目`;
        if (!SPEAKERS.includes(l.speaker)) errors.push(`${lw} の話者「${l.speaker}」は使えません`);
        if (typeof l.text !== 'string' || !l.text.trim()) errors.push(`${lw} にセリフがありません`);
        if (l.effect && !EFFECTS.includes(l.effect)) errors.push(`${lw} の effect「${l.effect}」は使えません`);
        if (l.effect === 'thought' && !['kei', 'shiho'].includes(l.speaker)) errors.push(`${lw}：心の声は生徒だけです`);
        for (const m of String(l.text).matchAll(ANY_PLACEHOLDER)) {
          if (!['teacher', 'kei', 'shiho'].includes(m[1])) errors.push(`${lw} の {${m[1]}} は使えません`);
        }
        if (/<[a-z/!]/i.test(l.text)) errors.push(`${lw} に HTML のタグのような文字があります`);
      });
    });
    return errors;
  }

  /** 話の全セリフを、シーンをまたいで1列に並べる（{ scene, sceneIndex, line, lineIndex }） */
  function flatten(ep) {
    const list = [];
    ep.scenes.forEach((scene, sceneIndex) => scene.lines.forEach((line, lineIndex) => list.push({ scene, sceneIndex, line, lineIndex })));
    return list;
  }

  /**
   * ストーリーのデータを読み込む。
   * @param {{fetchJson?: (url:string)=>Promise<any>, base?: string}} opts
   */
  function createStoryData(opts = {}) {
    const base = opts.base || 'data/story/';
    const fetchJson = opts.fetchJson || (async (url) => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${url} を読み込めませんでした（${res.status}）`);
      return res.json();
    });
    let index = null;
    let indexPromise = null;
    const episodes = new Map();

    async function loadIndex() {
      if (index) return index;
      if (!indexPromise) {
        indexPromise = fetchJson(`${base}episodes.json`).then((data) => {
          const errors = validateIndex(data);
          if (errors.length) throw new Error(`ストーリーのデータに誤りがあります：${errors[0]}`);
          index = data;
          return data;
        }).catch((e) => { indexPromise = null; throw e; });
      }
      return indexPromise;
    }

    async function loadEpisode(no) {
      if (episodes.has(no)) return episodes.get(no);
      const idx = await loadIndex();
      const meta = idx.episodes.find((e) => e.no === no);
      if (!meta) throw new Error(`第${no}話はありません`);
      const ep = await fetchJson(`${base}${meta.file}`);
      const errors = validateEpisode(ep, idx);
      if (errors.length) throw new Error(`第${no}話のデータに誤りがあります：${errors[0]}`);
      episodes.set(no, ep);
      return ep;
    }

    /** 全話を先に読み込む（話を開くボタンの操作の中で BGM を始められるように。iPad の自動再生の制限対策） */
    async function loadAll() {
      const idx = await loadIndex();
      await Promise.all(idx.episodes.map((e) => loadEpisode(e.no)));
      return idx;
    }

    return {
      loadIndex, loadEpisode, loadAll,
      get index() { return index; },
      episode: (no) => episodes.get(no) || null,
      backgroundUrl: (id, thumb = false) => {
        const b = index && index.backgrounds[id];
        return b ? `${BG_DIR}${thumb ? 'thumbs/' : ''}${b.file}` : null;
      },
      bgmUrl: (id) => {
        const t = index && index.bgm.tracks[id];
        return t ? `${BGM_DIR}${t.file}` : null;
      },
    };
  }

  return { SPEAKERS, EFFECTS, BG_DIR, BGM_DIR, fillText, speakerLabel, validateIndex, validateEpisode, flatten, createStoryData };
});
