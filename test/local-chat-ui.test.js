const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const loadEmoji = () => import(pathToFileURL(path.join(root, 'client/dist/public/js/lib/chatEmoji.js')).href);

test('emoji picker provides all requested categories and a substantial searchable set', async () => {
    const { CHAT_EMOJI_CATEGORIES, filterChatEmoji } = await loadEmoji();
    assert.deepEqual(
        CHAT_EMOJI_CATEGORIES.map(category => category.id),
        ['smileys', 'people', 'nature', 'food', 'activities', 'travel', 'objects', 'symbols', 'flags']
    );
    assert.ok(CHAT_EMOJI_CATEGORIES.flatMap(category => category.emoji).length >= 250);
    assert.ok(filterChatEmoji('smileys', 'radio').some(entry => entry.emoji === '📻'));
    assert.ok(filterChatEmoji('smileys', 'emergency').some(entry => entry.emoji === '🆘'));
    assert.ok(filterChatEmoji('food', '').every(entry =>
        CHAT_EMOJI_CATEGORIES.find(category => category.id === 'food').emoji.includes(entry)
    ));
});

test('emoji insertion replaces a selection and returns the restored caret position', async () => {
    const { insertChatEmoji } = await loadEmoji();
    assert.deepEqual(insertChatEmoji('CQ old net', 3, 6, '📻'), { value: 'CQ 📻 net', caret: 5 });
});

