'use strict';

// Сервер сайта без внешних зависимостей: `node server.js`.
//   /              — витрина (данные вшиваются прямо в HTML)
//   /admin/        — панель мастера
//   /api/...       — API (всё, что под /api/admin/, требует входа)
//   /uploads/...   — загруженные фото (лежат в data/uploads)

const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const store = require('./lib/store');
const auth = require('./lib/auth');
const { renderIndex } = require('./lib/render');
const { HttpError, cleanPerfume, cleanSettings } = require('./lib/sanitize');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_JSON_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = /^(text\/|application\/json|image\/svg\+xml)/;

const IMAGE_TYPES = {
  'image/webp': { ext: 'webp', ok: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  'image/jpeg': { ext: 'jpg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', ok: (b) => b.toString('hex', 0, 8) === '89504e470d0a1a0a' },
};

store.init();
store.cleanupUploads();

// ---------- ответы ----------

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
}

function send(req, res, status, body, headers = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  if (buf.length > 1024 && COMPRESSIBLE.test(headers['Content-Type'] || '') && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    buf = zlib.gzipSync(buf);
    headers['Content-Encoding'] = 'gzip';
  }
  headers.Vary = 'Accept-Encoding';
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

function json(req, res, status, data) {
  send(req, res, status, JSON.stringify(data), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
}

function redirect(res, location) {
  res.writeHead(301, { Location: location });
  res.end();
}

function notFoundPage(req, res) {
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Страница не найдена</title><body style="font-family:system-ui,sans-serif;background:#f4ede3;color:#231e1a;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center">
<div><p style="font-size:64px;margin:0;font-family:Georgia,serif">404</p><p>Такой страницы нет.</p><p><a href="/" style="color:#b0412c">Вернуться на главную</a></p></div></body></html>`;
  send(req, res, 404, html, { 'Content-Type': MIME['.html'] });
}

// ---------- запросы ----------

function readBody(req, limit) {
  if (Number(req.headers['content-length'] || 0) > limit) {
    return Promise.reject(new HttpError(413, 'Слишком большой файл или запрос'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new HttpError(413, 'Слишком большой файл или запрос'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => failed || resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Ожидался JSON');
  const raw = (await readBody(req, MAX_JSON_BYTES)).toString('utf8');
  let data;
  try {
    data = JSON.parse(raw || '{}');
  } catch {
    throw new HttpError(400, 'Некорректный JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Некорректные данные');
  return data;
}

// За прокси или туннелем (TRUST_PROXY=1) адрес сайта, каким его видит посетитель, приходит в X-Forwarded-Host.
function publicHost(req) {
  const forwarded = process.env.TRUST_PROXY ? String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() : '';
  return forwarded || req.headers.host || `localhost:${PORT}`;
}

// Браузер сам сообщает, откуда пришёл запрос: изменять данные можно только со своего сайта.
function isSameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin';
  const origin = req.headers.origin;
  if (origin) {
    try {
      const host = new URL(origin).host;
      return host === req.headers.host || host === publicHost(req);
    } catch {
      return false;
    }
  }
  return true; // не браузер (curl и т.п.) — у него нет чужих cookie
}

function clientIp(req) {
  if (process.env.TRUST_PROXY) {
    // Последний адрес дописал наш прокси — его не подделать, в отличие от первых.
    const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (chain.length) return chain[chain.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

function siteOrigin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  const proto = req.socket.encrypted || String(req.headers['x-forwarded-proto']).startsWith('https') ? 'https' : 'http';
  return `${proto}://${publicHost(req)}`;
}

// ---------- витрина ----------

function publicData() {
  const db = store.get();
  return { settings: db.settings, perfumes: db.perfumes.filter((p) => p.visible) };
}

let template = { mtimeMs: 0, html: '' };

async function sendIndex(req, res, url) {
  const file = path.join(PUBLIC_DIR, 'index.html');
  const stat = await fsp.stat(file);
  if (stat.mtimeMs !== template.mtimeMs) template = { mtimeMs: stat.mtimeMs, html: await fsp.readFile(file, 'utf8') };

  const html = renderIndex(template.html, publicData(), {
    origin: siteOrigin(req),
    page: url.pathname + url.search,
    aroma: url.searchParams.get('aroma') || '',
  });
  send(req, res, 200, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
}

async function serveStatic(req, res, root, urlPath, { immutable = false } = {}) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return notFoundPage(req, res);
  }
  if (rel.includes('\0') || rel.split(/[\\/]/).some((part) => part.startsWith('.'))) return notFoundPage(req, res);
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) return notFoundPage(req, res);

  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return notFoundPage(req, res);
  }
  if (stat.isDirectory()) return redirect(res, `${urlPath.replace(/\/?$/, '/')}`);

  const type = MIME[path.extname(file).toLowerCase()];
  if (!type) return notFoundPage(req, res);

  const headers = {
    'Content-Type': type,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  const since = Date.parse(req.headers['if-modified-since'] || '');
  if (since && Math.floor(stat.mtimeMs / 1000) <= Math.floor(since / 1000)) {
    res.writeHead(304, headers);
    return res.end();
  }
  send(req, res, 200, await fsp.readFile(file), headers);
}

