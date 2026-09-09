const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const loadEmoji = () => import(pathToFileURL(path.join(root, 'client/dist/public/js/lib/chatEmoji.js')).href);
const loadChatText = () => import(pathToFileURL(path.join(root, 'client/dist/public/js/lib/chatText.js')).href);
const loadLoggerResponsive = () => import(pathToFileURL(path.join(root, 'client/dist/public/js/lib/loggerResponsive.js')).href);

test('chat text safely identifies explicit and plausible protocol-less web URLs', async () => {
    const { chatLinkHref, chatTextParts } = await loadChatText();
    assert.deepEqual(chatTextParts('Visit https://westvalleyarc.com/node-status/'), [
        { kind: 'text', value: 'Visit ' },
        { kind: 'link', value: 'https://westvalleyarc.com/node-status/' }
    ]);
    assert.deepEqual(chatTextParts('Try http://example.com now'), [
        { kind: 'text', value: 'Try ' },
        { kind: 'link', value: 'http://example.com' },
        { kind: 'text', value: ' now' }
    ]);
    for (const value of ['westvalleyarc.com', 'www.westvalleyarc.com', 'logger.westvalleyarc.com/views/contact']) {
        assert.deepEqual(chatTextParts(value), [{ kind: 'link', value }]);
        assert.equal(chatLinkHref(value), `https://${value}`);
    }
    assert.deepEqual(chatTextParts('Visit westvalleyarc.com.'), [
        { kind: 'text', value: 'Visit ' },
        { kind: 'link', value: 'westvalleyarc.com' },
        { kind: 'text', value: '.' }
    ]);
    assert.deepEqual(chatTextParts('person@example.com'), [{ kind: 'text', value: 'person@example.com' }]);
    for (const value of ['KE7WIL', '3.14159', '192.168.1.1', 'bad_domain.com', '-bad.com', 'bad..com']) {
        assert.deepEqual(chatTextParts(value), [{ kind: 'text', value }]);
    }
});

test('chat URL rendering uses inert text nodes and preserves Unicode around links', async () => {
    const source = read('client/src/public/js/lib/chatText.ts');
    assert.match(source, /document\.createTextNode\(part\.value\)/);
    assert.match(source, /link\.textContent = part\.value/);
    assert.match(source, /link\.target = '_blank'/);
    assert.match(source, /link\.rel = 'noopener noreferrer'/);
    assert.doesNotMatch(source, /innerHTML/);
    const { chatTextParts } = await loadChatText();
    assert.deepEqual(chatTextParts('© Ω <-- https://example.com/path?q=µ, → <3'), [
        { kind: 'text', value: '© Ω <-- ' },
        { kind: 'link', value: 'https://example.com/path?q=µ' },
        { kind: 'text', value: ', → <3' }
    ]);
});

test('Viewer defaults and saved layouts are isolated by role and responsive context', () => {
    for (const file of ['client/src/public/js/byView/liveNet/ncoLogger.js', 'client/dist/public/js/byView/liveNet/ncoLogger.js']) {
        const source = read(file);
        assert.match(source, /VIEWER_DEFAULT_MODULE_LAYOUT[\s\S]*chat:\s*\{ x: 0, y: 0, w: 12, h: 20 \}[\s\S]*active:\s*\{ x: 12, y: 0, w: 12, h: 20 \}[\s\S]*collapsed:\s*\{ lurkers: true, checkedOut: true \}/);
        assert.match(source, /VIEWER_RESPONSIVE_DEFAULT_MODULE_LAYOUTS[\s\S]*phonePortrait:[\s\S]*active:\s*\{ x: 0, y: 0, w: 24, h: 14 \}[\s\S]*chat:\s*\{ x: 0, y: 14, w: 24, h: 14 \}/);
        assert.match(source, /VIEWER_RESPONSIVE_DEFAULT_MODULE_LAYOUTS[\s\S]*phonePortrait:[\s\S]*collapsed:\s*\{ controls: true, lurkers: true, checkedOut: true \}/);
        assert.match(source, /tabletPortrait:[\s\S]*chat:\s*\{ x: 0, y: 0, w: 10, h: 24 \}[\s\S]*active:\s*\{ x: 10, y: 0, w: 14, h: 24 \}/);
        assert.match(source, /tabletLandscape:[\s\S]*chat:\s*\{ x: 0, y: 0, w: 8, h: 20 \}[\s\S]*active:\s*\{ x: 8, y: 0, w: 16, h: 20 \}/);
        assert.match(source, /roleResponsiveLayouts:\s*local\.roleResponsiveLayouts/);
        assert.match(source, /function activateLayoutRole\(role, previousRole = ""\)[\s\S]*saveActiveLayoutContext\(previousRole\)[\s\S]*savedLayoutForContext\(currentLayoutContext\) \|\| defaultModuleLayoutForMode\(\)/);
        assert.match(source, /const previousRole = layoutRoleResolved \? currentUserRole : "";[\s\S]*if \(!layoutRoleResolved \|\| previousRole !== nextRole\)[\s\S]*activateLayoutRole\(nextRole, previousRole\)/);
        assert.match(source, /if \(desiredRole === "netcontrol"\)[\s\S]*activateLayoutRole\("netlogger", currentUserRole\);[\s\S]*storageSet\(\);/);
        assert.match(source, /legacyLayoutShouldResetForRole[\s\S]*shouldResetLegacyLoggerLayout/);
        assert.match(source, /isCurrentResponsiveLayout\(candidate, context\)/);
    }
});

