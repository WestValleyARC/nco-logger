const test = require('node:test');
const assert = require('node:assert/strict');
const {
    cleanMessage, toPublicMessage, detectImageType, createMessage, editMessage, deleteMessage, uploadImage,
    toggleReaction, setMessagePin, banMessageAuthor, clearPublicChat, authorizeChatAction,
    summarizeReactions, toggleReactionValue, toChatMessage, canViewMessage, shouldDeliverMessage,
    directConversationQuery, listDirectMessages, setPrivateIgnore, serveImage, chatEventForViewer,
    messageScope, attachmentPath, PUBLIC_SCOPE_QUERY, DIRECT_SCOPE_QUERY, banUserHelper, chatDisplayName,
    rateLimitAllows, RATE_LIMIT_COUNT, RATE_LIMIT_WINDOW_MS
} = require('../server/dist/lib/localChat');
const { requireSameOriginMutation, chatRouteErrorHandler } = require('../server/dist/routes/chatRoutes');
const { chatMessageSchema } = require('../server/dist/models/chatMessage');
const { userProfileSchema } = require('../server/dist/models/userProfile');

test('chat display names follow manual, QRZ, account, then callsign precedence', () => {
    assert.equal(chatDisplayName({
        manualName: 'Paula Operator', qrzFirstName: 'Patricia', accountFirstName: 'Alice', callSign: 'ns2e'
    }), 'Paula');
    assert.equal(chatDisplayName({
        manualName: '', qrzFirstName: 'Paula', qrzName: 'Full-Duplex', accountFirstName: 'Alice', callSign: 'ns2e'
    }), 'Paula');
    assert.equal(chatDisplayName({
        manualName: '', qrzFirstName: '', qrzName: 'Full-Duplex', accountFirstName: 'Alice', callSign: 'ns2e'
    }), 'Alice');
    assert.equal(chatDisplayName({
        manualName: '', qrzFirstName: '', qrzName: 'Full-Duplex', accountFirstName: '', callSign: 'ns2e'
    }), 'NS2E');
});

test('text and image chat creation share the genuine-first-name resolver', () => {
    const source = require('node:fs').readFileSync(require.resolve('../server/dist/lib/localChat'), 'utf8');
    assert.equal((source.match(/resolveChatDisplayName\(\{ callSign \}\)/g) || []).length, 2);
    assert.doesNotMatch(source, /qrz\?\.displayName|accountName: req\.user\.displayName/);
});

test('chat content preserves literal symbols, Unicode, and inert HTML-looking text', () => {
    const lines = [
        '<--', '-->', '<3', '< > &', '© ® ™ °', '± × ÷ ≤ ≥', '→ ← ↑ ↓', 'µ Ω',
        'José García — Zażółć gęślą jaźń — 東京 📻', '<b>literal</b>', '<script>alert("inert")</script>'
    ];
    assert.equal(cleanMessage(`  ${lines.join('\r\n')}  `), lines.join('\n'));
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
        setMessagePin, banMessageAuthor, clearPublicChat, listDirectMessages, setPrivateIgnore, serveImage]) {
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
    assert.throws(() => attachmentPath('../../private.png'), /Invalid attachment storage name/);
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
    assert.deepEqual(summarizeReactions([
        { emoji: '👍', userProfile: one }, { emoji: '👍', userProfile: one }
    ], one), [{ emoji: '👍', count: 1, reactedByMe: true }]);
});

test('the shared chat rate window bounds bursts and releases stale users', () => {
    const userId = 'rate-limit-test-user';
    const startedAt = Date.now() + RATE_LIMIT_WINDOW_MS;
    for (let index = 0; index < RATE_LIMIT_COUNT; index += 1) {
        assert.equal(rateLimitAllows(userId, startedAt), true);
    }
    assert.equal(rateLimitAllows(userId, startedAt), false);
    assert.equal(rateLimitAllows(userId, startedAt + RATE_LIMIT_WINDOW_MS), true);
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
    assert.equal(result.canMessagePrivately, true);

    const ownerView = toPublicMessage({
        _id: { toString: () => '507f1f77bcf86cd799439014' },
        netProfile: { toString: () => '507f1f77bcf86cd799439015' },
        userProfile: { toString: () => owner }, callSign: 'W1ABC', displayName: 'Alex', text: 'hello',
        createdAt: new Date(), editedAt: null, deletedAt: null, clearedAt: null, reactions: []
    }, 'netuser', owner);
    assert.equal(ownerView.mine, true);
    assert.equal(ownerView.canMessagePrivately, false);
});

test('chat message schema persists Phase 2 interaction state', () => {
    assert.ok(chatMessageSchema.path('replyTo'));
    assert.ok(chatMessageSchema.path('reactions'));
    assert.ok(chatMessageSchema.path('pinnedAt'));
    assert.ok(chatMessageSchema.path('pinnedBy'));
    assert.ok(chatMessageSchema.path('clearedAt'));
});

