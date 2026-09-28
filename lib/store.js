'use strict';

// Хранилище — один JSON-файл (data/db.json). Для каталога в десятки–сотни
// ароматов этого более чем достаточно, а бэкап — это просто копия папки data/.
// Запись атомарная: сначала во временный файл, потом переименование.

const fs = require('node:fs');
const path = require('node:path');

const auth = require('./auth');
const seed = require('./seed');
const { cleanPerfume, cleanSettings } = require('./sanitize');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DEFAULT_PASSWORD = 'katana';

let db = null;

function createInitialDb() {
  const now = Date.now();
  const perfumes = [];
  seed.perfumes.forEach((raw, i) => {
    const perfume = cleanPerfume(raw, null, perfumes);
    // Новинки — самые свежие, остальные «добавлены» раньше.
    perfume.createdAt = perfume.isNew ? now - i * 60_000 : now - (30 + i) * 86_400_000;
    perfume.updatedAt = perfume.createdAt;
    perfumes.push(perfume);
  });
  const password = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
  return {
    version: 1,
    auth: { passwordHash: auth.hashPassword(password), isDefault: !process.env.ADMIN_PASSWORD, sessionVersion: 1 },
    settings: cleanSettings(seed.settings, null),
    perfumes,
  };
}

function init() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  auth.init(DATA_DIR);
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
      throw new Error(`Не удалось прочитать ${DB_FILE}: ${err.message}. Восстановите файл из бэкапа.`);
    }
    // Новые поля настроек (если появились в коде) получают значения из демо-данных.
    db.settings = cleanSettings(db.settings, cleanSettings(seed.settings, null));
    db.perfumes = Array.isArray(db.perfumes) ? db.perfumes : [];
  } else {
    db = createInitialDb();
    save();
  }
  return db;
}

function get() {
  return db;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function save() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  // На Windows антивирус или редактор иногда держат файл — пробуем ещё пару раз.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, DB_FILE);
      return;
    } catch (err) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleep(60);
    }
  }
}

function isImageUsed(url) {
  return db.settings.aboutPhoto === url || db.perfumes.some((p) => p.image === url);
}

function removeUploadIfUnused(url) {
  if (!url || isImageUsed(url)) return;
  fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {});
}

// Фото, которые загрузили, но так и не сохранили в аромат, удаляются через сутки.
function cleanupUploads() {
  const dayAgo = Date.now() - 86_400_000;
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    const file = path.join(UPLOAD_DIR, name);
    try {
      if (!isImageUsed(`/uploads/${name}`) && fs.statSync(file).mtimeMs < dayAgo) fs.unlinkSync(file);
    } catch {
      /* файл заняли или уже удалили — не страшно */
    }
  }
}

module.exports = { init, get, save, removeUploadIfUnused, cleanupUploads, DATA_DIR, UPLOAD_DIR, DEFAULT_PASSWORD };
