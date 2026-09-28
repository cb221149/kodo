'use strict';

// Главная страница из шаблона public/index.html: подставляем тексты первого экрана,
// мета-теги для превью и данные каталога. Используется сервером (server.js)
// и сборщиком статической версии (scripts/build-static.js).

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// «Ароматы, *отточенные* как клинок» → слово в звёздочках становится курсивом.
const emphasize = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');

// data — { settings, perfumes } (только ароматы, видимые на сайте).
// origin — адрес сайта (https://домен) или '' — тогда без ссылок в мета-тегах.
// page — путь и параметры открытой страницы; aroma — адрес аромата из ?aroma=.
function renderIndex(template, data, { origin = '', page = '/', aroma = '' } = {}) {
  const s = data.settings;
  const brand = s.brand || 'Парфюмерная мастерская';
  const perfume = aroma ? data.perfumes.find((p) => p.slug === aroma || p.id === aroma) : null;

  // Для ссылки на конкретный аромат — свой заголовок, описание и фото в превью Telegram.
  let title = `${brand} — авторская парфюмерия ручной работы в Ташкенте`;
  let description = s.heroText;
  let image = '';
  if (perfume) {
    title = `${perfume.name}${perfume.inspiredBy ? ` — по мотивам ${perfume.inspiredBy}` : ''} | ${brand}`;
    description = perfume.description || description;
    if (perfume.image && origin && perfume.image.startsWith('/')) image = origin + perfume.image;
  }
  const url = origin ? origin + page : '';

  const vars = {
    title: esc(title),
    description: esc(String(description || '').replace(/\s+/g, ' ').slice(0, 200)),
    canonical: url ? `<link rel="canonical" href="${esc(url)}">` : '',
    ogUrl: url ? `<meta property="og:url" content="${esc(url)}">` : '',
    ogImage: image ? `<meta property="og:image" content="${esc(image)}">` : '',
    brand: esc(brand),
    brandSub: esc(s.brandSub),
    heroEyebrow: esc(s.heroEyebrow),
    heroTitle: emphasize(s.heroTitle),
    heroText: esc(s.heroText),
    bootstrap: `<script id="bootstrap" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? vars[key] : match));
}

module.exports = { renderIndex };
