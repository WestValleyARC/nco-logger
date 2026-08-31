const test = require('node:test');
const assert = require('node:assert/strict');
const {
    cleanMessage, toPublicMessage, detectImageType, createMessage, editMessage, deleteMessage, uploadImage,
    toggleReaction, setMessagePin, banMessageAuthor, clearPublicChat, authorizeChatAction,
    summarizeReactions, toggleReactionValue
} = require('../server/dist/lib/localChat');
const { chatMessageSchema } = require('../server/dist/models/chatMessage');

test('chat content is reduced to safe plain text', () => {
    assert.equal(cleanMessage(' <script>alert(1)</script><b>Hello</b> '), 'Hello');
});

test('deleted chat never exposes its original content', () => {
    const userId = '507f1f77bcf86cd799439011';
    const message = {
        _id: { toString: () => '507f1f77bcf86cd799439012' },
        userProfile: { toString: () => userId },
        callSign: 'W1ABC', displayName: 'Alex', text: 'secret', createdAt: new Date(),
        editedAt: null, deletedAt: new Date()
    };
    const result = toPublicMessage(message, 'netuser', userId);
    assert.equal(result.text, '');
    assert.equal(result.deleted, true);
    assert.equal(result.canDelete, false);
    assert.equal(result.canEdit, false);
    assert.equal(result.attachment, null);
});

test('owned messages expose edit permission and edited state', () => {
    const userId = '507f1f77bcf86cd799439011';
    const createdAt = new Date('2026-08-30T12:00:00.000Z');
    const editedAt = new Date('2026-08-30T12:05:00.000Z');
    const result = toPublicMessage({
        _id: { toString: () => '507f1f77bcf86cd799439012' },
        userProfile: { toString: () => userId },
        callSign: 'W1ABC', displayName: 'Alex', text: 'updated', createdAt, editedAt, deletedAt: null
    }, 'netuser', userId);
    assert.equal(result.canEdit, true);
    assert.equal(result.editedAt, editedAt.toISOString());
    assert.equal(result.createdAt, createdAt.toISOString());
});

test('chat mutation handlers require authentication', async () => {
    const invoke = async (handler, req) => {
        let status = 200;
        let payload;
        const res = { status(code) { status = code; return this; }, json(body) { payload = body; return this; } };
        await handler(req, res);
        return { status, payload };
    };
    for (const handler of [createMessage, editMessage, deleteMessage, uploadImage, toggleReaction,
        setMessagePin, banMessageAuthor, clearPublicChat]) {
        const result = await invoke(handler, { params: { id: '507f1f77bcf86cd799439013', messageId: '507f1f77bcf86cd799439012' } });
        assert.equal(result.status, 401);
        assert.equal(result.payload.error, 'Authentication required');
    }
});

test('image signatures are detected without trusting filenames', () => {
    assert.deepEqual(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), {
        mimeType: 'image/png', extension: 'png'
    });
    assert.deepEqual(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), {
        mimeType: 'image/jpeg', extension: 'jpg'
    });
    assert.equal(detectImageType(Buffer.from('<svg><script>alert(1)</script></svg>')), null);
});

test('public image metadata exposes an authenticated URL but not its storage name', () => {
    const userId = '507f1f77bcf86cd799439011';
    const netProfile = '507f1f77bcf86cd799439013';
    const message = {
        _id: { toString: () => '507f1f77bcf86cd799439012' },
        netProfile: { toString: () => netProfile },
        userProfile: { toString: () => userId },
        callSign: 'W1ABC', displayName: 'Alex', text: '', createdAt: new Date(),
        editedAt: null, deletedAt: null,
        attachment: { kind: 'image', storageName: 'private-name.png', mimeType: 'image/png', size: 12 }
    };
    const result = toPublicMessage(message, 'netuser', userId);
    assert.deepEqual(result.attachment, {
        kind: 'image', mimeType: 'image/png', size: 12,
        url: `/api/chat/${netProfile}/messages/507f1f77bcf86cd799439012/image`
    });
    assert.equal(JSON.stringify(result).includes('private-name'), false);
});

