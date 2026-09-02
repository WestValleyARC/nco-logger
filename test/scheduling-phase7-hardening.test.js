const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const {
    NCO_ABANDONMENT_MS,
    CLAIM_STALE_MS,
    recoverAutoCloseClaims,
    reconcileLiveNetPersistence,
    processAbandonedLiveNets
} = require('../server/dist/lib/scheduling/hardening');
const { processOccurrenceLifecycle } = require('../server/dist/lib/scheduling/lifecycle');
const { closeNet } = require('../server/dist/lib/sharedNetOps');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const NOW = new Date('2030-01-10T20:00:00.000Z');

test('Phase 7 LiveNet recovery and inactivity hardening', async t => {
    const externalUri = process.env.TEST_MONGODB_URI;
    let mongod;
    if (externalUri) assert.match(externalUri, /scheduling_phase7_test/, 'TEST_MONGODB_URI must target the Phase 7 test database');
    if (!externalUri) {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        mongod = await MongoMemoryServer.create();
    }
    const db = await mongoose.createConnection(externalUri || mongod.getUri()).asPromise();
    const NetProfile = require('../server/dist/models/netProfile').getNetProfile(db);
    const NetSchedule = require('../server/dist/models/netSchedule').getNetSchedule(db);
    const ScheduledOccurrence = require('../server/dist/models/scheduledOccurrence').getScheduledOccurrence(db);
    const LiveNet = require('../server/dist/models/liveNet').getLiveNet(db);
    const StationInteraction = require('../server/dist/models/stationInteraction').getStationInteraction(db);
    const LiveNetAutoClose = require('../server/dist/models/liveNetAutoClose').getLiveNetAutoClose(db);
    await Promise.all([
        NetProfile.init(), NetSchedule.init(), ScheduledOccurrence.init(), LiveNet.init(),
        StationInteraction.init(), LiveNetAutoClose.init()
    ]);

    const ownerId = new mongoose.Types.ObjectId();
    const coOwnerId = new mongoose.Types.ObjectId();
    const followerId = new mongoose.Types.ObjectId();
    let sequence = 0;
    const reset = () => Promise.all([
        NetProfile.deleteMany({}), NetSchedule.deleteMany({}), ScheduledOccurrence.deleteMany({}),
        LiveNet.deleteMany({}), StationInteraction.deleteMany({}), LiveNetAutoClose.deleteMany({})
    ]);
    const createProfile = overrides => NetProfile.create({
        title: `Hardening Net ${++sequence}`,
        frequency: '146.520', mode: 'FM', owners: [ownerId, coOwnerId], followers: [followerId],
        permanent: false, ...overrides
    });
    const createSchedule = profile => NetSchedule.create({
        netProfile: profile._id, type: 'oneTime', timezone: 'UTC', localStartTime: '20:00', startDate: '2030-01-10'
    });
    const createOccurrence = async (profile, status, startAt = NOW) => {
        const schedule = await createSchedule(profile);
        return ScheduledOccurrence.create({
            schedule: schedule._id, netProfile: profile._id, occurrenceKey: `hardening-${++sequence}`,
            originalStartAt: startAt, startAt, status
        });
    };
    const createLive = async (profile, { started = true, occurrence = null, link = true, closing = false } = {}) => {
        const liveNet = await LiveNet.create({
            netProfile: profile._id, occurrence: occurrence?._id, netControl: ownerId,
            started, startedAt: started ? new Date(NOW.getTime() - 3 * 60 * 60 * 1000) : null,
            closing, url: `/views/livenet/${profile._id}`, lookupTable: {}
        });
        if (link) {
            profile.liveNet = liveNet._id;
            await profile.save({ validateBeforeSave: false });
        }
        if (occurrence) {
            occurrence.liveNet = liveNet._id;
            await occurrence.save();
        }
        return liveNet;
    };
    const addInteraction = ({ profile, liveNet, role = 'netcontrol', checkedState = true, lastSeen }) =>
        StationInteraction.create({
            callSign: `W1${++sequence}`, createdBy: 'user', role, checkedState, lastSeen,
            checkedInAt: lastSeen, netProfile: profile._id, liveNet: liveNet._id
        });
    const captureEmails = () => {
        const sent = [];
        return {
            sent,
            send: async ({ event }) => sent.push({
                title: event.netTitle,
                owners: event.ownerIds.map(String)
            })
        };
    };

    try {
        await t.test('recent NCO activity and sub-threshold absence keep nets open; participant activity is ignored', async () => {
            await reset();
            const recentProfile = await createProfile();
            const recentLive = await createLive(recentProfile);
            await addInteraction({ profile: recentProfile, liveNet: recentLive, lastSeen: new Date(NOW - NCO_ABANDONMENT_MS + 1) });
            const multipleProfile = await createProfile();
            const multipleLive = await createLive(multipleProfile);
            await addInteraction({ profile: multipleProfile, liveNet: multipleLive, lastSeen: new Date(NOW - 3 * 60 * 60000) });
            await addInteraction({ profile: multipleProfile, liveNet: multipleLive, lastSeen: new Date(NOW - 15 * 60000) });
            const result = await processAbandonedLiveNets({ now: NOW, db, sendInactivityEmail: async () => {} });
            assert.equal(result.autoClosed, 0);
            assert.equal(await LiveNet.countDocuments({}), 2);

            const abandonedProfile = await createProfile();
            const abandonedLive = await createLive(abandonedProfile);
            await addInteraction({ profile: abandonedProfile, liveNet: abandonedLive, lastSeen: new Date(NOW - NCO_ABANDONMENT_MS) });
            await addInteraction({ profile: abandonedProfile, liveNet: abandonedLive, role: 'netuser', lastSeen: NOW });
            const email = captureEmails();
            const closed = await processAbandonedLiveNets({ now: NOW, db, sendInactivityEmail: email.send });
            assert.equal(closed.autoClosed, 1);
            assert.equal(await LiveNet.exists({ _id: abandonedLive._id }), null);
            assert.equal(email.sent.length, 1);
        });

        await t.test('manual and scheduled nets auto-close; scheduled completion uses actual close time and only owners are emailed', async () => {
            await reset();
            const manualProfile = await createProfile();
            const manualLive = await createLive(manualProfile);
            await addInteraction({ profile: manualProfile, liveNet: manualLive, lastSeen: new Date(NOW - NCO_ABANDONMENT_MS - 1) });
            const scheduledProfile = await createProfile();
            const occurrence = await createOccurrence(scheduledProfile, 'live');
            const scheduledLive = await createLive(scheduledProfile, { occurrence });
            await addInteraction({ profile: scheduledProfile, liveNet: scheduledLive, lastSeen: new Date(NOW - NCO_ABANDONMENT_MS - 1) });
            const email = captureEmails();
            const result = await processAbandonedLiveNets({ now: NOW, db, sendInactivityEmail: email.send });
            assert.equal(result.autoClosed, 2);
            assert.equal(email.sent.length, 2);
            for (const message of email.sent) {
                assert.deepEqual(message.owners.sort(), [String(ownerId), String(coOwnerId)].sort());
                assert.ok(!message.owners.includes(String(followerId)));
            }
            const completed = await ScheduledOccurrence.findById(occurrence._id);
            assert.equal(completed.status, 'completed');
            assert.equal(completed.completedAt.toISOString(), NOW.toISOString());
        });

        await t.test('permanent nets are inactivity-exempt but not integrity-exempt, and missing history gets a persistent grace baseline', async () => {
            await reset();
            const permanent = await createProfile({ permanent: true });
            const permanentLive = await createLive(permanent);
            await addInteraction({ profile: permanent, liveNet: permanentLive, lastSeen: new Date(NOW - 4 * 60 * 60000) });
            const legacy = await createProfile();
            const legacyLive = await createLive(legacy);
            legacyLive.startedAt = null;
            await legacyLive.save();
            const result = await processAbandonedLiveNets({ now: NOW, db, sendInactivityEmail: async () => {} });
            assert.equal(result.autoClosed, 0);
            assert.ok(await LiveNet.exists({ _id: permanentLive._id }));
            assert.ok(await LiveNet.exists({ _id: legacyLive._id }));
            const observation = await LiveNetAutoClose.findOne({ liveNet: legacyLive._id });
            assert.equal(observation.firstObservedAt.toISOString(), NOW.toISOString());

            permanent.liveNet = new mongoose.Types.ObjectId();
            await permanent.save({ validateBeforeSave: false });
            const integrity = await reconcileLiveNetPersistence({ now: NOW, db });
            assert.ok(integrity.staleProfileRefs >= 1);
            assert.equal((await NetProfile.findById(permanent._id)).liveNet, undefined);
        });

        await t.test('profile references, orphan LiveNets, occurrence mismatches, and valid active/preparing relationships reconcile safely', async () => {
            await reset();
            const missing = await createProfile({ liveNet: new mongoose.Types.ObjectId() });
            const orphanProfile = await createProfile();
            const orphan = await createLive(orphanProfile, { link: false });
            const validActiveProfile = await createProfile();
            const validActive = await createLive(validActiveProfile);
            const wrongReferenceProfile = await createProfile({ liveNet: validActive._id });
            const validPreparingProfile = await createProfile();
            const validPreparingOccurrence = await createOccurrence(validPreparingProfile, 'preparing', new Date(NOW.getTime() + 10 * 60000));
            const validPreparing = await createLive(validPreparingProfile, { started: false, occurrence: validPreparingOccurrence });
            const mismatchProfile = await createProfile();
            const otherProfile = await createProfile();
            const otherOccurrence = await createOccurrence(otherProfile, 'preparing', new Date(NOW.getTime() + 10 * 60000));
            const mismatchLive = await createLive(mismatchProfile, { started: false, occurrence: otherOccurrence });

            const result = await reconcileLiveNetPersistence({ now: NOW, db });
            assert.ok(result.staleProfileRefs >= 2);
            assert.ok(result.orphanLiveNets >= 2);
            assert.equal((await NetProfile.findById(missing._id)).liveNet, undefined);
            assert.equal((await NetProfile.findById(wrongReferenceProfile._id)).liveNet, undefined);
            assert.equal(await LiveNet.exists({ _id: orphan._id }), null);
            assert.equal(await LiveNet.exists({ _id: mismatchLive._id }), null);
            assert.ok(await LiveNet.exists({ _id: validActive._id }));
            assert.ok(await LiveNet.exists({ _id: validPreparing._id }));
            const reconciledOccurrence = await ScheduledOccurrence.findById(otherOccurrence._id);
            assert.equal(reconciledOccurrence.status, 'scheduled');
            assert.equal(reconciledOccurrence.liveNet, undefined);
        });

        await t.test('stale preparations recover after restart without inactivity email', async () => {
            await reset();
            const profile = await createProfile();
            const startAt = new Date(NOW.getTime() - 31 * 60000);
            const occurrence = await createOccurrence(profile, 'preparing', startAt);
            const liveNet = await createLive(profile, { started: false, occurrence });
            const unpreparedProfile = await createProfile();
            const unprepared = await createOccurrence(unpreparedProfile, 'scheduled', startAt);
            const emails = captureEmails();
            const lifecycle = await processOccurrenceLifecycle({ now: NOW, db });
            await processAbandonedLiveNets({ now: NOW, db, sendInactivityEmail: emails.send });
            assert.equal(lifecycle.missed, 2);
            assert.equal((await ScheduledOccurrence.findById(occurrence._id)).status, 'missed');
            assert.equal((await ScheduledOccurrence.findById(unprepared._id)).status, 'missed');
            assert.equal(await LiveNet.exists({ _id: liveNet._id }), null);
            assert.equal(emails.sent.length, 0);
        });

        await t.test('claims make concurrent/repeated processing idempotent and ambiguous email claims are not resent', async () => {
            await reset();
            const profile = await createProfile();
            const liveNet = await createLive(profile);
            await addInteraction({ profile, liveNet, lastSeen: new Date(NOW - NCO_ABANDONMENT_MS - 1) });
            const email = captureEmails();
            await Promise.all([
                processAbandonedLiveNets({ now: NOW, db, sendInactivityEmail: email.send }),
                processAbandonedLiveNets({ now: NOW, db, sendInactivityEmail: email.send })
            ]);
            await processAbandonedLiveNets({ now: new Date(NOW.getTime() + 60000), db, sendInactivityEmail: email.send });
            assert.equal(email.sent.length, 1);
            assert.equal(await LiveNetAutoClose.countDocuments({ closeState: 'completed' }), 1);

            await LiveNetAutoClose.create({
                liveNet: new mongoose.Types.ObjectId(), netProfile: profile._id, netTitle: profile.title,
                ownerIds: profile.owners, firstObservedAt: NOW, closeState: 'completed', closeCompletedAt: NOW,
                email: { state: 'claimed', claimedAt: new Date(NOW.getTime() - CLAIM_STALE_MS - 1) }
            });
            const recovered = await recoverAutoCloseClaims({ now: NOW, db });
            assert.equal(recovered.ambiguousEmailsFailed, 1);
            assert.equal(await LiveNetAutoClose.countDocuments({ 'email.state': 'claimed' }), 0);
        });

        await t.test('NCO return at the close boundary prevents closure; manual close and old idle task do not send inactivity email', async () => {
            await reset();
            const profile = await createProfile();
            const liveNet = await createLive(profile);
            await addInteraction({ profile, liveNet, lastSeen: new Date(NOW - NCO_ABANDONMENT_MS - 1) });
            const email = captureEmails();
            const result = await processAbandonedLiveNets({
                now: NOW,
                db,
                sendInactivityEmail: email.send,
                beforeCloseClaim: () => addInteraction({ profile, liveNet, lastSeen: NOW })
            });
            assert.equal(result.autoClosed, 0);
            assert.ok(await LiveNet.exists({ _id: liveNet._id }));

            await closeNet({ netProfileDoc: profile, liveNetDoc: await LiveNet.findById(liveNet._id), quiet: true, db });
            await processAbandonedLiveNets({ now: NOW, db, sendInactivityEmail: email.send });
            assert.equal(email.sent.length, 0);
            assert.match(read('server/dist/lib/backgroundTasks/closeIdleNets.js'), /handled by the recurring scheduling worker/);
            assert.doesNotMatch(read('server/dist/lib/backgroundTasks/closeIdleNets.js'), /closeNet\(/);
            assert.match(read('server/dist/lib/scheduling/worker.js'), /processLiveNetHardening/);
        });
    } finally {
        await db.dropDatabase();
        await db.close();
        if (mongod) await mongod.stop();
    }
});
