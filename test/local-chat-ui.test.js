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
    assert.match(source, /chatFontPreset:\s*normalizeFontPreset\(layout\.chatFontPreset \|\| saved\.chatFontPreset\)/);
    assert.match(source, /\[layoutKey\]:\s*\{[\s\S]*chatFontPreset:\s*normalizeFontPreset\(local\.chatFontPreset\)/);
    assert.match(source, /chatFontPreset:\s*normalizeFontPreset\(saved\.chatFontPreset\)/);
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
    assert.match(source, />Delete All Messages<\/button>/);
    assert.match(source, /Original message unavailable/);
    assert.match(css, /\.chat-message-actions\s*\{[^}]*position:\s*absolute[^}]*opacity:\s*0/s);
    assert.match(css, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.chat-message-actions/);
    assert.match(css, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.chat-message\s*\{[^}]*padding-bottom:\s*2\.35rem/s);
    assert.match(css, /\.chat-action-private\s*\{[^}]*color:\s*#f7c8ff[^}]*font-size:\s*1\.25rem[^}]*font-weight:\s*700[^}]*text-shadow:/s);
    assert.match(css, /\.chat-message-action-icon\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*line-height:\s*1/s);
    assert.match(css, /\.chat-action-private \.chat-message-action-icon\s*\{[^}]*transform:\s*translateY\(-0\.08em\)/s);
    assert.match(source, /iconElement\.className = 'chat-message-action-icon'/);
    assert.match(source, /iconElement\.setAttribute\('aria-hidden', 'true'\)/);
    assert.match(source, /if \(message\.canMessagePrivately\)\s*\{[\s\S]*addAction\('✉', 'Message privately', 'chat-action-private'/);
    assert.match(source, /button\.title = label/);
    assert.match(source, /button\.setAttribute\('aria-label', `\$\{label\} message from \$\{message\.callSign\}`\)/);
    assert.match(css, /\.chat-message-pinned\s*\{/);
    assert.match(css, /\.chat-reaction-chip\.is-mine\s*\{/);
    assert.match(source, /chip\.setAttribute\('aria-pressed', String\(reaction\.reactedByMe\)\)/);
    assert.match(source, /reactionButton\.setAttribute\('aria-expanded', 'false'\)/);
    assert.match(source, /event\.key !== 'ArrowDown' && event\.key !== 'ArrowUp'/);
    assert.match(source, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/);
    assert.match(css, /\.chat-header-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/s);
    assert.match(css, /\.chat-clear-button\s*\{[^}]*grid-column:\s*2[^}]*justify-self:\s*center[^}]*color:\s*#ff5263/s);
    assert.doesNotMatch(source, /has-pin-action/);
    assert.match(css, /\.chat-message:hover \.chat-message-actions,[\s\S]*opacity:\s*1[\s\S]*pointer-events:\s*auto/s);
});

test('native server-backed pins are not hidden or replaced by NCO helper normalization', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    const chat = read('client/src/public/js/lib/chat.ts');
    const css = read('client/dist/public/css/nco-logger.css');
    const normalize = source.slice(source.indexOf('function normalizeChatDisplay()'), source.indexOf('function safeNormalizeChatDisplay()'));
    assert.doesNotMatch(normalize, /nch-native-pin-control/);
    assert.doesNotMatch(normalize, /button\.className = "nch-pin-chat"/);
    assert.doesNotMatch(normalize, /renderPinnedChatStrip/);
    assert.doesNotMatch(css, /\.nch-native-pin-control\s*\{[^}]*display:\s*none/s);
    assert.match(chat, /class="chat-pinned-strip" aria-label="Pinned public messages"/);
    assert.match(chat, /this\.publicMessages\.values\(\)[\s\S]*message\.pinned/);
    assert.match(chat, /className = 'chat-pinned-image'/);
    assert.match(chat, /open\.append\(author, preview, expandLabel\)/);
    assert.match(chat, /void this\.togglePin\(message\)/);
    assert.match(read('client/dist/public/css/local.css'),
        /\.chat-pinned-strip\s*\{[^}]*display:\s*flex[^}]*flex:\s*0 0 auto[^}]*max-height:\s*86px/s);
    assert.match(read('client/dist/public/css/local.css'),
        /\.chat-pinned-image\s*\{[^}]*width:\s*42px[^}]*height:\s*28px[^}]*object-fit:\s*cover/s);
    assert.match(read('client/dist/public/css/local.css'),
        /\.chat-pinned-item\s*\{[^}]*flex:\s*0 0 auto/s);
    assert.match(read('client/dist/public/css/local.css'),
        /\.chat-pinned-item\.is-expanded \.chat-pinned-image\s*\{[^}]*max-width:\s*min\(100%, 420px\)[^}]*max-height:\s*220px/s);
    assert.match(read('client/dist/public/css/local.css'),
        /\.chat-pinned-expand-label\s*\{[^}]*border:[^}]*font-size:\s*0\.78rem[^}]*font-weight:\s*700/s);
});

test('private chat keeps recipient, presence, unread, and ignore state inside the Chat module', () => {
    const source = read('client/src/public/js/lib/chat.ts');
    const css = read('client/dist/public/css/local.css');
    assert.match(source, /To: Everyone · Public ▾/);
    assert.match(source, /· Private ▾/);
    assert.match(source, /Message \$\{selected\.callSign\} privately…/);
    assert.match(source, /Message the net…/);
    assert.match(source, /chat-recipient-unread/);
    assert.match(source, /Ignore private messages/);
    assert.match(source, /presence\.textContent = recipient\.ignored[\s\S]*'Available'[\s\S]*'Unavailable'/);
    assert.match(source, /ignore\.setAttribute\('aria-pressed'/);
    assert.match(source, /shouldRecordPrivateUnread/);
    assert.match(source, /suppressIgnoredConversation/);
    assert.match(source, /Message privately/);
    assert.match(source, /clearPrivateUnread/);
    assert.match(source, /direct\/\$\{encodeURIComponent\(recipientId\)\}\/messages/);
    assert.match(css, /\.chat-presence-dot\.is-online\s*\{\s*background:\s*#43d17a/);
    assert.match(css, /\.chat-presence-dot\.is-offline\s*\{\s*background:\s*#7d8790/);
    assert.match(css, /\.chat-recipient-choice\.is-ignored\s*\{/);
    assert.doesNotMatch(source, /WebSocket/);
});

test('chat request errors distinguish authentication, authorization, and rate limits', () => {
    const source = read('client/src/public/js/lib/chat.ts');
    const state = read('client/src/public/js/lib/chatState.ts');
    assert.match(state, /status === 401[\s\S]*Sign in required/);
    assert.match(state, /status === 403[\s\S]*Permission denied/);
    assert.match(state, /status === 429[\s\S]*Rate limit reached/);
    assert.match(source, /chatRequestErrorMessage\(response\.status, data\.error/);
    assert.match(source, /reconcileMutationMessage\(data\.message\)/);
    assert.match(source, /message\.scope === 'direct'[\s\S]*reconcileDirectMessages\(\[message\], false\)/);
});
