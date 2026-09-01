const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const loadState = () => import(pathToFileURL(path.resolve(__dirname, '../client/dist/public/js/lib/chatState.js')).href);

test('chat opens at latest while preserving a reader who manually scrolled up', async () => {
    const { shouldScrollChatToLatest } = await loadState();
    assert.equal(shouldScrollChatToLatest(true, false), true);
    assert.equal(shouldScrollChatToLatest(false, true), true);
    assert.equal(shouldScrollChatToLatest(false, false), false);
});

test('history and SSE races reconcile by stable message id', async () => {
    const { reconcileChatMessages } = await loadState();
    const messages = new Map();
    const original = { id: 'one', createdAt: '2026-08-31T00:00:00.000Z', text: 'first' };
    const update = { ...original, text: 'updated' };
    assert.equal(reconcileChatMessages(messages, [original]), 1);
    assert.equal(reconcileChatMessages(messages, [update]), 0);
    assert.equal(messages.size, 1);
    assert.equal(messages.get('one').text, 'updated');
});

test('private unread counts increment off-conversation and clear when opened', async () => {
    const { recordPrivateUnread, clearPrivateUnread, shouldRecordPrivateUnread } = await loadState();
    const counts = new Map();
    recordPrivateUnread(counts, 'sender-a', true);
    recordPrivateUnread(counts, 'sender-a', true);
    recordPrivateUnread(counts, 'sender-b', false);
    assert.equal(counts.get('sender-a'), 2);
    assert.equal(counts.has('sender-b'), false);
    clearPrivateUnread(counts, 'sender-a');
    assert.equal(counts.has('sender-a'), false);
    const candidate = { countUnread: true, isNew: true, mine: false, ignored: false, selected: false };
    assert.equal(shouldRecordPrivateUnread(candidate), true);
    assert.equal(shouldRecordPrivateUnread({ ...candidate, ignored: true }), false);
    assert.equal(shouldRecordPrivateUnread({ ...candidate, selected: true }), false);
    assert.equal(shouldRecordPrivateUnread({ ...candidate, mine: true }), false);
    assert.equal(shouldRecordPrivateUnread({ ...candidate, isNew: false }), false);
    assert.equal(shouldRecordPrivateUnread({ ...candidate, countUnread: false }), false);
});

test('chat request failures use concise human-readable status messages', async () => {
    const { chatRequestErrorMessage } = await loadState();
    assert.equal(chatRequestErrorMessage(401, 'raw auth detail', 'Fallback'), 'Sign in required');
    assert.equal(chatRequestErrorMessage(403, 'raw policy detail', 'Fallback'), 'Permission denied');
    assert.equal(chatRequestErrorMessage(429, 'raw limiter detail', 'Fallback'), 'Rate limit reached');
    assert.equal(chatRequestErrorMessage(500, 'Service unavailable', 'Fallback'), 'Service unavailable');
    assert.equal(chatRequestErrorMessage(500, undefined, 'Fallback'), 'Fallback');
});

test('latest-message detection preserves deterministic ordering for incremental appends', async () => {
    const { isLatestChatMessage } = await loadState();
    const messages = new Map([
        ['a', { id: 'a', createdAt: '2026-08-31T00:00:00.000Z' }],
        ['c', { id: 'c', createdAt: '2026-08-31T00:00:02.000Z' }]
    ]);
    const latest = { id: 'd', createdAt: '2026-08-31T00:00:03.000Z' };
    const lateArrival = { id: 'b', createdAt: '2026-08-31T00:00:01.000Z' };
    messages.set(latest.id, latest);
    assert.equal(isLatestChatMessage(messages.values(), latest), true);
    messages.set(lateArrival.id, lateArrival);
    assert.equal(isLatestChatMessage(messages.values(), lateArrival), false);
});

test('long-session chat collections discard oldest messages at their configured boundary', async () => {
    const { trimOldestChatMessages } = await loadState();
    const messages = new Map();
    for (let index = 0; index < 1001; index += 1) {
        const id = String(index).padStart(4, '0');
        messages.set(id, { id, createdAt: `2026-08-31T00:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z` });
    }
    const removed = trimOldestChatMessages(messages, 1000);
    assert.deepEqual(removed, ['0000']);
    assert.equal(messages.size, 1000);
    assert.equal(messages.has('0000'), false);
    assert.equal(messages.has('1000'), true);
});
