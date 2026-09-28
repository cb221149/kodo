/* Панель мастера: вход, ароматы (добавление, фото, хиты, наличие, порядок),
   тексты сайта и смена пароля. Работает через /api/admin/*. */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const numFmt = new Intl.NumberFormat('ru-RU');
  const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const plural = (n, forms) => {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b === 1) return forms[0];
    if (b > 1 && b < 5) return forms[1];
    return forms[2];
  };
  const GENDER = { female: 'Женский', male: 'Мужской', unisex: 'Унисекс' };
  const KANJI = ['刀', '鋏', '香'];
  const DEFAULT_FAMILIES = ['Цветочный', 'Фруктовый', 'Цитрусовый', 'Свежий', 'Древесный', 'Восточный', 'Пряный', 'Гурманский', 'Фужерный', 'Шипровый', 'Кожаный', 'Мускусный'];

  const state = { perfumes: [], settings: {}, defaultPassword: false, filter: '', q: '' };
  let loggedIn = false;
  let uploading = 0;

  // Статическая версия (Netlify, GitHub Pages): сервера нет — панель работает в демо-режиме,
  // данные и фото хранятся в браузере (localStorage), витрина на этом устройстве их показывает.
  const STATIC_DEMO = document.body.hasAttribute('data-static-demo');
  const DEMO_KEY = 'kodo-demo-db-v1';
  const ROOT = new URL(document.body.dataset.root || '/', location.href);
  const asset = (path) => (path && !/^(data:|https?:|\/)/.test(path) ? new URL(path, ROOT).href : path);

  // ---------- сервер ----------

  class AuthError extends Error {}

  async function api(method, url, body, rawBlob) {
    if (STATIC_DEMO) return demoApi(method, url, body, rawBlob);
    const options = { method, headers: {}, credentials: 'same-origin' };
    if (rawBlob) {
      options.headers['Content-Type'] = rawBlob.type;
      options.body = rawBlob;
    } else if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, options);
    } catch {
      throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* пустой ответ */
    }
    if (res.status === 401 && url !== '/api/login') {
      if (loggedIn) showLogin('Сессия закончилась — войдите снова.');
      throw new AuthError('Нужно войти');
    }
    if (!res.ok) throw new Error((data && data.error) || `Ошибка ${res.status}`);
    return data;
  }

  function handleError(err) {
    if (!(err instanceof AuthError)) toast(err.message, 'error');
  }

  // ---------- демо-режим без сервера ----------

  const session = {
    get: () => {
      try {
        return sessionStorage.getItem('kodo-demo-auth') === '1';
      } catch {
        return false;
      }
    },
    set: (on) => {
      try {
        if (on) sessionStorage.setItem('kodo-demo-auth', '1');
        else sessionStorage.removeItem('kodo-demo-auth');
      } catch {
        /* без хранилища вход живёт до перезагрузки */
      }
    },
  };

  function demoLoad() {
    try {
      const local = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null');
      if (local && local.settings && Array.isArray(local.perfumes)) return local;
    } catch {
      /* берём исходные данные */
    }
    return JSON.parse($('#demo-data').textContent);
  }

  function demoSave(db) {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(db));
    } catch {
      throw new Error('В демо-версии закончилось место в браузере — удалите пару фото или нажмите «Сбросить демо»');
    }
  }

  function demoPerfume(input, prev) {
    const p = { ...(prev || {}), ...(input || {}) };
    p.name = String(p.name || '').trim().slice(0, 80);
    if (!p.name) throw new Error('Укажите название аромата');
    if (!prev) {
      p.id = 'd' + Math.random().toString(36).slice(2, 10);
      p.slug = p.id;
      p.createdAt = Date.now();
    }
    p.prices = (p.prices || []).filter((r) => r.ml > 0 && r.price >= 0).sort((a, b) => a.ml - b.ml);
    p.notes = p.notes || { top: [], heart: [], base: [] };
    p.updatedAt = Date.now();
    return p;
  }

  // Как на сервере (lib/sanitize.js): «@ник» или ссылка t.me/… → просто ник; пустые вопросы отбрасываются.
  function demoSettings(input) {
    const s = { ...input };
    const username = (v, bad, max) =>
      String(v || '')
        .trim()
        .replace(/^https?:\/\/(www\.)?(t\.me|telegram\.me|instagram\.com)\//i, '')
        .replace(/^@/, '')
        .split(/[/?#]/)[0]
        .replace(bad, '')
        .slice(0, max);
    if ('telegram' in s) s.telegram = username(s.telegram, /[^A-Za-z0-9_]/g, 32);
    if ('instagram' in s) s.instagram = username(s.instagram, /[^A-Za-z0-9._]/g, 30);
    if ('whatsapp' in s) s.whatsapp = String(s.whatsapp || '').replace(/\D/g, '').slice(0, 15);
    if (Array.isArray(s.faq)) s.faq = s.faq.filter((f) => f.q && f.a);
    if (Array.isArray(s.achievements)) s.achievements = s.achievements.filter(Boolean);
    return s;
  }

  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Не удалось прочитать фото'));
      reader.readAsDataURL(blob);
    });

  // Те же адреса и ответы, что у настоящего сервера (server.js), — остальной код панели не знает о разнице.
  async function demoApi(method, url, body, rawBlob) {
    const route = `${method} ${url}`;
    if (route === 'GET /api/session') return { authed: session.get() };
    if (route === 'POST /api/login') {
      if (!body || !body.password) throw new Error('Введите любой пароль');
      session.set(true);
      return { ok: true };
    }
    if (route === 'POST /api/logout') {
      session.set(false);
      return { ok: true };
    }
    if (!session.get()) {
      if (loggedIn) showLogin('Войдите снова.');
      throw new AuthError('Нужно войти');
    }
    const db = demoLoad();
    if (route === 'GET /api/admin/state') return { perfumes: db.perfumes, settings: db.settings, defaultPassword: false };
    if (route === 'POST /api/admin/upload') return { url: await blobToDataUrl(rawBlob) };
    if (route === 'POST /api/admin/perfumes') {
      const perfume = demoPerfume(body, null);
      db.perfumes.unshift(perfume);
      demoSave(db);
      return perfume;
    }
    if (route === 'POST /api/admin/perfumes/order') {
      const rank = new Map(body.ids.map((id, i) => [id, i]));
      db.perfumes.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
      demoSave(db);
      return { ids: db.perfumes.map((p) => p.id) };
    }
    const one = url.match(/^\/api\/admin\/perfumes\/(.+)$/);
    if (one) {
      const index = db.perfumes.findIndex((p) => p.id === decodeURIComponent(one[1]));
      if (index === -1) throw new Error('Аромат не найден — возможно, его уже удалили');
      if (method === 'DELETE') {
        db.perfumes.splice(index, 1);
        demoSave(db);
        return { ok: true };
      }
      const perfume = demoPerfume(body, db.perfumes[index]);
      db.perfumes[index] = perfume;
      demoSave(db);
      return perfume;
    }
    if (route === 'PUT /api/admin/settings') {
      db.settings = { ...db.settings, ...demoSettings(body) };
      demoSave(db);
      return db.settings;
    }
    if (route === 'POST /api/admin/password') throw new Error('В демо-версии пароль не меняется');
    if (route === 'POST /api/admin/logout-others') return { ok: true };
    throw new Error('Недоступно в демо-версии');
  }

  if (STATIC_DEMO) {
    $$('[data-demo-only]').forEach((el) => (el.hidden = false));
    $$('[data-demo-reset]').forEach((btn) =>
      btn.addEventListener('click', () => {
        if (!confirm('Сбросить все демо-правки и вернуть исходный каталог?')) return;
        try {
          localStorage.removeItem(DEMO_KEY);
        } catch {
          /* нечего сбрасывать */
        }
        location.reload();
      }),
    );
  }

  function toast(message, type) {
    const box = $('[data-toasts]');
    (document.querySelector('dialog[open]') || document.body).appendChild(box);
    const el = document.createElement('div');
    el.className = `toast${type === 'error' ? ' toast--error' : ''}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 320);
    }, type === 'error' ? 5000 : 2600);
  }

  // ---------- вход и выход ----------

  function showLogin(message) {
    loggedIn = false;
    if (editor.open) editor.close();
    $('[data-view="app"]').hidden = true;
    $('[data-view="login"]').hidden = false;
    const error = $('[data-login-error]');
    error.textContent = message || '';
    error.hidden = !message;
    setTimeout(() => $('[data-login-form] input[name="password"]').focus(), 30);
  }

  async function showApp() {
    const data = await api('GET', '/api/admin/state');
    Object.assign(state, data);
    loggedIn = true;
    $('[data-view="login"]').hidden = true;
    $('[data-view="app"]').hidden = false;
    $('[data-brand]').textContent = state.settings.brand || 'Мастерская';
    $('[data-default-pw]').hidden = !state.defaultPassword;
    renderFamilies();
    renderList();
    fillSettingsForm(state.settings);
  }

  $('[data-login-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem('password');
    const error = $('[data-login-error]');
    const button = form.querySelector('[type="submit"]');
    if (!input.value) {
      error.textContent = 'Введите пароль';
      error.hidden = false;
      input.focus();
      return;
    }
    button.disabled = true;
    error.hidden = true;
    try {
      await api('POST', '/api/login', { password: input.value });
      form.reset();
      await showApp();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      input.select();
    } finally {
      button.disabled = false;
    }
  });

  $$('[data-pw-toggle]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
      input.focus();
    }),
  );

  $('[data-logout]').addEventListener('click', async () => {
    if (settingsDirty && !confirm('В текстах сайта есть несохранённые изменения. Всё равно выйти?')) return;
    try {
      await api('POST', '/api/logout');
    } catch {
      /* всё равно показываем вход */
    }
    setDirty(false);
    showLogin();
  });

  // ---------- вкладки ----------

  const tabButtons = $$('[data-tab]');

  function selectTab(name, focus) {
    tabButtons.forEach((b) => {
      const active = b.dataset.tab === name;
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
      if (active && focus) b.focus();
    });
    $$('[data-panel]').forEach((panel) => (panel.hidden = panel.dataset.panel !== name));
    try {
      sessionStorage.setItem('admin-tab', name);
    } catch {
      /* не важно */
    }
  }

  tabButtons.forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  $('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = tabButtons.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    const next = tabButtons[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabButtons.length) % tabButtons.length];
    selectTab(next.dataset.tab, true);
  });
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) selectTab(go.dataset.goto);
  });

  // ---------- фото ----------

  const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  // Уменьшаем фото прямо в браузере: 5 МБ с телефона превращаются в ~200 КБ, сайт летает.
  async function prepareImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Не получилось открыть фото. Сохраните его как JPG или PNG и попробуйте снова.'));
        image.src = url;
      });
      // В демо фото хранится в браузере, где мало места, — поэтому там снимки меньше.
      const scale = Math.min(1, (STATIC_DEMO ? 1000 : 1600) / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let blob = await toBlob(canvas, 'image/webp', STATIC_DEMO ? 0.8 : 0.86);
      if (!blob || blob.type !== 'image/webp') {
        // Старые браузеры не умеют WebP — сохраняем JPEG на бежевом фоне вместо прозрачного.
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#f4ede3';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        blob = await toBlob(canvas, 'image/jpeg', 0.88);
      }
      if (!blob) throw new Error('Не удалось обработать фото');
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function uploadImage(file) {
    const blob = await prepareImage(file);
    const data = await api('POST', '/api/admin/upload', undefined, blob);
    return data.url;
  }

  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  function setupUploader(root, { get, set, placeholder, onChange }) {
    const preview = $('[data-preview]', root);
    const input = $('[data-file]', root);
    const removeBtn = $('[data-remove-image]', root);

    function render() {
      const url = get();
      preview.innerHTML = url ? `<img src="${esc(asset(url))}" alt="Загруженное фото">` : placeholder();
      removeBtn.hidden = !url;
    }

    async function handle(file) {
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        toast('Это не изображение — выберите фото', 'error');
        return;
      }
      root.classList.add('is-busy');
      uploading += 1;
      try {
        set(await uploadImage(file));
        render();
        if (onChange) onChange();
        toast('Фото загружено');
      } catch (err) {
        handleError(err);
      } finally {
        uploading -= 1;
        root.classList.remove('is-busy');
        input.value = '';
      }
    }

    input.addEventListener('change', () => handle(input.files[0]));
    removeBtn.addEventListener('click', () => {
      set('');
      render();
      if (onChange) onChange();
    });
    ['dragenter', 'dragover'].forEach((type) =>
      root.addEventListener(type, (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        root.classList.add('is-drag');
      }),
    );
    root.addEventListener('dragleave', (e) => {
      if (!root.contains(e.relatedTarget)) root.classList.remove('is-drag');
    });
    root.addEventListener('drop', (e) => {
      root.classList.remove('is-drag');
      if (!hasFiles(e)) return;
      e.preventDefault();
      handle(e.dataTransfer.files[0]);
    });
    return { render, handle };
  }

  // Файл, брошенный мимо зоны загрузки, не должен открываться вместо панели.
  ['dragover', 'drop'].forEach((type) => document.addEventListener(type, (e) => hasFiles(e) && e.preventDefault()));

  // ---------- список ароматов ----------

  const bottleFor = (p) => Art.bottle({ color: p.color, shape: p.shape, cap: p.cap, seed: p.id, label: state.settings.brand });
  const thumb = (p) => (p.image ? `<img src="${esc(asset(p.image))}" alt="" loading="lazy">` : bottleFor(p));
  const toggle = (p, key, ic, label) =>
    `<button type="button" class="toggle" data-toggle="${key}" aria-pressed="${p[key]}">${icon(ic)}${label}</button>`;

  function filteredPerfumes() {
    const q = norm(state.q);
    return state.perfumes.filter((p) => {
      if (state.filter === 'hits' && !p.bestseller) return false;
      if (state.filter === 'hidden' && p.visible) return false;
      if (state.filter === 'out' && p.inStock) return false;
      return !q || norm(`${p.name} ${p.inspiredBy} ${p.family}`).includes(q);
    });
  }

  function renderList() {
    const all = state.perfumes;
    const list = filteredPerfumes();
    const canReorder = !state.q && !state.filter;
    const hits = all.filter((p) => p.bestseller).length;
    const hidden = all.filter((p) => !p.visible).length;
    const out = all.filter((p) => !p.inStock).length;

    $('[data-count-all]').textContent = all.length;
    $('[data-stats]').textContent = [
      `${all.length} ${plural(all.length, ['аромат', 'аромата', 'ароматов'])}`,
      `хитов: ${hits}`,
      hidden ? `скрыто с сайта: ${hidden}` : '',
      out ? `нет в наличии: ${out}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    $('[data-order-hint]').textContent = canReorder
      ? 'Порядок в этом списке — порядок на сайте. Меняйте его стрелками ↑ ↓.'
      : 'Чтобы менять порядок, сбросьте поиск и фильтр.';

    const box = $('[data-plist]');
    if (!list.length) {
      box.innerHTML = all.length
        ? '<div class="plist-empty"><b>Ничего не найдено</b>Попробуйте другой запрос или фильтр.</div>'
        : '<div class="plist-empty"><b>Пока нет ни одного аромата</b>Нажмите «Добавить аромат», чтобы создать первый.</div>';
      return;
    }
    box.innerHTML = list
      .map((p) => {
        const index = all.indexOf(p);
        const prices = p.prices.length ? p.prices.map((r) => `${r.ml} мл — ${numFmt.format(r.price)}`).join(' · ') + ' сум' : 'Цены не указаны';
        const sub = [p.inspiredBy ? `по мотивам ${p.inspiredBy}` : '', GENDER[p.gender], p.family].filter(Boolean).join(' · ');
        return `<div class="prow${p.visible ? '' : ' is-hidden'}" data-id="${esc(p.id)}">
          <div class="prow__thumb" data-edit>${thumb(p)}</div>
          <div class="prow__main">
            <button type="button" class="prow__name" data-edit>${esc(p.name)}${p.visible ? '' : '<span class="pill">скрыт</span>'}${p.isNew ? '<span class="pill">новинка</span>' : ''}</button>
            <p class="prow__sub">${esc(sub)}</p>
            <p class="prow__prices${p.prices.length ? '' : ' is-empty'}">${esc(prices)}</p>
          </div>
          <div class="prow__toggles">
            ${toggle(p, 'bestseller', 'star', 'Хит')}
            ${toggle(p, 'inStock', 'box', 'В наличии')}
            ${toggle(p, 'visible', 'eye', 'На сайте')}
          </div>
          <div class="prow__actions">
            <button type="button" class="icon-btn" data-move="-1" aria-label="Поднять «${esc(p.name)}» выше"${canReorder && index > 0 ? '' : ' disabled'}>${icon('up')}</button>
            <button type="button" class="icon-btn" data-move="1" aria-label="Опустить «${esc(p.name)}» ниже"${canReorder && index < all.length - 1 ? '' : ' disabled'}>${icon('down')}</button>
            <button type="button" class="icon-btn" data-edit aria-label="Изменить «${esc(p.name)}»">${icon('edit')}</button>
            <button type="button" class="icon-btn icon-btn--danger" data-delete aria-label="Удалить «${esc(p.name)}»">${icon('trash')}</button>
          </div>
        </div>`;
      })
      .join('');
  }

  function replacePerfume(updated) {
    const i = state.perfumes.findIndex((p) => p.id === updated.id);
    if (i !== -1) state.perfumes[i] = updated;
  }

  function flashRow(id) {
    const row = $(`.prow[data-id="${id}"]`);
    if (!row) return;
    row.classList.add('is-flash');
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  const TOGGLE_TEXT = {
    bestseller: (p) => (p.bestseller ? `«${p.name}» теперь в хитах` : `«${p.name}» убран из хитов`),
    inStock: (p) => (p.inStock ? `«${p.name}» снова в наличии` : `«${p.name}»: отмечено «нет в наличии»`),
    visible: (p) => (p.visible ? `«${p.name}» снова на сайте` : `«${p.name}» скрыт с сайта`),
  };

  async function movePerfume(p, dir) {
    const ids = state.perfumes.map((x) => x.id);
    const i = ids.indexOf(p.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const before = state.perfumes.slice();
    state.perfumes.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    renderList();
    const same = $(`.prow[data-id="${p.id}"] [data-move="${dir}"]`);
    (same && !same.disabled ? same : $(`.prow[data-id="${p.id}"] [data-move="${-dir}"]`))?.focus();
    try {
      await api('POST', '/api/admin/perfumes/order', { ids });
    } catch (err) {
      state.perfumes = before;
      renderList();
      handleError(err);
    }
  }

  async function deletePerfume(p) {
    if (!confirm(`Удалить аромат «${p.name}»? Это действие нельзя отменить.`)) return false;
    try {
      await api('DELETE', `/api/admin/perfumes/${encodeURIComponent(p.id)}`);
      state.perfumes = state.perfumes.filter((x) => x.id !== p.id);
      renderList();
      toast(`«${p.name}» удалён`);
      return true;
    } catch (err) {
      handleError(err);
      return false;
    }
  }

  $('[data-plist]').addEventListener('click', async (e) => {
    const row = e.target.closest('.prow');
    const p = row && state.perfumes.find((x) => x.id === row.dataset.id);
    if (!p) return;
    if (e.target.closest('[data-edit]')) return openEditor(p);
    if (e.target.closest('[data-delete]')) return deletePerfume(p);
    const move = e.target.closest('[data-move]');
    if (move) return movePerfume(p, Number(move.dataset.move));
    const btn = e.target.closest('[data-toggle]');
    if (btn) {
      const key = btn.dataset.toggle;
      btn.disabled = true;
      try {
        const updated = await api('PUT', `/api/admin/perfumes/${encodeURIComponent(p.id)}`, { [key]: !p[key] });
        replacePerfume(updated);
        renderList();
        toast(TOGGLE_TEXT[key](updated));
      } catch (err) {
        btn.disabled = false;
        handleError(err);
      }
    }
  });

  $('[data-q]').addEventListener('input', (e) => {
    state.q = e.target.value.trim();
    renderList();
  });
  $('[data-list-filter]').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.filter = b.dataset.value;
    $$('[data-list-filter] button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderList();
  });
  $('[data-new]').addEventListener('click', () => openEditor(null));

  function renderFamilies() {
    const families = new Set([...DEFAULT_FAMILIES, ...state.perfumes.map((p) => p.family).filter(Boolean)]);
    $('#families').innerHTML = [...families]
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .map((f) => `<option value="${esc(f)}"></option>`)
      .join('');
  }

  // ---------- редактор аромата ----------

  const editor = $('[data-editor]');
  const form = $('[data-editor-form]');
  const field = (name) => form.elements.namedItem(name);
  let editing = null;
  let editorImage = '';
  let snapshot = '';

  // Картинка аромата: нарисованный флакон (форма + цвет + крышка) или своё фото.
  const lookValue = () => field('look').value || 'bottle';
  const pickedShape = () => (field('shape') && field('shape').value) || 'classic';
  const pickedCap = () => field('cap').value || 'black';

  $('[data-colors]', form).innerHTML =
    Art.COLORS.map(
      (c) =>
        `<label class="swatch" title="${esc(c.name)}"><input type="radio" name="colorPreset" value="${c.color}" aria-label="${esc(c.name)}"><span style="--c:${c.color}"></span></label>`,
    ).join('') + '<label class="swatch swatch--custom" title="Свой цвет"><input type="color" name="color" aria-label="Свой цвет"><span></span></label>';
  $('[data-caps]', form).innerHTML = Object.entries(Art.CAPS)
    .map(
      ([key, cap]) =>
        `<label class="swatch" title="${esc(cap.name)}"><input type="radio" name="cap" value="${key}" aria-label="${esc(cap.name)}"><span style="--c:${cap.color}"></span></label>`,
    )
    .join('');

  // Плитки форм рисуются в текущем цвете и с текущей крышкой — сразу видно, как будет на сайте.
  function renderShapes(selected = pickedShape()) {
    $('[data-shapes]', form).innerHTML = Art.SHAPES.map(
      (s) => `<label class="shape-opt"><input type="radio" name="shape" value="${s.id}"${s.id === selected ? ' checked' : ''}>
        <span>${Art.bottle({ shape: s.id, color: field('color').value, cap: pickedCap() })}<small>${s.name}</small></span></label>`,
    ).join('');
  }

  function syncPicker() {
    const color = field('color').value.toLowerCase();
    const preset = Art.COLORS.find((c) => c.color === color);
    $$('input[name="colorPreset"]', form).forEach((r) => (r.checked = r.value === color));
    const custom = $('.swatch--custom', form);
    custom.classList.toggle('is-active', !preset);
    custom.style.setProperty('--c', color);
    $('[data-shape-name]', form).textContent = `· ${Art.SHAPES.find((s) => s.id === pickedShape()).name}`;
    $('[data-color-name]', form).textContent = `· ${preset ? preset.name : 'свой'}`;
    $('[data-cap-name]', form).textContent = `· ${Art.CAPS[pickedCap()].name}`;
  }

  function setLook(look) {
    field('look').value = look;
    $$('[data-look-panel]', form).forEach((panel) => (panel.hidden = panel.dataset.lookPanel !== look));
    editorUploader.render();
  }

  const editorUploader = setupUploader($('[data-uploader="image"]', form), {
    get: () => (lookValue() === 'photo' ? editorImage : ''),
    set: (url) => {
      editorImage = url;
      if (url && lookValue() !== 'photo') setLook('photo'); // фото перетащили или вставили, пока был выбран флакон
    },
    placeholder: () =>
      lookValue() === 'photo'
        ? `<div class="uploader__placeholder">${icon('upload')}Загрузите фото: кнопкой ниже, перетаскиванием или Ctrl+V</div>`
        : Art.bottle({ color: field('color').value, shape: pickedShape(), cap: pickedCap(), label: state.settings.brand }),
  });

  form.addEventListener('change', (e) => {
    const name = e.target.name;
    if (name === 'look') return setLook(e.target.value);
    if (name === 'colorPreset') field('color').value = e.target.value;
    if (name === 'colorPreset' || name === 'cap') renderShapes();
    if (name === 'colorPreset' || name === 'cap' || name === 'shape') {
      syncPicker();
      editorUploader.render();
    }
  });
  field('color').addEventListener('input', () => {
    renderShapes();
    syncPicker();
    editorUploader.render();
  });

  const splitList = (value) => value.split(',').map((s) => s.trim()).filter(Boolean);
  const digits = (value) => {
    const d = String(value ?? '').replace(/\D/g, '');
    return d ? Number(d) : null;
  };

  function addPriceRow(row = { ml: '', price: '' }) {
    const div = document.createElement('div');
    div.className = 'price-row';
    div.innerHTML = `
      <label><input type="number" min="1" max="1000" step="1" inputmode="numeric" data-ml value="${esc(row.ml)}" placeholder="30" aria-label="Объём, мл"><span>мл</span></label>
      <label><input type="text" inputmode="numeric" data-price value="${row.price === '' || row.price == null ? '' : numFmt.format(row.price)}" placeholder="Цена" aria-label="Цена, сум"><span>сум</span></label>
      <button type="button" class="icon-btn" data-remove-price aria-label="Удалить этот объём">${icon('close')}</button>`;
    $('[data-prices]', form).appendChild(div);
    return div;
  }

  function priceRows() {
    return $$('.price-row', form).map((row) => ({ row, ml: digits($('[data-ml]', row).value), price: digits($('[data-price]', row).value) }));
  }

  function collect() {
    return {
      name: field('name').value.trim(),
      inspiredBy: field('inspiredBy').value.trim(),
      gender: field('gender').value || 'unisex',
      family: field('family').value.trim(),
      description: field('description').value.trim(),
      notes: {
        top: splitList(field('notes.top').value),
        heart: splitList(field('notes.heart').value),
        base: splitList(field('notes.base').value),
      },
      prices: priceRows()
        .filter((r) => r.ml !== null && r.price !== null)
        .map(({ ml, price }) => ({ ml, price })),
      longevity: Number(field('longevity').value),
      sillage: Number(field('sillage').value),
      bestseller: field('bestseller').checked,
      isNew: field('isNew').checked,
      inStock: field('inStock').checked,
      visible: field('visible').checked,
      color: field('color').value,
      shape: pickedShape(),
      cap: pickedCap(),
      image: lookValue() === 'photo' ? editorImage : '',
    };
  }

  function setStatus(text, isError) {
    const el = $('[data-editor-status]');
    el.textContent = text;
    el.classList.toggle('is-error', Boolean(isError));
  }

  function openEditor(p) {
    editing = p;
    const d = p || {
      name: '',
      inspiredBy: '',
      gender: 'unisex',
      family: '',
      description: '',
      notes: { top: [], heart: [], base: [] },
      prices: [{ ml: 10, price: '' }, { ml: 30, price: '' }, { ml: 50, price: '' }],
      longevity: 0,
      sillage: 0,
      bestseller: false,
      isNew: true,
      inStock: true,
      visible: true,
      color: '#e6c88f',
      shape: 'classic',
      cap: 'black',
      image: '',
    };
    $('[data-editor-title]').textContent = p ? 'Редактирование аромата' : 'Новый аромат';
    field('name').value = d.name;
    field('inspiredBy').value = d.inspiredBy;
    field('gender').value = d.gender;
    field('family').value = d.family;
    field('description').value = d.description;
    field('notes.top').value = d.notes.top.join(', ');
    field('notes.heart').value = d.notes.heart.join(', ');
    field('notes.base').value = d.notes.base.join(', ');
    field('longevity').value = String(d.longevity);
    field('sillage').value = String(d.sillage);
    ['bestseller', 'isNew', 'inStock', 'visible'].forEach((key) => (field(key).checked = Boolean(d[key])));
    $('[data-prices]', form).innerHTML = '';
    (d.prices.length ? d.prices : [{ ml: '', price: '' }]).forEach((row) => addPriceRow(row));
    // У старых ароматов форма могла быть не выбрана — показываем ту, что сейчас на сайте.
    const look = Art.resolve({ seed: p ? p.id : 'new', color: d.color, shape: d.shape, cap: d.cap });
    field('color').value = d.color || '#e6c88f';
    field('cap').value = look.cap;
    renderShapes(look.shape);
    syncPicker();
    editorImage = d.image || '';
    setLook(d.image ? 'photo' : 'bottle');
    $('[data-editor-delete]').hidden = !p;
    $$('.is-invalid', form).forEach((el) => el.classList.remove('is-invalid'));
    setStatus('');
    editor.showModal();
    $('.editor__body', form).scrollTop = 0;
    snapshot = JSON.stringify(collect());
    if (!p) field('name').focus();
  }

  function closeEditor(force) {
    if (!editor.open) return true;
    if (!force && JSON.stringify(collect()) !== snapshot && !confirm('Закрыть без сохранения? Изменения пропадут.')) return false;
    editor.close();
    editing = null;
    return true;
  }

  function validate() {
    $$('.is-invalid', form).forEach((el) => el.classList.remove('is-invalid'));
    const problems = [];
    if (!field('name').value.trim()) {
      field('name').classList.add('is-invalid');
      problems.push('Укажите название аромата');
    }
    priceRows().forEach(({ row, ml, price }) => {
      if ((ml === null) === (price === null)) return;
      $(ml === null ? '[data-ml]' : '[data-price]', row).classList.add('is-invalid');
      problems.push('В каждой строке цен нужны и объём, и цена — или удалите лишнюю строку');
    });
    const mls = priceRows().map((r) => r.ml).filter((ml) => ml !== null);
    if (new Set(mls).size !== mls.length) problems.push('Один и тот же объём указан дважды');
    if (lookValue() === 'photo' && !editorImage) problems.push('Загрузите фото — или выберите «Флакон»');
    return problems;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (uploading) return setStatus('Подождите, фото ещё загружается…', true);
    const problems = validate();
    if (problems.length) {
      setStatus(problems[0], true);
      $('.is-invalid', form)?.focus();
      return;
    }
    const data = collect();
    const isNew = !editing;
    const button = $('[data-editor-save]');
    button.disabled = true;
    setStatus('Сохраняем…');
    try {
      const saved = isNew
        ? await api('POST', '/api/admin/perfumes', data)
        : await api('PUT', `/api/admin/perfumes/${encodeURIComponent(editing.id)}`, data);
      if (isNew) state.perfumes.unshift(saved);
      else replacePerfume(saved);
      closeEditor(true);
      renderFamilies();
      renderList();
      flashRow(saved.id);
      toast(isNew ? (saved.visible ? `«${saved.name}» добавлен на сайт` : `«${saved.name}» добавлен (пока скрыт)`) : 'Изменения сохранены');
    } catch (err) {
      if (!(err instanceof AuthError)) setStatus(err.message, true);
    } finally {
      button.disabled = false;
    }
  });

  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-editor-close]')) return closeEditor(false);
    if (e.target.closest('[data-add-price]')) {
      const used = priceRows().map((r) => r.ml);
      const next = [10, 30, 50, 100, 5, 15, 20, 75].find((ml) => !used.includes(ml)) || '';
      $('[data-price]', addPriceRow({ ml: next, price: '' })).focus();
      return;
    }
    const remove = e.target.closest('[data-remove-price]');
    if (remove) remove.closest('.price-row').remove();
  });
  form.addEventListener(
    'blur',
    (e) => {
      // «135000» → «135 000» — так проще проверять цену глазами.
      if (e.target.matches('[data-price]')) {
        const n = digits(e.target.value);
        e.target.value = n === null ? '' : numFmt.format(n);
      }
    },
    true,
  );
  form.addEventListener('input', (e) => e.target.classList.remove('is-invalid'));
  editor.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeEditor(false);
  });
  $('[data-editor-delete]').addEventListener('click', async () => {
    if (editing && (await deletePerfume(editing))) closeEditor(true);
  });

  // ---------- тексты сайта ----------

  const sform = $('[data-settings-form]');
  let draft = {};
  let settingsDirty = false;

  const aboutUploader = setupUploader($('[data-uploader="aboutPhoto"]', sform), {
    get: () => draft.aboutPhoto || '',
    set: (url) => (draft.aboutPhoto = url),
    placeholder: () => '<div class="uploader__placeholder"><b>匠</b>Без фото на сайте будет иллюстрация с катаной</div>',
    onChange: () => setDirty(true),
  });

  const achievementRow = (value) => `<div class="list-edit__row">
      <input type="text" maxlength="160" value="${esc(value)}" aria-label="Достижение" placeholder="Например: чемпион Ташкента по фехтованию">
      <button type="button" class="icon-btn" data-list-remove aria-label="Удалить достижение">${icon('close')}</button>
    </div>`;
  const faqRow = (item) => `<div class="faq-edit__item">
      <div>
        <input type="text" maxlength="200" value="${esc(item.q)}" placeholder="Вопрос" aria-label="Вопрос">
        <textarea rows="2" maxlength="1200" placeholder="Ответ" aria-label="Ответ">${esc(item.a)}</textarea>
      </div>
      <button type="button" class="icon-btn" data-list-remove aria-label="Удалить вопрос">${icon('close')}</button>
    </div>`;

  function setDirty(value) {
    settingsDirty = value;
    $('[data-savebar]').hidden = !value;
  }

  function fillSettingsForm(settings) {
    draft = JSON.parse(JSON.stringify(settings));
    $$('[name]', sform).forEach((el) => (el.value = settings[el.name] ?? ''));
    $('[data-list="achievements"]', sform).innerHTML = (draft.achievements || []).map(achievementRow).join('');
    $('[data-list="faq"]', sform).innerHTML = (draft.faq || []).map(faqRow).join('');
    $('[data-pillars]', sform).innerHTML = [0, 1, 2]
      .map((i) => {
        const p = (draft.pillars || [])[i] || { title: '', text: '' };
        return `<div class="pillars-edit__item">
          <div class="pillars-edit__head"><b aria-hidden="true">${KANJI[i]}</b><input type="text" maxlength="40" value="${esc(p.title)}" placeholder="Название" aria-label="Путь ${i + 1}: название"></div>
          <textarea rows="4" maxlength="400" aria-label="Путь ${i + 1}: текст">${esc(p.text)}</textarea>
        </div>`;
      })
      .join('');
    aboutUploader.render();
    setDirty(false);
  }

  function collectSettings() {
    const out = {};
    $$('[name]', sform).forEach((el) => (out[el.name] = el.value));
    out.achievements = $$('[data-list="achievements"] input', sform).map((i) => i.value.trim()).filter(Boolean);
    out.faq = $$('.faq-edit__item', sform)
      .map((item) => ({ q: $('input', item).value.trim(), a: $('textarea', item).value.trim() }))
      .filter((item) => item.q || item.a);
    out.pillars = $$('.pillars-edit__item', sform).map((item) => ({ title: $('input', item).value.trim(), text: $('textarea', item).value.trim() }));
    out.aboutPhoto = draft.aboutPhoto || '';
    return out;
  }

  sform.addEventListener('input', () => setDirty(true));
  sform.addEventListener('click', (e) => {
    const add = e.target.closest('[data-list-add]');
    if (add) {
      const box = $(`[data-list="${add.dataset.listAdd}"]`, sform);
      box.insertAdjacentHTML('beforeend', add.dataset.listAdd === 'faq' ? faqRow({ q: '', a: '' }) : achievementRow(''));
      box.lastElementChild.querySelector('input').focus();
      setDirty(true);
      return;
    }
    const remove = e.target.closest('[data-list-remove]');
    if (remove) {
      remove.parentElement.remove();
      setDirty(true);
    }
  });
  $('[data-settings-reset]').addEventListener('click', () => fillSettingsForm(state.settings));

  sform.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (uploading) return toast('Подождите, фото ещё загружается…', 'error');
    const half = $$('.faq-edit__item', sform).find((item) => !$('input', item).value.trim() !== !$('textarea', item).value.trim());
    if (half) {
      toast('Заполните и вопрос, и ответ — или удалите этот вопрос', 'error');
      ($('input', half).value.trim() ? $('textarea', half) : $('input', half)).focus();
      return;
    }
    const button = $('[type="submit"]', sform);
    button.disabled = true;
    try {
      state.settings = await api('PUT', '/api/admin/settings', collectSettings());
      fillSettingsForm(state.settings);
      $('[data-brand]').textContent = state.settings.brand || 'Мастерская';
      renderList();
      toast('Сохранено — изменения уже на сайте');
    } catch (err) {
      handleError(err);
    } finally {
      button.disabled = false;
    }
  });

  // ---------- безопасность ----------

  $('[data-password-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const error = $('[data-password-error]');
    const current = f.elements.namedItem('current').value;
    const next = f.elements.namedItem('next').value;
    const repeat = f.elements.namedItem('repeat').value;
    const fail = (message) => {
      error.textContent = message;
      error.hidden = false;
    };
    error.hidden = true;
    if (!current) return fail('Введите текущий пароль');
    if (next.length < 8) return fail('Новый пароль — минимум 8 символов');
    if (next !== repeat) return fail('Новые пароли не совпадают');
    if (next === current) return fail('Новый пароль совпадает с текущим');
    const button = $('[type="submit"]', f);
    button.disabled = true;
    try {
      await api('POST', '/api/admin/password', { current, next });
      f.reset();
      state.defaultPassword = false;
      $('[data-default-pw]').hidden = true;
      toast('Пароль изменён');
    } catch (err) {
      if (!(err instanceof AuthError)) fail(err.message);
    } finally {
      button.disabled = false;
    }
  });

  $('[data-logout-others]').addEventListener('click', async () => {
    try {
      await api('POST', '/api/admin/logout-others');
      toast('Готово: на других устройствах нужно будет войти заново');
    } catch (err) {
      handleError(err);
    }
  });

  // ---------- общее ----------

  // Вставка фото из буфера обмена (Ctrl+V): в открытый аромат или в фото мастера.
  document.addEventListener('paste', (e) => {
    const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (!item || !loggedIn) return;
    if (editor.open) {
      e.preventDefault();
      editorUploader.handle(item.getAsFile());
    } else if (!$('[data-panel="settings"]').hidden) {
      e.preventDefault();
      aboutUploader.handle(item.getAsFile());
    }
  });

  window.addEventListener('beforeunload', (e) => {
    const editorDirty = editor.open && JSON.stringify(collect()) !== snapshot;
    if (settingsDirty || editorDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  let savedTab = 'perfumes';
  try {
    savedTab = sessionStorage.getItem('admin-tab') || 'perfumes';
  } catch {
    /* по умолчанию — ароматы */
  }
  selectTab(savedTab);

  api('GET', '/api/session')
    .then(({ authed }) => (authed ? showApp() : showLogin()))
    .catch((err) => showLogin(err instanceof AuthError ? '' : err.message));
})();
