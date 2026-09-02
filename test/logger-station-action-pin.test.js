const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const verifyPinLifecycle = source => {
    assert.match(source, /function clearPinnedStationAction\(call\)[\s\S]*pinnedActionCall = "";[\s\S]*classList\.remove\("nch-has-pinned-actions"\)[\s\S]*classList\.remove\("nch-actions-pinned"\)/);
    assert.match(source, /target\.closest\("\.nch-row-actions, \.nch-inline-actions"\)[\s\S]*clearPinnedStationAction\(stationActionRow\.dataset\.call\)/);
    assert.match(source, /if \(!row \|\| event\.shiftKey \|\| event\.target\.closest/);
    assert.match(source, /pinnedActionCall = pinnedActionCall === call \? "" : call/);
    assert.match(source, /event\.key === "Escape" && pinnedActionCall[\s\S]*pinnedActionCall = "";[\s\S]*renderQueue\(\)/);
};

test('station action selection clears the shared pinned-row state', () => {
    verifyPinLifecycle(read('client/src/public/js/byView/liveNet/ncoLogger.js'));
    verifyPinLifecycle(read('client/dist/public/js/byView/liveNet/ncoLogger.js'));
});

test('shared action trays cover active, checked-out, and lurker station actions', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    assert.match(source, /data-row-checkout=/);
    assert.match(source, /data-row-checkin=/);
    assert.match(source, /data-delete=/);
    assert.match(source, /data-add-lurker=/);
    assert.match(source, /class="nch-inline-actions"/);
    assert.match(source, /class="nch-row-actions nch-active-actions"/);
});
