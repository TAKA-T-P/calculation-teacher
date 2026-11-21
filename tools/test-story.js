#!/usr/bin/env node
/*
 * ストーリーモードのテスト（記録・解放条件・名前・データ・進行・BGM）。ブラウザ不要。
 *   node tools/test-story.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SR = require('../js/story-records.js');
const SD = require('../js/story-data.js');
const Story = require('../js/story.js');
const BGM = require('../js/story-bgm.js');
const SoundLib = require('../js/sound.js');
const Records = require('../js/records.js');
const D = require('../js/character-dialogue.js');

const ROOT = path.join(__dirname, '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const index = readJson('data/story/episodes.json');
const episodes = index.episodes.map((e) => readJson(`data/story/${e.file}`));

let failed = 0;
let count = 0;
async function test(label, fn) {
  count++;
  try { await fn(); console.log(`OK  ${label}`); } catch (e) { failed++; console.log(`NG  ${label}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ''} 期待値 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`); }

function fakeStorage(init = {}) {
  const map = new Map(Object.entries(init));
  return {
    map,
    failSet: false,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (this.failSet) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

const SPEC = [
  [1, 4, 'はじめまして、先生', 0], [2, 5, '赤ペンの本当の役目', 20], [3, 6, '間違いノートの秘密', 50], [4, 7, '夏の作戦会議', 100],
  [5, 8, 'あきらめない夏', 150], [6, 9, '小さな成長、大きな壁', 200], [7, 10, 'E判定からの挑戦', 250], [8, 11, 'もう一度、前を向いて', 300],
  [9, 12, 'リアル入試、開幕！', 350], [10, 1, '自分を信じる練習', 400], [11, 2, '最後の一問まで', 450], [12, 3, '桜の咲く教室で', 500],
];

(async () => {
  console.log('--- 解放条件・累積正解数');
  await test('[5] 全12話の話数・月・タイトル・解放条件が指示書のとおり（データと記録の両方）', () => {
    eq(index.episodes.map((e) => [e.no, e.month, e.title, e.required]), SPEC);
    eq(SR.DEFAULT_THRESHOLDS, SPEC.map((s) => s[3]), 'story-records.js の解放条件');
  });
  await test('[25] 境界値：0→1話、19→1、20→2、49→2 … 499→11、500→12、それ以上も12', () => {
    const cases = [[0, 1], [19, 1], [20, 2], [49, 2], [50, 3], [99, 3], [100, 4], [149, 4], [150, 5], [199, 5], [200, 6], [249, 6], [250, 7],
      [299, 7], [300, 8], [349, 8], [350, 9], [399, 9], [400, 10], [449, 10], [450, 11], [499, 11], [500, 12], [501, 12], [10000, 12]];
    cases.forEach(([t, n]) => eq(SR.unlockedCount(t), n, `${t}問`));
  });
  await test('[24-1〜5・8] 正解で+1、同じ採点結果は二重に数えない（別の正解はそれぞれ数える）', () => {
    const st = SR.createStoryStore({ storage: fakeStorage() });
    eq(st.totalCorrect, 0, '最初は0（過去の記録から推測しない）');
    const r1 = { correct: true };
    eq(st.addCorrectAnswer(r1).added, true);
    eq(st.addCorrectAnswer(r1).added, false, '同じ判定の二重加算');
    eq(st.totalCorrect, 1);
    st.addCorrectAnswer({ correct: true });
    eq(st.totalCorrect, 2);
  });
  await test('[24] 解放条件に達した正解で、新しく解放された話を返す。500問で全話、500を超えても数え続ける', () => {
    const st = SR.createStoryStore({ storage: fakeStorage() });
    const unlockedAt = {};
    for (let i = 1; i <= 520; i++) {
      const r = st.addCorrectAnswer({});
      r.newlyUnlocked.forEach((n) => { unlockedAt[n] = i; });
    }
    eq(unlockedAt, { 2: 20, 3: 50, 4: 100, 5: 150, 6: 200, 7: 250, 8: 300, 9: 350, 10: 400, 11: 450, 12: 500 });
    eq(st.totalCorrect, 520);
    eq(st.unlockedCount(), 12);
    eq(st.nextUnlock(), null);
  });
  await test('[24-10] 正解するたびに保存され、読み込み直しても残る（ストーリー専用のキー calcTeacher.story）', () => {
    const storage = fakeStorage();
    const st = SR.createStoryStore({ storage });
    for (let i = 0; i < 21; i++) st.addCorrectAnswer({});
    st.markRead(1);
    eq(SR.STORAGE_KEY, 'calcTeacher.story');
    const saved = JSON.parse(storage.getItem('calcTeacher.story'));
    eq([saved.version, saved.totalCorrect, saved.readEpisodes, saved.boyName, saved.girlName, saved.teacherName], [1, 21, [1], 'ケイ', 'シホ', '']);
    assert(!('unlockedEpisodes' in saved), '解放済みの話は保存しない（正解数から計算する）');
    const again = SR.createStoryStore({ storage });
    eq([again.totalCorrect, again.isRead(1), again.unlockedCount()], [21, true, 2]);
  });
  await test('既読：最後まで読んだ解放済みの話だけ既読にする。NEW は解放済み・未読の話', () => {
    const st = SR.createStoryStore({ storage: fakeStorage() });
    eq(st.unreadUnlocked(), [1], '最初は第1話が NEW');
    eq(st.markRead(2), false, '未解放の話は既読にしない');
    st.markRead(1);
    eq(st.unreadUnlocked(), []);
    for (let i = 0; i < 50; i++) st.addCorrectAnswer({});
    eq(st.unreadUnlocked(), [2, 3]);
    eq(st.nextUnlock(), { no: 4, need: 100, remaining: 50 });
    eq(st.remainingFor(12), 450);
    eq(st.remainingFor(2), 0);
  });
  await test('[記録] 壊れたデータは退避して初期状態から。新しい版のデータは上書きしない。保存できなくても例外を出さない', () => {
    const broken = fakeStorage({ 'calcTeacher.story': '{こわれた' });
    const st = SR.createStoryStore({ storage: broken });
    eq([st.totalCorrect, st.status.recovered], [0, true]);
    eq(broken.getItem('calcTeacher.story.backup'), '{こわれた');
    const newer = fakeStorage({ 'calcTeacher.story': JSON.stringify({ version: 9, totalCorrect: 70 }) });
    const st2 = SR.createStoryStore({ storage: newer });
    st2.addCorrectAnswer({});
    eq(st2.totalCorrect, 71, 'メモリ上では数える');
    eq(JSON.parse(newer.getItem('calcTeacher.story')).version, 9, '新しい版のデータを上書きしていない');
    const full = fakeStorage();
    full.failSet = true;
    const st3 = SR.createStoryStore({ storage: full });
    const r = st3.addCorrectAnswer({});
    eq([r.added, r.saved, st3.status.lastError], [true, false, 'quota']);
    const none = SR.createStoryStore({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
    none.addCorrectAnswer({});
    eq(none.totalCorrect, 1);
    eq(SR.createStoryStore({ storage: null }).addCorrectAnswer({}).total, 1);
  });
  await test('[記録] ゲームの「記録を消す」はストーリーの記録を消さない。ストーリーのリセットは名前を残す', () => {
    const storage = fakeStorage();
    const records = Records.createRecordStore({ storage });
    const st = SR.createStoryStore({ storage });
    for (let i = 0; i < 30; i++) st.addCorrectAnswer({});
    st.setName('teacher', '田中');
    records.recordOfficial('equation', { score: 500, maxStreak: 3 }, () => 'x');
    eq(records.clearAll().ok, true);
    eq(SR.createStoryStore({ storage }).totalCorrect, 30, 'ゲームの記録を消してもストーリーは残る');
    st.markRead(1);
    eq(st.resetProgress().ok, true);
    const again = SR.createStoryStore({ storage });
    eq([again.totalCorrect, again.unreadUnlocked(), again.names().teacher], [0, [1], '田中']);
    eq(Object.keys(JSON.parse(storage.getItem('calcTeacher.records'))).sort(), ['certification', 'timeAttack', 'version'], 'ゲームの記録の形式は変えていない');
  });

  console.log('--- 名前');
  await test('[26] 初期状態は「先生」「ケイ」「シホ」。先生の名前には「先生」がつき、末尾に「先生」があれば重ねない', () => {
    const st = SR.createStoryStore({ storage: fakeStorage() });
    eq(st.displayNames(), { teacher: '先生', kei: 'ケイ', shiho: 'シホ' });
    [['', '先生'], ['田中', '田中先生'], ['たかおみ', 'たかおみ先生'], ['田中先生', '田中先生'], ['  田中  ', '田中先生'], ['先生', '先生']]
      .forEach(([input, shown]) => eq(SR.teacherDisplayName(input), shown, `「${input}」`));
  });
  await test('[26] 生徒の名前は本文に反映され、「くん」「さん」が重ならない。空欄は初期名', () => {
    const st = SR.createStoryStore({ storage: fakeStorage() });
    st.setName('kei', 'ユウト');
    st.setName('shiho', 'ミサキさん');
    const nm = st.displayNames();
    eq(SD.fillText('{kei}くん、{shiho}さん、{teacher}！', nm), 'ユウトくん、ミサキさん、先生！');
    st.setName('kei', 'ケンくん');
    eq(SD.fillText('{kei}くん', st.displayNames()), 'ケンくん', '「ケンくんくん」にならない');
    st.setName('kei', '   ');
    eq(st.displayNames().kei, 'ケイ', '空欄は初期名');
    st.setName('shiho', 'さん');
    eq(st.displayNames().shiho, 'シホ', '敬称だけなら初期名');
  });
  await test('[26] 長い名前は10文字までにする。HTML のような文字もそのまま文字として扱い、プレースホルダー以外は置きかえない', () => {
    eq(SR.sanitizeName('あいうえおかきくけこさしすせそ'), 'あいうえおかきくけこ');
    eq(SR.sanitizeName('\u0007ab\u200bc\n d'), 'abc d');
    const nm = { teacher: SR.teacherDisplayName('<b>x</b>'), kei: SR.studentDisplayName('<img src=x onerror=alert(1)>', 'ケイ'), shiho: 'シホ' };
    eq(nm.teacher, '<b>x</b>先生');
    eq(SD.fillText('{kei}と{teacher}と{unknown}と{kei2}', nm), '<img src=x先生'.length ? `${nm.kei}と<b>x</b>先生と{unknown}と{kei2}` : '');
    eq(SR.sanitizeName('😀😀😀😀😀😀😀😀😀😀😀😀'), '😀'.repeat(10), '絵文字も1文字として数える');
  });
  await test('[26] 名前を変えても、累積正解数と既読はそのまま。名前はすぐに保存される', () => {
    const storage = fakeStorage();
    const st = SR.createStoryStore({ storage });
    for (let i = 0; i < 25; i++) st.addCorrectAnswer({});
    st.markRead(1); st.markRead(2);
    st.setName('teacher', '田中');
    st.setName('kei', 'ユウト');
    const again = SR.createStoryStore({ storage });
    eq([again.totalCorrect, again.unreadUnlocked(), again.displayNames()], [25, [], { teacher: '田中先生', kei: 'ユウト', shiho: 'シホ' }]);
  });

  console.log('--- ストーリーのデータ');
  await test('[2・27] episodes.json と全12話のデータに誤りがない（話者・背景・BGM・プレースホルダー・タグ）', () => {
    eq(SD.validateIndex(index), []);
    episodes.forEach((ep) => eq(SD.validateEpisode(ep, index), [], `第${ep.no}話`));
  });
  await test('[11] 各話15〜25吹き出し（第12話は25〜35）、シーンは1〜4つ', () => {
    episodes.forEach((ep) => {
      const n = SD.flatten(ep).length;
      const [min, max] = ep.no === 12 ? [25, 35] : [15, 25];
      assert(n >= min && n <= max, `第${ep.no}話 ${n}吹き出し`);
      assert(ep.scenes.length >= 1 && ep.scenes.length <= 4, `第${ep.no}話 ${ep.scenes.length}シーン`);
    });
  });
  await test('[15] 話ごとの BGM の割り当てが指示書のとおり（曲の切りかえはシーンの区切りだけ）', () => {
    const bgmOf = (no) => episodes[no - 1].scenes.map((s) => s.bgm);
    eq(bgmOf(1), ['daily']); eq(bgmOf(2), ['daily']); eq(bgmOf(3), ['daily']); eq(bgmOf(4), ['friendship']);
    eq(bgmOf(5), ['friendship', 'sad', 'growth']);
    eq(bgmOf(6), ['sad', 'growth']); eq(bgmOf(7), ['sad', 'growth']); eq(bgmOf(8), ['growth']);
    eq(bgmOf(9), ['friendship', null, 'exam', 'growth'], '第9話：合宿会場→静寂→漢太鼓→きみはやりとげた');
    eq(bgmOf(10), ['friendship', 'sad', 'friendship']); eq(bgmOf(11), ['growth']);
    eq(bgmOf(12), ['congratulations', 'congratulations', 'ending']);
    eq(Object.keys(index.bgm.tracks).sort(), ['congratulations', 'daily', 'ending', 'exam', 'friendship', 'growth', 'sad']);
    eq(Object.values(index.bgm.tracks).map((t) => t.title), ['かのうせいのかたまり', 'きみは相棒', '涙の結晶', 'きみはやりとげた', '漢太鼓', 'こもれびの手紙', '僕らのエピローグ']);
  });
  await test('[13・18・19] 背景：第9話は合宿会場→試験室→試験室→合宿会場、第12話は第1話と同じ春の教室（満開の桜）で終わる', () => {
    const bgOf = (no) => episodes[no - 1].scenes.map((s) => s.background);
    eq(bgOf(9), ['winter-camp', 'exam-room', 'exam-room', 'winter-camp']);
    eq(bgOf(1), ['classroom-spring']);
    eq(bgOf(12)[0], 'classroom-sakura');
    eq(bgOf(12)[2], 'classroom-sakura');
    eq(bgOf(7), ['meeting-room-rain', 'meeting-room-rain']);
    assert(episodes[11].ending === true && episodes.filter((e) => e.ending).length === 1, 'エンディングは第12話だけ');
    eq(index.ending.messages, ['間違いは、できるようになるための第一歩。', 'あなたの赤ペンが、誰かの未来を変える。']);
    eq(index.ending.theEnd, '― THE END ―');
  });
  await test('[K・L] 背景画像（WebP・サムネイル）と BGM（7曲）のファイルがある。ない背景（雨の面談室）は面談室の画像＋雨の演出、さらにグラデーションで代わりに表示する', () => {
    Object.entries(index.backgrounds).forEach(([id, b]) => {
      const file = path.join(ROOT, SD.BG_DIR, b.file);
      if (fs.existsSync(file)) assert(fs.existsSync(path.join(ROOT, SD.BG_DIR, 'thumbs', b.file)), `${id} のサムネイル`);
      else assert(b.baseImage && b.overlay && b.fallback, `${id}：画像がないときの代わりの表示`);
      assert(/gradient/.test(b.fallback), `${id} のグラデーション`);
    });
    assert(!fs.existsSync(path.join(ROOT, SD.BG_DIR, 'meeting-room-rain.webp')), '（雨の面談室はまだ画像がない想定）');
    Object.entries(index.bgm.tracks).forEach(([id, t]) => {
      const f = path.join(ROOT, SD.BGM_DIR, t.file);
      assert(fs.existsSync(f) && fs.statSync(f).size > 100000, `${id} の音声ファイル`);
      assert(t.loopEnd > 60 && t.loopStart === 0 && t.duration >= t.loopEnd, `${id} のループ位置`);
    });
  });
  await test('[3] 登場人物：先生にはアイコンがなく、ケイ・シホはゲームの生徒キャラクター（👦・👧）と同じアイコン', () => {
    assert(!('icon' in index.characters.teacher), '先生のアイコン');
    eq([index.characters.kei.icon, index.characters.shiho.icon], D.CHARACTERS.map((c) => c.emoji));
    eq([index.characters.kei.defaultName, index.characters.shiho.defaultName, index.characters.teacher.defaultName], ['ケイ', 'シホ', '']);
  });
  await test('[3] 一人称：ケイは「オレ」、シホは「私」。先生は「絶対に合格」などの約束をせず、性別がわかる一人称を使わない', () => {
    const all = episodes.flatMap((ep) => SD.flatten(ep).map((it) => ({ ...it.line, no: ep.no })));
    all.filter((l) => l.speaker === 'kei').forEach((l) => assert(!/(僕|ぼく|私(?!立)|わたし|俺)/.test(l.text), `第${l.no}話 ケイ：${l.text}`));
    all.filter((l) => l.speaker === 'shiho').forEach((l) => assert(!/(オレ|俺|僕|ぼく|あたし)/.test(l.text), `第${l.no}話 シホ：${l.text}`));
    all.filter((l) => l.speaker === 'teacher').forEach((l) => {
      assert(!/(僕|ぼく|俺|オレ|あたし|わたし|私は|私が|私も)/.test(l.text), `第${l.no}話 先生の一人称：${l.text}`);
      assert(!/(絶対(に)?合格|必ず合格|合格(でき|す)る(よ|から))/.test(l.text), `第${l.no}話 先生の約束：${l.text}`);
    });
    assert(all.some((l) => l.speaker === 'kei' && l.text.includes('オレ')) && all.some((l) => l.speaker === 'shiho' && l.text.includes('私')), '一人称が使われている');
  });
  await test('[1] 物語のテーマ：第1話で「まちがいは第一歩」を伝え、第12話で2人とも第一志望に合格する', () => {
    const text = (no) => SD.flatten(episodes[no - 1]).map((it) => it.line.text).join('\n');
    assert(text(1).includes('第一歩'), '第1話のメッセージ');
    assert(/第一志望、合格/.test(text(12)) && /私も……私も、合格しました/.test(text(12)), '第12話の合格報告');
    assert(text(12).includes('4月') && text(12).includes('答案'), '1年前の答案');
    assert(text(9).includes('それでは、試験を始めてください。'), '第9話の試験開始');
  });

  console.log('--- 進行');
  await test('[27] セリフを1つずつ進め、シーンが変わるところがわかる。最後まで読むと終わり（それ以上進まない）', () => {
    const r = new Story.StoryReader(episodes[8]);
    const items = [];
    let it;
    while ((it = r.next())) items.push(it);
    eq(items.length, SD.flatten(episodes[8]).length);
    eq(items.filter((x) => x.sceneChanged).map((x) => x.scene.id), ['camp', 'silence', 'exam', 'review']);
    assert(items[items.length - 1].last && r.finished && r.next() === null, '最後');
  });
  await test('[10] スキップで最後のセリフまで進む（途中からでも）', () => {
    const r = new Story.StoryReader(episodes[11]);
    r.next(); r.next();
    const rest = r.skip();
    eq(rest.length, SD.flatten(episodes[11]).length - 2);
    assert(r.finished && rest[rest.length - 1].last, 'スキップで最後まで');
    eq(r.skip(), []);
  });

  console.log('--- BGM');
  function makeBgm(opts = {}) {
    let t = 0;
    const timers = [];
    const elements = [];
    const storage = opts.storage || fakeStorage();
    class FakeAudio {
      constructor() { this.src = ''; this.currentTime = 0; this.duration = NaN; this.paused = true; this.volume = 1; this.listeners = {}; this.plays = 0; elements.push(this); }
      addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
      emit(type) { (this.listeners[type] || []).forEach((fn) => fn()); }
      play() { this.plays++; if (opts.failPlay) return Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; }
    }
    const player = BGM.createBgmPlayer({
      storage,
      createAudio: opts.noAudio ? () => { throw new Error('no audio'); } : () => new FakeAudio(),
      setInterval: (fn) => { timers.push(fn); return timers.length; },
      clearInterval: (id) => { timers[id - 1] = null; },
      now: () => t,
    });
    player.setTracks({
      daily: { url: 'assets/story/bgm/daily.mp3', loopStart: 0, loopEnd: 87 },
      sad: { url: 'assets/story/bgm/sad.mp3', loopStart: 0, loopEnd: 107 },
      exam: { url: 'assets/story/bgm/exam.mp3', loopStart: 0, loopEnd: 135 },
    });
    const advance = (ms) => { for (let i = 0; i < ms / 50; i++) { t += 50; player.debug.tick(); } };
    return { player, elements, advance, storage };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  await test('[16] 初期設定は BGM ON・音量25%。効果音とは別のキー（calcTeacher.storySound）に保存し、再読み込み後も残る', () => {
    const storage = fakeStorage();
    const { player } = makeBgm({ storage });
    eq(player.getSettings(), { enabled: true, volume: 25 });
    player.setVolume(60);
    player.setEnabled(false);
    eq(JSON.parse(storage.getItem('calcTeacher.storySound')), { enabled: false, volume: 60 });
    eq(makeBgm({ storage }).player.getSettings(), { enabled: false, volume: 60 });
    eq(storage.getItem('calcTeacher.sound'), null, '効果音の設定にはふれない');
  });
  await test('[28・20] 効果音の ON/OFF・音量と BGM の ON/OFF・音量はそれぞれ独立', () => {
    const storage = fakeStorage();
    const sound = SoundLib.createSoundManager({ storage });
    const { player } = makeBgm({ storage });
    sound.setEnabled(false); sound.setVolume(10);
    eq(player.getSettings(), { enabled: true, volume: 25 }, '効果音を OFF にしても BGM は ON');
    player.setEnabled(false); player.setVolume(90);
    eq(sound.getSettings(), { enabled: false, volume: 10 }, 'BGM を変えても効果音は変わらない');
    sound.setEnabled(true);
    eq(SoundLib.createSoundManager({ storage }).getSettings().enabled, true);
    eq(makeBgm({ storage }).player.getSettings().enabled, false);
  });
  await test('[28] 開始時に曲を鳴らし、約1秒でフェードイン。同じ曲を指定しても鳴らし直さない（途切れない）', () => {
    const { player, elements, advance } = makeBgm();
    player.unlock();
    eq(elements.length, 2, 'audio 要素は2つ（ループのつなぎ用）');
    player.play('daily');
    const lead = elements.find((e) => e.src.endsWith('daily.mp3') && !e.paused);
    assert(lead, '再生していない');
    eq(player.debug.playing, 'daily');
    advance(500);
    const half = player.debug.voices.find((v) => v.track === 'daily').level;
    assert(half > 0.3 && half < 0.7, `フェードイン途中 ${half}`);
    advance(600);
    eq(player.debug.voices.find((v) => v.track === 'daily').level, 1);
    const plays = lead.plays;
    player.play('daily');
    eq(lead.plays, plays, '同じ曲で再生し直した');
    eq(player.debug.log.filter((l) => l.type === 'start').length, 1);
  });
  await test('[28] シーンで別の曲に変わると、古い曲を約1秒でフェードアウト・新しい曲をフェードイン。null で無音（静寂）', () => {
    const { player, advance } = makeBgm();
    player.unlock();
    player.play('daily'); advance(1200);
    player.play('exam');
    advance(500);
    const v = player.debug.voices;
    const old = v.find((x) => x.track === 'daily');
    const neu = v.find((x) => x.track === 'exam');
    assert(old && old.state === 'fading-out' && old.level < 0.7 && old.level > 0.3, `フェードアウト途中 ${JSON.stringify(old)}`);
    assert(neu && neu.level > 0.3 && neu.level < 0.7, 'フェードイン途中');
    advance(700);
    eq(player.debug.voices.filter((x) => x.state !== 'idle').map((x) => x.track), ['exam']);
    player.play(null);
    advance(1200);
    eq(player.debug.voices.filter((x) => x.state !== 'idle').length, 0, '静寂');
    eq(player.debug.desired, null);
  });
  await test('[17・28] ループ：曲の終わりの少し前から、もう1つの audio 要素で曲の頭をクロスフェードで鳴らす（無音のすき間を作らない）', () => {
    const { player, elements, advance } = makeBgm();
    player.unlock();
    player.play('daily'); advance(1200);
    const first = elements.find((e) => !e.paused && e.src.endsWith('daily.mp3'));
    first.currentTime = 87 - BGM.CROSSFADE - 0.01;
    advance(50);
    eq(player.debug.log.filter((l) => l.type === 'loop').length, 0, 'まだ早い');
    first.currentTime = 87 - BGM.CROSSFADE + 0.05;
    advance(50);
    const second = elements.find((e) => e !== first);
    assert(!second.paused && second.src.endsWith('daily.mp3') && second.currentTime === 0, '曲の頭から鳴らしていない');
    eq(player.debug.log.filter((l) => l.type === 'loop' && l.mode === 'crossfade').length, 1);
    advance(600);
    const levels = player.debug.voices.map((x) => x.level);
    assert(levels.every((l) => l > 0.2 && l < 0.8), `クロスフェード中は両方が鳴る ${levels}`);
    advance(800);
    eq(player.debug.voices.filter((x) => x.state !== 'idle').length, 1, 'つなぎ終わったら1つ');
    eq(player.debug.playing, 'daily');
  });
  await test('[17] タイマーが間に合わず曲が終わったときは、曲の頭から再生し直す', () => {
    const { player, elements, advance } = makeBgm();
    player.unlock();
    player.play('sad'); advance(1200);
    const el = elements.find((e) => !e.paused);
    el.currentTime = 107; el.emit('ended');
    eq(el.currentTime, 0);
    eq(player.debug.log.filter((l) => l.type === 'loop' && l.mode === 'ended').length, 1);
  });
  await test('[16・28] ストーリーを閉じると止まる。OFF にすると止まり、ON にすると今の場面の曲から鳴る。音量が反映される', () => {
    const { player, advance } = makeBgm();
    player.unlock();
    player.play('daily'); advance(1200);
    const g25 = player.debug.outputGain();
    assert(Math.abs(g25 - BGM.volumeToGain(25)) < 1e-9 && g25 > 0.1 && g25 < 0.25, `音量25%の大きさ ${g25}`);
    player.setVolume(0);
    eq(player.debug.outputGain(), 0, '音量0は無音');
    player.setVolume(25);
    player.setEnabled(false);
    eq(player.debug.outputGain(), 0, 'OFF は無音');
    advance(400);
    eq(player.debug.voices.filter((x) => x.state !== 'idle').length, 0);
    player.play('sad');
    eq(player.debug.voices.filter((x) => x.state !== 'idle').length, 0, 'OFF のあいだは鳴らさない');
    player.setEnabled(true);
    eq(player.debug.playing, 'sad', 'ON にすると今の場面の曲');
    player.stop();
    advance(800);
    eq([player.debug.voices.filter((x) => x.state !== 'idle').length, player.debug.desired], [0, null]);
  });
  await test('[28] 音声ファイルがない・再生できない・audio が使えない環境でも、例外を出さない', async () => {
    const { player, elements } = makeBgm({ failPlay: true });
    player.unlock();
    player.play('daily');
    await flush();
    eq(player.debug.lastError, 'not-allowed');
    eq(player.debug.voices.filter((x) => x.state !== 'idle').length, 0);
    const b = makeBgm();
    b.player.unlock();
    b.player.play('daily');
    b.elements.find((e) => !e.paused).emit('error');
    eq(b.player.debug.lastError, 'load-failed');
    const c = makeBgm({ noAudio: true });
    c.player.unlock();
    eq(c.player.play('daily'), false);
    c.player.stop();
    eq(makeBgm().player.play('nothing'), false, '知らない曲');
    assert(elements.length === 2, '要素');
  });
  await test('[28] 画面が隠れたら一時停止し、戻ったら続きから鳴らす', () => {
    const { player, elements, advance } = makeBgm();
    player.unlock();
    player.play('daily'); advance(1200);
    const el = elements.find((e) => !e.paused);
    el.currentTime = 30;
    player.setHidden(true);
    assert(el.paused && player.debug.outputGain() === 0, '一時停止');
    player.setHidden(false);
    assert(!el.paused && el.currentTime === 30, '続きから');
  });

  console.log(failed ? `\n${failed} 件失敗しました。` : `\nすべて成功しました（${count} 件）。`);
  process.exit(failed ? 1 : 0);
})();
