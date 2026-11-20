#!/usr/bin/env node
/*
 * 開発用の簡易静的サーバー（依存パッケージなし）。
 *   node tools/serve.js [port]
 * file:// では fetch で JSON を読めないため、プレビュー確認時はこのサーバーを使う。
 * GitHub Pages に公開した場合はこのサーバーは不要。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400); res.end('Bad Request'); return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.resolve(ROOT, '.' + urlPath);
  // ルート外・node_modules へのアクセスは拒否
  if (!filePath.startsWith(ROOT + path.sep) || filePath.includes(`${path.sep}node_modules${path.sep}`)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not Found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`ポート ${PORT} は使用中です。別のポートを指定してください（例: npm run serve -- 8081）`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`プレビュー: http://localhost:${PORT}/`);
  console.log('終了するには Ctrl+C を押してください。');
});
