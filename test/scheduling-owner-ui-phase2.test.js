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

test('Scheduling Owner UI Phase 2 manages occurrences without changing recurrence', async t => {
    await t.test('loads a bounded upcoming occurrence list only when schedule management opens', () => {
        assert.match(view, /id="schedule_occurrences"/);
        assert.match(client, /const openScheduleEditor = async netProfile/);
        assert.match(client, /await loadOccurrences\(netProfile\._id\)/);
        assert.match(client, /\/occurrences\?\$\{query\}/);
        assert.match(client, /limit:\s*'20'/);
        assert.match(client, /90 \* 24 \* 60 \* 60 \* 1000/);
    });

    await t.test('reschedules only one occurrence with the existing API', () => {
        assert.match(client, /axios\.patch\(\s*`\/api\/data\/netprofiles\/\$\{profileId\}\/occurrences\/\$\{occurrence\._id\}`/);
        assert.match(client, /\{ localDate: date\.value, localStartTime: time\.value \}/);
        const handler = client.slice(
            client.indexOf("save.addEventListener('click'"),
            client.indexOf("cancel.addEventListener('click'")
        );
        assert.doesNotMatch(handler, /\/schedule`/);
    });

    await t.test('individual cancellation requires confirmation and uses DELETE', () => {
        assert.match(client, /window\.confirm\('Cancel only this scheduled occurrence\?'\)/);
        assert.match(client, /axios\.delete\(`\/api\/data\/netprofiles\/\$\{profileId\}\/occurrences\/\$\{occurrence\._id\}`\)/);
    });

    await t.test('cancelled and rescheduled occurrences are represented distinctly', () => {
        assert.match(client, /scheduled: occurrence\.isOverride \? 'Rescheduled' : 'Scheduled'/);
        assert.match(client, /cancelled:\s*'Cancelled'/);
        assert.match(client, /is-\$\{occurrence\.status\}\$\{occurrence\.isOverride \? ' is-override' : ''\}/);
        assert.match(css, /\.schedule-occurrence\.is-cancelled/);
        assert.match(css, /\.schedule-occurrence\.is-override/);
    });

    await t.test('Preparing offers confirmed operational cancellation', () => {
        assert.match(client, /else if \(occurrence\.status === 'preparing'\)/);
        assert.match(client, /Cancel Preparation/);
        assert.match(client, /window\.confirm\('Cancel preparation and cancel this scheduled occurrence\?'\)/);
        assert.match(client, /\/occurrences\/\$\{occurrence\._id\}\/cancel-preparation/);
    });

    await t.test('ON AIR is labelled but never receives Cancel Preparation', () => {
        assert.match(client, /live:\s*'ON AIR'/);
        const actionBranch = client.slice(
            client.indexOf("if (occurrence.status === 'scheduled')"),
            client.indexOf('if (actions.childElementCount)')
        );
        assert.match(actionBranch, /else if \(occurrence\.status === 'preparing'\)/);
        assert.doesNotMatch(actionBranch, /occurrence\.status === 'live'/);
    });

    await t.test('one shared timer opens preparation without polling or API traffic', () => {
        assert.match(client, /scheduling\.preparationOpensAt/);
        assert.match(client, /let preparationWindowTimer = null/);
        assert.match(client, /window\.setTimeout\(\s*schedulePreparationWindowUpdate/);
        assert.doesNotMatch(client, /setInterval\(/);
        const timer = client.slice(
            client.indexOf('const schedulePreparationWindowUpdate'),
            client.indexOf('function setNetProfileMode')
        );
        assert.doesNotMatch(timer, /axios\./);
        assert.doesNotMatch(timer, /refreshNetList\(/);
        assert.match(timer, /enablePreparationAction\(target\)/);
        assert.match(client, /scheduling\.nextOccurrence && Number\.isFinite\(opensAt\)/);
        assert.doesNotMatch(client, /Number\.isFinite\(opensAt\) && opensAt > Date\.now\(\)/);
    });

    await t.test('Phase 1 create, edit, and disable schedule flows remain intact', () => {
        assert.match(client, /axios\.post\(`\/api\/data\/netprofiles\/\$\{id\}\/schedule`, payload\)/);
        assert.match(client, /axios\.patch\(`\/api\/data\/netprofiles\/\$\{id\}\/schedule`, payload\)/);
        assert.match(client, /window\.confirm\('Disable this schedule and cancel its future scheduled occurrences\?'\)/);
        assert.match(client, /axios\.delete\(`\/api\/data\/netprofiles\/\$\{scheduleEditor\.profileId\.value\}\/schedule`\)/);
    });

    await t.test('occurrence controls are compact and responsive', () => {
        assert.match(css, /\.schedule-occurrences-list/);
        assert.match(css, /\.schedule-occurrence-editor/);
        assert.match(css, /@media \(max-width: 575\.98px\)[\s\S]*\.schedule-occurrence-editor/);
    });
});
