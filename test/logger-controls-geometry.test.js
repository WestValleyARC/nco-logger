const test = require('node:test');
const assert = require('node:assert/strict');
const { accessSync, constants, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = resolve(__dirname, '..');
const CSS_FILES = [
    'client/dist/public/css/local.css',
    'client/dist/public/css/app-shell.css',
    'client/dist/public/css/nco-logger.css',
    'client/dist/public/css/nco-logger-light.css',
    'client/dist/public/css/nco-logger-metallic.css',
    'client/dist/public/css/nco-logger-appearance.css'
];

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

function chromeBinary() {
    const candidates = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
    return candidates.find(candidate => {
        try { accessSync(candidate, constants.X_OK); return true; } catch { return false; }
    });
}

function fixtureHtml() {
    const links = CSS_FILES.map(file => `<link rel="stylesheet" href="${pathToFileURL(join(ROOT, file)).href}">`).join('');
    return `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${links}</head>
<body class="nco-logger-page"><div id="nco-logger-root"><div id="netcontrol-ncs-helper" data-layout-context="tabletLandscape">
<header><span>Brand</span><span class="nch-net-title">Test Net</span><span>Menu</span></header><div class="nch-body">
<div class="nch-dashboard" data-role="dashboard" style="--nch-grid-rows:20;--nch-grid-gap:1px">
<section class="nch-module nch-lurkers-fixed" data-module="lurkers" style="grid-column:1 / span 10;grid-row:1 / span 5"><h3 class="nch-module-header" data-module-drag="lurkers"><span>Lurkers</span></h3><div class="nch-module-content"></div></section>
<section class="nch-module nch-controls-pane" data-module="controls" style="grid-column:11 / span 4;grid-row:1 / span 5"><h3 class="nch-module-header" data-module-drag="controls"><span>Station Controls</span></h3><div class="nch-module-content nch-entry-controls"><input class="nch-callsign-input nch-admin-only" placeholder="Callsign"><small class="nch-call-hint nch-admin-only">Type a callsign and press ENTER</small><div class="nch-quick-checkin nch-admin-only"><button data-quick-tag="mobile">Mobile</button><button data-quick-tag="shortTime">Short Time</button><button data-quick-tag="portable">Portable</button><button class="nch-quick-io">In &amp; Out</button></div><div class="nch-net-actions nch-admin-only"><button class="nch-edit-net">Edit Net</button><button class="nch-close-net">Close Net</button></div><input type="hidden"><input type="hidden"></div></section>
<section class="nch-module nch-checked-out-section" data-module="checkedOut" style="grid-column:15 / span 10;grid-row:1 / span 5"><h3 class="nch-module-header" data-module-drag="checkedOut"><span>Checked Out</span></h3><div class="nch-module-content"></div></section>
<section class="nch-module nch-chat-section" data-module="chat" style="grid-column:1 / span 8;grid-row:6 / span 15"><h3 class="nch-module-header"><span>Chat</span></h3><div class="nch-module-content"></div></section>
<section class="nch-module nch-active-section" data-module="active" style="grid-column:9 / span 16;grid-row:6 / span 15"><h3 class="nch-module-header"><span>Active</span></h3><div class="nch-module-content"></div></section>
</div><div class="nch-fixed-status-bar"></div></div></div></div></body></html>`;
}

async function connectWebSocket(url) {
    return new Promise((resolveSocket, rejectSocket) => {
        const socket = new WebSocket(url);
        socket.addEventListener('open', () => resolveSocket(socket), { once: true });
        socket.addEventListener('error', () => rejectSocket(new Error('Chrome DevTools WebSocket failed')), { once: true });
    });
}

test('1180x820 tablet landscape keeps Station Controls and neighboring grid boundaries flush', { timeout: 20000 }, async t => {
    if (process.env.CI) return t.skip('Local headless geometry verification is not a CI gate');
    const binary = chromeBinary();
    if (!binary || typeof WebSocket === 'undefined') return t.skip('A CDP-capable Chrome is not available');

    const work = mkdtempSync(join(tmpdir(), 'nco-controls-geometry-'));
    const profile = join(work, 'profile');
    const fixture = join(work, 'fixture.html');
    writeFileSync(fixture, fixtureHtml());
    const chrome = spawn(binary, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-breakpad', '--disable-crashpad-for-testing',
        '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'
    ], { stdio: 'ignore' });
    t.after(() => chrome.kill('SIGKILL'));

    const portFile = join(profile, 'DevToolsActivePort');
    let port;
    for (let attempt = 0; attempt < 100 && !port; attempt += 1) {
        if (chrome.exitCode !== null) break;
        try { port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]); } catch { await delay(50); }
    }
    if (!port) return t.skip('Chrome cannot launch in this sandbox');

    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pathToFileURL(fixture).href)}`, { method: 'PUT' });
    const target = await targetResponse.json();
    const socket = await connectWebSocket(target.webSocketDebuggerUrl);
    t.after(() => socket.close());
    let commandId = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id || !pending.has(message.id)) return;
        const { resolveCommand, rejectCommand } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rejectCommand(new Error(message.error.message)); else resolveCommand(message.result);
    });
    const command = (method, params = {}) => new Promise((resolveCommand, rejectCommand) => {
        const id = ++commandId;
        pending.set(id, { resolveCommand, rejectCommand });
        socket.send(JSON.stringify({ id, method, params }));
    });

    await command('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: true });
    await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await command('Page.enable');
    await command('Page.navigate', { url: pathToFileURL(fixture).href });
    await delay(250);

    const expression = `(() => {
      const read = selector => { const element = document.querySelector(selector); const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowX: style.overflowX, overflowY: style.overflowY }; };
      const module = read('.nch-controls-pane'), header = read('.nch-controls-pane .nch-module-header'), entry = read('.nch-entry-controls'), actions = read('.nch-net-actions'), close = read('.nch-close-net'), left = read('.nch-lurkers-fixed'), right = read('.nch-checked-out-section'), bottom = read('.nch-chat-section');
      return { module, header, entry, actions, close, left, right, bottom, cushion: module.bottom - close.bottom, media: { coarse: matchMedia('(pointer: coarse)').matches, noHover: matchMedia('(hover: none)').matches } };
    })()`;
    const evaluated = await command('Runtime.evaluate', { expression, returnByValue: true });
    const geometry = evaluated.result.value;

    assert.equal(geometry.media.coarse, true);
    assert.equal(geometry.media.noHover, true);
    assert.ok(geometry.module.height >= 166.5 && geometry.module.height <= 167.5, `controls height was ${geometry.module.height}px`);
    assert.equal(geometry.header.height, 32);
    assert.ok(geometry.entry.scrollWidth <= geometry.entry.clientWidth, `entry controls overflowed horizontally by ${geometry.entry.scrollWidth - geometry.entry.clientWidth}px`);
    assert.ok(geometry.entry.scrollHeight <= geometry.entry.clientHeight, `entry controls overflowed ${geometry.entry.scrollHeight - geometry.entry.clientHeight}px`);
    assert.ok(geometry.actions.left >= geometry.module.left && geometry.actions.right <= geometry.module.right, 'net actions extend outside Station Controls');
    assert.ok(geometry.close.left >= geometry.module.left && geometry.close.right <= geometry.module.right, 'Close Net is horizontally clipped');
    assert.ok(geometry.close.bottom <= geometry.module.bottom, 'Close Net extends below Station Controls');
    assert.ok(geometry.cushion >= 2 && geometry.cushion <= 3.5, `lower cushion was ${geometry.cushion}px`);
    assert.ok(Math.abs(geometry.left.bottom - geometry.module.bottom) <= 0.5, 'Lurkers bottom does not match Station Controls');
    assert.ok(Math.abs(geometry.right.bottom - geometry.module.bottom) <= 0.5, 'Checked Out bottom does not match Station Controls');
    const bottomGap = geometry.bottom.top - geometry.module.bottom;
    assert.ok(Math.abs(bottomGap) <= 1.5 && bottomGap >= 0.5, `bottom module gap was ${bottomGap}px`);
});
