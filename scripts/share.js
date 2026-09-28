'use strict';

// Временная публичная ссылка на сайт — чтобы показать демо на телефоне: `npm run share`.
// Поднимает сайт и туннель через бесплатный localhost.run. Нужен только ssh —
// он уже есть в Windows 10/11, macOS и Linux; регистрация не нужна.
// Ссылка живёт, пока открыто это окно и компьютер не спит. Остановить — Ctrl+C.

const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');

function portBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function main() {
  if (await portBusy(PORT)) {
    console.error(`\nПорт ${PORT} занят — похоже, сайт уже запущен. Остановите его (Ctrl+C в том окне) и снова выполните npm run share: он сам поднимет сайт.\n`);
    process.exit(1);
  }

  // Сайт запускаем, когда туннель выдал адрес: SITE_URL нужен для правильных https-ссылок в превью Telegram.
  // TRUST_PROXY: IP посетителя берётся из заголовков туннеля (важно для защиты от перебора пароля).
  let site = null;
  const startSite = (publicUrl) => {
    site = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', TRUST_PROXY: '1', SITE_URL: publicUrl },
      stdio: 'inherit',
    });
    site.on('exit', (code) => {
      if (code) stop(code);
    });
  };

  const tunnel = spawn(
    'ssh',
    ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes', '-R', `80:127.0.0.1:${PORT}`, 'nokey@localhost.run'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let currentUrl = '';
  const onOutput = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text); // localhost.run сам печатает QR-код — его можно отсканировать телефоном
    const url = (text.match(/https:\/\/[a-z0-9-]+\.lhr\.life/i) || [])[0];
    if (!url || url === currentUrl) return;
    // Бесплатный адрес иногда меняется при переподключении — тогда сообщаем новый.
    const changed = Boolean(currentUrl);
    currentUrl = url;
    if (!site) startSite(url);
    console.log(`\n  ✔ ${changed ? 'Ссылка сменилась, новая' : 'Ссылка для телефона'}: ${url}\n    Панель мастера: ${url}/admin\n    Работает, пока открыто это окно. Остановить — Ctrl+C.\n`);
  };
  tunnel.stdout.on('data', onOutput);
  tunnel.stderr.on('data', onOutput);

  function stop(code = 0) {
    tunnel.kill();
    if (site) site.kill();
    process.exit(code);
  }
  tunnel.on('error', (err) => {
    console.error(`\nНе удалось запустить ssh (${err.message}). В Windows: Параметры → Приложения → Дополнительные компоненты → «Клиент OpenSSH».\n`);
    stop(1);
  });
  tunnel.on('exit', (code) => {
    console.log(`\nТуннель закрылся${code ? ` (код ${code})` : ''} — сайт остановлен. Запустите npm run share ещё раз, ссылка будет новая.\n`);
    stop(code || 0);
  });
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
}

main();