// ---------- API ----------

async function login(req, res) {
  const ip = clientIp(req);
  const wait = auth.lockedFor(ip);
  if (wait) throw new HttpError(429, `Слишком много попыток. Попробуйте через ${Math.ceil(wait / 60000)} мин.`);
  const { password } = await readJson(req);
  const db = store.get();
  if (typeof password !== 'string' || !auth.verifyPassword(password, db.auth.passwordHash)) {
    auth.registerFailure(ip);
    throw new HttpError(401, 'Неверный пароль');
  }
  auth.registerSuccess(ip);
  res.setHeader('Set-Cookie', auth.sessionCookie(req, db.auth));
  json(req, res, 200, { ok: true });
}

async function uploadImage(req, res) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const kind = IMAGE_TYPES[type];
  if (!kind) throw new HttpError(415, 'Поддерживаются фото в форматах JPG, PNG и WebP');
  const buf = await readBody(req, MAX_IMAGE_BYTES);
  if (!kind.ok(buf)) throw new HttpError(415, 'Файл не похож на изображение');
  const name = `${crypto.randomBytes(12).toString('hex')}.${kind.ext}`;
  await fsp.writeFile(path.join(store.UPLOAD_DIR, name), buf);
  json(req, res, 201, { url: `/uploads/${name}` });
}

async function adminApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const db = store.get();

  if (route === 'GET /api/admin/state') {
    return json(req, res, 200, { perfumes: db.perfumes, settings: db.settings, defaultPassword: db.auth.isDefault });
  }

  if (route === 'POST /api/admin/perfumes') {
    const body = await readJson(req);
    const perfume = cleanPerfume(body, null, db.perfumes);
    db.perfumes.unshift(perfume);
    store.save();
    return json(req, res, 201, perfume);
  }

  if (route === 'POST /api/admin/perfumes/order') {
    const { ids } = await readJson(req);
    if (!Array.isArray(ids)) throw new HttpError(400, 'Нужен список ароматов');
    const rank = new Map(ids.map((id, i) => [id, i]));
    db.perfumes.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
    store.save();
    return json(req, res, 200, { ids: db.perfumes.map((p) => p.id) });
  }

  const one = url.pathname.match(/^\/api\/admin\/perfumes\/([\w-]+)$/);
  if (one && (req.method === 'PUT' || req.method === 'DELETE')) {
    const body = req.method === 'PUT' ? await readJson(req) : null;
    // Ищем аромат уже после чтения тела запроса — список мог измениться, пока оно шло.
    const index = db.perfumes.findIndex((p) => p.id === one[1]);
    if (index === -1) throw new HttpError(404, 'Аромат не найден — возможно, его уже удалили');
    const prev = db.perfumes[index];
    if (req.method === 'DELETE') {
      db.perfumes.splice(index, 1);
      store.save();
      store.removeUploadIfUnused(prev.image);
      return json(req, res, 200, { ok: true });
    }
    const next = cleanPerfume(body, prev, db.perfumes);
    db.perfumes[index] = next;
    store.save();
    if (prev.image !== next.image) store.removeUploadIfUnused(prev.image);
    return json(req, res, 200, next);
  }

  if (route === 'PUT /api/admin/settings') {
    const body = await readJson(req);
    const prevPhoto = db.settings.aboutPhoto;
    db.settings = cleanSettings(body, db.settings);
    store.save();
    if (prevPhoto !== db.settings.aboutPhoto) store.removeUploadIfUnused(prevPhoto);
    return json(req, res, 200, db.settings);
  }

  if (route === 'POST /api/admin/upload') return uploadImage(req, res);

  if (route === 'POST /api/admin/password') {
    const { current, next } = await readJson(req);
    if (!auth.verifyPassword(String(current || ''), db.auth.passwordHash)) throw new HttpError(400, 'Текущий пароль указан неверно');
    if (typeof next !== 'string' || next.length < 8) throw new HttpError(400, 'Новый пароль — минимум 8 символов');
    db.auth.passwordHash = auth.hashPassword(next);
    db.auth.isDefault = false;
    db.auth.sessionVersion += 1;
    store.save();
    res.setHeader('Set-Cookie', auth.sessionCookie(req, db.auth));
    return json(req, res, 200, { ok: true });
  }

  if (route === 'POST /api/admin/logout-others') {
    db.auth.sessionVersion += 1;
    store.save();
    res.setHeader('Set-Cookie', auth.sessionCookie(req, db.auth));
    return json(req, res, 200, { ok: true });
  }

  throw new HttpError(404, 'Не найдено');
}

