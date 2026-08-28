const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanMessage, toPublicMessage } = require('../server/dist/lib/localChat');

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
    const result = toPublicMessage(message, false, userId);
    assert.equal(result.text, '');
    assert.equal(result.deleted, true);
    assert.equal(result.canDelete, false);
});