test('chat image thumbnails stay compact and open an in-page lightbox', () => {
    const css = read('client/dist/public/css/local.css');
    const source = read('client/src/public/js/lib/chat.ts');
    assert.match(css, /\.chat-image\s*\{[^}]*max-width:\s*min\(100%,\s*210px\)[^}]*max-height:\s*160px[^}]*object-fit:\s*contain/s);
    assert.match(css, /\.chat-lightbox-card\s*\{[^}]*width:\s*min\(66vw,\s*1100px\)[^}]*height:\s*min\(66vh,\s*760px\)/s);
    assert.match(source, /imageButton\.type = 'button'/);
    assert.doesNotMatch(source, /target\s*=\s*['_"]_blank/);
    assert.match(source, /lightbox && !lightbox\.hidden[\s\S]*event\.key === 'Escape'[\s\S]*closeLightbox\(\)/);
    assert.match(source, /\.chat-lightbox-close'\)\?\.addEventListener\('click', \(\) => this\.closeLightbox\(\)\)/);
    assert.match(source, /event\.key === 'Tab'[\s\S]*document\.activeElement/);
    assert.match(source, /document\.body\.style\.overflow = 'hidden'/);
    assert.match(source, /this\.lightboxTrigger\?\.focus\(\)/);
});

test('lightbox downloads the authenticated image without navigating away', () => {
    const source = read('client/src/public/js/lib/chat.ts');
    assert.match(source, /fetch\(this\.lightboxUrl, \{ credentials: 'same-origin' \}\)/);
    assert.match(source, /anchor\.download = `chat-image\.\$\{extension\}`/);
    assert.match(source, /URL\.createObjectURL\(blob\)/);
});

test('composer controls and text retain the intended accessible styling', () => {
    const css = read('client/dist/public/css/local.css');
    const source = read('client/src/public/js/lib/chat.ts');
    assert.match(css, /#local-chat-message\s*\{[^}]*resize:\s*none[^}]*color:\s*var\(--chat-accent-bright\)/s);
    assert.match(css, /\.chat-icon-control:focus-visible/);
    assert.match(css, /\.chat-icon-control\s*\{[^}]*width:\s*auto[^}]*min-width:\s*0[^}]*font-size:\s*1\.35rem/s);
    assert.match(css, /\.chat-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto auto auto[^}]*gap:\s*0\.5rem !important[^}]*align-items:\s*stretch/s);
    assert.match(css, /\.chat-emoji-tab\s*\{[^}]*font-size:\s*1\.35rem/s);
    assert.match(css, /\.chat-emoji-search::placeholder\s*\{[^}]*color:\s*var\(--chat-accent-bright\)/s);
    assert.match(css, /\.chat-send-btn\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
    assert.match(css, /@media \(max-width: 520px\), \(max-height: 520px\)/);
    assert.match(source, /!picker\.contains\(target\)[\s\S]*toggleEmojiPicker\(false\)/);
    assert.match(source, /picker && !picker\.hidden[\s\S]*toggleEmojiPicker\(false\)/);
    assert.match(source, /button\.setAttribute\('aria-expanded', String\(open\)\)/);
    assert.match(source, /<form class="chat-form">/);
    assert.doesNotMatch(source, /chat-form[^"']*gap-2/);
    assert.match(source, /chat-lightbox-download[^>]*aria-label="Download original chat image"[^>]*>[\s\S]*<svg/);
    assert.doesNotMatch(source, />Download<\/button>/);
});

test('chat styles use content-derived cache-busting URLs', () => {
    const serverUtils = read('server/dist/lib/serverUtils.js');
    const localCssPartial = read('server/dist/views/partials/featureLocalCss.ejs');
    const liveNetView = read('server/dist/views/liveNet.ejs');
    assert.match(serverUtils, /publicAssetRoot[\s\S]*client\/dist\/public/);
    assert.match(serverUtils, /'css\/local\.css'/);
    assert.match(serverUtils, /'css\/nco-logger\.css'/);
    assert.match(localCssPartial, /local\.css\?v=<%= server\.appAssetVersion %>/);
    assert.match(liveNetView, /nco-logger\.css\?v=<%= server\.appAssetVersion %>/);
});

test('application JavaScript cannot remain fresh after a same-server rebuild', () => {
    const serverUtils = read('server/dist/lib/serverUtils.js');
    const server = read('server/dist/server.js');
    const compose = read('docker-compose.yml');
    const refresh = read('scripts/refresh-compose.sh');
    assert.match(serverUtils, /js\/lib\/chat\.js/);
    assert.match(serverUtils, /js\/byView\/liveNet\/main\.js/);
    assert.match(server, /max-age=0, must-revalidate/);
    assert.match(server, /X-App-Asset-Version|appAssetVersion/);
    assert.match(compose, /action: sync\+restart[\s\S]*path: \.\/server\/dist/);
    assert.match(compose, /action: rebuild[\s\S]*path: \.\/client\/src/);
    assert.match(refresh, /docker compose up -d --build --wait app/);
    assert.match(refresh, /\/readyz/);
});

test('NCO Logger and Chat font scales use independent variables', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    const css = read('client/dist/public/css/nco-logger.css');
    assert.match(source, /panel\?\.style\.setProperty\("--nch-font-adjust"/);
    assert.match(source, /nativeChat\(\)\?\.style\.removeProperty\("--nch-font-adjust"\)/);
    assert.match(source, /nativeChat\(\)\?\.style\.setProperty\("--nch-chat-font-size"/);
    assert.match(css, /\.chat-message-author[^}]*var\(--nch-chat-font-size\)/s);
    assert.doesNotMatch(css, /hl-chat[^\n{]*\{[^}]*--nch-font-adjust/s);
});

test('message interactions are compact, accessible, and permission driven', () => {
    const source = read('client/src/public/js/lib/chat.ts');
    const css = read('client/dist/public/css/local.css');
    assert.match(source, /message\.canReact/);
    assert.match(source, /message\.canReply/);
    assert.match(source, /message\.canPin/);
    assert.match(source, /message\.canBan/);
    assert.match(source, /\['👍', '❤️', '😂', '😮'\]/);
    assert.match(source, /window\.confirm\(`Ban/);
    assert.match(source, /window\.confirm\('Clear all public chat messages/);
    assert.match(source, /Original message unavailable/);
    assert.match(css, /\.chat-message-actions\s*\{[^}]*position:\s*absolute[^}]*opacity:\s*0/s);
    assert.match(css, /@media \(hover: none\)[\s\S]*\.chat-message-actions/);
    assert.match(css, /\.chat-message-pinned\s*\{/);
    assert.match(css, /\.chat-reaction-chip\.is-mine\s*\{/);
});

test('native server-backed pins are not hidden or replaced by NCO helper normalization', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    const normalize = source.slice(source.indexOf('function normalizeChatDisplay()'), source.indexOf('function safeNormalizeChatDisplay()'));
    assert.doesNotMatch(normalize, /nch-native-pin-control/);
    assert.doesNotMatch(normalize, /button\.className = "nch-pin-chat"/);
    assert.doesNotMatch(normalize, /renderPinnedChatStrip/);
});