test('direct messages serialize only for their sender and recipient regardless of role', () => {
    const sender = '507f1f77bcf86cd799439011';
    const recipient = '507f1f77bcf86cd799439012';
    const unrelatedNco = '507f1f77bcf86cd799439013';
    const message = {
        _id: { toString: () => '507f1f77bcf86cd799439014' },
        netProfile: { toString: () => '507f1f77bcf86cd799439015' },
        userProfile: { toString: () => sender },
        recipientUserProfile: { toString: () => recipient },
        scope: 'direct', callSign: 'W1AAA', displayName: 'Alice', text: 'private',
        createdAt: new Date(), editedAt: null, deletedAt: null, clearedAt: null, reactions: []
    };
    assert.equal(canViewMessage(message, sender), true);
    assert.equal(canViewMessage(message, recipient), true);
    assert.equal(canViewMessage(message, unrelatedNco), false);
    assert.throws(() => toChatMessage(message, 'netcontrol', unrelatedNco), /non-participant/);
    assert.throws(() => toChatMessage(message, 'netlogger', unrelatedNco), /non-participant/);
    const recipientView = toChatMessage(message, 'netuser', recipient);
    assert.equal(recipientView.scope, 'direct');
    assert.equal(recipientView.conversationUserId, sender);
    assert.equal(recipientView.canPin, false);
    assert.equal(recipientView.canBan, false);
    assert.equal(recipientView.canReply, true);
    assert.equal(chatEventForViewer(message, 'netcontrol', unrelatedNco), null);
    assert.equal(chatEventForViewer(message, 'netlogger', unrelatedNco), null);
    assert.equal(chatEventForViewer(message, 'netuser', recipient)?.text, 'private');
});

test('recipient-bearing legacy records fail closed as private messages', () => {
    const sender = '507f1f77bcf86cd799439011';
    const recipient = '507f1f77bcf86cd799439012';
    const legacyDirect = { userProfile: sender, recipientUserProfile: recipient };
    assert.equal(messageScope(legacyDirect), 'direct');
    assert.equal(canViewMessage(legacyDirect, recipient), true);
    assert.equal(canViewMessage(legacyDirect, '507f1f77bcf86cd799439013'), false);
    assert.deepEqual(PUBLIC_SCOPE_QUERY.$or, [
        { scope: 'public', recipientUserProfile: null },
        { scope: { $exists: false }, recipientUserProfile: null }
    ]);
    assert.equal(DIRECT_SCOPE_QUERY.$or.length, 2);
});

test('ignored private senders are suppressed without affecting public delivery or sender delivery', () => {
    const sender = '507f1f77bcf86cd799439011';
    const recipient = '507f1f77bcf86cd799439012';
    const direct = { scope: 'direct', userProfile: sender, recipientUserProfile: recipient };
    assert.equal(shouldDeliverMessage(direct, recipient, new Set()), true);
    assert.equal(shouldDeliverMessage(direct, recipient, new Set([sender])), false);
    assert.equal(shouldDeliverMessage(direct, sender, new Set([recipient])), true);
    assert.equal(shouldDeliverMessage(direct, '507f1f77bcf86cd799439013', new Set()), false);
    assert.equal(shouldDeliverMessage({ scope: 'public', userProfile: sender }, recipient, new Set([sender])), true);
});

test('direct conversation queries are restricted to the exact two participants', () => {
    const query = directConversationQuery('507f1f77bcf86cd799439010', '507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012');
    assert.equal(query.$and[0], DIRECT_SCOPE_QUERY);
    assert.deepEqual(query.$and[1].$or, [
        { userProfile: '507f1f77bcf86cd799439011', recipientUserProfile: '507f1f77bcf86cd799439012' },
        { userProfile: '507f1f77bcf86cd799439012', recipientUserProfile: '507f1f77bcf86cd799439011' }
    ]);
});

test('chat mutations reject explicit cross-site requests', () => {
    const invoke = headers => {
        let status = 200;
        let payload;
        let nextCalled = false;
        const req = {
            method: 'POST', protocol: 'https',
            get(name) { return headers[name.toLowerCase()]; }
        };
        const res = {
            status(code) { status = code; return this; },
            json(body) { payload = body; return this; }
        };
        requireSameOriginMutation(req, res, () => { nextCalled = true; });
        return { status, payload, nextCalled };
    };
    assert.equal(invoke({ host: 'logger.example', origin: 'https://logger.example' }).nextCalled, true);
    assert.equal(invoke({ host: 'logger.example', origin: 'https://evil.example' }).status, 403);
    assert.equal(invoke({ host: 'logger.example', 'sec-fetch-site': 'cross-site' }).status, 403);
});

test('central ban helper rejects self-ban attempts', async () => {
    const userId = '507f1f77bcf86cd799439011';
    await assert.rejects(banUserHelper({
        npid: '507f1f77bcf86cd799439010', userIdToBan: userId,
        bannedByUserId: userId, targetCallsign: 'W1ABC'
    }), /cannot ban yourself/);
});

test('malformed chat JSON receives a bounded JSON error', () => {
    let status = 200;
    let payload;
    const err = Object.assign(new SyntaxError('Unexpected token'), { status: 400, body: '{' });
    chatRouteErrorHandler(err, {}, {
        status(code) { status = code; return this; },
        json(body) { payload = body; return this; }
    }, () => assert.fail('malformed JSON should not reach the next handler'));
    assert.equal(status, 400);
    assert.equal(payload.error, 'Malformed JSON request');
});

test('Phase 3 schema stores direct scope, recipient identity, and personal ignore preferences', () => {
    assert.ok(chatMessageSchema.path('scope'));
    assert.ok(chatMessageSchema.path('recipientUserProfile'));
    assert.ok(userProfileSchema.path('ignoredPrivateUsers'));
});