test('public and private chat recipients share one stable control structure', () => {
    const source = read('client/src/public/js/lib/chat.ts');
    const css = read('client/dist/public/css/local.css');
    assert.match(source, /chat-recipient-toggle-label[\s\S]*chat-recipient-toggle-indicator/);
    assert.match(source, /toggleLabel\.textContent = selected[\s\S]*To: \$\{selected\.callSign\} \(Private\)[\s\S]*To: Everyone \(Public\)/);
    assert.match(css, /\.chat-recipient-toggle\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto[^}]*box-sizing:\s*border-box[^}]*text-align:\s*left/s);
    assert.match(css, /\.chat-recipient-toggle-label\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
    assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.chat-recipient-toggle\s*\{[^}]*width:\s*100%[^}]*height:\s*44px[^}]*min-height:\s*44px/s);
    assert.doesNotMatch(css, /chat-private-active \.chat-recipient-toggle/);
});

test('role layout migration rejects known cross-role defaults without erasing customization', async () => {
    const {
        isSameLoggerModuleLayout, loggerLayoutRole, shouldResetLegacyLoggerLayout, LOGGER_ROLE_LAYOUT_VERSION
    } = await loadLoggerResponsive();
    assert.equal(LOGGER_ROLE_LAYOUT_VERSION, 1);
    assert.equal(loggerLayoutRole('netcontrol'), 'nco');
    assert.equal(loggerLayoutRole('netlogger'), 'logger');
    assert.equal(loggerLayoutRole('netrelay'), 'relay');
    assert.equal(loggerLayoutRole('netuser'), 'viewer');
    const operatorDefault = {
        items: {
            controls: { x: 10, y: 0, w: 4, h: 4 }, active: { x: 8, y: 4, w: 16, h: 16 },
            chat: { x: 0, y: 4, w: 8, h: 16 }, lurkers: { x: 0, y: 0, w: 10, h: 4 },
            checkedOut: { x: 14, y: 0, w: 10, h: 4 }
        }, collapsed: {}
    };
    const viewerDefault = {
        items: {
            controls: { x: 10, y: 0, w: 4, h: 4 }, active: { x: 12, y: 0, w: 12, h: 20 },
            chat: { x: 0, y: 0, w: 12, h: 20 }, lurkers: { x: 0, y: 0, w: 12, h: 4 },
            checkedOut: { x: 12, y: 0, w: 12, h: 4 }
        }, collapsed: { lurkers: true, checkedOut: true }
    };
    const customized = structuredClone(operatorDefault);
    customized.items.chat.w = 9;
    assert.equal(isSameLoggerModuleLayout(operatorDefault, structuredClone(operatorDefault)), true);
    assert.equal(isSameLoggerModuleLayout(customized, operatorDefault), false);
    const inheritedViewerDefault = structuredClone(operatorDefault);
    inheritedViewerDefault.collapsed = { controls: true, lurkers: true, checkedOut: true };
    assert.equal(shouldResetLegacyLoggerLayout(operatorDefault, 'netuser', operatorDefault, viewerDefault), true);
    assert.equal(shouldResetLegacyLoggerLayout(viewerDefault, 'netcontrol', operatorDefault, viewerDefault), true);
    assert.equal(shouldResetLegacyLoggerLayout(
        inheritedViewerDefault, 'netuser', operatorDefault, viewerDefault, inheritedViewerDefault
    ), true);
    assert.equal(shouldResetLegacyLoggerLayout(
        inheritedViewerDefault, 'netlogger', operatorDefault, viewerDefault, inheritedViewerDefault
    ), true);
    assert.equal(shouldResetLegacyLoggerLayout(customized, 'netuser', operatorDefault, viewerDefault), false);
});

test('modern Logger menu styling is not replaced by the optional metallic paint layer', () => {
    const loggerCss = read('client/dist/public/css/nco-logger.css');
    const metallicCss = read('client/dist/public/css/nco-logger-metallic.css');
    assert.match(loggerCss, /\.nch-header-menu-popover\s*\{[^}]*gap:\s*1px[^}]*background:\s*#07111a[^}]*border-radius:\s*4px/s);
    assert.match(loggerCss, /\.nch-modules-menu-panel > button\[data-toggle-module\] small::after\s*\{[^}]*border-radius:\s*50%[^}]*transition:/s);
    assert.match(loggerCss, /button\[data-toggle-module\]\[aria-pressed="true"\] small::after\s*\{[^}]*transform:\s*translateX\(14px\)/s);
    assert.doesNotMatch(metallicCss, /\.nch-header-menu-popover/);
    assert.doesNotMatch(metallicCss, /\.nch-header-menu > summary/);
});

