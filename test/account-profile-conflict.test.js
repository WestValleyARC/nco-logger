const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');
const UserProfile = require('../server/dist/models/userProfile').getUserProfile();
const InitialReg = require('../server/dist/models/initialRegTracker').getInitialReg();
const { userProfileUpdate } = require('../server/dist/controllers/userProfileController');

test('profile save distinguishes account conflicts, invalid fields and server failures', async t => {
    const original = { findById: UserProfile.findById, exists: UserProfile.exists,
        update: UserProfile.findOneAndUpdate, registration: InitialReg.findOne };
    t.after(() => {
        UserProfile.findById = original.findById;
        UserProfile.exists = original.exists;
        UserProfile.findOneAndUpdate = original.update;
        InitialReg.findOne = original.registration;
    });
    const doc = { _id: 'current-account', callSign: 'AB1CDE', toObject: () => ({ callSign: 'AB1CDE' }) };
    UserProfile.findById = async () => doc;
    InitialReg.findOne = async () => assert.fail('conflicts must not touch registration records');
    let conflict = false;
    let saveError;
    let writes = 0;
    UserProfile.exists = async filter => {
        assert.deepEqual(filter, { callSign: 'AB1CDE', _id: { $ne: 'current-account' } });
        return conflict;
    };
    UserProfile.findOneAndUpdate = async () => {
        writes++;
        if (saveError) throw saveError;
        return doc;
    };
    const invoke = async () => {
        const res = { locals: { flexOpts: { baseTtlMs: 15000 } },
            status(value) { this.statusCode = value; return this; },
            json(value) { this.body = value; return this; } };
        await userProfileUpdate({ user: { id: 'current-account' }, body: { callSign: 'ab1cde' } }, res);
        return res;
    };
    conflict = true;
    const existing = await invoke();
    assert.equal(existing.statusCode, 409);
    assert.match(existing.body.errorMessage, /Sign out and sign in with the email you originally registered with/);
    assert.equal(writes, 0);

    conflict = false;
    assert.equal((await invoke()).statusCode, 200, 'the owner can keep their existing callsign');
    for (const error of [
        { code: 11000, keyPattern: { callSign: 1 }, message: 'private database details' },
        { name: 'ValidationError', errors: { callSign: { kind: 'unique', message: 'private email' } } }
    ]) {
        saveError = error;
        const race = await invoke();
        assert.equal(race.statusCode, 409);
        assert.equal(race.body.errorMessage, existing.body.errorMessage);
    }
    saveError = { name: 'ValidationError', errors: { displayName: { message: 'private input' } } };
    const invalid = await invoke();
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.body.errorMessage, /Name must be/);
    saveError = new Error('database password must never be disclosed');
    const failure = await invoke();
    assert.equal(failure.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(failure.body), /password|database/);
});

test('account page displays escaped account identity and recovery actions', () => {
    const html = ejs.render(fs.readFileSync(path.join(__dirname, '../server/dist/views/myAccount.ejs'), 'utf8'), {
        server: { appName: 'Test', logLevel: 'info' }, user: {}, VIEW: 'myAccount',
        accountEmail: '<operator>@example.test', accountSignInMethod: 'Google'
    }, { includer: () => ({ template: ' ' }) });
    assert.match(html, /&lt;operator&gt;@example.test/);
    assert.match(html, /Sign-in method: Google/);
    assert.match(html, /action="\/auth\/logout" method="post"/);
    assert.match(html, /href="\/views\/contact"/);
    assert.match(html, /id="profile-save-error"[^>]*role="alert"/);
});
