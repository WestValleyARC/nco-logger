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
    const { recordPrivateUnread, clearPrivateUnread } = await loadState();
    const counts = new Map();
    recordPrivateUnread(counts, 'sender-a', true);
    recordPrivateUnread(counts, 'sender-a', true);
    recordPrivateUnread(counts, 'sender-b', false);
    assert.equal(counts.get('sender-a'), 2);
    assert.equal(counts.has('sender-b'), false);
    clearPrivateUnread(counts, 'sender-a');
    assert.equal(counts.has('sender-a'), false);
});
