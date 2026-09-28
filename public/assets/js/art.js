/* Иллюстрации сайта в SVG: флакон-заглушка (пока у аромата нет фото) и катана.
   Используются и на витрине, и в админке. */
(function (global) {
  'use strict';

  let uid = 0;

  // Формы и крышки, из которых мастер выбирает в панели. Порядок = порядок в выборе.
  const SHAPES = [
    { id: 'classic', name: 'Классика' },
    { id: 'flask', name: 'Круглый' },
    { id: 'tall', name: 'Высокий' },
    { id: 'facet', name: 'Кристалл' },
    { id: 'block', name: 'Куб' },
    { id: 'arch', name: 'Арка' },
    { id: 'drop', name: 'Капля' },
    { id: 'pyramid', name: 'Пирамида' },
  ];
  const CAPS = {
    black: { name: 'Чёрная', color: '#2a241f' },
    gold: { name: 'Золото', color: '#b8995f' },
    wood: { name: 'Дерево', color: '#7d5c40' },
    silver: { name: 'Серебро', color: '#c9c0b3' },
    red: { name: 'Красный лак', color: '#9f3a28' },
    pearl: { name: 'Жемчуг', color: '#efe8dc' },
  };
  // Цвета «сока» для быстрого выбора; можно задать и любой свой.
  const COLORS = [
    { color: '#e9dfcc', name: 'Прозрачный' },
    { color: '#e6c88f', name: 'Шампань' },
    { color: '#e3a24a', name: 'Янтарь' },
    { color: '#c8643f', name: 'Шафран' },
    { color: '#a65a2a', name: 'Коньяк' },
    { color: '#7b4a2c', name: 'Табак' },
    { color: '#d49a94', name: 'Роза' },
    { color: '#c2566e', name: 'Малина' },
    { color: '#8e2334', name: 'Вишня' },
    { color: '#3a2830', name: 'Кофе' },
    { color: '#9c8ab8', name: 'Лаванда' },
    { color: '#8fb1a9', name: 'Море' },
    { color: '#5f6b57', name: 'Олива' },
    { color: '#3f5f86', name: 'Синий' },
  ];
  // Для ароматов, у которых форма не выбрана явно (старые записи), — прежний автоподбор.
  const AUTO_SHAPES = ['classic', 'flask', 'tall', 'facet', 'block'];
  const AUTO_CAPS = ['black', 'gold', 'wood', 'black', 'silver'];

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    const x = rgb(a);
    const y = rgb(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  const GLASS = 'fill="#fffaf3" fill-opacity=".5" stroke="#231e1a" stroke-opacity=".16" stroke-width="1.5"';
  const LABEL = 'fill="#f8f2e8" fill-opacity=".95" stroke="#231e1a" stroke-opacity=".1"';

  // Какая форма и крышка реально будут нарисованы: выбранные мастером
  // или (если не выбраны) подобранные по seed — у каждого аромата «свой» флакон.
  function resolve(opts) {
    const o = opts || {};
    const h = hash(String(o.seed || o.color || ''));
    const shape = SHAPES.some((s) => s.id === o.shape) ? o.shape : AUTO_SHAPES[h % AUTO_SHAPES.length];
    const cap = CAPS[o.cap] ? o.cap : AUTO_CAPS[(h >>> 4) % AUTO_CAPS.length];
    return { shape, cap };
  }

  // opts: { color, seed, shape?, cap?, label? }; cap — ключ из CAPS или готовый цвет #rrggbb.
  function bottle(opts) {
    const o = opts || {};
    const color = /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : '#c8a27a';
    const picked = resolve({ ...o, color });
    const shape = picked.shape;
    const cap = /^#[0-9a-f]{6}$/i.test(o.cap || '') ? o.cap : CAPS[picked.cap].color;
    const id = 'btl' + ++uid;
    const L = `url(#${id}l)`;
    const G = `url(#${id}g)`;
    const C = `url(#${id}c)`;
    const label = esc(String(o.label || '').slice(0, 12));
    const text = (y) =>
      label
        ? `<text x="100" y="${y}" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="11" font-weight="600" letter-spacing="2" fill="#231e1a">${label}</text>`
        : '';
    const seal = (y) => `<circle cx="100" cy="${y}" r="2.4" fill="#b0412c"/>`;

    let body = '';
    switch (shape) {
      case 'flask':
        body = `
          <rect x="89" y="84" width="22" height="22" rx="2" ${GLASS}/>
          <circle cx="100" cy="166" r="68" ${GLASS}/>
          <clipPath id="${id}k"><circle cx="100" cy="166" r="61"/></clipPath>
          <rect x="30" y="126" width="140" height="120" fill="${L}" clip-path="url(#${id}k)"/>
          <ellipse cx="100" cy="126" rx="46" ry="3.5" fill="#fff" fill-opacity=".25"/>
          <circle cx="100" cy="166" r="68" fill="${G}"/>
          <path d="M57 150 A46 46 0 0 1 82 110" stroke="#fff" stroke-opacity=".5" stroke-width="6" stroke-linecap="round" fill="none"/>
          <rect x="80" y="42" width="40" height="46" rx="9" fill="${C}"/>
          <rect x="66" y="156" width="68" height="30" rx="15" ${LABEL}/>
          ${text(172)}${seal(180)}`;
        break;
      case 'tall':
        body = `
          <rect x="90" y="64" width="20" height="16" rx="2" ${GLASS}/>
          <rect x="60" y="76" width="80" height="158" rx="10" ${GLASS}/>
          <rect x="67" y="96" width="66" height="131" rx="6" fill="${L}"/>
          <rect x="60" y="76" width="80" height="158" rx="10" fill="${G}"/>
          <rect x="70" y="86" width="6" height="136" rx="3" fill="#fff" fill-opacity=".35"/>
          <circle cx="100" cy="42" r="25" fill="${C}"/>
          <ellipse cx="91" cy="33" rx="8" ry="5" fill="#fff" fill-opacity=".22"/>
          <rect x="70" y="150" width="60" height="46" rx="2" ${LABEL}/>
          ${text(172)}${seal(183)}`;
        break;
      case 'facet':
        body = `
          <rect x="90" y="80" width="20" height="16" rx="2" ${GLASS}/>
          <path d="M62 94 H138 L158 130 L150 234 H50 L42 130 Z" ${GLASS} stroke-linejoin="round"/>
          <clipPath id="${id}k"><path d="M66 102 H134 L151 131 L144 227 H56 L49 131 Z"/></clipPath>
          <rect x="40" y="118" width="120" height="120" fill="${L}" clip-path="url(#${id}k)"/>
          <path d="M62 94 H138 L158 130 L150 234 H50 L42 130 Z" fill="${G}"/>
          <path d="M62 94 L76 130 L72 234 M138 94 L124 130 L128 234 M42 130 H158" stroke="#fff" stroke-opacity=".45" stroke-width="1.2" fill="none"/>
          <path d="M70 84 H130 L138 60 L100 28 L62 60 Z" fill="${C}"/>
          <path d="M62 60 H138 M100 28 L86 60 L100 84 L114 60 Z" stroke="#fff" stroke-opacity=".3" fill="none"/>
          <rect x="72" y="160" width="56" height="32" rx="2" ${LABEL}/>
          ${text(177)}${seal(185)}`;
        break;
      case 'arch':
        body = `
          <rect x="90" y="70" width="20" height="16" rx="2" ${GLASS}/>
          <path d="M52 234 V130 A48 48 0 0 1 148 130 V234 Z" ${GLASS}/>
          <clipPath id="${id}k"><path d="M59 227 V131 A41 41 0 0 1 141 131 V227 Z"/></clipPath>
          <rect x="50" y="128" width="100" height="110" fill="${L}" clip-path="url(#${id}k)"/>
          <path d="M52 234 V130 A48 48 0 0 1 148 130 V234 Z" fill="${G}"/>
          <rect x="62" y="128" width="6" height="92" rx="3" fill="#fff" fill-opacity=".35"/>
          <path d="M78 72 H122 V58 A22 22 0 0 0 78 58 Z" fill="${C}"/>
          <rect x="70" y="162" width="60" height="40" rx="2" ${LABEL}/>
          ${text(183)}${seal(193)}`;
        break;
      case 'drop':
        body = `
          <rect x="91" y="72" width="18" height="22" rx="2" ${GLASS}/>
          <path d="M100 88 C124 118 158 148 158 186 C158 216 132 236 100 236 C68 236 42 216 42 186 C42 148 76 118 100 88 Z" ${GLASS}/>
          <clipPath id="${id}k"><path d="M100 100 C120 128 151 154 151 186 C151 211 128 229 100 229 C72 229 49 211 49 186 C49 154 80 128 100 100 Z"/></clipPath>
          <rect x="40" y="148" width="120" height="100" fill="${L}" clip-path="url(#${id}k)"/>
          <path d="M100 88 C124 118 158 148 158 186 C158 216 132 236 100 236 C68 236 42 216 42 186 C42 148 76 118 100 88 Z" fill="${G}"/>
          <path d="M60 184 C60 164 72 146 86 128" stroke="#fff" stroke-opacity=".5" stroke-width="5" stroke-linecap="round" fill="none"/>
          <rect x="85" y="30" width="30" height="46" rx="8" fill="${C}"/>
          <rect x="70" y="182" width="60" height="28" rx="14" ${LABEL}/>
          ${text(199)}`;
        break;
      case 'pyramid':
        body = `
          <rect x="91" y="80" width="18" height="18" rx="2" ${GLASS}/>
          <path d="M82 96 H118 L158 234 H42 Z" ${GLASS} stroke-linejoin="round"/>
          <clipPath id="${id}k"><path d="M86 108 H114 L148 228 H52 Z"/></clipPath>
          <rect x="40" y="130" width="120" height="110" fill="${L}" clip-path="url(#${id}k)"/>
          <path d="M82 96 H118 L158 234 H42 Z" fill="${G}"/>
          <path d="M86 106 L55 222" stroke="#fff" stroke-opacity=".45" stroke-width="4" stroke-linecap="round"/>
          <rect x="84" y="36" width="32" height="46" rx="3" fill="${C}"/>
          <rect x="70" y="176" width="60" height="36" rx="2" ${LABEL}/>
          ${text(195)}${seal(204)}`;
        break;
      case 'block':
        body = `
          <rect x="44" y="104" width="112" height="130" rx="6" ${GLASS}/>
          <rect x="55" y="114" width="90" height="98" rx="3" fill="${L}"/>
          <rect x="44" y="104" width="112" height="130" rx="6" fill="${G}"/>
          <rect x="52" y="110" width="6" height="104" rx="3" fill="#fff" fill-opacity=".35"/>
          <rect x="64" y="50" width="72" height="56" rx="3" fill="${C}"/>
          <rect x="64" y="96" width="72" height="10" fill="#000" fill-opacity=".14"/>
          <rect x="66" y="148" width="68" height="26" rx="1" fill="#eadcbf" stroke="#231e1a" stroke-opacity=".12"/>
          ${text(165)}`;
        break;
      default:
        body = `
          <rect x="87" y="80" width="26" height="16" rx="2" ${GLASS}/>
          <rect x="46" y="92" width="108" height="142" rx="14" ${GLASS}/>
          <rect x="54" y="108" width="92" height="118" rx="8" fill="${L}"/>
          <rect x="46" y="92" width="108" height="142" rx="14" fill="${G}"/>
          <rect x="58" y="100" width="7" height="122" rx="3.5" fill="#fff" fill-opacity=".35"/>
          <rect x="73" y="38" width="54" height="44" rx="5" fill="${C}"/>
          <rect x="73" y="74" width="54" height="8" rx="2" fill="#000" fill-opacity=".12"/>
          <rect x="66" y="146" width="68" height="42" rx="3" ${LABEL}/>
          ${text(166)}${seal(177)}`;
    }

    return `<svg class="bottle" viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(color, '#ffffff', 0.28)}"/><stop offset="1" stop-color="${mix(color, '#000000', 0.22)}"/></linearGradient>
        <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".22" stop-color="#fff" stop-opacity=".12"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/><stop offset=".92" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity=".05"/></linearGradient>
        <linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${mix(cap, '#ffffff', 0.3)}"/><stop offset=".45" stop-color="${cap}"/><stop offset="1" stop-color="${mix(cap, '#000000', 0.35)}"/></linearGradient>
        <radialGradient id="${id}s"><stop offset="0" stop-color="#231e1a" stop-opacity=".28"/><stop offset="1" stop-color="#231e1a" stop-opacity="0"/></radialGradient>
      </defs>
      <ellipse cx="100" cy="240" rx="74" ry="8" fill="url(#${id}s)"/>
      ${body}
    </svg>`;
  }

  // Катана: рукоять с оплёткой, цуба, хабаки и клинок с изгибом и волной закалки (хамон).
  function katana() {
    const id = 'ktn' + ++uid;
    const edge = [[306, 41], [560, 40.6], [700, 39], [800, 36.4], [880, 32.5], [950, 27]];
    const edgeY = (x) => {
      for (let i = 1; i < edge.length; i++) {
        if (x <= edge[i][0]) {
          const [x0, y0] = edge[i - 1];
          const [x1, y1] = edge[i];
          return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
        }
      }
      return 27;
    };
    const f = (n) => n.toFixed(1);

    // Волна закалки: гребни над режущей кромкой, область под ними светлее.
    let hamon = `M316 ${f(edgeY(316) - 5)}`;
    let x = 316;
    for (; x + 18 <= 934; x += 18) hamon += ` Q${x + 9} ${f(edgeY(x + 9) - 9)} ${x + 18} ${f(edgeY(x + 18) - 5)}`;
    for (let back = x; back >= 316; back -= 22) hamon += ` L${back} ${f(edgeY(back) - 0.6)}`;
    hamon += ' Z';

    let wrap = '';
    for (let i = 0; i < 10; i++) {
      const cx = 42 + i * 22;
      wrap += `<path d="M${cx - 10} 32 L${cx} 23.5 L${cx + 10} 32 L${cx} 40.5 Z" fill="#e8dcc6" fill-opacity=".9"/>`;
    }

    const blade = 'M306 24 C560 24 820 19 994 10 Q978 22 950 27 C800 36 560 41 306 41 Z';

    return `<svg class="katana" viewBox="0 0 1000 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8f8983"/><stop offset=".3" stop-color="#e4e0da"/><stop offset=".55" stop-color="#c3bdb4"/><stop offset="1" stop-color="#f3f0ea"/>
        </linearGradient>
        <linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#e2c98f"/><stop offset=".5" stop-color="#a8875a"/><stop offset="1" stop-color="#6e5536"/>
        </linearGradient>
        <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <clipPath id="${id}c"><path d="${blade}"/></clipPath>
      </defs>
      <path d="${blade}" fill="url(#${id}b)"/>
      <path d="${hamon}" fill="#fbfaf6" fill-opacity=".65"/>
      <path d="M310 29.5 C560 29.5 820 25 948 18.5 L952 27" stroke="#5f5a54" stroke-opacity=".35" stroke-width="1" fill="none"/>
      <g clip-path="url(#${id}c)"><rect class="katana__glint" x="-160" y="0" width="140" height="64" fill="url(#${id}g)"/></g>
      <path d="M284 21 L306 23 L306 42 L284 43 Z" fill="url(#${id}m)"/>
      <rect x="272" y="4" width="12" height="56" rx="4" fill="#2b2420" stroke="url(#${id}m)" stroke-width="1.5"/>
      <rect x="258" y="19" width="14" height="26" rx="2" fill="url(#${id}m)"/>
      <rect x="26" y="21" width="234" height="22" rx="7" fill="#1f1a16"/>
      ${wrap}
      <ellipse cx="152" cy="32" rx="12" ry="4.5" fill="url(#${id}m)"/>
      <rect x="16" y="19" width="16" height="26" rx="5" fill="url(#${id}m)"/>
    </svg>`;
  }

  global.Art = { bottle, katana, resolve, SHAPES, CAPS, COLORS };
})(window);
