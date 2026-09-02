/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Net Profile Overhaul Phase 3 view integration', async t => {
    const formatterSource = read('client/dist/public/js/lib/publicSchedule.js');
    const formatter = await import(`data:text/javascript;base64,${Buffer.from(formatterSource).toString('base64')}`);

    await t.test('formats structured, multiple, and repeated connection types as separate lines', () => {
        assert.deepEqual(formatter.formatConnectionLines({
            connections: [
                { type: 'FM', frequency: '146.940', tone: '162.2' },
                { type: 'FM', frequency: '448.200' },
                { type: 'FM', frequency: '146.940', operation: 'Repeater', offset: '-0.600', tone: '100.0' },
                { type: 'FM', frequency: '146.520', operation: 'Simplex', offset: '+0.600', tone: '100.0' },
                { type: 'HF', frequency: '7.268', mode: 'LSB' },
                { type: 'AllStarLink', node: '63916' },
                { type: 'EchoLink', callsign: 'NY7S-4' },
                { type: 'DMR', talkgroup: '3100', colorCode: '1' },
                { type: 'D-STAR', reflector: 'REF001', module: 'C' },
                { type: 'YSF', room: 'America-Link' },
                { type: 'P25', talkgroup: '10200' },
                { type: 'Other', label: 'Web', value: 'example.test' }
            ]
        }), [
            'FM: 146.940 MHz · PL 162.2',
            'FM: 448.200 MHz',
            'FM: 146.940 MHz · -0.600 MHz · PL 100.0',
            'FM: 146.520 MHz · Simplex · PL 100.0',
            'HF: 7.268 MHz · LSB',
            'AllStarLink: 63916',
            'EchoLink: NY7S-4',
            'DMR: TG 3100 · CC 1',
            'D-STAR: REF001 C',
            'YSF: America-Link',
            'P25: TG 10200',
            'Other: Web: example.test'
        ]);
    });

    await t.test('uses legacy fallback only when structured connections are absent', () => {
        assert.deepEqual(
            formatter.formatConnectionLines({ mode: 'Reflector', modeDetails: 'REF030C' }),
            ['Connection: REF030C']
        );
        assert.deepEqual(formatter.formatConnectionLines({
            mode: 'Reflector', modeDetails: 'REF030C', connections: [{ type: 'YSF', room: 'America-Link' }]
        }), ['YSF: America-Link']);
        assert.deepEqual(formatter.formatConnectionLines({ connections: [] }), []);
    });

    await t.test('preserves saved connection array order in shared displays', () => {
        assert.deepEqual(formatter.formatConnectionLines({
            connections: [
                { type: 'AllStarLink', node: '63916' },
                { type: 'FM', frequency: '146.940', operation: 'Repeater', offset: '-0.600' },
                { type: 'EchoLink', callsign: 'NY7S-R' },
                { type: 'HF', frequency: '7.268', mode: 'LSB' }
            ]
        }), [
            'AllStarLink: 63916',
            'FM: 146.940 MHz · -0.600 MHz',
            'EchoLink: NY7S-R',
            'HF: 7.268 MHz · LSB'
        ]);
    });

    await t.test('public schedule and Favorites payloads preserve scheduling data and connections', () => {
        const { publicOccurrenceResponse } = require('../server/dist/lib/scheduling/publicSchedule');
        const { transformNetProfile } = require('../server/dist/lib/controllers/followHelpers');
        const connections = [{ type: 'DMR', talkgroup: '3100' }];
        const startAt = new Date('2030-01-01T19:00:00Z');
        const occurrence = publicOccurrenceResponse({
            _id: 'occurrence', startAt,
            netProfile: { _id: 'profile', title: 'A'.repeat(100), notes: '', frequency: '', mode: 'Reflector', modeDetails: 'DMR', connections }
        });
        assert.deepEqual(occurrence.connections, connections);
        assert.equal(occurrence.startAt, startAt);
        const scheduling = { enabled: true, onAir: false, nextOccurrence: { id: 'occurrence', startAt } };
        const favorite = transformNetProfile({
            id: '507f1f77bcf86cd799439011', title: 'A'.repeat(100), frequency: '', mode: 'Reflector',
            modeDetails: 'DMR', connections, permanent: true, followers: []
        }, scheduling);
        assert.deepEqual(favorite.connections, connections);
        assert.equal(favorite.scheduling, scheduling);
    });

    await t.test('all targeted clients use structured lines and long-name containment', () => {
        for (const file of [
            'client/dist/public/js/byView/myNets/main.js',
            'client/dist/public/js/byView/liveNets/main.js',
            'client/dist/public/js/byView/netSchedule/main.js',
            'client/dist/public/js/byView/netNotRunning/main.js',
            'client/dist/public/js/byView/liveNet/ncoLogger.js',
            'client/dist/public/js/lib/widgets.js'
        ]) assert.match(read(file), /formatConnectionLines/);
        assert.match(read('client/dist/public/css/app-shell.css'), /-webkit-line-clamp:\s*2/);
        assert.match(read('client/dist/public/css/nco-logger.css'), /\.nch-net-title[^}]*text-overflow:\s*ellipsis/);
    });
});
