#!/usr/bin/env node
/*
 * ストーリーモードの素材（背景画像・BGM）を、公開用の形に変換する（開発者用。ffmpeg が必要）。
 *   node tools/build-story-assets.js [元の素材フォルダ]   （省略時は「ストーリーモード用」）
 *
 * - 背景：PNG → WebP（1600×900・画質78）と、一覧用のサムネイル（480×270）。assets/story/backgrounds/
 * - BGM ：BGMer の SHORT 版 MP3 → 先頭・末尾の無音を切り、ラウドネスをそろえて MP3（160kbps）。assets/story/bgm/
 *         漢太鼓（exam）は元の音が非常に大きいので、ほかの曲より小さめにそろえる（会話を読みやすくするため）。
 *         曲の長さとループの位置を data/story/episodes.json の bgm.tracks に書き込む。
 * - エンディングの曲（BGMer「21世紀の幕開け」）：先頭・末尾の無音を切り、ラウドネスをそろえて assets/ending/ending.mp3 に。
 *         ループしない（曲の終わりの余韻はそのまま）。元の音源は「素材フォルダ/mp3/」か、リポジトリ直下に置く。
 * - 元の素材フォルダ（容量が大きい）はリポジトリに入れない（.gitignore）。変換後のファイルだけを公開する。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.resolve(process.argv[2] || path.join(ROOT, 'ストーリーモード用'));
const OUT_BG = path.join(ROOT, 'assets', 'story', 'backgrounds');
const OUT_BGM = path.join(ROOT, 'assets', 'story', 'bgm');
const EPISODES = path.join(ROOT, 'data', 'story', 'episodes.json');
const OUT_ENDING = path.join(ROOT, 'assets', 'ending');
const ENDING_SRC = '21世紀の幕開け.mp3';

const BACKGROUNDS = {
  'classroom-spring': '桜の見える春の教室.png',
  'classroom-desk': 'ノートと赤ペンのある机.png',
  'study-room': '自習室_夏.png',
  'study-room-autumn': '自習室_秋.png',
  'classroom-summer': '夏の明るい教室.png',
  'classroom-sunset': '夕暮れの教室・塾の玄関.png',
  'meeting-room': '面談室.png',
  'winter-camp': '冬合宿会場.png',
  'exam-room': 'リアル入試の試験室.png',
  'classroom-winter': '冬の教室.png',
  'classroom-sakura': '満開の桜が見える春の教室.png',
};
// 目標のラウドネス（LUFS）。会話の邪魔にならないよう控えめにし、漢太鼓はさらに小さくする
const TARGET_LUFS = { default: -16, exam: -19 };
const BGM = {
  daily: 'かのうせいのかたまり.mp3',
  friendship: 'きみは相棒.mp3',
  sad: '涙の結晶.mp3',
  growth: 'きみはやりとげた.mp3',
  exam: '漢太鼓.mp3',
  congratulations: 'こもれびの手紙.mp3',
  ending: '僕らのエピローグ.mp3',
};

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg に失敗しました: ${args.join(' ')}\n${r.stderr}`);
  return r.stderr;
}
const round3 = (n) => Math.round(n * 1000) / 1000;

function duration(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
}

function buildBackgrounds() {
  fs.mkdirSync(path.join(OUT_BG, 'thumbs'), { recursive: true });
  for (const [id, name] of Object.entries(BACKGROUNDS)) {
    const src = path.join(SRC, 'png', name);
    if (!fs.existsSync(src)) { console.log(`背景 ${id}: 元の画像がないので飛ばします（${name}）`); continue; }
    ffmpeg(['-y', '-v', 'error', '-i', src, '-vf', 'scale=1600:900:force_original_aspect_ratio=increase,crop=1600:900', '-c:v', 'libwebp', '-quality', '78', '-compression_level', '6', path.join(OUT_BG, `${id}.webp`)]);
    ffmpeg(['-y', '-v', 'error', '-i', src, '-vf', 'scale=480:270:force_original_aspect_ratio=increase,crop=480:270', '-c:v', 'libwebp', '-quality', '70', '-compression_level', '6', path.join(OUT_BG, 'thumbs', `${id}.webp`)]);
    const kb = (f) => Math.round(fs.statSync(f).size / 1024);
    console.log(`背景 ${id}: ${kb(path.join(OUT_BG, `${id}.webp`))}KB（サムネイル ${kb(path.join(OUT_BG, 'thumbs', `${id}.webp`))}KB）`);
  }
}

/** 先頭・末尾の無音（-50dB 未満）の範囲を調べる */
function soundRange(file) {
  const total = duration(file);
  const log = ffmpeg(['-v', 'info', '-i', file, '-af', 'silencedetect=noise=-50dB:d=0.05', '-f', 'null', '-']);
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const head = starts.length && starts[0] === 0 ? ends[0] : 0;
  const lastStart = starts[starts.length - 1];
  const tail = starts.length && ends.length < starts.length ? lastStart // 最後まで無音
    : (starts.length && Math.abs(ends[ends.length - 1] - total) < 0.05 ? lastStart : total);
  return { total, head, tail };
}

