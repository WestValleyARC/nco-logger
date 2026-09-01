/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'client/src/public/js/byView/liveNet/ncoLogger.js'), 'utf8');
const loadPolicy = () => import(pathToFileURL(path.join(root, 'client/dist/public/js/lib/avatarPolicy.js')).href);

test('QRZ photo is selected when resolved and default is used without one', async () => {
    const { selectNcoAvatarSource } = await loadPolicy();
    assert.equal(selectNcoAvatarSource('https://files.qrz.com/a.jpg', 'data:image/jpeg;base64,ok', '/default.svg'),
        'data:image/jpeg;base64,ok');
    assert.equal(selectNcoAvatarSource('', '', '/default.svg'), '/default.svg');
    assert.equal(selectNcoAvatarSource('https://files.qrz.com/a.jpg', '', '/default.svg'), '/default.svg');
});

test('NCO Logger ignores supported site profile photos when choosing its avatar', () => {
    const detailsBlock = source.slice(source.indexOf('function detailsFor'), source.indexOf('async function resolvedAvatarSource'));
    assert.match(detailsBlock, /qrzPhoto: safeImageUrl\(saved\.qrzPhoto\)/);
    assert.doesNotMatch(detailsBlock, /station\?\.photo/);
});

test('transient QRZ avatar failures retry sooner than definitive no-photo results', async () => {
    const { avatarRetryAt, AVATAR_TRANSIENT_RETRY_MS, AVATAR_DEFINITIVE_TTL_MS } = await loadPolicy();
    assert.equal(avatarRetryAt('timeout', false, 100), 100 + AVATAR_TRANSIENT_RETRY_MS);
    assert.equal(avatarRetryAt('auth-session-failure', false, 100), 100 + AVATAR_TRANSIENT_RETRY_MS);
    assert.equal(avatarRetryAt('not-found', false, 100), 100 + AVATAR_DEFINITIVE_TTL_MS);
    assert.equal(avatarRetryAt('success', false, 100), 100 + AVATAR_DEFINITIVE_TTL_MS);
    assert.match(source, /const qrzAvatarRetryAt = new Map\(\)/);
    assert.doesNotMatch(source, /qrzAttemptedCalls/);
});

test('avatar caches evict oldest entries at their configured bound', async () => {
    const { setBoundedCache } = await loadPolicy();
    const cache = new Map();
    for (let index = 0; index < 5; index++) setBoundedCache(cache, index, index, 3);
    assert.deepEqual([...cache.keys()], [2, 3, 4]);
    assert.match(source, /setBoundedCache\(resolvedAvatarDataUrls, candidate, source\)/);
});

test('later successful QRZ result rerenders the avatar without changing station state', () => {
    const lookupBlock = source.slice(source.indexOf('async function lookupQrz'), source.indexOf('async function stationProfileRequest'));
    const hydrateBlock = source.slice(source.indexOf('function hydrateAvatars'), source.indexOf('function quickTagState'));
    assert.match(lookupBlock, /const retainedPhoto = photo \|\| \(!definitiveNoPhoto \? current\.qrzPhoto : ""\)/);
    assert.match(lookupBlock, /qrzPhoto: retainedPhoto/);
    assert.match(lookupBlock, /renderQueue\(\)/);
    assert.match(hydrateBlock, /image\.src = source/);
    assert.doesNotMatch(hydrateBlock, /displayName|location|checkedState/);
});

test('failed image loads invalidate the positive cache and safely restore the default avatar', () => {
    const hydrateBlock = source.slice(source.indexOf('function hydrateAvatars'), source.indexOf('function quickTagState'));
    assert.match(hydrateBlock, /resolvedAvatarDataUrls\.delete\(candidate\)/);
    assert.match(hydrateBlock, /image\.src = DEFAULT_AVATAR/);
    assert.match(source, /referrerpolicy="no-referrer"/);
});

test('supported site-photo behavior remains available outside NCO Logger', () => {
    const auth = fs.readFileSync(path.join(root, 'server/dist/routes/authRoutes.js'), 'utf8');
    const widgets = fs.readFileSync(path.join(root, 'client/src/public/js/lib/widgets.ts'), 'utf8');
    assert.match(auth, /gravatar\.url/);
    assert.match(auth, /profile\.photos\[0\]\.value/);
    assert.match(widgets, /this\.station\?\.photo \?\? this\.defaultPhoto/);
});
