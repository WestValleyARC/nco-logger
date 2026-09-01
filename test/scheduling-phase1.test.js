const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { generateOccurrences } = require('../server/dist/lib/scheduling/recurrence');
const { getNetSchedule } = require('../server/dist/models/netSchedule');
const { getScheduledOccurrence } = require('../server/dist/models/scheduledOccurrence');

const baseSchedule = overrides => ({
    type: 'weekly',
    timezone: 'America/Phoenix',
    localStartTime: '19:00',
    startDate: '2026-01-01',
    weekdays: [1],
    ...overrides
});

const keys = occurrences => occurrences.map(item => item.occurrenceKey);

test('one-time schedule produces exactly one occurrence', () => {
    const result = generateOccurrences(baseSchedule({ type: 'oneTime', weekdays: undefined, startDate: '2026-01-15' }));
    assert.deepEqual(keys(result), ['2026-01-15']);
    assert.equal(result[0].startAt.toISOString(), '2026-01-16T02:00:00.000Z');
});

test('weekly schedule supports one weekday and includes startDate', () => {
    const result = generateOccurrences(baseSchedule({ startDate: '2026-01-05' }), {
        rangeEndDate: '2026-01-19'
    });
    assert.deepEqual(keys(result), ['2026-01-05', '2026-01-12', '2026-01-19']);
});

test('weekly schedule supports multiple weekdays', () => {
    const result = generateOccurrences(baseSchedule({ startDate: '2026-01-05', weekdays: [1, 3, 5] }), {
        rangeEndDate: '2026-01-11'
    });
    assert.deepEqual(keys(result), ['2026-01-05', '2026-01-07', '2026-01-09']);
});

test('endDate is inclusive and constrains the requested horizon', () => {
    const result = generateOccurrences(baseSchedule({ startDate: '2026-01-05', endDate: '2026-01-12' }), {
        rangeEndDate: '2026-02-28'
    });
    assert.deepEqual(keys(result), ['2026-01-05', '2026-01-12']);
});

test('indefinite schedule is constrained by the requested horizon', () => {
    const result = generateOccurrences(baseSchedule({ startDate: '2026-01-01' }), {
        rangeStartDate: '2026-02-01',
        rangeEndDate: '2026-02-10'
    });
    assert.deepEqual(keys(result), ['2026-02-02', '2026-02-09']);
});

test('monthly position generates first weekday', () => {
    const result = generateOccurrences(baseSchedule({
        type: 'monthlyPosition', weekdays: undefined, startDate: '2026-01-01', monthlyOrdinal: 1, monthlyWeekday: 4
    }), { rangeEndDate: '2026-03-31' });
    assert.deepEqual(keys(result), ['2026-01-01', '2026-02-05', '2026-03-05']);
});

test('monthly position generates third weekday', () => {
    const result = generateOccurrences(baseSchedule({
        type: 'monthlyPosition', weekdays: undefined, monthlyOrdinal: 3, monthlyWeekday: 6
    }), { rangeEndDate: '2026-02-28' });
    assert.deepEqual(keys(result), ['2026-01-17', '2026-02-21']);
});

test('monthly position generates last weekday', () => {
    const result = generateOccurrences(baseSchedule({
        type: 'monthlyPosition', weekdays: undefined, monthlyOrdinal: -1, monthlyWeekday: 1
    }), { rangeEndDate: '2026-02-28' });
    assert.deepEqual(keys(result), ['2026-01-26', '2026-02-23']);
});

test('fifth weekday is generated only in months where it exists', () => {
    const result = generateOccurrences(baseSchedule({
        type: 'monthlyPosition', weekdays: undefined, monthlyOrdinal: 5, monthlyWeekday: 1
    }), { rangeEndDate: '2026-03-31' });
    assert.deepEqual(keys(result), ['2026-03-30']);
});

test('monthly date generates normal dates and clamps missing dates', () => {
    const result = generateOccurrences(baseSchedule({
        type: 'monthlyDate', weekdays: undefined, startDate: '2026-03-01', monthlyDay: 31
    }), { rangeEndDate: '2026-05-31' });
    assert.deepEqual(keys(result), ['2026-03-31', '2026-04-30', '2026-05-31']);
});

test('monthly date clamps February and respects leap years', () => {
    const common = generateOccurrences(baseSchedule({
        type: 'monthlyDate', weekdays: undefined, startDate: '2026-02-01', monthlyDay: 31
    }), { rangeEndDate: '2026-02-28' });
    const leap = generateOccurrences(baseSchedule({
        type: 'monthlyDate', weekdays: undefined, startDate: '2028-02-01', monthlyDay: 31
    }), { rangeEndDate: '2028-02-29' });
    assert.deepEqual(keys(common), ['2026-02-28']);
    assert.deepEqual(keys(leap), ['2028-02-29']);
});

test('America/Phoenix keeps the same local time without DST adjustment', () => {
    const winter = generateOccurrences(baseSchedule({ type: 'oneTime', weekdays: undefined, startDate: '2026-01-15' }))[0];
    const summer = generateOccurrences(baseSchedule({ type: 'oneTime', weekdays: undefined, startDate: '2026-07-15' }))[0];
    assert.equal(winter.startAt.toISOString(), '2026-01-16T02:00:00.000Z');
    assert.equal(summer.startAt.toISOString(), '2026-07-16T02:00:00.000Z');
});