function loudness(file, filter) {
  const log = ffmpeg(['-v', 'info', '-i', file, '-af', `${filter ? `${filter},` : ''}ebur128=peak=true`, '-f', 'null', '-']);
  const m = /I:\s+(-?[\d.]+) LUFS[\s\S]*?Peak:\s+(-?[\d.]+) dBFS/.exec(log.slice(log.lastIndexOf('Summary')));
  return { lufs: Number(m[1]), peak: Number(m[2]) };
}

function buildBgm() {
  fs.mkdirSync(OUT_BGM, { recursive: true });
  const info = {};
  for (const [id, name] of Object.entries(BGM)) {
    const src = path.join(SRC, 'mp3', name);
    if (!fs.existsSync(src)) { console.log(`BGM ${id}: 元の音源がないので飛ばします（${name}）`); continue; }
    const r = soundRange(src);
    const start = Math.max(0, r.head - 0.02);
    const len = Math.min(r.total, r.tail + 0.15) - start;
    const before = loudness(src);
    const target = TARGET_LUFS[id] || TARGET_LUFS.default;
    const gainDb = round3(target - before.lufs);
    const out = path.join(OUT_BGM, `${id}.mp3`);
    // 切った境目でプツッと鳴らないよう、先頭10ms・末尾150msだけフェードを入れる
    const filter = `volume=${gainDb}dB,afade=t=in:d=0.01,afade=t=out:st=${round3(len - 0.15)}:d=0.15`;
    ffmpeg(['-y', '-v', 'error', '-ss', String(round3(start)), '-t', String(round3(len)), '-i', src, '-af', filter,
      '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-map_metadata', '-1', out]);
    const after = loudness(out);
    const d = duration(out);
    info[id] = { duration: round3(d), loopStart: 0, loopEnd: round3(d) };
    console.log(`BGM ${id}: ${round3(r.total)}秒 → ${round3(d)}秒（先頭の無音 ${round3(r.head)}秒・末尾の無音 ${round3(r.total - r.tail)}秒を削除） / ${before.lufs} → ${after.lufs} LUFS・ピーク ${after.peak} dBFS / ${Math.round(fs.statSync(out).size / 1024)}KB`);
  }
  // ループの位置を episodes.json に書き込む（曲名・ファイル名などの手で書いた項目は変えない）
  const data = JSON.parse(fs.readFileSync(EPISODES, 'utf8'));
  Object.entries(info).forEach(([id, v]) => { Object.assign(data.bgm.tracks[id], v); });
  fs.writeFileSync(EPISODES, `${JSON.stringify(data, null, 2)}\n`);
  console.log('data/story/episodes.json の bgm.tracks を更新しました。');
}

/** エンディングの曲（ループしない。末尾の余韻は残し、無音だけを切る） */
function buildEnding() {
  const src = [path.join(SRC, 'mp3', ENDING_SRC), path.join(ROOT, ENDING_SRC)].find((f) => fs.existsSync(f));
  if (!src) { console.log(`エンディング：元の音源がないので飛ばします（${ENDING_SRC}）`); return; }
  fs.mkdirSync(OUT_ENDING, { recursive: true });
  const r = soundRange(src);
  const start = Math.max(0, r.head - 0.02);
  const len = Math.min(r.total, r.tail + 0.3) - start;
  const before = loudness(src);
  const gainDb = round3(TARGET_LUFS.default - before.lufs);
  const out = path.join(OUT_ENDING, 'ending.mp3');
  const filter = `volume=${gainDb}dB,afade=t=in:d=0.01,afade=t=out:st=${round3(len - 0.3)}:d=0.3`;
  ffmpeg(['-y', '-v', 'error', '-ss', String(round3(start)), '-t', String(round3(len)), '-i', src, '-af', filter,
    '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-map_metadata', '-1', out]);
  const after = loudness(out);
  console.log(`エンディング：${round3(r.total)}秒 → ${round3(duration(out))}秒 / ${before.lufs} → ${after.lufs} LUFS・ピーク ${after.peak} dBFS / ${Math.round(fs.statSync(out).size / 1024)}KB`);
}

const only = process.env.ONLY; // 'bg'・'bgm'・'ending' のどれか1つだけ
if (only !== 'ending' && !fs.existsSync(SRC)) { console.error(`素材フォルダがありません: ${SRC}`); process.exit(1); }
if (!only || only === 'bg') buildBackgrounds();
if (!only || only === 'bgm') buildBgm();
if (!only || only === 'ending') buildEnding();
