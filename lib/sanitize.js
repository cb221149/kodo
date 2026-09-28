'use strict';

// Всё, что приходит из админки, проходит через эти функции: обрезаем длину,
// приводим типы и отбрасываем лишнее. На сайт попадают только чистые данные.

const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const GENDERS = ['female', 'male', 'unisex'];
// Должны совпадать с Art.SHAPES и Art.CAPS в public/assets/js/art.js.
const SHAPES = ['classic', 'flask', 'tall', 'facet', 'block', 'arch', 'drop', 'pyramid'];
const CAPS = ['black', 'gold', 'wood', 'silver', 'red', 'pearl'];

// Цвет флакона-заглушки по умолчанию — по семейству аромата.
const FAMILY_COLORS = [
  ['цвет', '#d49a94'],
  ['фрукт', '#e3a24a'],
  ['цитрус', '#e2c15a'],
  ['морск', '#8fb1a9'],
  ['свеж', '#8fb1a9'],
  ['древес', '#9a6b43'],
  ['восточ', '#c0673e'],
  ['амбр', '#c07a3e'],
  ['прян', '#a0522d'],
  ['гурман', '#a65a2a'],
  ['фужер', '#6f8a6a'],
  ['шипр', '#7d7a4a'],
  ['кож', '#5a3d2b'],
  ['муск', '#d9cbb2'],
];

function str(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

// Многострочный текст: сохраняем абзацы, убираем мусорные пробелы.
function text(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function int(value, min, max, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

// Ноты: принимаем и массив, и строку «через запятую».
function tags(value, maxItems, maxLen) {
  const arr = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return arr
    .map((item) => str(String(item ?? ''), maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function lines(value, maxItems, maxLen) {
  return (Array.isArray(value) ? value : [])
    .map((item) => str(String(item ?? ''), maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function imagePath(value) {
  return typeof value === 'string' && /^\/uploads\/[a-f0-9]{16,64}\.(webp|jpg|png)$/.test(value) ? value : '';
}

function color(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function defaultColor(family) {
  const f = String(family || '').toLowerCase();
  const hit = FAMILY_COLORS.find(([key]) => f.includes(key));
  return hit ? hit[1] : '#c8a27a';
}

function prices(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((row) => ({ ml: int(row && row.ml, 0, 1000, 0), price: int(row && row.price, -1, 1e9, -1) }))
    .filter((row) => row.ml > 0 && row.price >= 0 && !seen.has(row.ml) && seen.add(row.ml))
    .sort((a, b) => a.ml - b.ml)
    .slice(0, 8);
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

// «Шафрановый шёлк» → «shafranovyy-shyolk»: адрес аромата для ссылок ?aroma=...
function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[а-яёўқғҳ]/g, (ch) => TRANSLIT[ch] ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
}

function uniqueSlug(base, all, selfId) {
  const taken = new Set(all.filter((p) => p.id !== selfId).map((p) => p.slug));
  let slug = base || 'aromat';
  for (let i = 2; taken.has(slug); i++) slug = `${base || 'aromat'}-${i}`;
  return slug;
}

function newId() {
  return 'p' + crypto.randomBytes(5).toString('hex');
}

// input — то, что пришло из формы (может быть частичным, например только {bestseller: true});
// prev — текущая версия аромата или null для нового; all — все ароматы (для уникального адреса).
function cleanPerfume(input, prev, all) {
  const src = { ...(prev || {}), ...(input || {}) };
  const notes = src.notes && typeof src.notes === 'object' ? src.notes : {};
  const family = capitalize(str(src.family, 40));
  const name = str(src.name, 80);
  if (!name) throw new HttpError(400, 'Укажите название аромата');

  const id = prev ? prev.id : newId();
  const now = Date.now();
  return {
    id,
    slug: prev && prev.name === name && prev.slug ? prev.slug : uniqueSlug(slugify(name), all || [], id),
    name,
    inspiredBy: str(src.inspiredBy, 120),
    gender: GENDERS.includes(src.gender) ? src.gender : 'unisex',
    family,
    description: text(src.description, 1500),
    notes: {
      top: tags(notes.top, 12, 40),
      heart: tags(notes.heart, 12, 40),
      base: tags(notes.base, 12, 40),
    },
    prices: prices(src.prices),
    longevity: int(src.longevity, 0, 5, 0),
    sillage: int(src.sillage, 0, 5, 0),
    image: imagePath(src.image),
    // Нарисованный флакон (показывается, когда нет фото). Пусто — форма подбирается автоматически.
    shape: SHAPES.includes(src.shape) ? src.shape : '',
    cap: CAPS.includes(src.cap) ? src.cap : '',
    color: color(src.color, defaultColor(family)),
    bestseller: bool(src.bestseller, false),
    isNew: bool(src.isNew, false),
    inStock: bool(src.inStock, true),
    visible: bool(src.visible, true),
    createdAt: prev ? prev.createdAt : now,
    updatedAt: now,
  };
}

function username(value, allowed, max) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?(t\.me|telegram\.me|instagram\.com)\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .replace(allowed, '')
    .slice(0, max);
}

const SETTINGS_FIELDS = {
  brand: (v) => str(v, 40),
  brandSub: (v) => str(v, 60),
  heroEyebrow: (v) => str(v, 80),
  heroTitle: (v) => str(v, 140),
  heroText: (v) => text(v, 600),
  masterName: (v) => str(v, 60),
  aboutTitle: (v) => str(v, 140),
  aboutText: (v) => text(v, 4000),
  aboutPhoto: (v) => imagePath(v),
  achievements: (v) => lines(v, 12, 160),
  pillars: (v) =>
    [0, 1, 2].map((i) => {
      const item = Array.isArray(v) && v[i] && typeof v[i] === 'object' ? v[i] : {};
      return { title: str(item.title, 40), text: text(item.text, 400) };
    }),
  studioTitle: (v) => str(v, 140),
  studioText: (v) => text(v, 1200),
  phone: (v) => str(v, 32),
  telegram: (v) => username(v, /[^A-Za-z0-9_]/g, 32),
  instagram: (v) => username(v, /[^A-Za-z0-9._]/g, 30),
  whatsapp: (v) => String(v || '').replace(/\D/g, '').slice(0, 15),
  address: (v) => str(v, 200),
  hours: (v) => str(v, 120),
  delivery: (v) => text(v, 600),
  payment: (v) => text(v, 600),
  faq: (v) =>
    (Array.isArray(v) ? v : [])
      .map((item) => ({ q: str(item && item.q, 200), a: text(item && item.a, 1200) }))
      .filter((item) => item.q && item.a)
      .slice(0, 20),
};

// Незнакомые ключи отбрасываются, отсутствующие — остаются как были.
function cleanSettings(input, prev) {
  const out = { ...(prev || {}) };
  for (const [key, clean] of Object.entries(SETTINGS_FIELDS)) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) out[key] = clean(input[key]);
    else if (!(key in out)) out[key] = clean(undefined);
  }
  for (const key of Object.keys(out)) if (!(key in SETTINGS_FIELDS)) delete out[key];
  return out;
}

module.exports = { HttpError, cleanPerfume, cleanSettings, slugify };