test('emoji picker provides all requested categories and a substantial searchable set', async () => {
    const { CHAT_EMOJI_CATEGORIES, filterChatEmoji } = await loadEmoji();
    assert.deepEqual(
        CHAT_EMOJI_CATEGORIES.map(category => category.id),
        ['smileys', 'people', 'nature', 'food', 'activities', 'travel', 'objects', 'symbols', 'flags']
    );
    assert.deepEqual(CHAT_EMOJI_CATEGORIES.map(category => category.label), [
        'Smileys & Emotion', 'People & Body', 'Animals & Nature', 'Food & Drink', 'Activities',
        'Travel & Places', 'Objects', 'Symbols', 'Flags'
    ]);
    const catalog = CHAT_EMOJI_CATEGORIES.flatMap(category => category.emoji);
    assert.ok(catalog.length >= 1100 && catalog.length <= 1200);
    assert.equal(new Set(catalog.map(entry => entry.emoji)).size, catalog.length);
    const required = ['📻', '🎙️', '🎧', '📡', '🛰️', '📞', '☎️', '📱', '🔊', '🔇', '🔔', '🚨',
        '⚠️', '🆘', '🔋', '🔌', '💻', '🖥️', '⌨️', '🗼', '🌐', '📶', '⚡', '🛜'];
    for (const emoji of required) assert.ok(catalog.some(entry => entry.emoji === emoji), `missing ${emoji}`);
    assert.ok(filterChatEmoji('smileys', 'radio').some(entry => entry.emoji === '📻'));
    assert.ok(filterChatEmoji('smileys', 'emergency').some(entry => entry.emoji === '🆘'));
    assert.ok(filterChatEmoji('smileys', 'wifi').some(entry => entry.emoji === '🛜'));
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
    assert.match(css, /\.chat-emoji-tab\s*\{[^}]*background:\s*rgba\(116, 198, 212, 0\.06\)[^}]*border-color:\s*rgba\(116, 198, 212, 0\.22\)[^}]*font-size:\s*1\.05rem/s);
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

test('typing indicator reserves stable space at the composer boundary when idle', () => {
    const css = read('client/dist/public/css/local.css');
    const source = read('client/src/public/js/lib/chat.ts');
    assert.match(source, /chat-composer-wrap[\s\S]*chat-typing-indicator[\s\S]*chat-form/);
    assert.match(css, /\.chat-composer-wrap\s*\{[^}]*flex:\s*0 0 auto/s);
    assert.match(css, /\.chat-typing-indicator\s*\{[^}]*display:\s*block[^}]*height:\s*20px[^}]*min-height:\s*20px[^}]*max-height:\s*20px[^}]*flex:\s*0 0 20px[^}]*overflow:\s*hidden[^}]*white-space:\s*nowrap/s);
    assert.match(css, /\.chat-typing-indicator\[hidden\]\s*\{[^}]*display:\s*block[^}]*visibility:\s*hidden/s);
    assert.doesNotMatch(css, /\.chat-typing-indicator\s*\{[^}]*position:\s*(?:absolute|fixed)/s);
});

test('emoji-only chat messages are detected by grapheme and limited to three', async () => {
    const { isEmojiOnlyChatMessage } = await loadChatText();
    for (const value of ['👍', '😂😂', '❤️ 👍 😂', '👍🏽', '☕️', '👨‍👩‍👧‍👦', '🇺🇸 🇨🇦']) {
        assert.equal(isEmojiOnlyChatMessage(value), true, value);
    }
    for (const value of ['', '   ', 'Great job 👍', 'Thanks!', '👍 Great', '👍👍👍👍', '©', '↔']) {
        assert.equal(isEmojiOnlyChatMessage(value), false, value);
    }
});

test('large emoji styling is applied only to the rendered message body', () => {
    const localCss = read('client/dist/public/css/local.css');
    const loggerCss = read('client/dist/public/css/nco-logger.css');
    const source = read('client/src/public/js/lib/chat.ts');
    assert.match(source, /body\.classList\.toggle\('chat-emoji-only', isEmojiOnlyChatMessage\(message\.text\)\)/);
    assert.match(source, /appendChatText\(body, message\.text\)/);
    assert.match(localCss, /\.chat-message-content\.chat-emoji-only\s*\{[^}]*font-size:\s*3em[^}]*line-height:\s*1\.1/s);
    assert.match(loggerCss, /\.chat-message-content\.chat-emoji-only\s*\{[^}]*font-size:\s*calc\(var\(--nch-chat-font-size\) \* 3\) !important/s);
    assert.doesNotMatch(source, /innerHTML[\s\S]{0,200}chat-emoji-only/);
});

