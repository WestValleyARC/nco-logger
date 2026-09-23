const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { googleDisplayName, userForGoogleProfile } = require('../server/dist/routes/authRoutes');

const profile = overrides => ({
    id: 'google-123',
    displayName: 'Kelly',
    emails: [{ value: 'Operator@Example.com' }],
    photos: [{ value: 'https://example.test/photo.jpg' }],
    ...overrides
});

test('Google display names are used only when they already satisfy profile rules', () => {
    assert.equal(googleDisplayName(profile()), 'Kelly');
    assert.equal(googleDisplayName(profile({ displayName: 'Kelly (K7PWT)' })), '');
    assert.equal(googleDisplayName(profile({ displayName: 'A name that is much too long' })), '');
});

test('Google sign-in links an existing magic-link account by canonical email', async () => {
    const updates = [];
    const existing = { _id: 'existing-id', locked: false };
    const UserProfileModel = {
        findOneAndUpdate: async (filter, update, options) => {
            updates.push({ filter, update, options });
            return existing;
        }
    };

    const user = await userForGoogleProfile(profile(), UserProfileModel);

    assert.equal(user, existing);
    assert.deepEqual(updates[0].filter, { email: 'operator@example.com' });
    assert.equal(updates[0].update.lastAuthVia, 'google');
    assert.equal(updates[0].update.googleId, 'google-123');
});

test('Google sign-in creates an incomplete account when the provider display name is invalid', async () => {
    let savedOptions;
    let created;
    class UserProfileModel {
        static async findOneAndUpdate() { return null; }
        constructor(value) { created = value; }
        async save(options) {
            savedOptions = options;
            return { _id: 'new-id', ...created };
        }
    }

    const user = await userForGoogleProfile(profile({ displayName: 'Kelly (K7PWT)' }), UserProfileModel);

    assert.equal(user.displayName, '');
    assert.equal(user.email, 'operator@example.com');
    assert.deepEqual(savedOptions, { validateBeforeSave: false });
});

test('Google sign-in rejects profiles without a usable email address', async () => {
    const UserProfileModel = { findOneAndUpdate: async () => assert.fail('database should not be queried') };
    assert.equal(await userForGoogleProfile(profile({ emails: [] }), UserProfileModel), null);
    assert.equal(await userForGoogleProfile(profile({ emails: [{ value: 'not-an-email' }] }), UserProfileModel), null);
});

test('Google callback failures produce an actionable login-page message', () => {
    const loginSource = fs.readFileSync(
        path.join(__dirname, '../client/dist/public/js/byView/login/main.js'),
        'utf8'
    );
    assert.match(loginSource, /get\('error'\) === 'google-auth'/);
    assert.match(loginSource, /Try the email sign-in method below or contact support/);
});
