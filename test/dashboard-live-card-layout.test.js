/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('dashboard Live Nets preview keeps four fixed-height cards and truncates long connection lists', () => {
    const css = read('client/dist/public/css/app-shell.css');
    const dashboard = read('server/dist/views/dashboard.ejs');
    const client = read('client/dist/public/js/byView/dashboard/main.js');

    assert.match(client, /activeNets\.slice\(0, 4\)/);
    assert.match(client, /const connection = formatConnectionLines\(liveNet\)\.join\('\\n'\)/);
    assert.match(client, /netFreqElem\.title = connection/);
    assert.match(css, /\.landing-live-net-frequency\s*\{[^}]*display:\s*-webkit-box;[^}]*-webkit-box-orient:\s*vertical;[^}]*-webkit-line-clamp:\s*2;/s);
    assert.match(css, /@media \(min-width: 992px\)[\s\S]*\.landing-page \.landing-live-panel \.net-card\s*\{[^}]*height:\s*4\.45rem;/s);
    assert.match(dashboard, /id="netTemplate"[\s\S]*id="frequency"[\s\S]*landing-live-net-status/);
    assert.match(client, /event\.target\.closest\('\.liveNetRow'\)[\s\S]*window\.location\.assign\(row\.dataset\.href\)/);
    assert.match(client, /event\.target === row[\s\S]*event\.key === 'Enter'[\s\S]*event\.key === ' '/);
});

test('dashboard Live Nets panel keeps its desktop height without allowing card overflow', () => {
    const css = read('client/dist/public/css/app-shell.css');

    assert.match(
        css,
        /@media \(min-width: 992px\)[\s\S]*\.landing-page \.landing-net-panel\s*\{[^}]*height:\s*26rem;[^}]*min-height:\s*0;/s
    );
});

test('dashboard favorite heart toggles without triggering whole-card navigation', () => {
    const client = read('client/dist/public/js/byView/dashboard/main.js');

    assert.match(
        client,
        /rowCollectionElem\.addEventListener\('click',[\s\S]*event\.target\.closest\('\.landing-net-favorite'\)[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)[\s\S]*favorites\.handler\(\{ target: favorite \}\)[\s\S]*return;[\s\S]*event\.target\.closest\('\.liveNetRow'\)/
    );
});