test('emoji categories are labeled navigation controls separated from insertion choices', () => {
    const css = read('client/dist/public/css/local.css');
    const source = read('client/src/public/js/lib/chat.ts');
    assert.match(source, /local-chat-emoji-categories-label">Categories/);
    assert.match(source, /chat-emoji-category-name[^>]*aria-live="polite"/);
    assert.match(source, /chat-emoji-tabs" role="group" aria-labelledby="local-chat-emoji-categories-label"/);
    assert.match(source, /button\.setAttribute\('aria-label', `Show \$\{category\.label\} category`\)/);
    assert.match(source, /button\.setAttribute\('aria-pressed', String\(active\)\)/);
    assert.match(source, /grid\.setAttribute\('aria-label', search\.value\.trim\(\) \? 'Emoji search results'/);
    assert.match(css, /\.chat-emoji-category-nav\s*\{[^}]*border-bottom:/s);
    assert.doesNotMatch(source, /chat-emoji-tab[\s\S]{0,800}insertEmoji\(/);
});

test('quick reactions are fitted to the visible Chat module when opened and resized', () => {
    const css = read('client/dist/public/css/local.css');
    const source = read('client/src/public/js/lib/chat.ts');
    assert.match(source, /if \(!menu\.hidden\) this\.positionQuickReactions\(menu, controls\)/);
    assert.match(source, /positionOpenTransientOverlays[\s\S]*chat-quick-reactions:not\(\[hidden\]\)[\s\S]*positionQuickReactions/);
    assert.match(source, /new ResizeObserver\(\(\) => this\.handleWindowResize\(\)\)[\s\S]*resizeObserver\?\.observe\(this\)/);
    assert.match(source, /visibleLeft = Math\.max\(viewportLeft, chatRect\.left\)/);
    assert.match(source, /visibleBottom = Math\.min\(viewportBottom, chatRect\.bottom\)/);
    assert.match(source, /fitChatOverlayToViewport\(\{[\s\S]*preferredWidth: menu\.offsetWidth[\s\S]*alignEnd: true, gap: 4/);
    assert.match(source, /\['👍', '❤️', '😂', '😮'\]\.forEach\(emoji =>/);
    assert.match(css, /\.chat-quick-reactions\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*6/s);
});

test('responsive logger keeps independent orientation layouts and touch-safe controls', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    const css = read('client/dist/public/css/nco-logger.css');
    assert.match(source, /phonePortrait:[\s\S]*controls: \{ x: 0, y: 0, w: 24, h: 6[\s\S]*active: \{ x: 0, y: 6[\s\S]*chat: \{ x: 0, y: 20/);
    assert.match(source, /phoneLandscape:[\s\S]*active: \{ x: 8, y: 0, w: 16/);
    assert.match(source, /tabletPortrait:[\s\S]*chat: \{ x: 0, y: 5, w: 10[\s\S]*active: \{ x: 10, y: 5, w: 14/);
    assert.doesNotMatch(source, /NCO_TABLET_PORTRAIT_DEFAULT_MODULE_LAYOUT/);
    assert.match(source, /PREVIOUS_NCO_TABLET_LANDSCAPE_DEFAULT_MODULE_LAYOUT[\s\S]*controls: \{ x: 10, y: 0, w: 4, h: 7 \}[\s\S]*chat: \{ x: 0, y: 4, w: 8, h: 16 \}[\s\S]*active: \{ x: 8, y: 7, w: 16, h: 13 \}/);
    assert.match(source, /NCO_TABLET_LANDSCAPE_DEFAULT_MODULE_LAYOUT[\s\S]*lurkers: \{ x: 0, y: 0, w: 10, h: 5 \}[\s\S]*controls: \{ x: 10, y: 0, w: 4, h: 5 \}[\s\S]*checkedOut: \{ x: 14, y: 0, w: 10, h: 5 \}[\s\S]*chat: \{ x: 0, y: 5, w: 8, h: 15 \}[\s\S]*active: \{ x: 8, y: 5, w: 16, h: 15 \}/);
    assert.match(source, /loggerLayoutRole\(role\) === "nco" && context === "tabletLandscape"[\s\S]*return NCO_TABLET_LANDSCAPE_DEFAULT_MODULE_LAYOUT/);
    assert.match(source, /loggerLayoutRole\(role\) === "nco"[\s\S]*\[DEFAULT_MODULE_LAYOUT, PREVIOUS_NCO_TABLET_LANDSCAPE_DEFAULT_MODULE_LAYOUT\][\s\S]*isSameLoggerModuleLayout\(bucket\.tabletLandscape, previousDefault\)[\s\S]*bucket\.tabletLandscape = NCO_TABLET_LANDSCAPE_DEFAULT_MODULE_LAYOUT/);
    assert.match(source, /VIEWER_RESPONSIVE_DEFAULT_MODULE_LAYOUTS[\s\S]*phonePortrait[\s\S]*active: \{ x: 0, y: 0, w: 24[\s\S]*chat: \{ x: 0, y: 14, w: 24/);
    assert.match(source, /roleResponsiveLayouts:\s*local\.roleResponsiveLayouts/);
    assert.doesNotMatch(source, /hasCanonicalReadOnlyTop/);
    assert.match(source, /const heightOnlyPhoneResize = currentLayoutContext\.startsWith\("phone"\)[\s\S]*Math\.abs\(viewport\.width - lastLayoutViewportWidth\) <= 2[\s\S]*nextContext = `phone\$\{currentOrientation\}`[\s\S]*switchLayoutContext\(nextContext\)/);
    assert.match(source, /const layoutViewport = \(\) => \(\{[\s\S]*document\.documentElement\.clientWidth \|\| window\.innerWidth[\s\S]*document\.documentElement\.clientHeight \|\| window\.innerHeight/);
    assert.match(source, /Reset Portrait Layout[\s\S]*Reset Landscape Layout/);
    assert.match(source, /Reset only the \$\{layoutContextLabel\(targetContext\)\}/);
    assert.match(source, /netcontrol:\s*"NCO Mode"[\s\S]*netlogger:\s*"Logger Mode"[\s\S]*netrelay:\s*"Relay Mode"[\s\S]*\|\| "Viewer Mode"/);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-dashboard\s*\{[^}]*grid-template-rows:\s*repeat\(var\(--nch-grid-rows\), 26px\)[^}]*overflow:\s*visible/s);
    assert.match(css, /@container \(max-width: 190px\)[\s\S]*\[data-layout-context="tabletLandscape"\] \.nch-controls-pane \.nch-quick-checkin\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s);
    assert.match(css, /\[data-layout-context="tabletLandscape"\] \.nch-controls-pane \.nch-entry-controls\s*\{[^}]*justify-content:\s*flex-start/s);
    assert.match(css, /\[data-layout-context="tabletPortrait"\] \.nch-controls-pane \.nch-entry-controls\s*\{[^}]*padding-bottom:\s*9px/s);
    assert.match(css, /\[data-layout-context="tabletPortrait"\] \.nch-controls-pane \.nch-net-actions\s*\{[^}]*transform:\s*translateY\(-4px\)/s);
    assert.match(css, /\[data-layout-context="tabletLandscape"\] \.nch-controls-pane \.nch-net-actions\s*\{[^}]*margin-top:\s*3px/s);
    assert.match(css, /#netcontrol-ncs-helper\[data-layout-context\^="phone"\]\s*\{[^}]*z-index:\s*auto[^}]*grid-template-rows:\s*auto auto/s);
    assert.doesNotMatch(css, /\[data-layout-context\^="phone"\] \.nch-module\s*\{[^}]*margin/s);
    assert.match(css, /\[data-layout-context\^="phone"\] :is\(\.nch-module-content, \.nch-module-header\)\s*\{[^}]*overscroll-behavior-y:\s*auto[^}]*touch-action:\s*pan-y/s);
    assert.match(css, /:has\(#netcontrol-ncs-helper\[data-layout-context\^="phone"\]\) > hl-chat\.nch-chat-floating\s*\{[^}]*position:\s*absolute !important[^}]*z-index:\s*70 !important/s);
    assert.match(css, /hl-chat\.nch-chat-docked :is\(\.chat-messages, \.nch-private-messages, \.nch-pinned-chat-strip\)\s*\{[^}]*overscroll-behavior-y:\s*auto !important[^}]*touch-action:\s*pan-y/s);
    assert.match(source, /const followsDocument = currentLayoutContext\.startsWith\("phone"\)[\s\S]*rect\.top \+ \(followsDocument \? window\.scrollY : 0\)/);
    assert.match(css, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.nch-module-header\s*\{[^}]*min-height:\s*32px/s);
    assert.match(css, /\[data-layout-context\^="phone"\] > header\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*100[^}]*top:\s*0[^}]*right:\s*0[^}]*left:\s*0[^}]*safe-area-inset-top/s);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-body\s*\{[^}]*--nch-phone-footer-height:\s*40px[^}]*padding-top:\s*calc\(47px \+ env\(safe-area-inset-top\)\)[^}]*padding-bottom:\s*calc\(var\(--nch-phone-footer-height\) \+ env\(safe-area-inset-bottom\)\)/s);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-fixed-status-bar\s*\{[^}]*position:\s*fixed[^}]*right:\s*0[^}]*bottom:\s*0[^}]*left:\s*0[^}]*height:\s*calc\(var\(--nch-phone-footer-height, 40px\) \+ env\(safe-area-inset-bottom\)\)[^}]*min-height:\s*0[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[^}]*grid-template-rows:\s*17px minmax\(0, 1fr\)/s);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-fixed-status-bar\s*\{[^}]*z-index:\s*90/s);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-count-card strong\s*\{[^}]*font-size:\s*calc\(12px \+ var\(--nch-font-adjust, 0px\)\)/s);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-count-card small\s*\{[^}]*font-size:\s*calc\(8px \+ var\(--nch-font-adjust, 0px\)\)/s);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-status-icon\s*\{[^}]*width:\s*8px[^}]*height:\s*8px[^}]*flex:\s*0 0 8px[^}]*font-size:\s*6px/s);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-footer-mode\s*\{[^}]*justify-self:\s*end[^}]*text-align:\s*right/s);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-footer-mode::after\s*\{[^}]*content:\s*none/s);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-count-card\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-active-section \.nch-row\s*\{[^}]*grid-template-columns:\s*18px minmax\(112px, 128px\) minmax\(0, 1fr\) 36px/s);
    assert.match(css, /\[data-layout-context\^="tablet"\] \.nch-active-section \.nch-row\s*\{[^}]*grid-template-columns:\s*20px minmax\(112px, 136px\) minmax\(0, 1fr\) 36px/s);
    assert.match(css, /\[data-layout-context="tabletPortrait"\] \.nch-active-section \.nch-row\s*\{[^}]*grid-template-columns:\s*18px minmax\(112px, 128px\) minmax\(0, 1fr\) 36px/s);
    assert.match(css, /:is\(\[data-layout-context\^="phone"\], \[data-layout-context\^="tablet"\]\) button\.nch-station-action-toggle\s*\{[^}]*width:\s*36px[^}]*height:\s*36px[^}]*touch-action:\s*manipulation/s);
    assert.match(css, /:is\(\[data-layout-context\^="phone"\], \[data-layout-context\^="tablet"\]\) \.nch-active-section \.nch-row-text\s*\{[^}]*flex-direction:\s*column[^}]*overflow:\s*visible/s);
    assert.match(css, /:is\(\[data-layout-context\^="phone"\], \[data-layout-context\^="tablet"\]\) \.nch-active-section :is\(\.nch-role-badge, \.nch-tag\)\s*\{[^}]*flex:\s*0 0 auto/s);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-entry-controls\s*\{[^}]*padding-bottom:\s*9px/s);
    assert.match(source, /data-station-actions="\$\{escapeHtml\(call\)\}"[^>]*aria-expanded="false"/);
    assert.match(source, /const stationActionButton = event\.target\.closest\?\.\("\[data-station-actions\]"\)[\s\S]*pinnedActionCall = pinnedActionCall === call \? "" : call/);
    assert.match(source, /currentLayoutContext === "phonePortrait" && moduleAvailable\("controls"\) && items\.controls\.h < 6[\s\S]*items\.controls\.h = 6[\s\S]*items\[id\]\.y \+ addedRows/);
    assert.match(source, /currentLayoutContext === "phonePortrait" && id === "controls" \? 6 : MIN_MODULE_ROWS\[id\]/);
});

