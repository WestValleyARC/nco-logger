/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { materializeSchedule } = require('../server/dist/lib/scheduling/worker');
const { createTestDatabase } = require('./helpers/testDatabase');

test('schedule disable and recurrence reconciliation', async t => {
    const testDatabase = await createTestDatabase({ databaseName: 'scheduling_reconciliation_test', replicaSet: true });
    await mongoose.connect(testDatabase.uri);
    const NetProfile = require('../server/dist/models/netProfile').getNetProfile();
    const NetSchedule = require('../server/dist/models/netSchedule').getNetSchedule();
    const ScheduledOccurrence = require('../server/dist/models/scheduledOccurrence').getScheduledOccurrence();
    const UserProfile = require('../server/dist/models/userProfile').getUserProfile();
    const LiveNet = require('../server/dist/models/liveNet').getLiveNet();
    await Promise.all([NetProfile.init(), NetSchedule.init(), ScheduledOccurrence.init(), UserProfile.init(), LiveNet.init()]);
    await Promise.all([
        LiveNet.deleteMany({}), ScheduledOccurrence.deleteMany({}), NetSchedule.deleteMany({}),
        NetProfile.deleteMany({}), UserProfile.deleteMany({})
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
        await t.test('browser PATCH immediately reconciles repeated enabled edits and disable-edit-re-enable', async () => {
            const baselineNow = new Date();
            const localToday = DateTime.fromJSDate(baselineNow, { zone: 'UTC' }).startOf('day');
            const initialDay = localToday.plus({ days: 1 });
            const changedDay = localToday.plus({ days: 2 });
            const secondChangedDay = localToday.plus({ days: 3 });
            const { profile, schedule } = await createData({
                startDate: localToday.toFormat('yyyy-MM-dd'),
                weekdays: [initialDay.weekday]
            });
            await materializeSchedule({ schedule, now: baselineNow });

            const initialOccurrences = await ScheduledOccurrence.find({
                schedule: schedule._id, status: 'scheduled'
            }).sort({ startAt: 1 });
            assert.ok(initialOccurrences.length >= 3);

            const individualCancellation = initialOccurrences[0];
            individualCancellation.status = 'cancelled';
            individualCancellation.cancelledAt = baselineNow;
            individualCancellation.cancelledBy = owner._id;
            individualCancellation.cancellationOrigin = 'individual';
            await individualCancellation.save();

            const explicitOverride = initialOccurrences[1];
            const overrideStart = new Date(explicitOverride.startAt.getTime() + 45 * 60000);
            explicitOverride.startAt = overrideStart;
            explicitOverride.isOverride = true;
            await explicitOverride.save();

            const protectedRows = await ScheduledOccurrence.create([
                ['completed', 4], ['missed', 5], ['preparing', 6], ['live', 7]
            ].map(([status, days]) => ({
                schedule: schedule._id,
                netProfile: profile._id,
                occurrenceKey: `protected-${status}`,
                originalStartAt: localToday.plus({ days, hours: 12 }).toJSDate(),
                startAt: localToday.plus({ days, hours: 12 }).toJSDate(),
                status
            })));
            const pastScheduled = await ScheduledOccurrence.create({
                schedule: schedule._id,
                netProfile: profile._id,
                occurrenceKey: 'protected-past',
                originalStartAt: localToday.minus({ days: 1 }).toJSDate(),
                startAt: localToday.minus({ days: 1 }).toJSDate(),
                status: 'scheduled'
            });

            const assertAutomaticSchedule = async ({ weekdays, localStartTime }) => {
                const rows = await ScheduledOccurrence.find({
                    schedule: schedule._id,
                    status: 'scheduled',
                    isOverride: false,
                    startAt: { $gt: new Date() }
                });
                assert.ok(rows.length > 0);
                assert.ok(rows.every(row => weekdays.includes(DateTime.fromJSDate(row.startAt, { zone: 'UTC' }).weekday)));
                assert.ok(rows.every(row => DateTime.fromJSDate(row.startAt, { zone: 'UTC' }).toFormat('HH:mm') === localStartTime));
            };
            const patchSchedule = async overrides => request(`/${profile._id}/schedule`, {
                method: 'PATCH',
                body: scheduleBody({
                    startDate: localToday.toFormat('yyyy-MM-dd'),
                    ...overrides
                })
            });

            const weekdayEdit = await patchSchedule({ weekdays: [changedDay.weekday] });
            assert.equal(weekdayEdit.status, 200);
            assert.deepEqual(weekdayEdit.body.schedule.weekdays, [changedDay.weekday]);
            assert.deepEqual((await NetSchedule.findById(schedule._id)).weekdays, [changedDay.weekday]);
            await assertAutomaticSchedule({ weekdays: [changedDay.weekday], localStartTime: '19:00' });

            const timeEdit = await patchSchedule({ weekdays: [changedDay.weekday], localStartTime: '20:30' });
            assert.equal(timeEdit.body.schedule.localStartTime, '20:30');
            await assertAutomaticSchedule({ weekdays: [changedDay.weekday], localStartTime: '20:30' });

            const combinedEdit = await patchSchedule({ weekdays: [secondChangedDay.weekday], localStartTime: '21:15' });
            assert.deepEqual(combinedEdit.body.schedule.weekdays, [secondChangedDay.weekday]);
            assert.equal(combinedEdit.body.schedule.localStartTime, '21:15');
            await assertAutomaticSchedule({ weekdays: [secondChangedDay.weekday], localStartTime: '21:15' });

            const secondEnabledEdit = await patchSchedule({ weekdays: [changedDay.weekday], localStartTime: '22:00' });
            assert.equal(secondEnabledEdit.status, 200);
            await assertAutomaticSchedule({ weekdays: [changedDay.weekday], localStartTime: '22:00' });
            for (const protectedRow of protectedRows) {
                assert.equal((await ScheduledOccurrence.findById(protectedRow._id)).status, protectedRow.status);
            }

            await ScheduledOccurrence.deleteMany({ _id: { $in: protectedRows.slice(2).map(row => row._id) } });
            assert.equal((await request(`/${profile._id}/schedule`, { method: 'DELETE' })).status, 200);
            const reenabled = await patchSchedule({ weekdays: [secondChangedDay.weekday], localStartTime: '18:45' });
            assert.equal(reenabled.status, 200);
            assert.equal(reenabled.body.schedule.enabled, true);
            await assertAutomaticSchedule({ weekdays: [secondChangedDay.weekday], localStartTime: '18:45' });

            const persisted = await NetSchedule.findById(schedule._id);
            assert.deepEqual(persisted.weekdays, [secondChangedDay.weekday]);
            assert.equal(persisted.localStartTime, '18:45');
            assert.equal((await ScheduledOccurrence.findById(individualCancellation._id)).cancellationOrigin, 'individual');
            assert.equal((await ScheduledOccurrence.findById(individualCancellation._id)).status, 'cancelled');
            assert.equal((await ScheduledOccurrence.findById(explicitOverride._id)).isOverride, true);
            assert.equal((await ScheduledOccurrence.findById(explicitOverride._id)).startAt.toISOString(), overrideStart.toISOString());
            for (const protectedRow of protectedRows.slice(0, 2)) {
                assert.equal((await ScheduledOccurrence.findById(protectedRow._id)).status, protectedRow.status);
            }
            assert.equal((await ScheduledOccurrence.findById(pastScheduled._id)).status, 'scheduled');

            const allRows = await ScheduledOccurrence.find({ schedule: schedule._id });
            assert.equal(new Set(allRows.map(row => row.occurrenceKey)).size, allRows.length);
            assert.equal(await LiveNet.countDocuments({ occurrence: { $in: allRows.map(row => row._id) } }), 0);

            const browserSchedule = await request(`/${profile._id}/schedule`);
            assert.deepEqual(browserSchedule.body.schedule.weekdays, [secondChangedDay.weekday]);
            assert.equal(browserSchedule.body.schedule.localStartTime, '18:45');
            const browserOccurrences = await request(
                `/${profile._id}/occurrences?from=${encodeURIComponent(baselineNow.toISOString())}` +
                `&to=${encodeURIComponent(localToday.plus({ days: 90 }).toISO())}&limit=200`
            );
            assert.equal(browserOccurrences.status, 200);
            assert.ok(browserOccurrences.body.occurrences.some(occurrence =>
                occurrence.status === 'scheduled' && !occurrence.isOverride &&
                DateTime.fromISO(occurrence.startAt, { zone: 'UTC' }).weekday === secondChangedDay.weekday &&
                DateTime.fromISO(occurrence.startAt, { zone: 'UTC' }).toFormat('HH:mm') === '18:45'
            ));
        });

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
            assert.equal(result.removed, 0);
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
            assert.equal(result.removed, 0);
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
        await testDatabase.cleanup();
    }
});
