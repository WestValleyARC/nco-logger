const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { getNetSchedule } = require('../server/dist/models/netSchedule');
const { getScheduledOccurrence } = require('../server/dist/models/scheduledOccurrence');
const { generateOccurrences } = require('../server/dist/lib/scheduling/recurrence');
const { publicOccurrenceResponse } = require('../server/dist/lib/scheduling/publicSchedule');

const baseSchedule = overrides => ({
    type: 'weekly',
    timezone: 'America/Phoenix',
    localStartTime: '19:00',
    startDate: '2030-01-01',
    weekdays: [1],
    ...overrides
});

test('scheduled end time remains optional', async () => {
    const NetSchedule = getNetSchedule();

    const noEnd = new NetSchedule({
        ...baseSchedule(),
        netProfile: new mongoose.Types.ObjectId()
    });
    await noEnd.validate();
    assert.equal(noEnd.durationMinutes, undefined);

    const withEnd = new NetSchedule({
        ...baseSchedule({ durationMinutes: 90 }),
        netProfile: new mongoose.Types.ObjectId()
    });
    await withEnd.validate();
    assert.equal(withEnd.durationMinutes, 90);
});

test('duration is limited to whole minutes from 1 through 1440', async () => {
    const NetSchedule = getNetSchedule();

    for (const durationMinutes of [0, 1.5, 1441]) {
        await assert.rejects(new NetSchedule({
            ...baseSchedule({ durationMinutes }),
            netProfile: new mongoose.Types.ObjectId()
        }).validate());
    }

    for (const durationMinutes of [1, 90, 1440]) {
        const schedule = new NetSchedule({
            ...baseSchedule({ durationMinutes }),
            netProfile: new mongoose.Types.ObjectId()
        });
        await schedule.validate();
        assert.equal(schedule.durationMinutes, durationMinutes);
    }
});

test('occurrence generation snapshots duration without moving start', () => {
    const schedule = {
        type: 'oneTime',
        timezone: 'America/Phoenix',
        localStartTime: '19:00',
        startDate: '2030-01-07'
    };

    const noEnd = generateOccurrences(schedule)[0];
    const withEnd = generateOccurrences({ ...schedule, durationMinutes: 75 })[0];

    assert.equal(noEnd.durationMinutes, undefined);
    assert.equal(withEnd.durationMinutes, 75);
    assert.equal(withEnd.startAt.toISOString(), noEnd.startAt.toISOString());
});

test('occurrence duration snapshot is optional', async () => {
    const ScheduledOccurrence = getScheduledOccurrence();

    const occurrence = new ScheduledOccurrence({
        schedule: new mongoose.Types.ObjectId(),
        netProfile: new mongoose.Types.ObjectId(),
        occurrenceKey: '2030-01-07',
        originalStartAt: new Date('2030-01-08T02:00:00Z'),
        startAt: new Date('2030-01-08T02:00:00Z'),
        durationMinutes: 60
    });

    await occurrence.validate();
    assert.equal(occurrence.durationMinutes, 60);
});

test('public occurrence response includes optional duration', () => {
    const makeOccurrence = durationMinutes => ({
        _id: new mongoose.Types.ObjectId(),
        netProfile: {
            _id: new mongoose.Types.ObjectId(),
            title: 'Test Net',
            notes: '',
            frequency: '146.520',
            mode: 'FM',
            modeDetails: '',
            connections: []
        },
        startAt: new Date('2030-01-08T02:00:00Z'),
        durationMinutes
    });

    assert.equal(publicOccurrenceResponse(makeOccurrence(60)).durationMinutes, 60);
    assert.equal(publicOccurrenceResponse(makeOccurrence()).durationMinutes, undefined);
});
