const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');

const { materializeSchedule, processDueNotifications, HORIZON_DAYS } = require('../server/dist/lib/scheduling/worker');
const { listPublicOccurrences } = require('../server/dist/lib/scheduling/publicSchedule');
const { delNet } = require('../server/dist/lib/sharedNetOps');

const OWNER = new mongoose.Types.ObjectId();

const utcFields = value => ({
    localDate: value.toISOString().slice(0, 10),
    localStartTime: value.toISOString().slice(11, 16)
});

test('Scheduling integrity closure', async t => {
    const externalUri = process.env.TEST_MONGODB_URI;
    let replset;
    if (externalUri) {
        assert.match(
            externalUri,
            /scheduling_integrity_test/,
            'TEST_MONGODB_URI must target the integrity test database'
        );
    } else {
        const { MongoMemoryReplSet } = require('mongodb-memory-server');
        replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    }
    await mongoose.connect(externalUri || replset.getUri());

    const NetProfile = require('../server/dist/models/netProfile').getNetProfile();
    const NetSchedule = require('../server/dist/models/netSchedule').getNetSchedule();
    const ScheduledOccurrence = require('../server/dist/models/scheduledOccurrence').getScheduledOccurrence();
    const UserProfile = require('../server/dist/models/userProfile').getUserProfile();
    await Promise.all([NetProfile.init(), NetSchedule.init(), ScheduledOccurrence.init(), UserProfile.init()]);
    await UserProfile.create({
        _id: OWNER,
        displayName: 'Owner',
        callSign: 'W1OWN',
        lastAuthVia: 'email',
        email: 'owner@example.test',
        deletionReason: 'manual'
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { _id: OWNER, id: OWNER.toString(), callSign: 'W1OWN' };
        next();
    });
    app.use('/api/data/netprofiles', require('../server/dist/routes/dataNetProfileRoutes'));
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/data/netprofiles`;
    let sequence = 0;
    const createProfile = (overrides = {}) =>
        NetProfile.create({
            title: `Integrity Net ${++sequence}`,
            frequency: '146.520',
            mode: 'FM',
            owners: [OWNER],
            permanent: true,
            ...overrides
        });
    const scheduleBody = overrides => ({
        type: 'weekly',
        timezone: 'UTC',
        localStartTime: '19:00',
        startDate: '2030-01-01',
        weekdays: [1],
        ...overrides
    });
    const request = async (path, { method = 'GET', body } = {}) => {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
    };

    try {
        await t.test('ordinary create and update cannot bypass the disable lifecycle', async () => {
            const rejectedProfile = await createProfile();
            const rejectedCreate = await request(`/${rejectedProfile._id}/schedule`, {
                method: 'POST',
                body: scheduleBody({ enabled: false })
            });
            assert.equal(rejectedCreate.status, 400);
            assert.equal(await NetSchedule.exists({ netProfile: rejectedProfile._id }), null);

            const profile = await createProfile();
            assert.equal(
                (
                    await request(`/${profile._id}/schedule`, {
                        method: 'POST',
                        body: scheduleBody()
                    })
                ).status,
                201
            );
            const schedule = await NetSchedule.findOne({ netProfile: profile._id });
            const future = await ScheduledOccurrence.create({
                schedule: schedule._id,
                netProfile: profile._id,
                occurrenceKey: 'bypass-future',
                originalStartAt: new Date('2030-02-01T19:00:00Z'),
                startAt: new Date('2030-02-01T19:00:00Z')
            });
            const bypass = await request(`/${profile._id}/schedule`, {
                method: 'PATCH',
                body: { enabled: false }
            });
            assert.equal(bypass.status, 400);
            assert.equal((await NetSchedule.findById(schedule._id)).enabled, true);
            assert.equal((await ScheduledOccurrence.findById(future._id)).status, 'scheduled');

            const disabled = await request(`/${profile._id}/schedule`, { method: 'DELETE' });
            assert.equal(disabled.status, 200);
            assert.equal(disabled.body.schedule.enabled, false);
            assert.equal((await ScheduledOccurrence.findById(future._id)).status, 'cancelled');
        });

        await t.test(
            'near-term one-time creation materializes immediately and expired creation is rejected',
            async () => {
                const nearProfile = await createProfile();
                const nearStart = new Date(Date.now() + 2 * 60 * 1000);
                nearStart.setUTCSeconds(0, 0);
                const near = utcFields(nearStart);
                const created = await request(`/${nearProfile._id}/schedule`, {
                    method: 'POST',
                    body: scheduleBody({
                        type: 'oneTime',
                        weekdays: undefined,
                        startDate: near.localDate,
                        localStartTime: near.localStartTime
                    })
                });
                assert.equal(created.status, 201);
                const occurrence = await ScheduledOccurrence.findOne({ netProfile: nearProfile._id });
                assert.ok(occurrence);
                assert.equal(occurrence.startAt.toISOString(), nearStart.toISOString());
                assert.equal(occurrence.status, 'scheduled');

                const expiredProfile = await createProfile();
                const expiredStart = new Date(Date.now() - 2 * 60 * 1000);
                expiredStart.setUTCSeconds(0, 0);
                const expired = utcFields(expiredStart);
                const rejected = await request(`/${expiredProfile._id}/schedule`, {
                    method: 'POST',
                    body: scheduleBody({
                        type: 'oneTime',
                        weekdays: undefined,
                        startDate: expired.localDate,
                        localStartTime: expired.localStartTime
                    })
                });
                assert.equal(rejected.status, 400);
                assert.match(rejected.body.errorMessage, /must be in the future/);
                assert.equal(await NetSchedule.exists({ netProfile: expiredProfile._id }), null);
                assert.equal(await ScheduledOccurrence.exists({ netProfile: expiredProfile._id }), null);
            }
        );

        await t.test('rescheduling a sent reminder re-arms only the new time', async () => {
            const profile = await createProfile();
            await request(`/${profile._id}/schedule`, { method: 'POST', body: scheduleBody() });
            const schedule = await NetSchedule.findOne({ netProfile: profile._id });
            const oldStart = new Date('2030-04-01T18:00:00Z');
            const newStart = new Date('2030-04-01T19:00:00Z');
            const occurrence = await ScheduledOccurrence.create({
                schedule: schedule._id,
                netProfile: profile._id,
                occurrenceKey: 'reminder-move',
                originalStartAt: oldStart,
                startAt: oldStart,
                notification: { state: 'sent', attempts: 1, sentAt: new Date('2030-04-01T17:50:00Z') }
            });
            const moved = await request(`/${profile._id}/occurrences/${occurrence._id}`, {
                method: 'PATCH',
                body: utcFields(newStart)
            });
            assert.equal(moved.status, 200);
            assert.equal(moved.body.occurrence.notification.state, 'pending');
            assert.equal(moved.body.occurrence.notification.attempts, 0);
            assert.equal(moved.body.occurrence.notification.sentAt, null);

            const claimed = await ScheduledOccurrence.create({
                schedule: schedule._id,
                netProfile: profile._id,
                occurrenceKey: 'reminder-claimed',
                originalStartAt: oldStart,
                startAt: oldStart,
                notification: { state: 'claimed', attempts: 1, claimedAt: new Date('2030-04-01T17:49:00Z') }
            });
            assert.equal(
                (
                    await request(`/${profile._id}/occurrences/${claimed._id}`, {
                        method: 'PATCH',
                        body: utcFields(newStart)
                    })
                ).status,
                409
            );

            const sentAt = [];
            const sendNotification = async ({ occurrence: claimed }) => {
                sentAt.push(claimed.startAt.toISOString());
                return true;
            };
            const oldPass = await processDueNotifications({
                now: new Date(oldStart.getTime() - 10 * 60 * 1000),
                db: mongoose.connection,
                sendNotification
            });
            assert.equal(oldPass.sent, 0);
            const newPass = await processDueNotifications({
                now: new Date(newStart.getTime() - 10 * 60 * 1000),
                db: mongoose.connection,
                sendNotification
            });
            assert.equal(newPass.sent, 1);
            assert.deepEqual(sentAt, [newStart.toISOString()]);
            assert.equal(
                (
                    await processDueNotifications({
                        now: new Date(newStart.getTime() - 9 * 60 * 1000),
                        db: mongoose.connection,
                        sendNotification
                    })
                ).sent,
                0
            );
        });

        await t.test('final-owner deletion archives scheduling state without losing completed history', async () => {
            const profile = await createProfile();
            await UserProfile.updateOne({ _id: OWNER }, { $addToSet: { myNets: profile._id } });
            const schedule = await NetSchedule.create(scheduleBody({ netProfile: profile._id }));
            const future = await ScheduledOccurrence.create({
                schedule: schedule._id,
                netProfile: profile._id,
                occurrenceKey: 'delete-future',
                originalStartAt: new Date('2030-05-01T19:00:00Z'),
                startAt: new Date('2030-05-01T19:00:00Z')
            });
            const completed = await ScheduledOccurrence.create({
                schedule: schedule._id,
                netProfile: profile._id,
                occurrenceKey: 'delete-history',
                originalStartAt: new Date('2029-05-01T19:00:00Z'),
                startAt: new Date('2029-05-01T19:00:00Z'),
                status: 'completed',
                completedAt: new Date('2029-05-01T20:00:00Z')
            });

            assert.equal(await delNet({ upid: OWNER, npid: profile._id }), 'Last net owner, netprofile hard-deleted');
            assert.equal(await NetProfile.findById(profile._id), null);
            assert.equal(await NetSchedule.exists({ netProfile: profile._id, enabled: true }), null);
            assert.equal((await NetSchedule.findById(schedule._id)).enabled, false);
            assert.equal((await ScheduledOccurrence.findById(future._id)).status, 'cancelled');
            assert.equal((await ScheduledOccurrence.findById(completed._id)).status, 'completed');
            assert.equal(await ScheduledOccurrence.exists({ netProfile: profile._id, status: 'scheduled' }), null);
            const publicResult = await listPublicOccurrences({
                window: 'seven-day',
                timezone: 'UTC',
                start: '2030-04-29',
                now: new Date('2030-04-29T00:00:00Z')
            });
            assert.ok(!publicResult.occurrences.some(item => String(item.netProfileId) === String(profile._id)));
        });

        await t.test('recurring materialization remains horizon-bounded and idempotent', async () => {
            const profile = await createProfile();
            const schedule = await NetSchedule.create({
                netProfile: profile._id,
                type: 'weekly',
                timezone: 'UTC',
                localStartTime: '19:00',
                startDate: '2030-01-01',
                weekdays: [1, 2, 3, 4, 5, 6, 7]
            });
            const now = new Date('2030-01-01T12:00:00Z');
            const first = await materializeSchedule({ schedule, now });
            const count = await ScheduledOccurrence.countDocuments({ schedule: schedule._id });
            const second = await materializeSchedule({ schedule, now });
            assert.ok(first.created >= HORIZON_DAYS && first.created <= HORIZON_DAYS + 1);
            assert.equal(count, first.created);
            assert.deepEqual(second, { created: 0, synchronized: 0, removed: 0 });
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
        if (replset) await replset.stop();
    }
});
