/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    plainTextDescription,
    publicOccurrenceResponse
} = require('../server/dist/lib/scheduling/publicSchedule');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('public schedule descriptions become safe human-readable plain text', () => {
    const cases = [
        ['<p>West Valley ARC daily Morning Call-in Net.</p>', 'West Valley ARC daily Morning Call-in Net.'],
        ['WVARC &amp; TTE', 'WVARC & TTE'],
        ['Copyright &copy; &mdash; &#39;quoted&#39; &quot;net&quot;', 'Copyright © — \'quoted\' "net"'],
        ['<div>Morning <strong>Call-in <em>Net</em></strong></div><p>All welcome.</p>', 'Morning Call-in Net\nAll welcome.'],
        ['<script>alert("unsafe")</script><style>body{display:none}</style><p>Safe net</p><img src=x onerror=alert(1)>', 'Safe net'],
        ['&lt;script&gt;alert("encoded")&lt;/script&gt;<p>Still safe</p>', 'Still safe'],
        ['Ordinary plain text: 2 < 3 & 4 > 1.', 'Ordinary plain text: 2 < 3 & 4 > 1.'],
        ['Café — 日本語 📻', 'Café — 日本語 📻']
    ];
    for (const [stored, expected] of cases) assert.equal(plainTextDescription(stored), expected);

    const response = publicOccurrenceResponse({
        _id: 'occurrence',
        netProfile: {
            _id: 'profile', title: 'Morning Net', notes: '<p>WVARC &amp; TTE</p>',
            frequency: '', mode: '', modeDetails: '', connections: []
        },
        startAt: new Date('2030-01-01T00:00:00.000Z')
    });
    assert.equal(response.description, 'WVARC & TTE');

    const dashboardClient = read('client/dist/public/js/byView/dashboard/main.js');
    const scheduleClient = read('client/dist/public/js/byView/netSchedule/main.js');
    assert.match(dashboardClient, /description\.textContent = occurrence\.description/);
    assert.match(scheduleClient, /description\.textContent = occurrence\.description/);
    assert.doesNotMatch(dashboardClient, /description\.innerHTML/);
    assert.doesNotMatch(scheduleClient, /description\.innerHTML/);
});
