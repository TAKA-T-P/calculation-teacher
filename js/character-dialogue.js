/*
 * character-dialogue.js
 * 生徒キャラクター（男の子・女の子）とセリフの管理。
 * タイトル画面と各モードの結果画面で、「答案を添削してもらう生徒」が先生（プレイヤー）に話しかける演出に使う。
 *
 * - DOM・記録・採点には一切ふれない（表示するキャラクターとセリフを選ぶだけ）。
 * - 乱数は外から渡す。出題順の乱数（?seed=）とは別のものを使うので、キャラクターの抽選で出題順は変わらない。
 * - 合否・ランク・自己ベストなどは、呼び出し側が既存のロジック（certification.js・records.js など）の結果を渡す。
 *   ここで合否判定やスコア計算はしない。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CharacterDialogue = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ キャラクター
  const CHARACTERS = [
    { id: 'boy', emoji: '👦', name: '男の子' },
    { id: 'girl', emoji: '👧', name: '女の子' },
  ];

  // 一人称（ぼく・わたし）を含むセリフは、対応するキャラクターだけが話す。{ text, only } の形で書く
  const LINES = {
    // タイトル画面
    title: [
      '先生！今日も添削よろしくね！',
      'この計算、合ってるか見てくれる？',
      { text: '先生、ぼくの計算をチェックして！', only: 'boy' },
      '先生！計算ミスを見つけられるかな？',
      '今日も先生の出番だよ！',
      { text: 'わたしの答案、採点してくれる？', only: 'girl' },
      '先生の添削力を見せて！',
      'ちょっと難しい問題もあるよ！',
      '先生、全部正しい答案もあるからね！',
      '先生！さっそく授業を始めよう！',
    ],

    // トレーニング結果（正解率）
    'training-perfect': [
      'すごい！先生、全部見抜いちゃったね！',
      'パーフェクト！さすが先生！',
      '先生の赤ペンからは逃げられないね！',
      '全部正解！もう立派な先生だね！',
    ],
    'training-high': [
      'さすが先生！頼りになるなあ！',
      'ほとんど見抜けたね！すごい！',
      '先生、あと少しでパーフェクトだよ！',
      '今日の添削、とってもよかったよ！',
    ],
    'training-mid': [
      'いい感じ！次はもっと見抜けそう！',
      '先生、一緒に計算を見直してみよう！',
      '少しずつ添削のコツがつかめてきたね！',
      '次はもっとたくさん見つけてね！',
    ],
    'training-low': [
      '先生、もう一度チャレンジしてみよう！',
      '計算ミスって、見つけるのが難しいね！',
      '先生、一緒に復習しよう！',
      '大丈夫！次はきっともっと見抜けるよ！',
    ],

    // タイムアタック結果
    'ta-best': [
      'やったね先生！新記録だよ！',
      '先生、自己ベスト更新おめでとう！',
      'すごい！前よりもっと速くなったね！',
      '先生の添削スピード、進化してる！',
    ],
    'ta-gameover': [
      '先生、あわてずに見直してみよう！',
      'スピードも大切だけど、正確さも大切だね！',
      '次は3回ミスしないように頑張ろう！',
      '先生、もう一回挑戦してみようよ！',
    ],
    'ta-high': [
      '先生、添削が速すぎるよ！',
      'すごいスピード！目が追いつかない！',
      '先生、まさに赤ペンの達人だね！',
      'その速さ、どうやって身につけたの！？',
    ],
    'ta-mid': [
      '先生、なかなかのスピードだね！',
      'いい感じ！次はもっと上を目指そう！',
      'すごい！たくさん添削できたね！',
      '先生、まだまだ記録が伸びそう！',
    ],
    'ta-low': [
      '先生、次はもっとたくさん添削しよう！',
      '速さだけじゃなく、正確さも大切だね！',
      'もう一回やってみようよ、先生！',
      '次のチャレンジも楽しみにしてるね！',
    ],

    // 認定試験結果
    'cert-master': [
      '先生、ついにマスターだね！おめでとう！',
      'すごい！もう伝説の先生だよ！',
      '全問正解なんて、さすがマスターティーチャー！',
      '先生、本当にすごい！最高ランク達成だね！',
    ],
    'cert-rankup': [
      '先生、ランクアップおめでとう！',
      'わあ！先生がまたレベルアップした！',
      '新しいランクだね！すごい！',
      '先生がどんどん頼もしくなってる！',
    ],
    'cert-pass': [
      '先生、合格おめでとう！',
      'さすが先生！しっかり見抜けたね！',
      '合格だね！次の試験も応援してるよ！',
      '先生の実力、ちゃんと証明できたね！',
    ],
    'cert-fail': [
      '先生、次はきっと合格できるよ！',
      '惜しかったね！もう一度挑戦しよう！',
      '先生、あきらめずに頑張って！',
      '一緒に計算を見直して、また挑戦しよう！',
    ],
  };

  // タイムアタックのセリフを切り替える得点（指示書の基準。称号の基準とは別に、ここで決める）
  const TA_SCORE_BANDS = { high: 2000, mid: 1000 };

  // ------------------------------------------------------------ 場面 → セリフのグループ
  /** トレーニング：正解率（0〜100。game.js の summary().rate）で決める */
  function trainingGroup(rate) {
    if (rate >= 100) return 'training-perfect';
    if (rate >= 80) return 'training-high';
    if (rate >= 50) return 'training-mid';
    return 'training-low';
  }

  /**
   * タイムアタック：優先順位は ①公式の自己ベスト更新 ②3回ミスでゲームオーバー ③得点。
   * @param {{official:boolean, isBest:boolean, gameOver:boolean, score:number}} r
   *   isBest は records.recordOfficial() の結果（初めての記録も含む）、score・gameOver は TimeAttackSession.summary() の値
   */
  function timeAttackGroup({ official, isBest, gameOver, score }) {
    if (official && isBest && score > 0) return 'ta-best'; // 0点の初回は「新記録」とは言わない
    if (gameOver) return 'ta-gameover';
    if (score >= TA_SCORE_BANDS.high) return 'ta-high';
    if (score >= TA_SCORE_BANDS.mid) return 'ta-mid';
    return 'ta-low';
  }

  /**
   * 認定試験：優先順位は ①最終試験に初合格 ②初合格でランクアップ ③合格 ④不合格。
   * @param {{passed:boolean, firstClear:boolean, rankUp:boolean, isFinal:boolean}} r
   *   passed は CertificationSession の判定、firstClear・rankUp は records.recordExam() の結果、isFinal は最終試験かどうか
   */
  function certGroup({ passed, firstClear, rankUp, isFinal }) {
    if (!passed) return 'cert-fail';
    if (firstClear && isFinal) return 'cert-master';
    if (firstClear && rankUp) return 'cert-rankup';
    return 'cert-pass';
  }

  // ------------------------------------------------------------ 抽選
  const textOf = (line) => (typeof line === 'string' ? line : line.text);
  const onlyOf = (line) => (typeof line === 'string' ? null : line.only || null);

  /** そのキャラクターが話せるセリフ */
  function linesFor(group, characterId) {
    const all = LINES[group];
    if (!all) throw new RangeError(`セリフのグループがありません: ${group}`);
    return all.filter((l) => !onlyOf(l) || onlyOf(l) === characterId).map(textOf);
  }

  function pickIndex(n, rng) {
    const i = Math.floor(rng() * n);
    return Math.min(Math.max(i, 0), n - 1);
  }

  /**
   * キャラクター（男の子・女の子を50％ずつ）を選び、そのグループから話せるセリフを1つ選ぶ。
   * @param {string} group LINES のキー
   * @param {() => number} rng 0以上1未満を返す乱数（テストでは固定できる）
   * @returns {{group:string, character:{id:string, emoji:string, name:string}, text:string}}
   */
  function pick(group, rng = Math.random) {
    const character = CHARACTERS[pickIndex(CHARACTERS.length, rng)];
    const lines = linesFor(group, character.id);
    return { group, character: { ...character }, text: lines[pickIndex(lines.length, rng)] };
  }

  return { CHARACTERS, LINES, TA_SCORE_BANDS, trainingGroup, timeAttackGroup, certGroup, linesFor, pick };
});
