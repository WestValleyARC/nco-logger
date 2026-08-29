const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanMessage, toPublicMessage, detectImageType } = require('../server/dist/lib/localChat');

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
    assert.equal(result.attachment, null);
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
    const result = toPublicMessage(message, false, userId);
    assert.deepEqual(result.attachment, {
        kind: 'image', mimeType: 'image/png', size: 12,
        url: `/api/chat/${netProfile}/messages/507f1f77bcf86cd799439012/image`
    });
    assert.equal(JSON.stringify(result).includes('private-name'), false);
});
