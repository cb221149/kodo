'use strict';

// Статическая версия сайта для бесплатного хостинга (Netlify, GitHub Pages): `npm run build:static` → папка dist/.
// Витрина — полностью, с текущим каталогом из data/db.json.
// Панель мастера — в демо-режиме: правки сохраняются только в браузере того, кто их делает.
// Все ссылки относительные, поэтому сайт работает и в корне домена, и в подпапке (логин.github.io/проект/).

const fs = require('node:fs');
const path = require('node:path');

const store = require('../lib/store');
const { renderIndex } = require('../lib/render');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');

// "/assets/x" → "assets/x" (или "../assets/x" для панели), "/" → "./"
function relativize(html, prefix) {
  return html.replace(/(\s(?:href|src))="\/"/g, `$1="${prefix || './'}"`).replace(/(\s(?:href|src))="\/(?!\/)/g, `$1="${prefix}`);
}

function markStatic(html, root) {
  return html.replace('<body>', `<body data-static-demo data-root="${root}">`);
}

const toJsonScript = (id, data) => `<script id="${id}" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

store.init();
const db = store.get();

// Фото: пути делаем относительными и копируем только используемые файлы.
const photos = new Set();
const relPhoto = (p) => {
  if (!p || !p.startsWith('/uploads/')) return p || '';
  photos.add(path.basename(p));
  return p.slice(1);
};
const perfumes = db.perfumes.map((p) => ({ ...p, image: relPhoto(p.image) }));
const settings = { ...db.settings, aboutPhoto: relPhoto(db.settings.aboutPhoto) };

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(PUBLIC, OUT, { recursive: true, filter: (src) => !path.basename(src).startsWith('.') });

// Витрина
const template = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
let index = renderIndex(template, { settings, perfumes: perfumes.filter((p) => p.visible) }, { origin: SITE_URL });
index = markStatic(relativize(index, ''), './').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="robots" content="noindex">');
fs.writeFileSync(path.join(OUT, 'index.html'), index);

// Панель мастера в демо-режиме: исходный каталог (вместе со скрытыми ароматами) вшит в страницу.
let admin = fs.readFileSync(path.join(PUBLIC, 'admin', 'index.html'), 'utf8');
admin = markStatic(relativize(admin, '../'), '../').replace('<script src="../assets/js/art.js">', `${toJsonScript('demo-data', { settings, perfumes })}\n  <script src="../assets/js/art.js">`);
fs.writeFileSync(path.join(OUT, 'admin', 'index.html'), admin);

if (photos.size) {
  fs.mkdirSync(path.join(OUT, 'uploads'), { recursive: true });
  for (const name of photos) fs.copyFileSync(path.join(store.UPLOAD_DIR, name), path.join(OUT, 'uploads', name));
}

// Демо не должно попадать в поисковики.
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

const files = fs.readdirSync(OUT, { recursive: true }).filter((f) => fs.statSync(path.join(OUT, f)).isFile());
console.log(`\n  Готово: ${OUT}`);
console.log(`  ${files.length} файлов, ароматов: ${perfumes.length}, фото: ${photos.size}`);
console.log('  Netlify: перетащите папку dist на https://app.netlify.com/drop');
console.log('  GitHub Pages: загрузите содержимое dist в репозиторий и включите Pages (см. README)\n');
