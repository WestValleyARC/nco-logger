const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
    PREPARATION_WINDOW_MS,
    canAccessScheduledPreparation,
    prepareOccurrence,
    transitionPreparedOccurrence,
    cancelPreparation,
    processOccurrenceLifecycle
} = require('../server/dist/lib/scheduling/lifecycle');
const { closeNet } = require('../server/dist/lib/sharedNetOps');
const { capturePresence } = require('../server/dist/lib/controllers/liveNetHelpers');

const START_AT = new Date('2030-01-10T19:00:00.000Z');
const OWNER_ID = new mongoose.Types.ObjectId();
const OTHER_ID = new mongoose.Types.ObjectId();
const owner = {
    _id: OWNER_ID,
    id: OWNER_ID.toString(),
    callSign: 'W1OWN',
    displayName: 'Owner',
    location: 'Phoenix, AZ',
    email: 'owner@example.test',
    flexOptions: { option: { chat: true } }
};

test('Phase 4 scheduled LiveNet lifecycle', async t => {
    const uri = process.env.TEST_MONGODB_URI;
    assert.match(uri || '', /scheduling_phase4_test/, 'TEST_MONGODB_URI must target the Phase 4 test database');
    await mongoose.connect(uri);
    const NetProfile = require('../server/dist/models/netProfile').getNetProfile();
    const NetSchedule = require('../server/dist/models/netSchedule').getNetSchedule();
    const ScheduledOccurrence = require('../server/dist/models/scheduledOccurrence').getScheduledOccurrence();
    const LiveNet = require('../server/dist/models/liveNet').getLiveNet();
    const StationInteraction = require('../server/dist/models/stationInteraction').getStationInteraction();
    await Promise.all([
        NetProfile.init(), NetSchedule.init(), ScheduledOccurrence.init(), LiveNet.init(), StationInteraction.init()
    ]);

    let sequence = 0;
    const createData = async ({ status = 'scheduled', startAt = START_AT, owners = [OWNER_ID] } = {}) => {
        const profile = await NetProfile.create({
            title: `Lifecycle Test ${++sequence}`,
            frequency: '146.520',
            mode: 'FM',
            owners,
            permanent: true
        });
        const schedule = await NetSchedule.create({
            netProfile: profile._id,
            type: 'oneTime',
            timezone: 'UTC',
            localStartTime: '19:00',
            startDate: '2030-01-10'
        });
        const occurrence = await ScheduledOccurrence.create({
            schedule: schedule._id,
            netProfile: profile._id,
            occurrenceKey: `occurrence-${sequence}`,
            originalStartAt: startAt,
            startAt,
            status
        });
        return { profile, schedule, occurrence };
    };
    const prepare = (data, now, user = owner) => prepareOccurrence({
        npid: data.profile._id,
        occurrenceId: data.occurrence._id,
        user,
        now,
        db: mongoose.connection
    });

    try {
        await t.test('preparation timing boundaries are enforced', async () => {
            const tooEarly = await createData();
            await assert.rejects(
                prepare(tooEarly, new Date(START_AT.getTime() - PREPARATION_WINDOW_MS - 1)),
                error => error.status === 409
            );
            const atOpening = await createData();
            const openingResult = await prepare(atOpening, new Date(START_AT.getTime() - PREPARATION_WINDOW_MS));
            assert.equal(openingResult.occurrence.status, 'preparing');
            const between = await createData();
            assert.equal((await prepare(between, new Date(START_AT.getTime() - 10 * 60000))).occurrence.status, 'preparing');
        });

        await t.test('preparation atomically creates and links one waiting LiveNet and NCO interaction', async () => {
            const data = await createData();
            const now = new Date(START_AT.getTime() - 20 * 60000);
            const result = await prepare(data, now);
            const [profile, occurrence, liveNet, interactions] = await Promise.all([
                NetProfile.findById(data.profile._id),
                ScheduledOccurrence.findById(data.occurrence._id),
                LiveNet.findById(result.liveNet._id),
                StationInteraction.find({ liveNet: result.liveNet._id })
            ]);
            assert.equal(occurrence.status, 'preparing');
            assert.equal(occurrence.preparedAt.toISOString(), now.toISOString());
            assert.equal(String(occurrence.liveNet), String(liveNet._id));
            assert.equal(String(profile.liveNet), String(liveNet._id));
            assert.equal(String(liveNet.occurrence), String(occurrence._id));
            assert.equal(liveNet.started, false);
            assert.equal(liveNet.startedAt, null);
            assert.equal(interactions.length, 1);
            assert.equal(interactions[0].role, 'netcontrol');
            assert.equal(interactions[0].checkedState, true);
        });

        await t.test('repeated and concurrent prepare cannot duplicate LiveNets', async () => {
            const repeated = await createData();
            const now = new Date(START_AT.getTime() - 15 * 60000);
            const first = await prepare(repeated, now);
            const second = await prepare(repeated, now);
            assert.equal(String(second.liveNet._id), String(first.liveNet._id));
            assert.equal(second.idempotent, true);

            const concurrent = await createData();
            const attempts = await Promise.allSettled([prepare(concurrent, now), prepare(concurrent, now)]);
            assert.ok(attempts.some(attempt => attempt.status === 'fulfilled'));
            assert.equal(await LiveNet.countDocuments({ netProfile: concurrent.profile._id }), 1);
            const occurrence = await ScheduledOccurrence.findById(concurrent.occurrence._id);
            assert.ok(['preparing', 'live'].includes(occurrence.status));
        });

        await t.test('authorization, terminal states, and conflicting manual LiveNets block preparation', async () => {
            const nonOwner = await createData();
            await assert.rejects(
                prepare(nonOwner, new Date(START_AT.getTime() - 10 * 60000), { ...owner, _id: OTHER_ID, id: OTHER_ID.toString() }),
                error => error.status === 403
            );
            for (const status of ['cancelled', 'missed', 'completed', 'live']) {
                const data = await createData({ status });
                await assert.rejects(prepare(data, new Date(START_AT.getTime() - 10 * 60000)), error => error.status === 409);
            }

            const conflict = await createData();
            const manual = await LiveNet.create({
                netProfile: conflict.profile._id,
                netControl: OWNER_ID,
                countdownTimer: 5,
                url: `/views/livenet/${conflict.profile._id}`,
                lookupTable: {}
            });
            conflict.profile.liveNet = manual._id;
            await conflict.profile.save({ validateBeforeSave: false });
            await assert.rejects(prepare(conflict, new Date(START_AT.getTime() - 10 * 60000)), error => error.status === 409);
        });

        await t.test('preparing owner gets logger access while ordinary participant gets Waiting', async () => {
            const data = await createData();
            const now = new Date(START_AT.getTime() - 10 * 60000);
            const result = await prepare(data, now);
            const occurrence = await ScheduledOccurrence.findById(data.occurrence._id);
            const liveNet = await LiveNet.findById(result.liveNet._id);
            const profile = await NetProfile.findById(data.profile._id);
            assert.equal(canAccessScheduledPreparation({ netProfile: profile, liveNet, occurrence, user: owner, now }), true);
            assert.equal(canAccessScheduledPreparation({
                netProfile: profile,
                liveNet,
                occurrence,
                user: { _id: OTHER_ID, id: OTHER_ID.toString() },
                now
            }), false);
        });

        await t.test('recent NCO presence transitions preparing occurrence live at actual transition time', async () => {
            const data = await createData();
            const prepared = await prepare(data, new Date(START_AT.getTime() - 20 * 60000));
            await StationInteraction.updateOne(
                { liveNet: prepared.liveNet._id, role: 'netcontrol' },
                { $set: { lastSeen: new Date(START_AT.getTime() - 5000) } }
            );
            assert.equal(await transitionPreparedOccurrence({
                occurrenceId: data.occurrence._id,
                now: START_AT,
                db: mongoose.connection
            }), true);
            const occurrence = await ScheduledOccurrence.findById(data.occurrence._id);
            const liveNet = await LiveNet.findById(prepared.liveNet._id);
            assert.equal(occurrence.status, 'live');
            assert.equal(occurrence.startedAt.toISOString(), START_AT.toISOString());
            assert.equal(liveNet.started, true);
            assert.equal(liveNet.startedAt.toISOString(), START_AT.toISOString());
            assert.equal(await transitionPreparedOccurrence({ occurrenceId: occurrence._id, now: START_AT, db: mongoose.connection }), false);
        });

        await t.test('no recent NCO remains preparing during grace, then arrival transitions live', async () => {
            const data = await createData();
            const prepared = await prepare(data, new Date(START_AT.getTime() - 20 * 60000));
            assert.equal(await transitionPreparedOccurrence({
                occurrenceId: data.occurrence._id,
                now: START_AT,
                db: mongoose.connection
            }), false);
            assert.equal((await ScheduledOccurrence.findById(data.occurrence._id)).status, 'preparing');
            const arrival = new Date(START_AT.getTime() + 12 * 60000);
            await StationInteraction.updateOne(
                { liveNet: prepared.liveNet._id, role: 'netcontrol' },
                { $set: { lastSeen: arrival } }
            );
            assert.equal(await transitionPreparedOccurrence({
                occurrenceId: data.occurrence._id,
                now: arrival,
                db: mongoose.connection
            }), true);
            assert.equal((await ScheduledOccurrence.findById(data.occurrence._id)).startedAt.toISOString(), arrival.toISOString());
        });

        await t.test('owner preparing after scheduled start within grace transitions immediately', async () => {
            const data = await createData();
            const arrival = new Date(START_AT.getTime() + 10 * 60000);
            const result = await prepare(data, arrival);
            assert.equal(result.occurrence.status, 'live');
            assert.equal(result.occurrence.startedAt.toISOString(), arrival.toISOString());
            assert.equal(result.liveNet.started, true);
            assert.equal(result.liveNet.startedAt.toISOString(), arrival.toISOString());
        });

        await t.test('unprepared and prepared occurrences become missed at grace expiry without email work', async () => {
            const unprepared = await createData();
            const preparing = await createData();
            const prepared = await prepare(preparing, new Date(START_AT.getTime() - 20 * 60000));
            const graceEnd = new Date(START_AT.getTime() + 30 * 60000);
            await processOccurrenceLifecycle({ now: graceEnd, db: mongoose.connection });
            const missedWithoutNet = await ScheduledOccurrence.findById(unprepared.occurrence._id);
            const missedPrepared = await ScheduledOccurrence.findById(preparing.occurrence._id);
            assert.equal(missedWithoutNet.status, 'missed');
            assert.equal(missedWithoutNet.missedAt.toISOString(), graceEnd.toISOString());
            assert.equal(missedPrepared.status, 'missed');
            assert.equal(missedPrepared.missedAt.toISOString(), graceEnd.toISOString());
            assert.equal(missedPrepared.liveNet, undefined);
            assert.equal(await LiveNet.findById(prepared.liveNet._id), null);
            assert.equal(await StationInteraction.countDocuments({ liveNet: prepared.liveNet._id }), 0);
            assert.equal((await NetProfile.findById(preparing.profile._id)).liveNet, undefined);
        });

        await t.test('owner safely cancels preparation and live occurrence rejects preparation cancellation', async () => {
            const data = await createData();
            const prepared = await prepare(data, new Date(START_AT.getTime() - 10 * 60000));
            const cancelledAt = new Date(START_AT.getTime() - 5 * 60000);
            const cancelled = await cancelPreparation({
                npid: data.profile._id,
                occurrenceId: data.occurrence._id,
                user: owner,
                now: cancelledAt,
                db: mongoose.connection
            });
            assert.equal(cancelled.status, 'cancelled');
            assert.equal(cancelled.cancellationOrigin, 'preparation');
            assert.equal(cancelled.cancelledAt.toISOString(), cancelledAt.toISOString());
            assert.equal(String(cancelled.cancelledBy), OWNER_ID.toString());
            assert.equal(await LiveNet.findById(prepared.liveNet._id), null);
            assert.equal((await NetProfile.findById(data.profile._id)).liveNet, undefined);

            const liveData = await createData();
            await prepare(liveData, new Date(START_AT.getTime() + 5 * 60000));
            await assert.rejects(cancelPreparation({
                npid: liveData.profile._id,
                occurrenceId: liveData.occurrence._id,
                user: owner,
                now: new Date(START_AT.getTime() + 6 * 60000),
                db: mongoose.connection
            }), error => error.status === 409);
        });

        await t.test('normal scheduled close completes occurrence; manual close remains unchanged', async () => {
            const scheduled = await createData();
            const prepared = await prepare(scheduled, new Date(START_AT.getTime() + 5 * 60000));
            await closeNet({
                netProfileDoc: await NetProfile.findById(scheduled.profile._id),
                liveNetDoc: await LiveNet.findById(prepared.liveNet._id),
                quiet: true,
                db: mongoose.connection
            });
            const completed = await ScheduledOccurrence.findById(scheduled.occurrence._id);
            assert.equal(completed.status, 'completed');
            assert.ok(completed.completedAt);
            assert.equal(completed.liveNet, undefined);

            const manualProfile = await NetProfile.create({
                title: `Manual Close ${++sequence}`,
                frequency: '146.520',
                mode: 'FM',
                owners: [OWNER_ID],
                permanent: true
            });
            const manualLiveNet = await LiveNet.create({
                netProfile: manualProfile._id,
                netControl: OWNER_ID,
                countdownTimer: 12,
                started: true,
                startedAt: new Date(),
                url: `/views/livenet/${manualProfile._id}`,
                lookupTable: {}
            });
            manualProfile.liveNet = manualLiveNet._id;
            await manualProfile.save({ validateBeforeSave: false });
            await closeNet({ netProfileDoc: manualProfile, liveNetDoc: manualLiveNet, quiet: true, db: mongoose.connection });
            assert.equal(await LiveNet.findById(manualLiveNet._id), null);
            assert.equal((await NetProfile.findById(manualProfile._id)).liveNet, undefined);
        });

        await t.test('legacy manual countdown still starts and occurrence linking remains optional', async () => {
            const profile = await NetProfile.create({
                title: `Manual Countdown ${++sequence}`,
                frequency: '146.520',
                mode: 'FM',
                owners: [OWNER_ID],
                permanent: true
            });
            const interaction = await StationInteraction.create({
                netProfile: profile._id,
                callSign: owner.callSign,
                displayName: owner.displayName,
                createdBy: 'admin',
                role: 'netcontrol',
                checkedState: true,
                checkedInAt: new Date(),
                lastSeen: new Date(0),
                userProfile: OWNER_ID,
                sigReports: { rst: {} }
            });
            const liveNet = await LiveNet.create({
                netProfile: profile._id,
                netControl: OWNER_ID,
                countdownTimer: 0,
                started: false,
                url: `/views/livenet/${profile._id}`,
                lookupTable: { [owner.callSign]: { stationInteraction: interaction._id } }
            });
            interaction.liveNet = liveNet._id;
            await interaction.save();
            profile.liveNet = liveNet._id;
            await profile.save({ validateBeforeSave: false });
            assert.equal(liveNet.occurrence, undefined);
            await new Promise(resolve => setTimeout(resolve, 5));
            await capturePresence({
                req: { user: owner },
                res: { locals: { flexOpts: { chat: true, awayInMs: 25000 } } },
                netProfileDoc: profile,
                liveNetDoc: liveNet
            });
            assert.equal((await LiveNet.findById(liveNet._id)).started, true);
        });

        await t.test('lifecycle worker processing is idempotent and emits no follower-email transition', async () => {
            const data = await createData();
            const prepared = await prepare(data, new Date(START_AT.getTime() - 10 * 60000));
            await StationInteraction.updateOne(
                { liveNet: prepared.liveNet._id, role: 'netcontrol' },
                { $set: { lastSeen: START_AT } }
            );
            const first = await processOccurrenceLifecycle({ now: START_AT, db: mongoose.connection });
            const second = await processOccurrenceLifecycle({ now: START_AT, db: mongoose.connection });
            assert.ok(first.transitioned >= 1);
            assert.equal(second.transitioned, 0);
            assert.equal((await ScheduledOccurrence.findById(data.occurrence._id)).status, 'live');
        });
    } finally {
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
});
