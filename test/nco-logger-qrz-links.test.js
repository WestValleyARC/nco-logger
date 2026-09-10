/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const sourcePath = 'client/src/public/js/byView/liveNet/ncoLogger.js';

test('QRZ profile links use normalized, encoded callsigns and safe new-tab attributes', () => {
    const source = read(sourcePath);
    assert.match(source, /function qrzProfileLink\(callSign\)[\s\S]*const call = normalizeCall\(callSign\)/);
    assert.match(source, /href="https:\/\/www\.qrz\.com\/db\/\$\{encodeURIComponent\(call\)\}"/);
    assert.match(source, /target="_blank" rel="noopener noreferrer"/);
    assert.match(source, /const label = `View \$\{call\} on QRZ`[\s\S]*title="\$\{escapeHtml\(label\)\}" aria-label="\$\{escapeHtml\(label\)\}"/);
});

test('QRZ action renders only for active rows', () => {
    const source = read(sourcePath);
    const rowMarkup = source.match(/function stationRow\(station, group\) \{[\s\S]*?\n  \}/)?.[0] || '';
    assert.match(rowMarkup, /const qrzLink = station\.checkedState === true \? qrzProfileLink\(call\) : \"\"/);
    assert.match(rowMarkup, /const callActions = hand \|\| qrzLink/);
    assert.match(rowMarkup, /nch-lurker-row/);
    assert.match(rowMarkup, /nch-checked-out/);
});

test('QRZ is directly below the intact hand control in the station action column', () => {
    const source = read(sourcePath);
    assert.match(source, /const hand = canChangeHand[\s\S]*data-toggle-hand="\$\{escapeHtml\(call\)\}" data-state="\$\{station\.hand \? "true" : "false"\}"/);
    assert.match(source, /const qrzLink = station\.checkedState === true \? qrzProfileLink\(call\) : ""/);
    assert.match(source, /const callActions = hand \|\| qrzLink[\s\S]*nch-hand-slot[\s\S]*\$\{qrzLink\}/);
    for (const action of ['data-row-checkout=', 'data-row-checkin=', 'data-delete=', 'data-add-lurker=', 'data-station-actions=']) {
        assert.match(source, new RegExp(action), `${action} remains available`);
    }
});

test('QRZ clicks cannot trigger row selection or delegated station button actions', () => {
    const source = read(sourcePath);
    assert.match(source, /if \(event\.target\.closest\?\.\("a\.nch-qrz-link"\)\) \{\s*event\.stopPropagation\(\);\s*return;\s*\}[\s\S]*const clickedRow/);
    assert.match(source, /const clickedInteractive = event\.target\.closest\?\.\("button, input, textarea, select, a,/);
    assert.match(source, /touchRowDragCandidate\(target\)[\s\S]*target\.closest\("button, input, select, textarea, a,/);
    assert.match(source, /panel\.addEventListener\("dragstart"[\s\S]*event\.target\.closest\("button, input, select, textarea, a"\)/);
    assert.match(source, /const target = event\.target\.closest\("button"\);\s*if \(!target\) return;/);
});

test('QRZ styling is compact, responsive, and uses theme variables', () => {
    const css = read('client/dist/public/css/nco-logger.css');
    assert.match(css, /\.nch-call-actions\s*\{[^}]*width:\s*17px[^}]*flex-direction:\s*column/s);
    assert.match(css, /\.nch-call-actions\.nch-qrz-only\s*\{[^}]*width:\s*auto[^}]*min-width:\s*0/s);
    assert.match(css, /\.nch-qrz-link\s*\{[^}]*min-height:\s*14px[^}]*var\(--nch-skin-cyan-soft[^}]*touch-action:\s*manipulation/s);
});
