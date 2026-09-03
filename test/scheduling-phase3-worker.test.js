const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
    HORIZON_DAYS,
    NOTIFICATION_LEAD_MS,
    STALE_CLAIM_MS,
    MAX_NOTIFICATION_ATTEMPTS,
    NOTIFICATION_RETRY_DELAY_MS,
    materializeSchedule,
    materializeEnabledSchedules,
    processDueNotifications,
    runSchedulingPass,
    startSchedulingWorker
} = require('../server/dist/lib/scheduling/worker');
const { NetAnnounceStart, NetScheduledReminder } = require('../server/dist/lib/userNotification');
const { PREPARATION_WINDOW_MS, GRACE_PERIOD_MS } = require('../server/dist/lib/scheduling/lifecycle');

const NOW = new Date('2030-01-01T12:00:00.000Z');

test('Phase 3 scheduling materialization and notification worker', async t => {
    const externalUri = process.env.TEST_MONGODB_URI;
    let mongod;
    if (externalUri) assert.match(externalUri, /scheduling_phase3_test/, 'TEST_MONGODB_URI must target the Phase 3 test database');
    if (!externalUri) {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        mongod = await MongoMemoryServer.create();
    }
    const db = await mongoose.createConnection(externalUri || mongod.getUri()).asPromise();
    const NetProfile = require('../server/dist/models/netProfile').getNetProfile(db);
    const NetSchedule = require('../server/dist/models/netSchedule').getNetSchedule(db);
    const ScheduledOccurrence = require('../server/dist/models/scheduledOccurrence').getScheduledOccurrence(db);
    await Promise.all([NetProfile.init(), NetSchedule.init(), ScheduledOccurrence.init()]);

    let sequence = 0;
    const createProfile = () => NetProfile.create({
        title: `Worker Test ${++sequence}`,
        frequency: '146.520',
        mode: 'FM',
        owners: [new mongoose.Types.ObjectId()],
        followers: [new mongoose.Types.ObjectId()],
        permanent: true
    });
    const createSchedule = async (overrides = {}) => {
        const profile = await createProfile();
        const schedule = await NetSchedule.create({
            netProfile: profile._id,
            type: 'weekly',
            timezone: 'UTC',
            localStartTime: '19:00',
            startDate: '2030-01-01',
            weekdays: [2],
            ...overrides
        });
        return { profile, schedule };
    };
    const createOccurrence = ({ profile, schedule }, overrides = {}) => ScheduledOccurrence.create({
        schedule: schedule._id,
        netProfile: profile._id,
        occurrenceKey: overrides.occurrenceKey || `2030-06-${String(++sequence).padStart(2, '0')}`,
        originalStartAt: overrides.originalStartAt || new Date('2030-06-01T19:00:00.000Z'),
        startAt: overrides.startAt || new Date('2030-06-01T19:00:00.000Z'),
        ...overrides
    });

    try {
        await t.test('enabled one-time and recurring schedules materialize; disabled schedules do not', async () => {
            const oneTime = await createSchedule({
                type: 'oneTime', weekdays: undefined, startDate: '2030-01-15'
            });
            const recurring = await createSchedule();
            const disabled = await createSchedule({ enabled: false });
            assert.equal((await materializeSchedule({ schedule: oneTime.schedule, now: NOW, db })).created, 1);
            assert.ok((await materializeSchedule({ schedule: recurring.schedule, now: NOW, db })).created > 1);
            assert.deepEqual(await materializeSchedule({ schedule: disabled.schedule, now: NOW, db }), {
                created: 0, synchronized: 0, removed: 0
            });
            assert.equal(await ScheduledOccurrence.countDocuments({ schedule: disabled.schedule._id }), 0);
        });

        await t.test('rolling recurring horizon is approximately 90 days and far-future one-time still materializes', async () => {
            const recurring = await createSchedule({ weekdays: [1, 2, 3, 4, 5, 6, 7] });
            await materializeSchedule({ schedule: recurring.schedule, now: NOW, db });
            const occurrences = await ScheduledOccurrence.find({ schedule: recurring.schedule._id }).sort({ startAt: 1 });
            assert.ok(occurrences.length >= HORIZON_DAYS - 1 && occurrences.length <= HORIZON_DAYS + 1);
            assert.ok(occurrences.at(-1).startAt <= new Date(NOW.getTime() + (HORIZON_DAYS + 1) * 86400000));

            const farFuture = await createSchedule({
                type: 'oneTime', weekdays: undefined, startDate: '2032-07-04'
            });
            await materializeSchedule({ schedule: farFuture.schedule, now: NOW, db });
            const occurrence = await ScheduledOccurrence.findOne({ schedule: farFuture.schedule._id });
            assert.equal(occurrence.occurrenceKey, '2032-07-04');
        });

        await t.test('repeated materialization is idempotent and occurrence keys remain stable', async () => {
            const data = await createSchedule();
            await materializeSchedule({ schedule: data.schedule, now: NOW, db });
            const first = await ScheduledOccurrence.find({ schedule: data.schedule._id }).sort({ occurrenceKey: 1 });
            const result = await materializeSchedule({ schedule: data.schedule, now: NOW, db });
            const second = await ScheduledOccurrence.find({ schedule: data.schedule._id }).sort({ occurrenceKey: 1 });
            assert.equal(result.created, 0);
            assert.equal(second.length, first.length);
            assert.deepEqual(second.map(item => item.occurrenceKey), first.map(item => item.occurrenceKey));
        });

        await t.test('overrides, cancellations, and all lifecycle/history states are preserved', async () => {
            const data = await createSchedule({ type: 'oneTime', weekdays: undefined, startDate: '2030-02-05' });
            const originalStartAt = new Date('2030-02-05T19:00:00.000Z');
            const states = [
                { status: 'scheduled', isOverride: true },
                { status: 'cancelled' },
                { status: 'preparing' },
                { status: 'live' },
                { status: 'completed' },
                { status: 'missed' }
            ];
            for (const state of states) {
                await ScheduledOccurrence.deleteMany({ schedule: data.schedule._id });
                const occurrence = await createOccurrence(data, {
                    occurrenceKey: '2030-02-05',
                    originalStartAt,
                    startAt: new Date('2030-02-05T20:00:00.000Z'),
                    ...state
                });
                await materializeSchedule({ schedule: data.schedule, now: NOW, db });
                const preserved = await ScheduledOccurrence.findById(occurrence._id);
                assert.equal(preserved.status, state.status);
                assert.equal(preserved.isOverride, Boolean(state.isOverride));
                assert.equal(preserved.startAt.toISOString(), '2030-02-05T20:00:00.000Z');
                assert.equal(preserved.originalStartAt.toISOString(), originalStartAt.toISOString());
            }
        });

        await t.test('series edits create required dates and remove only stale ordinary future rows', async () => {
            const data = await createSchedule({ weekdays: [2] });
            await materializeSchedule({ schedule: data.schedule, now: NOW, db });
            const old = await ScheduledOccurrence.find({ schedule: data.schedule._id }).sort({ startAt: 1 });
            const override = old[0];
            override.isOverride = true;
            override.startAt = new Date(override.startAt.getTime() + 3600000);
            await override.save();
            const cancelled = old[1];
            cancelled.status = 'cancelled';
            cancelled.cancelledAt = NOW;
            await cancelled.save();

            data.schedule.weekdays = [4];
            await data.schedule.save();
            const result = await materializeSchedule({ schedule: data.schedule, now: NOW, db });
            assert.ok(result.created > 0);
            assert.ok(result.removed > 0);
            assert.ok(await ScheduledOccurrence.findById(override._id));
            assert.equal((await ScheduledOccurrence.findById(cancelled._id)).status, 'cancelled');
            const ordinary = await ScheduledOccurrence.find({
                schedule: data.schedule._id, status: 'scheduled', isOverride: false
            });
            assert.ok(ordinary.every(item => new Date(item.startAt).getUTCDay() === 4));
        });

        const notificationData = async ({ minutesFromNow, state = 'pending', isOverride = false, claimedAt } = {}) => {
            const data = await createSchedule({ type: 'oneTime', weekdays: undefined, startDate: '2030-01-01' });
            const startAt = new Date(NOW.getTime() + minutesFromNow * 60000);
            const occurrence = await createOccurrence(data, {
                occurrenceKey: `notify-${++sequence}`,
                originalStartAt: new Date(NOW.getTime() + 24 * 60 * 60000),
                startAt,
                isOverride,
                notification: { state, attempts: 0, claimedAt }
            });
            return { ...data, occurrence };
        };

        await t.test('notification selection honors 10-minute, early, late, and past-due rules', async () => {
            const due = await notificationData({ minutesFromNow: 10 });
            const early = await notificationData({ minutesFromNow: 11 });
            const late = await notificationData({ minutesFromNow: 1 });
            const past = await notificationData({ minutesFromNow: -1 });
            const sentIds = [];
            await processDueNotifications({
                now: NOW,
                db,
                sendNotification: async ({ occurrence }) => sentIds.push(occurrence._id.toString())
            });
            assert.ok(sentIds.includes(due.occurrence._id.toString()));
            assert.ok(sentIds.includes(late.occurrence._id.toString()));
            assert.ok(!sentIds.includes(early.occurrence._id.toString()));
            assert.ok(!sentIds.includes(past.occurrence._id.toString()));
            assert.equal((await ScheduledOccurrence.findById(due.occurrence._id)).notification.state, 'sent');
            assert.equal((await ScheduledOccurrence.findById(early.occurrence._id)).notification.state, 'pending');
            assert.equal((await ScheduledOccurrence.findById(past.occurrence._id)).notification.state, 'failed');
            const sentCount = sentIds.length;
            await processDueNotifications({
                now: NOW,
                db,
                sendNotification: async ({ occurrence }) => sentIds.push(occurrence._id.toString())
            });
            assert.equal(sentIds.length, sentCount, 'a later worker process must not resend persisted notifications');
        });

        await t.test('sent notifications cannot resend and known failures retry durably', async () => {
            const alreadySent = await notificationData({ minutesFromNow: 5, state: 'sent' });
            const failure = await notificationData({ minutesFromNow: 5 });
            let calls = 0;

            await ScheduledOccurrence.deleteMany({
                _id: { $nin: [alreadySent.occurrence._id, failure.occurrence._id] },
                'notification.state': { $in: ['pending', 'claimed'] }
            });

            const sendNotification = async ({ occurrence }) => {
                calls++;
                if (occurrence._id.equals(failure.occurrence._id) && calls < 3) {
                    throw new Error('mock SMTP rejection');
                }
            };

            await processDueNotifications({ now: NOW, db, sendNotification });

            let retrying = await ScheduledOccurrence.findById(failure.occurrence._id);
            assert.equal(calls, 1);
            assert.equal((await ScheduledOccurrence.findById(alreadySent.occurrence._id)).notification.state, 'sent');
            assert.equal(retrying.notification.state, 'pending');
            assert.equal(retrying.notification.attempts, 1);
            assert.ok(retrying.notification.failedAt);
            assert.equal(
                retrying.notification.retryAt.toISOString(),
                new Date(NOW.getTime() + NOTIFICATION_RETRY_DELAY_MS).toISOString()
            );

            await processDueNotifications({
                now: new Date(NOW.getTime() + NOTIFICATION_RETRY_DELAY_MS - 1),
                db,
                sendNotification
            });
            assert.equal(calls, 1, 'retry must not occur before retryAt');

            await processDueNotifications({
                now: new Date(NOW.getTime() + NOTIFICATION_RETRY_DELAY_MS),
                db,
                sendNotification
            });

            retrying = await ScheduledOccurrence.findById(failure.occurrence._id);
            assert.equal(calls, 2);
            assert.equal(retrying.notification.state, 'pending');
            assert.equal(retrying.notification.attempts, 2);

            await processDueNotifications({
                now: new Date(NOW.getTime() + (2 * NOTIFICATION_RETRY_DELAY_MS)),
                db,
                sendNotification
            });

            const sent = await ScheduledOccurrence.findById(failure.occurrence._id);
            assert.equal(calls, 3);
            assert.equal(sent.notification.state, 'sent');
            assert.equal(sent.notification.attempts, 3);
            assert.equal(sent.notification.retryAt, null);
        });

        await t.test('known failures become terminal after the durable retry limit', async () => {
            const failure = await notificationData({ minutesFromNow: 9 });
            let calls = 0;

            await ScheduledOccurrence.deleteMany({
                _id: { $ne: failure.occurrence._id },
                'notification.state': { $in: ['pending', 'claimed'] }
            });

            const sendNotification = async () => {
                calls++;
                throw new Error('mock SMTP rejection');
            };

            for (let attempt = 0; attempt < MAX_NOTIFICATION_ATTEMPTS; attempt++) {
                await processDueNotifications({
                    now: new Date(NOW.getTime() + (attempt * NOTIFICATION_RETRY_DELAY_MS)),
                    db,
                    sendNotification
                });
            }

            const failed = await ScheduledOccurrence.findById(failure.occurrence._id);
            assert.equal(calls, MAX_NOTIFICATION_ATTEMPTS);
            assert.equal(failed.notification.state, 'failed');
            assert.equal(failed.notification.attempts, MAX_NOTIFICATION_ATTEMPTS);
            assert.ok(failed.notification.failedAt);
            assert.equal(failed.notification.retryAt, null);
        });

        await t.test('atomic claims prevent duplicate concurrent sends', async () => {
            const data = await notificationData({ minutesFromNow: 5 });
            let sends = 0;
            const sendNotification = async () => {
                sends++;
                await new Promise(resolve => setTimeout(resolve, 25));
            };
            await Promise.all([
                processDueNotifications({ now: NOW, db, sendNotification }),
                processDueNotifications({ now: NOW, db, sendNotification })
            ]);
            assert.equal(sends, 1);
            assert.equal((await ScheduledOccurrence.findById(data.occurrence._id)).notification.state, 'sent');
        });

        await t.test('stale ambiguous claims are failed without resend', async () => {
            const data = await notificationData({
                minutesFromNow: 20,
                state: 'claimed',
                claimedAt: new Date(NOW.getTime() - STALE_CLAIM_MS - 1)
            });
            let sends = 0;
            await processDueNotifications({ now: NOW, db, sendNotification: async () => sends++ });
            const occurrence = await ScheduledOccurrence.findById(data.occurrence._id);
            assert.equal(sends, 0);
            assert.equal(occurrence.notification.state, 'failed');
            assert.ok(occurrence.notification.failedAt);
        });

        await t.test('an override effective startAt controls notification timing', async () => {
            const data = await notificationData({ minutesFromNow: 5, isOverride: true });
            let sends = 0;
            await processDueNotifications({ now: NOW, db, sendNotification: async () => sends++ });
            assert.equal(sends, 1);
            assert.equal((await ScheduledOccurrence.findById(data.occurrence._id)).notification.state, 'sent');
        });

        await t.test('repeated worker passes are idempotent and manual notification behavior remains available', async () => {
            const data = await createSchedule();
            const sendNotification = async () => undefined;
            await runSchedulingPass({ now: NOW, db, sendNotification });
            const count = await ScheduledOccurrence.countDocuments({ schedule: data.schedule._id });
            await runSchedulingPass({ now: NOW, db, sendNotification });
            assert.equal(await ScheduledOccurrence.countDocuments({ schedule: data.schedule._id }), count);
            assert.equal(typeof NetAnnounceStart, 'function');
        });

        await t.test('reminder wording and independent lifecycle windows remain accurate', () => {
            const reminder = new NetScheduledReminder({
                netProfileDoc: { _id: new mongoose.Types.ObjectId(), title: 'Timing Test Net' },
                startAt: new Date(NOW.getTime() + NOTIFICATION_LEAD_MS),
                timezone: 'UTC'
            });
            assert.match(reminder.body.text, /approximately 10 minutes/);
            assert.doesNotMatch(reminder.body.text, /approximately 30 minutes/);
            assert.equal(NOTIFICATION_LEAD_MS, 10 * 60 * 1000);
            assert.equal(PREPARATION_WINDOW_MS, 30 * 60 * 1000);
            assert.equal(GRACE_PERIOD_MS, 30 * 60 * 1000);
            const manual = new NetAnnounceStart({
                netControl: 'N0CALL',
                netProfileDoc: { title: 'Manual Test Net' },
                liveNetDoc: { countdownTimer: 0, url: '/views/livenet/manual' }
            });
            assert.match(manual.body.text, /N0CALL initiated the start of Manual Test Net, which is going live now/);
        });

        await t.test('a worker pass failure is contained and does not crash startup', async () => {
            let attempted = false;
            const stop = startSchedulingWorker({
                intervalMs: 60000,
                runPass: async () => {
                    attempted = true;
                    throw new Error('expected test failure');
                }
            });
            await new Promise(resolve => setTimeout(resolve, 25));
            stop();
            assert.equal(attempted, true);
        });

        await t.test('enabled-schedule sweep ignores disabled schedules', async () => {
            const enabled = await createSchedule();
            const disabled = await createSchedule({ enabled: false });
            await materializeEnabledSchedules({ now: NOW, db });
            assert.ok(await ScheduledOccurrence.exists({ schedule: enabled.schedule._id }));
            assert.equal(await ScheduledOccurrence.exists({ schedule: disabled.schedule._id }), null);
        });
    } finally {
        await db.dropDatabase();
        await db.close();
        if (mongod) await mongod.stop();
    }
});