async function handleApi(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !isSameOrigin(req)) throw new HttpError(403, 'Запрос отклонён');
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /api/public') return json(req, res, 200, publicData());
  if (route === 'GET /api/session') return json(req, res, 200, { authed: auth.isAuthed(req, store.get().auth) });
  if (route === 'POST /api/login') return login(req, res);
  if (route === 'POST /api/logout') {
    res.setHeader('Set-Cookie', auth.clearCookie(req));
    return json(req, res, 200, { ok: true });
  }
  if (url.pathname.startsWith('/api/admin/')) {
    if (!auth.isAuthed(req, store.get().auth)) throw new HttpError(401, 'Нужно войти');
    return adminApi(req, res, url);
  }
  throw new HttpError(404, 'Не найдено');
}

// ---------- маршруты ----------

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
    setSecurityHeaders(res);
    const p = url.pathname;
    if (p.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается');
    if (p === '/' || p === '/index.html') return await sendIndex(req, res, url);
    if (p === '/admin') return redirect(res, '/admin/');
    if (p.startsWith('/uploads/')) return await serveStatic(req, res, store.UPLOAD_DIR, p.slice('/uploads'.length), { immutable: true });
    return await serveStatic(req, res, PUBLIC_DIR, p);
  } catch (err) {
    if (res.headersSent) return res.destroy();
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    const message = status === 500 ? 'Ошибка сервера — попробуйте ещё раз' : err.message;
    if (status === 413) res.setHeader('Connection', 'close');
    if (url && url.pathname.startsWith('/api/')) return json(req, res, status, { error: message });
    send(req, res, status, message, { 'Content-Type': MIME['.txt'] });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nПорт ${PORT} уже занят. Запустите на другом: PORT=3001 npm start (в PowerShell: $env:PORT=3001; npm start)\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const db = store.get();
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);
  console.log(`\n  ${db.settings.brand} — сайт запущен`);
  console.log(`  Сайт:     http://localhost:${PORT}`);
  console.log(`  Админка:  http://localhost:${PORT}/admin`);
  if (HOST === '0.0.0.0' && lan.length) console.log(`  С телефона (та же Wi-Fi): ${lan.join(', ')}`);
  if (db.auth.isDefault) console.log(`  Пароль админки по умолчанию: «${store.DEFAULT_PASSWORD}» — смените его в разделе «Безопасность».`);
  console.log(`  Данные:   ${store.DATA_DIR}\n`);
});