test('357x741 is phone portrait and cannot retain an unstamped desktop layout', async () => {
    const {
        classifyLoggerLayout, isCurrentResponsiveLayout, LOGGER_RESPONSIVE_LAYOUT_VERSION
    } = await loadLoggerResponsive();
    const context = classifyLoggerLayout(357, 741);
    assert.equal(context, 'phonePortrait');
    assert.equal(classifyLoggerLayout(741, 357), 'phoneLandscape');

    const legacyDesktopGeometry = {
        gridVersion: 4,
        items: {
            lurkers: { x: 0, y: 0, w: 10, h: 4 },
            controls: { x: 10, y: 0, w: 4, h: 4 },
            checkedOut: { x: 14, y: 0, w: 10, h: 4 },
            chat: { x: 0, y: 4, w: 8, h: 16 },
            active: { x: 8, y: 4, w: 16, h: 16 }
        }
    };
    assert.equal(isCurrentResponsiveLayout(legacyDesktopGeometry, context), false);
    assert.equal(isCurrentResponsiveLayout({
        ...legacyDesktopGeometry,
        responsiveLayoutVersion: LOGGER_RESPONSIVE_LAYOUT_VERSION,
        layoutContext: context
    }, context), false);
    assert.equal(isCurrentResponsiveLayout({
        ...legacyDesktopGeometry,
        responsiveLayoutVersion: LOGGER_RESPONSIVE_LAYOUT_VERSION,
        layoutContext: 'tabletPortrait'
    }, context), false);
    assert.equal(isCurrentResponsiveLayout({
        gridVersion: 4,
        responsiveLayoutVersion: LOGGER_RESPONSIVE_LAYOUT_VERSION,
        layoutContext: context,
        items: Object.fromEntries(['controls', 'active', 'chat', 'lurkers', 'checkedOut']
            .map((id, index) => [id, { x: 0, y: index * 5, w: 24, h: 5 }]))
    }, context), true);
});

