/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('station rendering avoids unchanged group writes and quadratic active categorization', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');

    assert.match(source, /renderedStationGroupHtml\.get\(element\) === html/);
    assert.match(source, /updateStationGroup\(panel\.querySelector\("\[data-role='checked-out'\]"\)/);
    assert.match(source, /updateStationGroup\(activeList, activeHtml\)/);
    assert.match(source, /updateStationGroup\(panel\.querySelector\("\[data-role='lurkers'\]"\)/);
    assert.match(source, /activeOrdered\.forEach\(station =>/);
    assert.doesNotMatch(source, /activeOrdered\.filter\(s => !ncos\.includes/);
});

test('chat normalization processes mutation roots instead of rescanning the full history per append', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');

    assert.match(source, /record\.addedNodes/);
    assert.match(source, /normalizeChatDisplay\(roots\.length \? roots : \[chat\], includeGlobalChecks\)/);
    assert.match(source, /new MutationObserver\(safeNormalizeChatDisplay\)/);
});

test('long-session diagnostics are bounded and do not create a periodic log loop', () => {
    const logger = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    const chat = read('client/src/public/js/lib/chat.ts');

    assert.match(logger, /TIMING_SAMPLE_LIMIT = 60/);
    assert.match(chat, /CHAT_TIMING_SAMPLE_LIMIT = 60/);
    assert.doesNotMatch(logger, /setInterval\([^\n]*Diagnostics/);
    assert.doesNotMatch(chat, /setInterval\(/);
});

test('change streams use a bounded pool separate from the development request pool', () => {
    const development = read('server/dist/devConfig.yaml');
    const common = read('server/dist/commonConfig.yaml');
    const requestPoolSize = Number(development.match(/realtime_mongoose_poolsize:\s*(\d+)/)?.[1]);
    const streamPoolSize = Number(common.match(/change_stream_poolsize:\s*(\d+)/)?.[1]);

    assert.equal(requestPoolSize, 5);
    assert.equal(streamPoolSize, 10);
});
