/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('dashboard Live Nets cards grow with all connection lines while preserving whole-row interaction', () => {
    const css = read('client/dist/public/css/app-shell.css');
    const dashboard = read('server/dist/views/dashboard.ejs');
    const client = read('client/dist/public/js/byView/dashboard/main.js');

    assert.match(css, /\.landing-page \.landing-live-panel \.net-card\s*\{[^}]*min-height:\s*4\.45rem;[^}]*height:\s*auto;/s);
    assert.match(client, /netFreqElem\.innerText = formatConnectionLines\(liveNet\)\.join\('\\n'\)/);
    assert.match(dashboard, /id="netTemplate"[\s\S]*id="frequency"[\s\S]*landing-live-net-status/);
    assert.match(client, /event\.target\.closest\('\.liveNetRow'\)[\s\S]*window\.location\.assign\(row\.dataset\.href\)/);
    assert.match(client, /event\.target === row[\s\S]*event\.key === 'Enter'[\s\S]*event\.key === ' '/);
    assert.match(css, /@media \(min-width: 992px\)[\s\S]*\.landing-page \.landing-live-panel \.net-card\s*\{/);
});
