/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const view = read('server/dist/views/myNets.ejs');
const client = read('client/dist/public/js/byView/myNets/main.js');
const css = read('client/dist/public/css/app-shell.css');

test('Scheduling Owner UI Phase 1 uses the existing schedule API contract', async t => {
    await t.test('supports one-time and all recurring schedule types', () => {
        assert.match(view, /value="oneTime">One Time/);
        assert.match(view, /value="weekly">Weekly \/ Multiple Weekdays/);
        assert.match(view, /value="monthlyPosition">Monthly by Position/);
        assert.match(view, /value="monthlyDate">Monthly by Date/);
        assert.match(client, /type:\s*scheduleEditor\.type\.value|const type = scheduleEditor\.type\.value/);
    });

    await t.test('weekly schedules support one or multiple weekdays', () => {
        assert.match(view, /name="schedule_weekday"/);
        assert.match(view, /Monday.*Tuesday.*Wednesday.*Thursday.*Friday.*Saturday.*Sunday/s);
        assert.match(client, /input\[name="schedule_weekday"\]:checked/);
        assert.match(client, /payload\.weekdays\s*=/);
        assert.match(client, /Select at least one weekday/);
    });

    await t.test('monthly position and monthly date use existing fields', () => {
        assert.match(view, /id="schedule_monthly_ordinal"/);
        assert.match(view, /id="schedule_monthly_weekday"/);
        assert.match(view, /id="schedule_monthly_day"[^>]*min="1"[^>]*max="31"/);
        assert.match(client, /payload\.monthlyOrdinal/);
        assert.match(client, /payload\.monthlyWeekday/);
        assert.match(client, /payload\.monthlyDay/);
    });

    await t.test('timezone defaults to the browser and is submitted unchanged', () => {
        assert.match(client, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone \|\| 'UTC'/);
        assert.match(client, /timezone:\s*scheduleEditor\.timezone\.value\.trim\(\)/);
        assert.match(client, /Intl\.supportedValuesOf\('timeZone'\)/);
        assert.doesNotMatch(client, /America\/Phoenix/);
    });

    await t.test('end time is optional and maps to durationMinutes', () => {
        assert.match(view, /id="schedule_end_time"[^>]*type="time"/);
        assert.doesNotMatch(view, /id="schedule_end_time"[^>]*required/);
        assert.match(client, /durationMinutes:\s*durationFromTimes/);
        assert.match(client, /schedule\?\.durationMinutes/);
    });

    await t.test('start values and optional indefinite end date use backend field names', () => {
        assert.match(view, /id="schedule_start_date"[^>]*type="date"/);
        assert.match(view, /id="schedule_start_time"[^>]*type="time"/);
        assert.match(view, /Leave blank to repeat indefinitely/);
        assert.match(client, /localStartTime:\s*scheduleEditor\.startTime\.value/);
        assert.match(client, /startDate:\s*scheduleEditor\.startDate\.value/);
        assert.match(client, /endDate: type === 'oneTime' \? null : scheduleEditor\.endDate\.value \|\| null/);
    });

    await t.test('schedule data loads lazily and populates every recurrence value', () => {
        assert.match(client, /action:\s*\(\) => openScheduleEditor\(netProfile\)/);
        assert.match(client, /axios\.get\(`\/api\/data\/netprofiles\/\$\{netProfile\._id\}\/schedule`\)/);
        for (const field of [
            'type', 'timezone', 'startDate', 'localStartTime', 'durationMinutes', 'endDate',
            'weekdays', 'monthlyOrdinal', 'monthlyWeekday', 'monthlyDay'
        ]) {
            assert.match(client, new RegExp(`schedule\\?\\.${field}|schedule\\.${field}`));
        }
    });

    await t.test('create and edit use existing POST and PATCH endpoints', () => {
        assert.match(client, /axios\.post\(`\/api\/data\/netprofiles\/\$\{id\}\/schedule`, payload\)/);
        assert.match(client, /axios\.patch\(`\/api\/data\/netprofiles\/\$\{id\}\/schedule`, payload\)/);
        assert.match(client, /if \(currentSchedule\)/);
    });

    await t.test('disable requires confirmation and uses existing DELETE endpoint', () => {
        assert.match(view, /id="schedule_disable"[^>]*hidden>Disable Schedule/);
        assert.match(client, /window\.confirm\('Disable this schedule and cancel its future scheduled occurrences\?'\)/);
        assert.match(client, /axios\.delete\(`\/api\/data\/netprofiles\/\$\{scheduleEditor\.profileId\.value\}\/schedule`\)/);
    });

    await t.test('manual unscheduled start behavior remains in place', () => {
        assert.match(client, /if \(!hasSchedule && !hasOperationalSession\)/);
        assert.match(client, /new HttpClient\('livenet', `\/api\/data\/livenets\/\$\{netProfile\._id\}`\)/);
        assert.match(client, /countdownTimer:/);
    });

    await t.test('editor follows existing theme and has a mobile layout', () => {
        assert.match(css, /\.schedule-editor-dialog/);
        assert.match(css, /\.schedule-editor-body/);
        assert.match(css, /\.schedule-weekdays/);
        assert.match(css, /@media \(max-width: 575\.98px\)[\s\S]*\.schedule-editor-actions/);
    });
});
