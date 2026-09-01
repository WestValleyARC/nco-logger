const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');

const OWNER = new mongoose.Types.ObjectId();
const OTHER = new mongoose.Types.ObjectId();

test('Phase 2 owner scheduling APIs', async t => {
    const externalUri = process.env.TEST_MONGODB_URI;
    let mongod;
    if (externalUri) assert.match(externalUri, /scheduling_phase2_test/, 'TEST_MONGODB_URI must target the Phase 2 test database');
    if (!externalUri) {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        mongod = await MongoMemoryServer.create();
    }
    await mongoose.connect(externalUri || mongod.getUri());

    const NetProfile = require('../server/dist/models/netProfile').getNetProfile();
    const NetSchedule = require('../server/dist/models/netSchedule').getNetSchedule();
    const ScheduledOccurrence = require('../server/dist/models/scheduledOccurrence').getScheduledOccurrence();
    await Promise.all([NetProfile.init(), NetSchedule.init(), ScheduledOccurrence.init()]);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        const userId = req.get('x-test-user') === 'other' ? OTHER : OWNER;
        req.user = { _id: userId, id: userId.toString(), callSign: userId === OWNER ? 'W1OWN' : 'W1OTH' };
        next();
    });
    app.use('/api/data/netprofiles', require('../server/dist/routes/dataNetProfileRoutes'));
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/data/netprofiles`;

    let sequence = 0;
    const createProfile = async (owners = [OWNER]) => NetProfile.create({
        title: `Schedule Test ${++sequence}`,
        frequency: '146.520',
        mode: 'FM',
        owners,
        permanent: true
    });
    const scheduleBody = overrides => ({
        type: 'weekly',
        timezone: 'America/Phoenix',
        localStartTime: '19:00',
        startDate: '2030-01-01',
        weekdays: [1, 3],
        ...overrides
    });
    const request = async (path, { method = 'GET', body, user = 'owner' } = {}) => {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json', 'x-test-user': user },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
    };
    const createSchedule = async profile => {
        const response = await request(`/${profile._id}/schedule`, { method: 'POST', body: scheduleBody() });
        assert.equal(response.status, 201);
        return NetSchedule.findById(response.body.schedule._id);
    };
    const createOccurrence = (profile, schedule, status = 'scheduled', overrides = {}) =>
        ScheduledOccurrence.create({
            schedule: schedule._id,
            netProfile: profile._id,
            occurrenceKey: overrides.occurrenceKey || `2030-01-${String(++sequence).padStart(2, '0')}`,
            originalStartAt: overrides.originalStartAt || new Date('2030-01-10T02:00:00.000Z'),
            startAt: overrides.startAt || new Date('2030-01-10T02:00:00.000Z'),
            status,
            ...overrides
        });

    try {
        await t.test('owner creates and reads a schedule; non-owner is forbidden', async () => {
            const profile = await createProfile();
            const denied = await request(`/${profile._id}/schedule`, {
                method: 'POST', body: scheduleBody(), user: 'other'
            });
            assert.equal(denied.status, 403);

            const created = await request(`/${profile._id}/schedule`, { method: 'POST', body: scheduleBody() });
            assert.equal(created.status, 201);
            assert.equal(created.body.schedule.netProfile, profile._id.toString());
            assert.equal(created.body.schedule.type, 'weekly');

            const read = await request(`/${profile._id}/schedule`);
            assert.equal(read.status, 200);
            assert.equal(read.body.schedule._id, created.body.schedule._id);
            assert.equal((await request(`/${profile._id}/schedule`, { user: 'other' })).status, 403);
        });

        await t.test('duplicate and concurrent schedule creation are protected by uniqueness', async () => {
            const profile = await createProfile();
            assert.equal((await request(`/${profile._id}/schedule`, { method: 'POST', body: scheduleBody() })).status, 201);
            assert.equal((await request(`/${profile._id}/schedule`, { method: 'POST', body: scheduleBody() })).status, 409);

            const concurrentProfile = await createProfile();
            const results = await Promise.all([
                request(`/${concurrentProfile._id}/schedule`, { method: 'POST', body: scheduleBody() }),
                request(`/${concurrentProfile._id}/schedule`, { method: 'POST', body: scheduleBody() })
            ]);
            assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
        });

        await t.test('owner updates with full validation, type normalization, and protected-field rejection', async () => {
            const profile = await createProfile();
            const schedule = await createSchedule(profile);
            const updated = await request(`/${profile._id}/schedule`, {
                method: 'PATCH',
                body: { type: 'monthlyDate', monthlyDay: 31, localStartTime: '20:15' }
            });
            assert.equal(updated.status, 200);
            assert.equal(updated.body.schedule.type, 'monthlyDate');
            assert.equal(updated.body.schedule.monthlyDay, 31);
            assert.equal(updated.body.schedule.weekdays, undefined);

            const invalid = await request(`/${profile._id}/schedule`, {
                method: 'PATCH', body: { timezone: 'Not/A_Timezone' }
            });
            assert.equal(invalid.status, 400);
            const protectedField = await request(`/${profile._id}/schedule`, {
                method: 'PATCH', body: { netProfile: new mongoose.Types.ObjectId() }
            });
            assert.equal(protectedField.status, 400);
            assert.equal((await NetSchedule.findById(schedule._id)).netProfile.toString(), profile._id.toString());
        });

        await t.test('schedule disable is transactional, cancels future scheduled items, and preserves history', async () => {
            const profile = await createProfile();
            const schedule = await createSchedule(profile);
            const future = await createOccurrence(profile, schedule, 'scheduled');
            const completed = await createOccurrence(profile, schedule, 'completed');
            const response = await request(`/${profile._id}/schedule`, { method: 'DELETE' });
            assert.equal(response.status, 200);
            assert.equal(response.body.schedule.enabled, false);
            assert.equal((await ScheduledOccurrence.findById(future._id)).status, 'cancelled');
            assert.equal((await ScheduledOccurrence.findById(completed._id)).status, 'completed');
            assert.ok(await NetSchedule.findById(schedule._id));
        });

        await t.test('schedule disable rejects preparing and live occurrences', async () => {
            for (const status of ['preparing', 'live']) {
                const profile = await createProfile();
                const schedule = await createSchedule(profile);
                await createOccurrence(profile, schedule, status);
                const response = await request(`/${profile._id}/schedule`, { method: 'DELETE' });
                assert.equal(response.status, 409);
                assert.equal((await NetSchedule.findById(schedule._id)).enabled, true);
            }
        });

        await t.test('owner lists bounded chronological occurrences; non-owner and excessive ranges are rejected', async () => {
            const profile = await createProfile();
            const schedule = await createSchedule(profile);
            await createOccurrence(profile, schedule, 'scheduled', {
                occurrenceKey: '2030-01-20',
                originalStartAt: new Date('2030-01-20T02:00:00.000Z'),
                startAt: new Date('2030-01-20T02:00:00.000Z')
            });
            await createOccurrence(profile, schedule, 'scheduled', {
                occurrenceKey: '2030-01-10',
                originalStartAt: new Date('2030-01-10T02:00:00.000Z'),
                startAt: new Date('2030-01-10T02:00:00.000Z')
            });
            const path = `/${profile._id}/occurrences?from=2030-01-01T00:00:00Z&to=2030-02-01T00:00:00Z&limit=10`;
            const listed = await request(path);
            assert.equal(listed.status, 200);
            assert.deepEqual(listed.body.occurrences.map(item => item.occurrenceKey), ['2030-01-10', '2030-01-20']);
            assert.equal((await request(path, { user: 'other' })).status, 403);
            assert.equal((await request(`/${profile._id}/occurrences?from=2030-01-01&to=2032-01-01`)).status, 400);
        });

        await t.test('scheduled occurrence reschedule preserves identity and original time', async () => {
            const profile = await createProfile();
            const schedule = await createSchedule(profile);
            const occurrence = await createOccurrence(profile, schedule, 'scheduled', { occurrenceKey: '2030-03-10' });
            const original = occurrence.originalStartAt.toISOString();
            const response = await request(`/${profile._id}/occurrences/${occurrence._id}`, {
                method: 'PATCH', body: { localDate: '2030-03-11', localStartTime: '18:30' }
            });
            assert.equal(response.status, 200);
            assert.equal(response.body.occurrence.occurrenceKey, '2030-03-10');
            assert.equal(response.body.occurrence.originalStartAt, original);
            assert.equal(response.body.occurrence.startAt, '2030-03-12T01:30:00.000Z');
            assert.equal(response.body.occurrence.isOverride, true);
        });

        await t.test('all non-scheduled occurrence states reject ordinary rescheduling', async () => {
            for (const status of ['preparing', 'live', 'completed', 'cancelled', 'missed']) {
                const profile = await createProfile();
                const schedule = await createSchedule(profile);
                const occurrence = await createOccurrence(profile, schedule, status);
                const response = await request(`/${profile._id}/occurrences/${occurrence._id}`, {
                    method: 'PATCH', body: { localDate: '2030-03-11', localStartTime: '18:30' }
                });
                assert.equal(response.status, 409);
            }
        });

        await t.test('scheduled occurrence cancellation preserves document and records owner metadata', async () => {
            const profile = await createProfile();
            const schedule = await createSchedule(profile);
            const occurrence = await createOccurrence(profile, schedule, 'scheduled', { occurrenceKey: '2030-04-01' });
            const response = await request(`/${profile._id}/occurrences/${occurrence._id}`, { method: 'DELETE' });
            assert.equal(response.status, 200);
            assert.equal(response.body.occurrence.status, 'cancelled');
            assert.equal(response.body.occurrence.occurrenceKey, '2030-04-01');
            assert.equal(response.body.occurrence.cancelledBy, OWNER.toString());
            assert.ok(response.body.occurrence.cancelledAt);
            assert.ok(await ScheduledOccurrence.findById(occurrence._id));
            assert.equal((await request(`/${profile._id}/occurrences/${occurrence._id}`, { method: 'DELETE' })).status, 409);
            assert.equal((await request(`/${profile._id}/occurrences/${occurrence._id}`, {
                method: 'PATCH', body: { localDate: '2030-04-02', localStartTime: '19:00' }
            })).status, 409);
        });

        await t.test('preparing/live occurrences and non-owners cannot use ordinary cancellation', async () => {
            for (const status of ['preparing', 'live']) {
                const profile = await createProfile();
                const schedule = await createSchedule(profile);
                const occurrence = await createOccurrence(profile, schedule, status);
                assert.equal((await request(`/${profile._id}/occurrences/${occurrence._id}`, { method: 'DELETE' })).status, 409);
            }
            const profile = await createProfile();
            const schedule = await createSchedule(profile);
            const occurrence = await createOccurrence(profile, schedule);
            assert.equal((await request(`/${profile._id}/occurrences/${occurrence._id}`, {
                method: 'DELETE', user: 'other'
            })).status, 403);
        });

        await t.test('existing unscheduled NetProfile endpoint still loads normally', async () => {
            const profile = await createProfile();
            const response = await request(`/${profile._id}`);
            assert.equal(response.status, 200);
            assert.equal(response.body._id, profile._id.toString());
            assert.equal(response.body.live, false);
            assert.equal(await NetSchedule.exists({ netProfile: profile._id }), null);
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
        if (mongod) await mongod.stop();
    }
});
