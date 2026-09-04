const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const loadState = () => import(pathToFileURL(path.join(root, 'client/dist/public/js/lib/chatState.js')).href);

test('reconnect owns one EventSource and teardown closes it exactly once', async () => {
    const { SingleChatStream } = await loadState();
    const slot = new SingleChatStream();
    const first = { closes: 0, close() { this.closes += 1; } };
    const second = { closes: 0, close() { this.closes += 1; } };

    assert.equal(slot.replace(() => first), first);
    assert.equal(slot.active, true);
    assert.equal(slot.owns(first), true);
    assert.equal(slot.replace(() => second), second);
    assert.equal(first.closes, 1);
    assert.equal(slot.owns(first), false);
    assert.equal(slot.owns(second), true);

    slot.close();
    slot.close();
    assert.equal(second.closes, 1);
    assert.equal(slot.active, false);
});

test('reconnect snapshots remove stale known messages without deleting messages received during the request', async () => {
    const { reconcileChatSnapshot } = await loadState();
    const messages = new Map([
        ['kept', { id: 'kept', createdAt: '2026-08-31T10:00:00.000Z', text: 'old' }],
        ['stale', { id: 'stale', createdAt: '2026-08-31T10:01:00.000Z', text: 'cleared while offline' }]
    ]);
    const knownBeforeRequest = new Set(messages.keys());
    messages.set('live-race', { id: 'live-race', createdAt: '2026-08-31T10:03:00.000Z', text: 'arrived by SSE' });

    const added = reconcileChatSnapshot(messages, [
        { id: 'kept', createdAt: '2026-08-31T10:00:00.000Z', text: 'edited while offline' },
        { id: 'missed', createdAt: '2026-08-31T10:02:00.000Z', text: 'missed while offline' }
    ], knownBeforeRequest);

    assert.equal(added, 1);
    assert.deepEqual([...messages.keys()].sort(), ['kept', 'live-race', 'missed']);
    assert.equal(messages.get('kept').text, 'edited while offline');
});

test('composer operation gate prevents rapid Enter, double-click, and simultaneous image submission', async () => {
    const { ExclusiveChatOperation } = await loadState();
    const gate = new ExclusiveChatOperation();
    assert.equal(gate.begin('send'), true);
    assert.equal(gate.begin('send'), false);
    assert.equal(gate.begin('upload'), false);
    gate.end('upload');
    assert.equal(gate.isActive('send'), true);
    gate.end('send');
    assert.equal(gate.begin('upload'), true);
    gate.end('upload');
    assert.equal(gate.isActive(), false);
});

test('anchor-based scroll restoration preserves a reader position after content changes above it', async () => {
    const { preserveScrollTop, shouldScrollChatToLatest } = await loadState();
    assert.equal(preserveScrollTop(240, 12, 72), 300);
    assert.equal(preserveScrollTop(20, 80, 10), 0);
    assert.equal(shouldScrollChatToLatest(true, false), true);
    assert.equal(shouldScrollChatToLatest(false, false), false);
});

test('chat reconnect and bridge lifecycle avoid redundant polling and initial history reload', () => {
    const chat = read('client/src/public/js/lib/chat.ts');
    const bridge = read('client/src/public/js/byView/liveNet/ncoLoggerChatBridge.js');
    const server = read('server/dist/lib/localChat.js');

    assert.match(chat, /const source = this\.eventStream\.replace/);
    assert.match(chat, /if \(receivedReady\) this\.requestHistoryReload\(\)/);
    assert.match(chat, /this\.clearConnectionRetry\(\)[\s\S]*this\.eventStream\.close\(\)[\s\S]*this\.connectionAbort\?\.abort\(\)/);
    assert.match(chat, /this\.historyReloadQueued = true/);
    assert.match(chat, /existing\?\.dataset\['renderKey'\] === renderKey \? existing : this\.renderMessage/);
    assert.match(chat, /private renderLatestAppend\(/);
    assert.match(chat, /container\.append\(this\.renderMessage\(message\)\)/);
    assert.match(chat, /trimOldestChatMessages\(this\.publicMessages, PUBLIC_MESSAGE_LIMIT\)/);
    assert.match(chat, /NCOChatDiagnostics/);
    assert.doesNotMatch(bridge, /setInterval\(attach/);
    assert.match(bridge, /new MutationObserver\(queueAttach\)/);
    assert.match(bridge, /record\.addedNodes\.forEach\(addMessageNodes\)/);
    assert.doesNotMatch(bridge, /boundChat\.querySelectorAll\("\[data-message-id\]"\)\.forEach/);
    assert.ok(server.indexOf('openChatChangeStream({') < server.indexOf("writeEvent('ready'"));
    assert.match(server, /req\.once\('close', cleanup\)/);
    assert.match(server, /res\.once\('close', cleanup\)/);
    assert.match(server, /chatChangeSubscription\.close\(\)/);
});
