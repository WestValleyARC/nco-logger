const test = require('node:test');
const assert = require('node:assert/strict');

const FlagAccountsTask = require('../server/dist/lib/backgroundTasks/flagAccounts');
const { processInactiveAccount } = FlagAccountsTask;
const { clearInactivityDeletionOnLogin } = require('../server/dist/lib/accountInactivity');
const { flagAccountForDeletion } = require('../server/dist/lib/sharedNetOps');
const { userProfileSchema } = require('../server/dist/models/userProfile');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-01T12:00:00.000Z');

const account = overrides => ({
    _id: 'account-id',
    id: 'account-id',
    email: 'operator@example.com',
    lastLogin: new Date('2023-09-01T12:00:00.000Z'),
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    policyConsent: true,
    locked: false,
    flaggedForDeletion: false,
    inactivityWarningSentAt: null,
    deletionReason: null,
    async save() { this.saved = true; return this; },
    ...overrides
});

test('cleared inactivity deletion reason remains valid when the user is saved later', () => {
    const deletionReason = userProfileSchema.path('deletionReason');
    assert.equal(deletionReason.enumValues.includes(null), true);
    assert.equal(deletionReason.doValidateSync(null, {}), undefined);
});

test('account inactive for less than three years is untouched', async () => {
    const user = account({ lastLogin: new Date('2023-09-02T12:00:00.000Z') });
    const result = await processInactiveAccount({
        userProfileDoc: user,
        inactivityYears: 3,
        warningDays: 30,
        now: NOW,
        sendWarning: async () => assert.fail('must not warn before three years'),
        flagForDeletion: async () => assert.fail('must not flag before three years')
    });
    assert.equal(result, 'active');
    assert.equal(user.saved, undefined);
});

test('account reaching three years receives a warning but is not flagged', async () => {
    const user = account();
    let warnings = 0;
    const result = await processInactiveAccount({
        userProfileDoc: user,
        warningDays: 30,
        now: NOW,
        sendWarning: async () => { warnings++; return true; },
        flagForDeletion: async () => assert.fail('must not flag at warning time')
    });
    assert.equal(result, 'warning-sent');
    assert.equal(warnings, 1);
    assert.equal(user.inactivityWarningSentAt, NOW);
    assert.equal(user.flaggedForDeletion, false);
});

test('account remains intact during the 30-day warning period', async () => {
    const user = account({ inactivityWarningSentAt: new Date(NOW.getTime() - 29 * DAY_MS) });
    const result = await processInactiveAccount({
        userProfileDoc: user,
        warningDays: 30,
        now: NOW,
        sendWarning: async () => assert.fail('warning must not be resent'),
        flagForDeletion: async () => assert.fail('must not flag during warning period')
    });
    assert.equal(result, 'warning-period');
    assert.equal(user.flaggedForDeletion, false);
});

test('successful login clears an inactivity warning and inactivity deletion state', async () => {
    const user = account({
        inactivityWarningSentAt: new Date(NOW.getTime() - 10 * DAY_MS),
        flaggedForDeletion: true,
        deletionReason: 'inactivity'
    });
    let update;
    const UserProfile = { updateOne: async (_filter, value) => { update = value; } };
    assert.equal(await clearInactivityDeletionOnLogin({ userProfileDoc: user, UserProfile }), true);
    assert.equal(update.$set.flaggedForDeletion, false);
    assert.equal(user.inactivityWarningSentAt, null);
    assert.equal(user.flaggedForDeletion, false);
    assert.equal(user.deletionReason, null);
});

test('account still inactive after 30 days enters existing deletion cleanup', async () => {
    const user = account({ inactivityWarningSentAt: new Date(NOW.getTime() - 30 * DAY_MS) });
    let reason;
    const result = await processInactiveAccount({
        userProfileDoc: user,
        warningDays: 30,
        now: NOW,
        sendWarning: async () => assert.fail('warning must not be resent'),
        flagForDeletion: async options => { reason = options.deletionReason; }
    });
    assert.equal(result, 'eligible-for-deletion');
    assert.equal(reason, 'inactivity');
});

test('existing account older than three years is warned first instead of deleted', async () => {
    const user = account({ lastLogin: new Date('2020-01-01T00:00:00.000Z') });
    const result = await processInactiveAccount({
        userProfileDoc: user,
        warningDays: 30,
        now: NOW,
        sendWarning: async () => true,
        flagForDeletion: async () => assert.fail('legacy inactive account must receive warning first')
    });
    assert.equal(result, 'warning-sent');
    assert.equal(user.flaggedForDeletion, false);
});

test('manual deletion remains immediate and distinct from inactivity', async () => {
    const user = account({ inactivityWarningSentAt: new Date(NOW.getTime() - 5 * DAY_MS) });
    let queued = false;
    const models = {
        PendingAccountDelete: { create: async value => { queued = value.upid === user._id; return value; } }
    };
    const db = { model: name => models[name] || {} };
    await flagAccountForDeletion({ userProfileDoc: user, deletionReason: 'manual', db });
    assert.equal(user.flaggedForDeletion, true);
    assert.equal(user.deletionReason, 'manual');
    assert.equal(user.inactivityWarningSentAt, null);
    assert.equal(queued, true);
});

test('legacy unclassified deletion flags are not eligible under the new inactivity rule', async () => {
    const user = account({ flaggedForDeletion: true, deletionReason: null });
    let taskRemoved = false;
    let profileDeleted = false;
    const task = { upid: user._id, deleteOne: async () => { taskRemoved = true; } };
    user.deleteOne = async () => { profileDeleted = true; };
    const models = {
        PendingAccountDelete: { find: async () => [task] },
        UserProfile: { findById: async () => user }
    };
    const db = { model: name => models[name] || {} };
    const DeleteFlaggedAccountsTask = require('../server/dist/lib/backgroundTasks/deleteFlaggedAccounts');
    await new DeleteFlaggedAccountsTask({ label: 'deleteFlaggedAccounts', options: {}, db }).run();
    assert.equal(user.flaggedForDeletion, false);
    assert.equal(taskRemoved, true);
    assert.equal(profileDeleted, false);
});
