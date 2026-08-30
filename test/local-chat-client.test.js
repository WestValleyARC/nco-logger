const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const loadState = () => import(pathToFileURL(path.resolve(__dirname, '../client/dist/public/js/lib/chatState.js')).href);

test('POST and SSE delivery of the same message ID reconcile without duplicates', async () => {
    const { reconcileChatMessages } = await loadState();
    const messages = new Map();
    const sent = { id: 'b', createdAt: '2026-08-30T12:00:00.000Z', text: 'hello' };
    assert.equal(reconcileChatMessages(messages, [sent]), 1);
    assert.equal(reconcileChatMessages(messages, [{ ...sent }]), 0);
    assert.equal(messages.size, 1);
});

test('reconnect history updates known messages and keeps deterministic ordering', async () => {
    const { reconcileChatMessages, sortChatMessages } = await loadState();
    const messages = new Map([
        ['b', { id: 'b', createdAt: '2026-08-30T12:00:00.000Z', text: 'old' }]
    ]);
    const added = reconcileChatMessages(messages, [
        { id: 'c', createdAt: '2026-08-30T12:00:00.000Z', text: 'third' },
        { id: 'a', createdAt: '2026-08-30T12:00:00.000Z', text: 'first' },
        { id: 'b', createdAt: '2026-08-30T12:00:00.000Z', text: 'edited' }
    ]);
    assert.equal(added, 2);
    assert.equal(messages.size, 3);
    assert.equal(messages.get('b').text, 'edited');
    assert.deepEqual(sortChatMessages(messages.values()).map(message => message.id), ['a', 'b', 'c']);
});