test('phone portrait document height is derived only from visible modules', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    assert.match(source, /function visiblePhonePortraitLayout\(layout\)[\s\S]*currentLayoutContext !== "phonePortrait"[\s\S]*MODULE_IDS\.filter\(id => moduleAvailable\(id\) && !layout\.collapsed\[id\]\)/);
    assert.match(source, /visible\.forEach\(id => \{\s*rendered\.items\[id\]\.y = nextRow;\s*nextRow \+= rendered\.items\[id\]\.h/);
    assert.match(source, /return \{ layout: rendered, rows: Math\.max\(1, nextRow\) \}/);
    assert.match(source, /const rendered = visiblePhonePortraitLayout\(layout\)[\s\S]*--nch-grid-rows", String\(rendered\.rows\)/);
    assert.match(source, /VIEWER_RESPONSIVE_DEFAULT_MODULE_LAYOUTS[\s\S]*phonePortrait:[\s\S]*active: \{ x: 0, y: 0, w: 24, h: 14 \}[\s\S]*chat: \{ x: 0, y: 14, w: 24, h: 14 \}[\s\S]*collapsed: \{ controls: true, lurkers: true, checkedOut: true \}/);
});

test('private unread shortcut opens one sender directly and lists multiple senders', () => {
    const source = read('client/src/public/js/lib/chat.ts');
    const css = read('client/dist/public/css/local.css');
    assert.match(source, /unreadIds\.length === 1[\s\S]*switchConversation\(unreadIds\[0\]/);
    assert.match(source, /className = 'chat-unread-choice'/);
    assert.match(source, /this\.unreadCounts\.entries\(\)[\s\S]*count > 0/);
    assert.match(css, /\.chat-unread-menu\s*\{[^}]*position:\s*fixed[^}]*max-height:[^}]*overflow-y:\s*auto/s);
});

test('chat preserves separate public and private drafts and uses an em dash in authors', () => {
    const source = read('client/src/public/js/lib/chat.ts');
    assert.match(source, /private readonly drafts = new Map<string, string>\(\)/);
    assert.match(source, /this\.drafts\.set\(this\.conversationKey\(\), input\.value\)/);
    assert.match(source, /input\.value = this\.drafts\.get\(this\.conversationKey\(\)\) \|\| ''/);
    assert.match(source, /`\$\{firstName\} — \$\{message\.callSign\}`/);
});

test('slash command assistance filters current-role commands without changing submission semantics', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    assert.match(source, /function renderSlashSuggestions\(\)/);
    assert.match(source, /command\.name\.startsWith\(query\)/);
    assert.match(source, /className = "nch-command-suggestion"/);
    assert.match(source, /setSlashComposerText\(/);
    assert.match(source, /<details class="nch-hotkey-help"/);
});

test('server-returned station metadata replaces stale browser presentation state', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    assert.match(source, /function reconcileStationMetadata\(stations\)/);
    assert.match(source, /name:\s*serverName[\s\S]*location:\s*serverLocation[\s\S]*nameOverride:\s*false[\s\S]*locationOverride:\s*false/);
    assert.match(source, /latestStations = nextStations;\s*reconcileStationMetadata\(latestStations\)/);
});

