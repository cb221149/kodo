'use strict';

// Вход в админку: один пароль мастера (хранится как scrypt-хэш),
// сессия — подписанная cookie. Смена пароля завершает все остальные сессии.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const COOKIE_NAME = 'kodo_session';
const SESSION_DAYS = 30;
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;

let secret = null;
const failures = new Map(); // ip -> { count, until }

function init(dataDir) {
  const file = path.join(dataDir, '.secret');
  try {
    secret = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  } catch {
    secret = null;
  }
  if (!secret || secret.length < 32) {
    secret = crypto.randomBytes(32);
    fs.writeFileSync(file, secret.toString('hex'), { mode: 0o600 });
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password).normalize('NFKC'), salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function sign(payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function isHttps(req) {
  return Boolean(req.socket.encrypted) || req.headers['x-forwarded-proto'] === 'https';
}

function cookie(req, value, maxAge) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${isHttps(req) ? '; Secure' : ''}`;
}

function sessionCookie(req, authState) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const payload = Buffer.from(JSON.stringify({ v: authState.sessionVersion, e: Date.now() + maxAge * 1000 })).toString('base64url');
  return cookie(req, `${payload}.${sign(payload)}`, maxAge);
}

function clearCookie(req) {
  return cookie(req, '', 0);
}

function readCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE_NAME) return part.slice(i + 1).trim();
  }
  return '';
}

function isAuthed(req, authState) {
  const [payload, sig] = readCookie(req).split('.');
  if (!payload || !sig) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.v === authState.sessionVersion && data.e > Date.now();
  } catch {
    return false;
  }
}

// Защита от перебора пароля: после MAX_FAILS ошибок IP блокируется на 15 минут.
function lockedFor(ip) {
  const entry = failures.get(ip);
  if (!entry) return 0;
  if (Date.now() > entry.until) {
    failures.delete(ip);
    return 0;
  }
  return entry.count >= MAX_FAILS ? entry.until - Date.now() : 0;
}

function registerFailure(ip) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || now > entry.until) failures.set(ip, { count: 1, until: now + LOCK_MS });
  else entry.count += 1;
  if (failures.size > 5000) failures.clear();
}

function registerSuccess(ip) {
  failures.delete(ip);
}

module.exports = {
  init,
  hashPassword,
  verifyPassword,
  sessionCookie,
  clearCookie,
  isAuthed,
  lockedFor,
  registerFailure,
  registerSuccess,
};
