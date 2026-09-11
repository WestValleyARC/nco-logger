const test = require('node:test');
const assert = require('node:assert/strict');
const privateTestNet = require('../server/dist/lib/privateTestNet');

test('private test net access is owner/invite only', () => {
    const profile = { testFixture: 'josh-private', owners: ['owner'], invitedTesters: ['tester'] };
    assert.equal(privateTestNet.canAccess(profile, { _id: 'owner' }), true);
    assert.equal(privateTestNet.canAccess(profile, { _id: 'tester' }), true);
    assert.equal(privateTestNet.canAccess(profile, { _id: 'stranger' }), false);
    assert.equal(privateTestNet.canAccess(profile, null), false);
});

test('ordinary nets retain ordinary access semantics', () => {
    assert.equal(privateTestNet.canAccess({ testFixture: undefined }, null), true);
});