test('private unread alert shares normal flow with the recipient selector', () => {
    const css = read('client/dist/public/css/local.css');
    const source = read('client/src/public/js/lib/chat.ts');
    assert.match(source, /chat-recipient-selector[\s\S]*chat-recipient-toggle[\s\S]*chat-private-unread[\s\S]*<\/div>[\s\S]*chat-ignore-button/);
    assert.match(css, /\.chat-recipient-selector\s*\{[^}]*display:\s*flex[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
    assert.match(css, /\.chat-private-unread\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/s);
    assert.doesNotMatch(css, /\.chat-private-unread\s*\{[^}]*position:\s*(?:absolute|fixed)/s);
    assert.match(css, /@media \(max-width:\s*520px\)\s*\{[\s\S]*\.chat-recipient-selector\s*\{[^}]*flex:\s*1 1 100%[^}]*width:\s*100%[\s\S]*\.chat-recipient-toggle\s*\{[^}]*flex:\s*1 1 100%[^}]*max-width:\s*100%[^}]*min-height:\s*44px/s);
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

test('highlight hover stays dark and initial chat waits for the docked logger layout', () => {
    const css = read('client/dist/public/css/nco-logger.css');
    const source = read('client/src/public/js/lib/chat.ts');
    assert.match(css, /\.nch-row\.nch-highlighted:hover\s*\{[^}]*color:\s*#fff8de[^}]*background:\s*#5a4d22[^}]*border-color:\s*#d1ae48/s);
    assert.match(css, /\.nch-row\.nch-highlighted:focus-within,[\s\S]*background:\s*#eac552/);
    assert.match(source, /this\.render\(\{ forceBottom: true \}\);\s*if \(this\.initialScrollGate\.markHistoryReady\(\)\) this\.scrollToLatest\(\);\s*this\.openEvents/);
    assert.match(source, /addEventListener\('nch-chat-layout-ready', this\.handleInitialLayoutReady\)/);
    assert.match(read('client/src/public/js/byView/liveNet/ncoLogger.js'), /renderHelperChatUi\(\);\s*chat\.dispatchEvent\(new Event\("nch-chat-layout-ready"\)\)/);
    assert.doesNotMatch(source, /requestAnimationFrame\(\(\) => this\.scrollToLatest\(\)\)/);
    assert.match(source, /if \(shouldScrollChatToLatest\(forceBottom, wasNearBottom\)\)/);
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
    const loggerCss = read('client/dist/public/css/nco-logger.css');
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
    assert.match(css, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.chat-message\.is-actions-open\s*\{[^}]*padding-bottom:\s*2\.35rem/s);
    assert.match(css, /\.chat-action-private\s*\{[^}]*color:\s*#f7c8ff[^}]*font-size:\s*1\.25rem[^}]*font-weight:\s*700[^}]*text-shadow:/s);
    assert.match(css, /\.chat-message-action-icon\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*line-height:\s*1/s);
    assert.match(css, /\.chat-action-private \.chat-message-action-icon\s*\{[^}]*transform:\s*translateY\(-0\.25em\)/s);
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
    assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.chat-message:hover \.chat-message-actions,[\s\S]*opacity:\s*1[\s\S]*pointer-events:\s*auto/s);
    assert.match(css, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.chat-message-actions\s*\{[^}]*visibility:\s*hidden[^}]*opacity:\s*0[^}]*pointer-events:\s*none[\s\S]*\.chat-message\.is-actions-open \.chat-message-actions\s*\{[^}]*visibility:\s*visible[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/s);
    assert.match(css, /\.chat-message-actions-toggle\s*\{\s*display:\s*none/);
    assert.match(css, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.chat-message-actions-toggle\s*\{[^}]*display:\s*inline-flex[^}]*width:\s*2rem[^}]*height:\s*2rem/s);
    assert.match(css, /\.chat-message\.is-actions-open > \.chat-message-actions-toggle\s*\{[^}]*background:\s*var\(--chat-accent-bright\)[^}]*box-shadow:/s);
    assert.match(source, /openMessageActionsId:\s*string \| null = null/);
    assert.match(source, /document\.addEventListener\('scroll', this\.handleDocumentScroll, \{ capture: true, passive: true \}\)/);
    assert.match(source, /if \(!actionTarget\) this\.closeMessageActions\(\)/);
    assert.match(source, /if \(this\.openMessageActionsId\)[\s\S]*this\.closeMessageActions\(true\)/);
    assert.match(source, /toggle\.addEventListener\('click', \(\) => this\.toggleMessageActions\(message\.id, row\)\)/);
    assert.match(source, /toggle\.textContent = '☺'/);
    assert.doesNotMatch(source, /toggle\.textContent = '⋯'/);
    assert.match(source, /private toggleMessageActions\([\s\S]*const open = this\.openMessageActionsId !== messageId;[\s\S]*this\.closeMessageActions\(\);[\s\S]*if \(!open\) return;[\s\S]*this\.openMessageActionsId = messageId/);
    assert.match(source, /toggle\?\.setAttribute\('aria-label', 'Hide message actions'\)/);
    assert.match(source, /if \(!keepOpen\) this\.closeMessageActions\(\)[\s\S]*action\(\)/);
    assert.match(source, /fitChatOverlayToViewport/);
    assert.match(source, /positionTransientOverlay\(menu, toggle, 384\)/);
    assert.match(source, /positionTransientOverlay\(menu, toggle, 320, true\)/);
    assert.match(source, /positionTransientOverlay\(picker, button, 352, true, 8\)/);
    assert.match(source, /positionTransientOverlay\(optionsPanel, optionsToggle, 190, true\)/);
    assert.match(source, /window\.visualViewport\?\.addEventListener\('scroll', this\.handleWindowResize\)/);
    assert.match(css, /\.chat-recipient-menu\s*\{[^}]*position:\s*fixed[^}]*max-width:\s*calc\(100vw - max\(8px, env\(safe-area-inset-left\)\) - max\(8px, env\(safe-area-inset-right\)\)\)/s);
    assert.match(css, /\.chat-viewport-inset-probe\s*\{[^}]*padding:\s*max\(8px, env\(safe-area-inset-top\)\)[^}]*safe-area-inset-left/s);
    assert.match(css, /\.chat-message-actions\s*\{[^}]*right:\s*0\.2rem[^}]*max-width:\s*calc\(100% - 0\.4rem\)/s);
    assert.match(loggerCss, /\.nch-command-suggestions\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*min-width:\s*0[^}]*overflow-x:\s*hidden/s);
});