test('spring-forward nonexistent local time shifts forward by the DST gap', () => {
    const occurrence = generateOccurrences(baseSchedule({
        type: 'oneTime', weekdays: undefined, timezone: 'America/New_York',
        localStartTime: '02:30', startDate: '2026-03-08'
    }))[0];
    assert.equal(occurrence.startAt.toISOString(), '2026-03-08T07:30:00.000Z');
});

test('fall-back ambiguous local time uses the earlier instant', () => {
    const occurrence = generateOccurrences(baseSchedule({
        type: 'oneTime', weekdays: undefined, timezone: 'America/New_York',
        localStartTime: '01:30', startDate: '2026-11-01'
    }))[0];
    assert.equal(occurrence.startAt.toISOString(), '2026-11-01T05:30:00.000Z');
});

test('occurrenceKey remains the stable local calendar identity', () => {
    const occurrence = generateOccurrences(baseSchedule({
        type: 'oneTime', weekdays: undefined, timezone: 'Pacific/Auckland',
        localStartTime: '00:15', startDate: '2026-06-10'
    }))[0];
    assert.equal(occurrence.occurrenceKey, '2026-06-10');
    assert.equal(occurrence.localDate, '2026-06-10');
    assert.equal(occurrence.originalStartAt.toISOString(), occurrence.startAt.toISOString());
});

test('NetSchedule rejects invalid timezone and local start time', async () => {
    const NetSchedule = getNetSchedule();
    const netProfile = new mongoose.Types.ObjectId();
    await assert.rejects(
        new NetSchedule({ ...baseSchedule({ timezone: 'Arizona-ish' }), netProfile }).validate(),
        /valid IANA timezone/
    );
    await assert.rejects(
        new NetSchedule({ ...baseSchedule({ localStartTime: '7:00 PM' }), netProfile }).validate(),
        /HH:mm/
    );
});

test('NetSchedule rejects invalid recurrence-specific fields', async () => {
    const NetSchedule = getNetSchedule();
    const netProfile = new mongoose.Types.ObjectId();
    await assert.rejects(
        new NetSchedule({ ...baseSchedule({ weekdays: undefined }), netProfile }).validate(),
        /require at least one weekday/
    );
    await assert.rejects(
        new NetSchedule({ ...baseSchedule({ type: 'oneTime' }), netProfile }).validate(),
        /only valid for weekly/
    );
    await assert.rejects(
        new NetSchedule({
            ...baseSchedule({ type: 'monthlyPosition', weekdays: undefined, monthlyOrdinal: 1 }), netProfile
        }).validate(),
        /require monthlyWeekday/
    );
    await assert.rejects(
        new NetSchedule({
            ...baseSchedule({ type: 'monthlyDate', weekdays: undefined, monthlyDay: 32 }), netProfile
        }).validate(),
        /maximum allowed value/
    );
});

test('NetSchedule rejects endDate before startDate', async () => {
    const NetSchedule = getNetSchedule();
    await assert.rejects(
        new NetSchedule({
            ...baseSchedule({ startDate: '2026-02-01', endDate: '2026-01-31' }),
            netProfile: new mongoose.Types.ObjectId()
        }).validate(),
        /on or after startDate/
    );
});

test('database indexes enforce one schedule per profile and unique occurrence keys', async () => {
    const externalUri = process.env.TEST_MONGODB_URI;
    let mongod;
    if (externalUri) assert.match(externalUri, /scheduling_phase1_test/, 'TEST_MONGODB_URI must target the scheduling test database');
    if (!externalUri) {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        mongod = await MongoMemoryServer.create();
    }
    const db = await mongoose.createConnection(externalUri || mongod.getUri()).asPromise();
    try {
        const NetSchedule = getNetSchedule(db);
        const ScheduledOccurrence = getScheduledOccurrence(db);
        await Promise.all([NetSchedule.init(), ScheduledOccurrence.init()]);

        const netProfile = new mongoose.Types.ObjectId();
        const scheduleData = { ...baseSchedule(), netProfile };
        const schedule = await NetSchedule.create(scheduleData);
        await assert.rejects(NetSchedule.create(scheduleData), error => error?.code === 11000);

        const occurrenceData = {
            schedule: schedule._id,
            netProfile,
            occurrenceKey: '2026-01-05',
            originalStartAt: new Date('2026-01-06T02:00:00.000Z'),
            startAt: new Date('2026-01-06T02:00:00.000Z')
        };
        const occurrence = await ScheduledOccurrence.create(occurrenceData);
        assert.equal(occurrence.notification.state, 'pending');
        assert.equal(occurrence.notification.attempts, 0);
        await assert.rejects(ScheduledOccurrence.create(occurrenceData), error => error?.code === 11000);
    } finally {
        await db.dropDatabase();
        await db.close();
        if (mongod) await mongod.stop();
    }
});
