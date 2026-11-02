const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword, verifyPassword, userForLocalCredentials } = require('../server/dist/lib/passwordAuth');

test('local password hashing is stable and verified safely', async () => {
    const password = 'CorrectHorseBatteryStaple!';
    const hashed = await hashPassword(password);

    assert.match(hashed, /^pbkdf2\$/);
    assert.equal(await verifyPassword(password, hashed), true);
    assert.equal(await verifyPassword('wrong-password', hashed), false);
    assert.equal(await verifyPassword(password, 'not-a-valid-hash'), false);
});

test('local credential lookup rejects invalid or locked accounts before login', async () => {
    const findOne = async filter => {
        const email = filter?.email;
        if (email === 'operator@example.test') {
            return { _id: 'user-1', email, locked: false, passwordHash: await hashPassword('secret-pass') };
        }
        if (email === 'locked@example.test' && filter?.locked?.$ne === true) {
            return null;
        }
        return null;
    };

    const validUser = await userForLocalCredentials({ email: 'operator@example.test', password: 'secret-pass' }, { findOne });
    const invalidUser = await userForLocalCredentials({ email: 'operator@example.test', password: 'wrong-pass' }, { findOne });
    const lockedUser = await userForLocalCredentials({ email: 'locked@example.test', password: 'locked-pass' }, { findOne });

    assert.equal(validUser?._id, 'user-1');
    assert.equal(invalidUser, null);
    assert.equal(lockedUser, null);
});
