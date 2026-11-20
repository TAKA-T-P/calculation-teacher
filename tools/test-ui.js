#!/usr/bin/env node
/*
 * ゲーム画面の自動操作テスト（ヘッドレスブラウザ使用）。
 *   node tools/test-ui.js
 *
 * - 開発用サーバーを空きポートで起動し、tests/ui/ui-test.html をヘッドレスの Chrome / Edge で開く。
 * - スマートフォン（390px）・iPad 縦（820px）・iPad 横（1180px）の3つの画面幅で実行する。
 * - ブラウザが見つからない場合は「スキップ」と表示して終了する（CHROME_PATH で場所を指定できる）。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const VIEWPORTS = (process.env.UI_ONLY_PHONE ? [{ name: 'スマートフォン縦', w: 390, h: 844 }] : null) || [
  { name: 'スマートフォン縦', w: 390, h: 844 },
  { name: 'iPad 縦', w: 820, h: 1180 },
  { name: 'iPad 横・PC', w: 1180, h: 820 },
];

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'serve.js'), '0'], { cwd: ROOT });
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const m = /localhost:(\d+)\//.exec(buf);
      if (m) resolve({ child, port: Number(m[1]) });
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`サーバーが終了しました（${code}）`)));
  });
}

function runBrowser(browser, url, w, h) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ui-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--window-size=${Math.max(w + 40, 600)},${h + 400}`,
    '--virtual-time-budget=120000', '--dump-dom', url,
  ];
  return new Promise((resolve) => {
    execFile(browser, args, { maxBuffer: 64 * 1024 * 1024, timeout: 180000 }, (err, stdout) => {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 一時フォルダの削除失敗は無視 */ }
      const m = /RESULTS:(\{.*\})/s.exec(stdout || '');
      if (!m) return resolve({ fatal: `結果を取得できませんでした${err ? `（${err.message}）` : ''}`, results: [] });
      try {
        resolve(JSON.parse(m[1].replace(/<\/pre>[\s\S]*$/, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')));
      } catch (e) {
        resolve({ fatal: `結果の JSON を読めませんでした: ${e.message}`, results: [] });
      }
    });
  });
}

(async () => {
  const browser = findBrowser();
  if (!browser) {
    console.log('ヘッドレスブラウザ（Chrome / Edge）が見つからないため、UI テストをスキップしました。');
    console.log('CHROME_PATH 環境変数でブラウザの場所を指定できます。');
    process.exit(0);
  }
  console.log(`ブラウザ: ${browser}`);
  const { child, port } = await startServer();
  let failed = 0;
  let total = 0;
  try {
    for (const vp of VIEWPORTS) {
      const url = `http://localhost:${port}/tests/ui/ui-test.html?w=${vp.w}&h=${vp.h}`;
      console.log(`\n=== ${vp.name}（${vp.w}×${vp.h}）`);
      const res = await runBrowser(browser, url, vp.w, vp.h);
      if (res.fatal) { failed++; console.log(`NG  実行エラー: ${res.fatal}`); }
      for (const r of res.results) {
        if (r.name.startsWith('  情報')) { console.log(r.name); continue; }
        total++;
        if (!r.ok) failed++;
        console.log(`${r.ok ? 'OK ' : 'NG '} ${r.name}${r.ok ? '' : `\n      ${r.detail}`}`);
      }
      if (!res.fatal && res.results.length === 0) { failed++; console.log('NG  テストが1件も実行されませんでした'); }
    }
  } finally {
    child.kill();
  }
  console.log(failed === 0 ? `\nすべて成功しました（${total} 件）。` : `\n${failed} 件失敗しました。`);
  process.exit(failed === 0 ? 0 : 1);
})();
