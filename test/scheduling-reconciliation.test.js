/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const { materializeSchedule } = require('../server/dist/lib/scheduling/worker');

test('schedule disable and recurrence reconciliation', async t => {
    const uri = process.env.TEST_MONGODB_URI;
    assert.match(uri || '', /scheduling_reconciliation_test/, 'TEST_MONGODB_URI must target the reconciliation test database');
    await mongoose.connect(uri);
    const NetProfile = require('../server/dist/models/netProfile').getNetProfile();
    const NetSchedule = require('../server/dist/models/netSchedule').getNetSchedule();
    const ScheduledOccurrence = require('../server/dist/models/scheduledOccurrence').getScheduledOccurrence();
    const UserProfile = require('../server/dist/models/userProfile').getUserProfile();
    await Promise.all([NetProfile.init(), NetSchedule.init(), ScheduledOccurrence.init(), UserProfile.init()]);
    await Promise.all([
        ScheduledOccurrence.deleteMany({}), NetSchedule.deleteMany({}), NetProfile.deleteMany({}), UserProfile.deleteMany({})
    ]);

    const owner = new UserProfile({
        displayName: 'Schedule Owner', callSign: 'W1OWN', email: 'owner@example.test', lastAuthVia: 'email'
    });
    await owner.save({ validateBeforeSave: false });
    let sequence = 0;
    const now = new Date('2030-01-01T00:00:00.000Z');
    const createData = async (overrides = {}) => {
        const profile = await NetProfile.create({
            title: `Reconciliation Net ${++sequence}`, frequency: '146.520', mode: 'FM', owners: [owner._id]
        });
        const schedule = await NetSchedule.create({
            netProfile: profile._id,
            type: 'weekly',
            timezone: 'UTC',
            localStartTime: '19:00',
            startDate: '2030-01-01',
            weekdays: [2],
            enabled: true,
            ...overrides
        });
        return { profile, schedule };
    };

    const app = express();
    app.use(express.json());
    app.use(async (req, res, next) => {
        req.user = await UserProfile.findById(owner._id);
        res.locals.flexOpts = { maxNetsPerUser: 50, maxOwnersPerNet: 5 };
        next();
    });
    app.use('/api/data/netprofiles', require('../server/dist/routes/dataNetProfileRoutes'));
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/data/netprofiles`;
    const request = async (url, { method = 'GET', body } = {}) => {
        const response = await fetch(`${baseUrl}${url}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
    };
    const scheduleBody = overrides => ({
        type: 'weekly', timezone: 'UTC', localStartTime: '19:00', startDate: '2030-01-01',
        endDate: null, weekdays: [2], enabled: true, ...overrides
    });

    try {
        await t.test('disable tags automatic rows and same-recurrence re-enable restores them idempotently', async () => {
            const { profile, schedule } = await createData();
            await materializeSchedule({ schedule, now });
            const originalCount = await ScheduledOccurrence.countDocuments({ schedule: schedule._id });
            const disabled = await request(`/${profile._id}/schedule`, { method: 'DELETE' });
            assert.equal(disabled.status, 200);
            assert.equal(disabled.body.cancelledOccurrences, originalCount);
            assert.equal(await ScheduledOccurrence.countDocuments({
                schedule: schedule._id, status: 'cancelled', cancellationOrigin: 'schedule-disabled'
            }), originalCount);

            assert.equal((await request(`/${profile._id}/schedule`, {
                method: 'PATCH', body: scheduleBody()
            })).status, 200);
            const current = await NetSchedule.findById(schedule._id);
            await materializeSchedule({ schedule: current, now });
            assert.equal(await ScheduledOccurrence.countDocuments({ schedule: schedule._id, status: 'scheduled' }), originalCount);
            assert.equal(await ScheduledOccurrence.countDocuments({ schedule: schedule._id, cancellationOrigin: 'schedule-disabled' }), 0);
            const repeated = await materializeSchedule({ schedule: current, now });
            assert.deepEqual(repeated, { created: 0, synchronized: 0, removed: 0 });
            assert.equal(await ScheduledOccurrence.countDocuments({ schedule: schedule._id }), originalCount);
        });

        await t.test('disable then weekday change removes obsolete automatic rows and creates only current dates', async () => {
            const { profile, schedule } = await createData();
            await materializeSchedule({ schedule, now });
            await request(`/${profile._id}/schedule`, { method: 'DELETE' });
            await request(`/${profile._id}/schedule`, { method: 'PATCH', body: scheduleBody({ weekdays: [4] }) });
            const current = await NetSchedule.findById(schedule._id);
            const result = await materializeSchedule({ schedule: current, now });
            assert.ok(result.created > 0);
            assert.ok(result.removed > 0);
            assert.equal(await ScheduledOccurrence.countDocuments({
                schedule: schedule._id, cancellationOrigin: 'schedule-disabled'
            }), 0);
            const occurrences = await ScheduledOccurrence.find({ schedule: schedule._id });
            assert.ok(occurrences.length > 0);
            assert.ok(occurrences.every(item => item.status === 'scheduled' && item.startAt.getUTCDay() === 4));
        });

        await t.test('enabled recurrence and time edits synchronize untouched future rows', async () => {
            const { profile, schedule } = await createData();
            await materializeSchedule({ schedule, now });
            await request(`/${profile._id}/schedule`, {
                method: 'PATCH',
                body: scheduleBody({ weekdays: [4], localStartTime: '20:30', timezone: 'America/Phoenix' })
            });
            const current = await NetSchedule.findById(schedule._id);
            const result = await materializeSchedule({ schedule: current, now });
            assert.ok(result.created > 0);
            assert.ok(result.removed > 0);
            const occurrences = await ScheduledOccurrence.find({ schedule: schedule._id, status: 'scheduled' });
            assert.ok(occurrences.every(item => item.originalStartAt.getTime() === item.startAt.getTime()));
            assert.ok(occurrences.every(item => item.startAt.getUTCHours() === 3 && item.startAt.getUTCMinutes() === 30));
        });

        await t.test('individual cancellation remains authoritative across worker passes', async () => {
            const { profile, schedule } = await createData();
            await materializeSchedule({ schedule, now });
            const occurrence = await ScheduledOccurrence.findOne({ schedule: schedule._id, status: 'scheduled' });
            const cancelled = await request(`/${profile._id}/occurrences/${occurrence._id}`, { method: 'DELETE' });
            assert.equal(cancelled.status, 200);
            assert.equal(cancelled.body.occurrence.cancellationOrigin, 'individual');
            await materializeSchedule({ schedule, now });
            await materializeSchedule({ schedule, now });
            const preserved = await ScheduledOccurrence.findById(occurrence._id);
            assert.equal(preserved.status, 'cancelled');
            assert.equal(preserved.cancellationOrigin, 'individual');
        });

        await t.test('rescheduled override survives disable and returns at its selected time', async () => {
            const { profile, schedule } = await createData();
            await materializeSchedule({ schedule, now });
            const occurrence = await ScheduledOccurrence.findOne({ schedule: schedule._id, status: 'scheduled' });
            const selected = new Date(occurrence.startAt.getTime() + 90 * 60000);
            occurrence.startAt = selected;
            occurrence.isOverride = true;
            await occurrence.save();
            await request(`/${profile._id}/schedule`, { method: 'DELETE' });
            const disabled = await ScheduledOccurrence.findById(occurrence._id);
            assert.equal(disabled.cancellationOrigin, 'schedule-disabled');
            assert.equal(disabled.isOverride, true);
            await request(`/${profile._id}/schedule`, { method: 'PATCH', body: scheduleBody() });
            await materializeSchedule({ schedule: await NetSchedule.findById(schedule._id), now });
            const restored = await ScheduledOccurrence.findById(occurrence._id);
            assert.equal(restored.status, 'scheduled');
            assert.equal(restored.isOverride, true);
            assert.equal(restored.startAt.toISOString(), selected.toISOString());
        });

        await t.test('legacy cancellations and lifecycle/history states remain untouched', async () => {
            const { schedule } = await createData();
            const base = {
                schedule: schedule._id,
                netProfile: schedule.netProfile,
                originalStartAt: new Date('2030-01-08T19:00:00.000Z'),
                startAt: new Date('2030-01-08T19:00:00.000Z'),
                isOverride: false
            };
            const legacy = await ScheduledOccurrence.create({ ...base, occurrenceKey: '2030-01-08', status: 'cancelled' });
            const completed = await ScheduledOccurrence.create({ ...base, occurrenceKey: 'history-completed', status: 'completed' });
            const missed = await ScheduledOccurrence.create({ ...base, occurrenceKey: 'history-missed', status: 'missed' });
            const past = await ScheduledOccurrence.create({
                ...base, occurrenceKey: 'history-past', status: 'scheduled',
                originalStartAt: new Date('2029-12-01T19:00:00.000Z'), startAt: new Date('2029-12-01T19:00:00.000Z')
            });
            await materializeSchedule({ schedule, now });
            assert.equal((await ScheduledOccurrence.findById(legacy._id)).status, 'cancelled');
            assert.equal((await ScheduledOccurrence.findById(legacy._id)).cancellationOrigin, undefined);
            assert.equal((await ScheduledOccurrence.findById(completed._id)).status, 'completed');
            assert.equal((await ScheduledOccurrence.findById(missed._id)).status, 'missed');
            assert.equal((await ScheduledOccurrence.findById(past._id)).status, 'scheduled');
        });

        await t.test('disable still rejects preparing/live and grace period remains 30 minutes', async () => {
            for (const status of ['preparing', 'live']) {
                const { profile, schedule } = await createData();
                await ScheduledOccurrence.create({
                    schedule: schedule._id,
                    netProfile: profile._id,
                    occurrenceKey: `active-${status}`,
                    originalStartAt: new Date('2030-01-02T19:00:00.000Z'),
                    startAt: new Date('2030-01-02T19:00:00.000Z'),
                    status
                });
                const response = await request(`/${profile._id}/schedule`, { method: 'DELETE' });
                assert.equal(response.status, 409);
                assert.equal((await NetSchedule.findById(schedule._id)).enabled, true);
            }
            const lifecycle = fs.readFileSync(path.join(__dirname, '../server/dist/lib/scheduling/lifecycle.js'), 'utf8');
            assert.match(lifecycle, /const GRACE_PERIOD_MS = 30 \* 60 \* 1000;/);
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
});