test('chat action authorization follows the Phase 2 role matrix', () => {
    const expected = {
        netcontrol: { other: ['react', 'reply', 'pin', 'ban'], mine: ['react', 'reply', 'edit', 'delete', 'pin'] },
        netlogger: { other: ['react', 'reply', 'pin'], mine: ['react', 'reply', 'edit', 'delete', 'pin'] },
        netrelay: { other: ['react', 'reply'], mine: ['react', 'reply', 'edit', 'delete'] },
        netuser: { other: ['react', 'reply'], mine: ['react', 'reply', 'edit', 'delete'] }
    };
    const actions = ['react', 'reply', 'edit', 'delete', 'pin', 'ban'];
    for (const [role, permissions] of Object.entries(expected)) {
        for (const action of actions) {
            assert.equal(authorizeChatAction({ role, action, mine: false }), permissions.other.includes(action), `${role} other ${action}`);
            assert.equal(authorizeChatAction({ role, action, mine: true }), permissions.mine.includes(action), `${role} own ${action}`);
        }
    }
    assert.equal(authorizeChatAction({ role: 'netcontrol', action: 'clear' }), true);
    for (const role of ['netlogger', 'netrelay', 'netuser']) {
        assert.equal(authorizeChatAction({ role, action: 'clear' }), false, `${role} clear`);
    }
    assert.equal(authorizeChatAction({ role: 'netcontrol', action: 'react', cleared: true }), false);
});

test('quick reactions toggle once per user and summarize counts for the viewer', () => {
    const one = '507f1f77bcf86cd799439011';
    const two = '507f1f77bcf86cd799439012';
    let reactions = toggleReactionValue([], '👍', one);
    reactions = toggleReactionValue(reactions, '👍', two);
    assert.deepEqual(summarizeReactions(reactions, one), [{ emoji: '👍', count: 2, reactedByMe: true }]);
    reactions = toggleReactionValue(reactions, '👍', one);
    assert.deepEqual(summarizeReactions(reactions, one), [{ emoji: '👍', count: 1, reactedByMe: false }]);
    const deduplicated = toggleReactionValue([
        { emoji: '❤️', userProfile: one }, { emoji: '❤️', userProfile: one }
    ], '😂', two);
    assert.deepEqual(summarizeReactions(deduplicated, two), [
        { emoji: '❤️', count: 1, reactedByMe: false },
        { emoji: '😂', count: 1, reactedByMe: true }
    ]);
});

test('public messages expose reply, reaction, pin, and per-role action state', () => {
    const owner = '507f1f77bcf86cd799439011';
    const viewer = '507f1f77bcf86cd799439012';
    const replyTo = '507f1f77bcf86cd799439013';
    const result = toPublicMessage({
        _id: { toString: () => '507f1f77bcf86cd799439014' },
        netProfile: { toString: () => '507f1f77bcf86cd799439015' },
        userProfile: { toString: () => owner }, callSign: 'W1ABC', displayName: 'Alex', text: 'hello',
        replyTo: { toString: () => replyTo }, reactions: [{ emoji: '❤️', userProfile: { toString: () => viewer } }],
        pinnedAt: new Date(), createdAt: new Date(), editedAt: null, deletedAt: null, clearedAt: null
    }, 'netcontrol', viewer);
    assert.equal(result.replyTo, replyTo);
    assert.equal(result.pinned, true);
    assert.deepEqual(result.reactions, [{ emoji: '❤️', count: 1, reactedByMe: true }]);
    assert.equal(result.canPin, true);
    assert.equal(result.canBan, true);
    assert.equal(result.canEdit, false);
    assert.equal(result.canDelete, false);
});

test('chat message schema persists Phase 2 interaction state', () => {
    assert.ok(chatMessageSchema.path('replyTo'));
    assert.ok(chatMessageSchema.path('reactions'));
    assert.ok(chatMessageSchema.path('pinnedAt'));
    assert.ok(chatMessageSchema.path('pinnedBy'));
    assert.ok(chatMessageSchema.path('clearedAt'));
});