test('native server-backed pins are not hidden or replaced by NCO helper normalization', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    const chat = read('client/src/public/js/lib/chat.ts');
    const css = read('client/dist/public/css/nco-logger.css');
    const localCss = read('client/dist/public/css/local.css');
    const lightCss = read('client/dist/public/css/nco-logger-light.css');
    const normalize = source.slice(source.indexOf('function normalizeChatDisplay()'), source.indexOf('function safeNormalizeChatDisplay()'));
    assert.doesNotMatch(normalize, /nch-native-pin-control/);
    assert.doesNotMatch(normalize, /button\.className = "nch-pin-chat"/);
    assert.doesNotMatch(normalize, /renderPinnedChatStrip/);
    assert.doesNotMatch(css, /\.nch-native-pin-control\s*\{[^}]*display:\s*none/s);
    assert.match(chat, /class="chat-pinned-strip" aria-label="Pinned public messages"/);
    assert.match(chat, /this\.publicMessages\.values\(\)[\s\S]*message\.pinned/);
    assert.match(chat, /className = 'chat-pinned-image'/);
    assert.match(chat, /author\.className = 'chat-pinned-author'[\s\S]*author\.textContent = message\.callSign/);
    assert.match(chat, /visibleMessages = this\.pinnedCollectionExpanded \? pinnedMessages : pinnedMessages\.slice\(0, 3\)/);
    assert.match(chat, /`\+ \$\{hiddenCount\} more pins ▾`/);
    assert.match(chat, /'Show fewer ▴'/);
    assert.match(chat, /if \(!truncated\)\s*\{[\s\S]*disclosure\?\.remove\(\)/);
    assert.match(chat, /if \(!disclosure\)\s*\{[\s\S]*className = 'chat-pinned-disclosure'/);
    assert.match(chat, /isPinnedTextTruncated\(preview\.scrollWidth, preview\.clientWidth\)/);
    assert.match(chat, /imageButton\.className = 'chat-pinned-image-open'[\s\S]*this\.openLightbox\(/);
    assert.match(chat, /if \(message\.canPin\)[\s\S]*unpin\.title = 'Unpin message'/);
    assert.match(chat, /void this\.togglePin\(message\)/);
    assert.match(localCss,
        /\.chat-pinned-strip\s*\{[^}]*display:\s*flex[^}]*flex:\s*0 0 auto[^}]*overflow:\s*visible[^}]*border-bottom:\s*1px/s);
    assert.match(localCss,
        /\.chat-pinned-image\s*\{[^}]*width:\s*auto[^}]*max-width:\s*70px[^}]*height:\s*auto[^}]*object-fit:\s*contain/s);
    assert.match(localCss,
        /\.chat-pinned-item\s*\{[^}]*width:\s*100%[^}]*grid-template-columns:\s*auto auto minmax\(0, 1fr\) auto auto[^}]*flex:\s*0 0 auto/s);
    assert.match(localCss,
        /\.chat-pinned-unpin\s*\{[^}]*grid-column:\s*5[^}]*justify-self:\s*end/s);
    assert.match(localCss,
        /\.chat-pinned-disclosure,[\s\S]*\.chat-pinned-collection-toggle\s*\{[^}]*background:\s*transparent[^}]*border:\s*0/s);
    assert.match(localCss, /\.chat-pinned-author\s*\{[^}]*color:\s*#efbf62[^}]*font-weight:\s*600/s);
    assert.match(lightCss, /:root\[data-theme='light'\] body\.nco-logger-page hl-chat\.nch-chat-docked :is\(\.chat-pinned-author,[^}]*\.chat-pinned-disclosure,[^}]*\.chat-pinned-collection-toggle/);
    assert.match(lightCss, /:root\[data-theme='light'\] body\.nco-logger-page hl-chat\.nch-chat-docked :is\(\.chat-pinned-strip, \.nch-pinned-chat-strip\)\s*\{[^}]*background:\s*linear-gradient\(90deg, rgba\(227, 238, 243, \.98\), rgba\(244, 240, 225, \.72\)\)/s);
    const pinCss = localCss.slice(localCss.indexOf('.chat-pinned-strip {'), localCss.indexOf('.chat-clear-button:focus-visible'));
    assert.doesNotMatch(pinCss, /@media/);
    assert.doesNotMatch(chat.slice(chat.indexOf('private renderPinnedMessages'), chat.indexOf('private updatePinnedTextOverflow')), /\[Image\]|Show full ▾/);
});

test('private chat keeps recipient, presence, unread, and ignore state inside the Chat module', () => {
    const source = read('client/src/public/js/lib/chat.ts');
    const css = read('client/dist/public/css/local.css');
    assert.match(source, /chat-recipient-toggle-label">To: Everyone \(Public\)/);
    assert.match(source, /To: \$\{selected\.callSign\} \(Private\)/);
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
