/* Витрина: хиты, каталог с фильтрами и прайсом, карточка аромата,
   корзина и оформление заказа сообщением в Telegram. */
(function () {
  'use strict';

  // Статическая версия (Netlify, GitHub Pages): сервера нет, панель мастера работает в демо-режиме
  // и хранит правки в браузере — витрина на этом же устройстве показывает их.
  const STATIC_DEMO = document.body.hasAttribute('data-static-demo');
  const DEMO_KEY = 'kodo-demo-db-v1';
  let boot = JSON.parse(document.getElementById('bootstrap').textContent);
  let demoEdited = false;
  if (STATIC_DEMO) {
    try {
      const local = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null');
      if (local && local.settings && Array.isArray(local.perfumes)) {
        boot = { settings: local.settings, perfumes: local.perfumes.filter((p) => p.visible) };
        demoEdited = true;
      }
    } catch {
      /* нет доступа к хранилищу — показываем исходные данные */
    }
  }
  const S = boot.settings || {};
  const perfumes = boot.perfumes || [];
  const byId = new Map(perfumes.map((p) => [p.id, p]));

  // Корень сайта: «/» на своём сервере или папка сайта на GitHub Pages (https://логин.github.io/проект/).
  const ROOT = new URL(document.body.dataset.root || '/', location.href);
  const asset = (path) => (path && !/^(data:|https?:|\/)/.test(path) ? new URL(path, ROOT).href : path);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const emphasize = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const numFmt = new Intl.NumberFormat('ru-RU');
  const money = (n) => `${numFmt.format(n)} сум`;
  const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const plural = (n, forms) => {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b === 1) return forms[0];
    if (b > 1 && b < 5) return forms[1];
    return forms[2];
  };
  const GENDER = { female: 'Женский', male: 'Мужской', unisex: 'Унисекс' };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const minPrice = (p) => (p.prices.length ? Math.min(...p.prices.map((x) => x.price)) : 0);
  const allNotes = (p) => [...p.notes.top, ...p.notes.heart, ...p.notes.base];
  const priceFor = (p, ml) => p.prices.find((x) => x.ml === ml);
  // По умолчанию предлагаем средний объём (обычно 30 мл).
  const defaultVolume = (p) => p.prices[Math.floor((p.prices.length - 1) / 2)];
  const canBuy = (p) => p.inStock && p.prices.length > 0;

  function media(p) {
    return p.image
      ? `<img src="${esc(asset(p.image))}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
      : Art.bottle({ color: p.color, shape: p.shape, cap: p.cap, seed: p.id, label: S.brand });
  }

  // ---------- связь с мастером ----------

  const tgUrl = (text) =>
    S.telegram ? `https://t.me/${encodeURIComponent(S.telegram)}${text ? `?text=${encodeURIComponent(text)}` : ''}` : '';
  const waUrl = (text) => (S.whatsapp ? `https://wa.me/${S.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}` : '');
  const phoneHref = () => {
    const digits = String(S.phone || '').replace(/[^\d+]/g, '');
    return digits ? `tel:${digits}` : '';
  };

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* на http-адресе в локальной сети буфер обмена недоступен — пробуем старый способ */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      (document.querySelector('dialog[open]') || document.body).appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  // Открывает чат с мастером; текст подставляется в поле ввода и на всякий случай копируется.
  function openChat(text, successMessage) {
    const url = tgUrl(text) || waUrl(text);
    if (url) {
      window.open(url, '_blank', 'noopener'); // строго внутри клика, иначе браузер заблокирует окно
      copyText(text).then((copied) =>
        toast(successMessage || (copied ? 'Открываем чат — текст уже подставлен и скопирован' : 'Открываем чат — текст уже подставлен')),
      );
    } else if (phoneHref()) {
      location.href = phoneHref();
    } else {
      toast('Контакты мастера пока не указаны');
    }
  }

  // ---------- уведомления ----------

  const toasts = $('[data-toasts]');
  function toast(message, action) {
    // Модальное окно лежит поверх страницы, поэтому уведомление показываем внутри него.
    (document.querySelector('dialog[open]') || document.body).appendChild(toasts);
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    if (action) {
      el.querySelector('button').addEventListener('click', () => {
        el.remove();
        action.run();
      });
    }
    toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 320);
    }, action ? 4500 : 3000);
  }

  // ---------- тексты из настроек ----------

  function fillSettings() {
    $$('[data-s]').forEach((el) => (el.textContent = S[el.dataset.s] || ''));
    $$('[data-s-em]').forEach((el) => (el.innerHTML = emphasize(S[el.dataset.sEm] || '')));
    $$('[data-s-paras]').forEach((el) => {
      el.innerHTML = String(S[el.dataset.sParas] || '')
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`)
        .join('');
    });
    $$('[data-when]').forEach((el) => (el.hidden = !S[el.dataset.when]));
    $$('[data-tg-link]').forEach((el) => {
      const url = tgUrl(el.dataset.tgText || '');
      if (url) el.href = url;
      else el.hidden = true;
    });
    if (!S.telegram && S.whatsapp) $('[data-checkout]').lastChild.textContent = 'Оформить в WhatsApp';
    $$('[data-phone-link]').forEach((el) => (el.href = phoneHref()));
    $$('[data-ig-link]').forEach((el) => (el.href = S.instagram ? `https://instagram.com/${encodeURIComponent(S.instagram)}` : '#'));
    $$('[data-wa-link]').forEach((el) => (el.href = waUrl('')));
    $$('[data-year]').forEach((el) => (el.textContent = new Date().getFullYear()));

    const achievements = S.achievements || [];
    const achList = $('[data-achievements]');
    achList.innerHTML = achievements.map((a) => `<li>${esc(a)}</li>`).join('');
    achList.hidden = !achievements.length;

    const KANJI = ['刀', '鋏', '香'];
    $('[data-pillars]').innerHTML = (S.pillars || [])
      .map((p, i) =>
        p.title || p.text
          ? `<article class="pillar" data-reveal>
              <span class="pillar__kanji" aria-hidden="true">${KANJI[i]}</span>
              <h3>${esc(p.title)}</h3>
              <p>${esc(p.text)}</p>
              <span class="pillar__bg" aria-hidden="true">${KANJI[i]}</span>
            </article>`
          : '',
      )
      .join('');

    const faq = S.faq || [];
    $('#faq').hidden = !faq.length;
    $('[data-faq]').innerHTML = faq
      .map((f, i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
      .join('');

    $('[data-about-media]').innerHTML = S.aboutPhoto
      ? `<img src="${esc(asset(S.aboutPhoto))}" alt="${esc(S.masterName || 'Мастер')}" loading="lazy">`
      : `<div class="about__placeholder">
          <span class="about__kanji" aria-hidden="true">匠</span>
          <div class="about__blade">${Art.katana()}</div>
          <p class="about__cap">匠 · такуми — мастер своего дела</p>
        </div>`;
  }

  // ---------- первый экран ----------

  function renderHero() {
    $$('[data-art="katana"]').forEach((el) => (el.innerHTML = Art.katana()));
    $('[data-art="hero-bottle"]').innerHTML = Art.bottle({ color: '#b5643c', shape: 'classic', cap: '#231e1a', label: S.brand, seed: 'hero' });

    if (!perfumes.length) {
      $('[data-facts]').hidden = true;
      return;
    }
    $('[data-stat="count"]').textContent = perfumes.length;
    $('[data-stat="count-label"]').textContent = `${plural(perfumes.length, ['аромат', 'аромата', 'ароматов'])} в коллекции`;

    let cheapest = null;
    perfumes.forEach((p) => p.prices.forEach((row) => {
      if (!cheapest || row.price < cheapest.price) cheapest = row;
    }));
    if (cheapest) {
      $('[data-stat="from"]').textContent = `от ${numFmt.format(cheapest.price)}`;
      $('[data-stat="from-label"]').textContent = `сум за ${cheapest.ml} мл`;
    }

    const top = perfumes.find((p) => p.bestseller);
    const pick = $('[data-hero-pick]');
    if (top) {
      pick.dataset.open = top.id;
      pick.setAttribute('aria-label', `Хит продаж: ${top.name}`);
      pick.innerHTML = `
        <span class="hero__pick-thumb">${media(top)}</span>
        <span><small>Хит №1</small><b>${esc(top.name)}</b><span>${minPrice(top) ? `от ${money(minPrice(top))}` : 'цена по запросу'}</span></span>`;
      pick.hidden = false;
    }
  }

  // ---------- карточки ----------

  function card(p, rank) {
    const from = minPrice(p);
    const notes = allNotes(p).slice(0, 3).join(' · ');
    const badges = [
      p.bestseller && !rank ? '<span class="badge badge--hit">Хит</span>' : '',
      p.isNew ? '<span class="badge badge--new">Новинка</span>' : '',
      !p.inStock ? '<span class="badge badge--out">Нет в наличии</span>' : '',
    ].join('');
    return `<article class="card${p.inStock ? '' : ' is-out'}${rank ? ' card--hit' : ''}" data-reveal>
      <div class="card__media">
        ${media(p)}
        ${badges ? `<div class="card__badges">${badges}</div>` : ''}
        ${rank ? `<span class="card__rank" aria-hidden="true">${String(rank).padStart(2, '0')}</span>` : ''}
      </div>
      <div class="card__body">
        ${p.inspiredBy ? `<p class="card__inspired">по мотивам ${esc(p.inspiredBy)}</p>` : ''}
        <h3 class="card__name"><button type="button" class="card__open" data-open="${esc(p.id)}">${esc(p.name)}</button></h3>
        ${notes ? `<p class="card__notes">${esc(notes)}</p>` : ''}
        <div class="card__foot">
          <span class="card__price">${from ? `<small>от</small>${money(from)}` : 'Цена по запросу'}</span>
          ${canBuy(p) ? `<button type="button" class="card__add" data-quick-add="${esc(p.id)}" aria-label="Добавить «${esc(p.name)}» в корзину">${icon('plus')}</button>` : ''}
        </div>
      </div>
    </article>`;
  }

  function renderHits() {
    const hits = perfumes.filter((p) => p.bestseller);
    $('#hits').hidden = !hits.length;
    $$('[data-nav-hits]').forEach((a) => (a.hidden = !hits.length));
    $('[data-hits]').innerHTML = hits.map((p, i) => card(p, i + 1)).join('');
  }

  // ---------- каталог ----------

  const filter = { q: '', gender: '', family: '', sort: '', view: 'grid' };
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

  function initFilters() {
    const counts = new Map();
    perfumes.forEach((p) => {
      if (!p.family) return;
      const key = norm(p.family);
      counts.set(key, { label: p.family, n: (counts.get(key)?.n || 0) + 1 });
    });
    const select = $('[data-filter="family"]');
    [...counts.entries()]
      .sort((a, b) => b[1].n - a[1].n || a[1].label.localeCompare(b[1].label, 'ru'))
      .forEach(([key, { label, n }]) => select.insertAdjacentHTML('beforeend', `<option value="${esc(key)}">${esc(label)} (${n})</option>`));

    // Показываем только те «для кого», что реально есть в каталоге.
    $$('[data-filter="gender"] .chip').forEach((chip) => {
      if (chip.dataset.value) chip.hidden = !perfumes.some((p) => p.gender === chip.dataset.value);
    });

    let timer;
    $('[data-filter="q"]').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        filter.q = e.target.value.trim();
        renderCatalog();
      }, 150);
    });
    $('[data-filter="gender"]').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      filter.gender = chip.dataset.value;
      $$('[data-filter="gender"] .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      renderCatalog();
    });
    select.addEventListener('change', (e) => {
      filter.family = e.target.value;
      renderCatalog();
    });
    $('[data-filter="sort"]').addEventListener('change', (e) => {
      filter.sort = e.target.value;
      renderCatalog();
    });
    $$('[data-view]').forEach((btn) =>
      btn.addEventListener('click', () => {
        filter.view = btn.dataset.view;
        $$('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        renderCatalog();
      }),
    );
  }

  function resetFilters() {
    Object.assign(filter, { q: '', gender: '', family: '', sort: '' });
    $('[data-filter="q"]').value = '';
    $('[data-filter="family"]').value = '';
    $('[data-filter="sort"]').value = '';
    $$('[data-filter="gender"] .chip').forEach((c) => c.setAttribute('aria-pressed', String(!c.dataset.value)));
    renderCatalog();
  }

  function matches(p) {
    if (filter.gender && p.gender !== filter.gender) return false;
    if (filter.family && norm(p.family) !== filter.family) return false;
    if (!filter.q) return true;
    const hay = norm([p.name, p.inspiredBy, p.family, p.description, GENDER[p.gender], ...allNotes(p)].join(' '));
    return norm(filter.q).split(/\s+/).every((word) => hay.includes(word));
  }

  function sorted(list) {
    const arr = list.slice();
    const by = {
      hits: (a, b) => b.bestseller - a.bestseller,
      new: (a, b) => b.isNew - a.isNew || b.createdAt - a.createdAt,
      cheap: (a, b) => minPrice(a) - minPrice(b),
      expensive: (a, b) => minPrice(b) - minPrice(a),
    }[filter.sort];
    return by ? arr.sort(by) : arr;
  }

  function renderCatalog() {
    const list = sorted(perfumes.filter(matches));
    const grid = $('[data-grid]');
    const table = $('[data-table]');
    const total = perfumes.length;
    $('[data-count]').textContent =
      list.length === total
        ? `${total} ${plural(total, ['аромат', 'аромата', 'ароматов'])} в каталоге`
        : `Найдено: ${list.length} из ${total}`;

    if (!list.length) {
      table.hidden = true;
      grid.hidden = false;
      grid.innerHTML = `<div class="empty">
          <span class="seal seal--lg" aria-hidden="true">香</span>
          <p class="empty__title">Ничего не нашлось</p>
          <p>${filter.q ? `По запросу «${esc(filter.q)}» ароматов нет — но мастер может сделать его под заказ.` : 'Попробуйте изменить фильтры.'}</p>
          <div class="empty__actions">
            ${filter.q ? `<button type="button" class="btn btn--dark" data-ask>${icon('tg')}Спросить мастера</button>` : ''}
            <button type="button" class="btn btn--line" data-reset>Сбросить фильтры</button>
          </div>
        </div>`;
      return;
    }

    grid.hidden = filter.view !== 'grid';
    table.hidden = filter.view !== 'table';
    if (filter.view === 'grid') {
      grid.innerHTML = list.map((p) => card(p)).join('');
      // Карточки после фильтрации показываем сразу, без анимации появления.
      $$('[data-reveal]', grid).forEach((el) => el.removeAttribute('data-reveal'));
    } else {
      table.innerHTML = priceTable(list);
    }
  }

  function priceTable(list) {
    const volumes = [...new Set(list.flatMap((p) => p.prices.map((x) => x.ml)))].sort((a, b) => a - b);
    const rows = list
      .map((p) => {
        const cells = volumes
          .map((ml) => {
            const row = priceFor(p, ml);
            if (!row) return `<td class="pl-num" data-label="${ml} мл"><span class="pl-dash">—</span></td>`;
            const price = numFmt.format(row.price);
            return `<td class="pl-num" data-label="${ml} мл">${
              p.inStock
                ? `<button type="button" class="pl-price" data-add="${esc(p.id)}" data-ml="${ml}" aria-label="Добавить в корзину: ${esc(p.name)}, ${ml} мл, ${price} сум">${price}</button>`
                : `<span class="pl-price is-muted">${price}</span>`
            }</td>`;
          })
          .join('');
        return `<tr${p.inStock ? '' : ' class="is-out"'}>
            <th scope="row"><button type="button" class="pl-name" data-open="${esc(p.id)}">
              <span class="pl-thumb">${media(p)}</span>
              <span><b>${esc(p.name)}</b>${p.inspiredBy ? `<small>${esc(p.inspiredBy)}</small>` : ''}</span>
            </button></th>
            <td class="pl-gender">${GENDER[p.gender]}</td>
            ${cells}
          </tr>`;
      })
      .join('');
    return `<table>
        <thead><tr><th scope="col">Аромат</th><th scope="col" class="pl-gender">Для кого</th>${volumes.map((ml) => `<th scope="col" class="pl-num">${ml} мл</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="pl-note">Цены в сумах. Нажмите на цену, чтобы положить аромат в корзину.</p>`;
  }

  // ---------- окно аромата ----------

  const pd = $('#product');
  const baseTitle = `${S.brand} — авторская парфюмерия ручной работы в Ташкенте`;
  let current = null; // { p, ml, qty }
  let returnFocus = null;

  function pyramid(p) {
    const rows = [
      ['Верх', p.notes.top, 4],
      ['Сердце', p.notes.heart, 5.5],
      ['База', p.notes.base, 7],
    ].filter(([, list]) => list.length);
    if (!rows.length) return '';
    return `<div class="pyramid">${rows
      .map(
        ([label, list, size]) =>
          `<div class="pyramid__row"><span class="pyramid__label"><i style="--t:${size}px"></i>${label}</span><span>${esc(list.join(', '))}</span></div>`,
      )
      .join('')}</div>`;
  }

  function meters(p) {
    const meter = (label, value) =>
      value
        ? `<div><div class="meter__label"><span>${label}</span><span>${value}/5</span></div><div class="meter__bar" role="img" aria-label="${label}: ${value} из 5">${[1, 2, 3, 4, 5]
            .map((i) => `<span${i <= value ? ' class="on"' : ''}></span>`)
            .join('')}</div></div>`
        : '';
    const html = meter('Стойкость', p.longevity) + meter('Шлейф', p.sillage);
    return html ? `<div class="meters">${html}</div>` : '';
  }

  function renderProduct() {
    const { p } = current;
    const badges = [p.isNew ? '<span class="badge badge--new">Новинка</span>' : '', !p.inStock ? '<span class="badge badge--out">Нет в наличии</span>' : ''].join('');
    let actions;
    if (canBuy(p)) {
      actions = `<div class="pd__actions">
          <button type="button" class="btn btn--dark" data-pd-add>${icon('bag')}В корзину</button>
          <button type="button" class="btn btn--line" data-pd-order>${icon('tg')}Заказать сразу</button>
        </div>`;
    } else {
      actions = `<div class="pd__actions pd__actions--single">
          <button type="button" class="btn btn--dark" data-pd-ask>${icon('tg')}${p.inStock ? 'Узнать цену' : 'Спросить о наличии'}</button>
        </div>`;
    }

    $('[data-pd]').innerHTML = `
      <button type="button" class="icon-btn pd__close" data-pd-close aria-label="Закрыть">${icon('close')}</button>
      <div class="pd__media">${media(p)}${badges ? `<div class="card__badges">${badges}</div>` : ''}</div>
      <div class="pd__info">
        ${p.inspiredBy ? `<p class="pd__inspired">по мотивам <b>${esc(p.inspiredBy)}</b></p>` : ''}
        <h2 class="pd__name" id="pd-name">${esc(p.name)}</h2>
        <div class="tags">
          <span class="tag">${GENDER[p.gender]}</span>
          ${p.family ? `<span class="tag">${esc(p.family)}</span>` : ''}
          ${p.bestseller ? '<span class="tag tag--hit">Хит продаж</span>' : ''}
        </div>
        ${p.description ? `<p class="pd__desc">${esc(p.description)}</p>` : ''}
        ${pyramid(p)}
        ${meters(p)}
        ${
          canBuy(p)
            ? `<fieldset class="volumes"><legend>Объём</legend>${p.prices
                .map(
                  (row) => `<label class="volume"><input type="radio" name="pd-volume" value="${row.ml}"${row.ml === current.ml ? ' checked' : ''}>
                    <span><b>${row.ml} мл</b><small>${money(row.price)}</small></span></label>`,
                )
                .join('')}</fieldset>
              <div class="pd__buy">
                <p class="pd__price" data-pd-price></p>
                <div class="qty" role="group" aria-label="Количество">
                  <button type="button" data-pd-qty="-1" aria-label="Меньше">${icon('minus')}</button>
                  <output data-pd-qty-value>1</output>
                  <button type="button" data-pd-qty="1" aria-label="Больше">${icon('plus')}</button>
                </div>
              </div>`
            : ''
        }
        ${actions}
        <button type="button" class="pd__share" data-pd-share>${icon('share')}Поделиться ароматом</button>
      </div>`;
    updateProductPrice();
  }

  function updateProductPrice() {
    const el = $('[data-pd-price]');
    if (!el) return;
    const row = priceFor(current.p, current.ml);
    $('[data-pd-qty-value]').textContent = current.qty;
    el.innerHTML = row ? `${money(row.price * current.qty)}${current.qty > 1 ? `<small>${current.qty} × ${money(row.price)}</small>` : ''}` : '';
  }

  function openProduct(id, { fromHistory = false } = {}) {
    const p = byId.get(id);
    if (!p) return;
    current = { p, ml: (defaultVolume(p) || {}).ml, qty: 1 };
    renderProduct();
    document.title = `${p.name} | ${S.brand}`;
    if (!pd.open) {
      returnFocus = document.activeElement;
      pd.showModal();
    }
    $('.pd__info', pd).scrollTop = 0;
    $('.pd__body', pd).scrollTop = 0;

    // Ссылку на открытый аромат можно отправить другу; «Назад» на телефоне закрывает окно.
    if (!fromHistory) {
      const url = new URL(location.href);
      const hadAroma = url.searchParams.has('aroma');
      url.searchParams.set('aroma', p.slug);
      if (hadAroma) history.replaceState(history.state, '', url);
      else history.pushState({ aroma: true }, '', url);
    }
  }

  function closeProduct() {
    if (history.state && history.state.aroma) {
      history.back(); // окно закроется в обработчике popstate
      return;
    }
    hideProduct();
    const url = new URL(location.href);
    url.searchParams.delete('aroma');
    history.replaceState(null, '', url);
  }

  function hideProduct() {
    if (pd.open) pd.close();
    document.title = baseTitle;
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function syncFromUrl() {
    const slug = new URL(location.href).searchParams.get('aroma');
    const p = slug && perfumes.find((x) => x.slug === slug || x.id === slug);
    if (p) openProduct(p.id, { fromHistory: true });
    else hideProduct();
  }

  function orderLine(p, ml, qty) {
    const row = priceFor(p, ml);
    return `• ${p.name}${p.inspiredBy ? ` (по мотивам ${p.inspiredBy})` : ''} — ${ml} мл × ${qty} = ${money(row.price * qty)}`;
  }

  async function shareProduct(p) {
    const url = new URL(`?aroma=${encodeURIComponent(p.slug)}`, ROOT).href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${p.name} — ${S.brand}`, url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    toast((await copyText(url)) ? 'Ссылка на аромат скопирована' : url);
  }

  pd.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeProduct();
  });
  pd.addEventListener('click', (e) => {
    if (e.target === pd) return closeProduct(); // клик по затемнению
    if (e.target.closest('[data-pd-close]')) return closeProduct();
    const { p } = current;
    const qtyBtn = e.target.closest('[data-pd-qty]');
    if (qtyBtn) {
      current.qty = Math.min(20, Math.max(1, current.qty + Number(qtyBtn.dataset.pdQty)));
      updateProductPrice();
    }
    if (e.target.closest('[data-pd-add]')) {
      addToCart(p.id, current.ml, current.qty);
      toast(`«${p.name}», ${current.ml} мл — в корзине`, { label: 'Оформить →', run: openCart });
    }
    if (e.target.closest('[data-pd-order]')) {
      const row = priceFor(p, current.ml);
      openChat(`Здравствуйте! Хочу заказать:\n${orderLine(p, current.ml, current.qty)}\nИтого: ${money(row.price * current.qty)}`);
    }
    if (e.target.closest('[data-pd-ask]')) {
      openChat(
        p.inStock
          ? `Здравствуйте! Сколько стоит аромат «${p.name}»${p.inspiredBy ? ` (по мотивам ${p.inspiredBy})` : ''}?`
          : `Здравствуйте! Когда будет в наличии аромат «${p.name}»${p.inspiredBy ? ` (по мотивам ${p.inspiredBy})` : ''}?`,
      );
    }
    if (e.target.closest('[data-pd-share]')) shareProduct(p);
  });
  pd.addEventListener('change', (e) => {
    if (e.target.name === 'pd-volume') {
      current.ml = Number(e.target.value);
      updateProductPrice();
    }
  });
  window.addEventListener('popstate', syncFromUrl);

  // ---------- корзина ----------

  const CART_KEY = 'kodo-cart-v1';
  const cartDialog = $('#cart');
  let cart = loadCart();

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      // Убираем то, что мастер успел снять с продажи или переоценить по объёмам.
      return raw
        .filter((l) => l && byId.has(l.id) && canBuy(byId.get(l.id)) && priceFor(byId.get(l.id), l.ml))
        .map((l) => ({ id: l.id, ml: l.ml, qty: Math.min(20, Math.max(1, Math.round(l.qty) || 1)) }));
    } catch {
      return [];
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* приватный режим — корзина живёт до перезагрузки */
    }
    renderCart();
  }

  function addToCart(id, ml, qty = 1) {
    const line = cart.find((l) => l.id === id && l.ml === ml);
    if (line) line.qty = Math.min(20, line.qty + qty);
    else cart.push({ id, ml, qty });
    saveCart();
  }

  const lineTotal = (l) => priceFor(byId.get(l.id), l.ml).price * l.qty;
  const cartTotal = () => cart.reduce((sum, l) => sum + lineTotal(l), 0);
  const cartCount = () => cart.reduce((sum, l) => sum + l.qty, 0);

  function renderCart() {
    const count = cartCount();
    $$('[data-cart-count]').forEach((el) => {
      el.textContent = count;
      el.hidden = !count;
    });
    $$('[data-cart-sum]').forEach((el) => (el.textContent = money(cartTotal())));
    $('.cart-fab').hidden = !count;
    $('[data-cart-foot]').hidden = !cart.length;
    $('[data-cart-total]').textContent = money(cartTotal());

    const items = $('[data-cart-items]');
    if (!cart.length) {
      items.innerHTML = `<div class="cart-empty">
          <span class="seal seal--lg" aria-hidden="true">香</span>
          <p>Корзина пока пуста</p>
          <p>Загляните в каталог — там есть из чего выбрать.</p>
          <button type="button" class="btn btn--dark" data-go-catalog>Перейти в каталог</button>
        </div>`;
      return;
    }
    items.innerHTML = cart
      .map((l, i) => {
        const p = byId.get(l.id);
        return `<div class="line">
          <div class="line__thumb">${media(p)}</div>
          <div>
            <button type="button" class="line__name" data-open="${esc(p.id)}">${esc(p.name)}</button>
            <div class="line__meta">
              <select data-line-ml="${i}" aria-label="Объём">${p.prices
                .map((row) => `<option value="${row.ml}"${row.ml === l.ml ? ' selected' : ''}>${row.ml} мл</option>`)
                .join('')}</select>
              <div class="qty qty--sm" role="group" aria-label="Количество">
                <button type="button" data-line-qty="${i}" data-step="-1" aria-label="Меньше">${icon('minus')}</button>
                <output>${l.qty}</output>
                <button type="button" data-line-qty="${i}" data-step="1" aria-label="Больше">${icon('plus')}</button>
              </div>
            </div>
          </div>
          <div class="line__side">
            <span class="line__price">${money(lineTotal(l))}</span>
            <button type="button" class="line__remove" data-line-remove="${i}">Убрать</button>
          </div>
        </div>`;
      })
      .join('');
  }

  function openCart() {
    if (pd.open) closeProduct();
    renderCart();
    if (!cartDialog.open) cartDialog.showModal();
  }

  cartDialog.addEventListener('click', (e) => {
    if (e.target === cartDialog || e.target.closest('[data-close-cart]')) return cartDialog.close();
    if (e.target.closest('[data-go-catalog]')) {
      cartDialog.close();
      $('#catalog').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) {
      cartDialog.close();
      openProduct(open.dataset.open);
      return;
    }
    const qtyBtn = e.target.closest('[data-line-qty]');
    if (qtyBtn) {
      const line = cart[Number(qtyBtn.dataset.lineQty)];
      line.qty += Number(qtyBtn.dataset.step);
      if (line.qty < 1) cart.splice(cart.indexOf(line), 1);
      else line.qty = Math.min(20, line.qty);
      saveCart();
      return;
    }
    const remove = e.target.closest('[data-line-remove]');
    if (remove) {
      cart.splice(Number(remove.dataset.lineRemove), 1);
      saveCart();
      return;
    }
    if (e.target.closest('[data-clear-cart]')) {
      cart = [];
      saveCart();
      return;
    }
    if (e.target.closest('[data-checkout]')) {
      const note = $('[data-cart-note]').value.trim();
      const text = [
        'Здравствуйте! Хочу заказать:',
        ...cart.map((l) => orderLine(byId.get(l.id), l.ml, l.qty)),
        `Итого: ${money(cartTotal())}`,
        note ? `Комментарий: ${note}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      openChat(text, 'Открываем чат с мастером — осталось нажать «Отправить»');
    }
  });
  cartDialog.addEventListener('change', (e) => {
    const select = e.target.closest('[data-line-ml]');
    if (!select) return;
    const line = cart[Number(select.dataset.lineMl)];
    const ml = Number(select.value);
    const same = cart.find((l) => l !== line && l.id === line.id && l.ml === ml);
    if (same) {
      same.qty = Math.min(20, same.qty + line.qty);
      cart.splice(cart.indexOf(line), 1);
    } else {
      line.ml = ml;
    }
    saveCart();
  });

  // ---------- общие действия ----------

  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open && !open.closest('dialog')) {
      openProduct(open.dataset.open);
      return;
    }
    const quick = e.target.closest('[data-quick-add], [data-add]');
    if (quick && !quick.closest('dialog')) {
      const p = byId.get(quick.dataset.quickAdd || quick.dataset.add);
      const ml = quick.dataset.ml ? Number(quick.dataset.ml) : defaultVolume(p).ml;
      addToCart(p.id, ml);
      toast(`«${p.name}», ${ml} мл — в корзине`, { label: 'Корзина →', run: openCart });
      return;
    }
    if (e.target.closest('[data-open-cart]')) return openCart();
    if (e.target.closest('[data-reset]')) return resetFilters();
    if (e.target.closest('[data-ask]')) return openChat(`Здравствуйте! Ищу аромат: ${filter.q}. Сможете сделать?`);
  });

  $('[data-request]').addEventListener('submit', (e) => {
    e.preventDefault();
    const wish = e.target.elements.wish.value.trim();
    if (wish) openChat(`Здравствуйте! Ищу аромат по мотивам: ${wish}. Сможете сделать?`);
  });

  // ---------- шапка и меню ----------

  const header = $('.header');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const burger = $('.burger');
  const nav = $('#nav');
  const setMenu = (open) => {
    nav.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
  };
  burger.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (e) => e.target.closest('a') && setMenu(false));
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('is-open') && !e.target.closest('#nav, .burger')) setMenu(false);
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false));

  // ---------- появление при прокрутке ----------

  function initReveal() {
    if (reduceMotion || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    // То, что уже видно при загрузке, не прячем — иначе будет мигание.
    $$('[data-reveal]').forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
      el.classList.add('reveal');
      io.observe(el);
    });
  }

  // ---------- демо-версия ----------

  function renderDemoBar() {
    if (!demoEdited) return;
    document.body.insertAdjacentHTML(
      'afterbegin',
      `<div class="demo-bar" role="status">
        <span>Демо: сайт показан с вашими правками из панели мастера — они видны только на этом устройстве.</span>
        <button type="button" data-demo-reset>Вернуть как было</button>
      </div>`,
    );
    $('[data-demo-reset]').addEventListener('click', () => {
      try {
        localStorage.removeItem(DEMO_KEY);
      } catch {
        /* нечего сбрасывать */
      }
      location.reload();
    });
  }

  // ---------- запуск ----------

  renderDemoBar();
  fillSettings();
  renderHero();
  renderHits();
  initFilters();
  renderCatalog();
  renderCart();
  initReveal();
  syncFromUrl();
})();
