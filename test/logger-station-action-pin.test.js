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
    assert.match(source, /event\.key === "Escape" && pinnedActionCall[\s\S]*clearPinnedStationAction\(pinnedActionCall\)/);
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

test('phone station actions use a dedicated operator-only touch toggle', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    assert.match(source, /function stationActionToggle\(station, call\)[\s\S]*currentLayoutContext\.startsWith\("phone"\)[\s\S]*\["netcontrol", "netlogger", "netrelay"\]\.includes\(currentUserRole\)/);
    assert.match(source, /if \(!touchActions \|\| station\.checkedState !== true\) return ""/);
    assert.match(source, /data-station-actions=/);
    assert.match(source, /const stationActionButton = event\.target\.closest\?\.\("\[data-station-actions\]"\)/);
    assert.doesNotMatch(source, /if \(clickedRow && !clickedInteractive && touchStationActions\) \{\s*const call = normalizeCall\(clickedRow\.dataset\.call\);\s*pinnedActionCall = pinnedActionCall === call/);
});

test('phone station actions render in one visual-viewport modal with complete dismissal', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    const css = read('client/dist/public/css/nco-logger.css');
    assert.match(source, /data-role="station-action-modal" hidden/);
    assert.match(source, /function syncStationActionModal\(\)[\s\S]*modal\.innerHTML = `<div class="nch-station-action-backdrop" data-close-station-actions[\s\S]*class="nch-station-action-panel"[\s\S]*role="dialog" aria-modal="true"/);
    assert.match(source, /class="nch-tray-close" data-close-station-actions aria-label="Close station actions"/);
    assert.match(source, /event\.target\.closest\?\.\("\[data-close-station-actions\]"\)[\s\S]*clearPinnedStationAction\(call\)/);
    assert.match(source, /const stationActionModal = target\.closest\("\[data-role='station-action-modal'\]"\)[\s\S]*clearPinnedStationAction\(pinnedActionCall\)/);
    assert.match(source, /pinnedActionCall = pinnedActionCall === call \? "" : call;\s*syncStationActionModal\(\);/);
    assert.doesNotMatch(source.match(/if \(stationActionButton && touchStationActions\) \{[\s\S]*?return;\s*\}/)?.[0] || '', /renderQueue/);
    assert.doesNotMatch(source.match(/function syncStationActionModal\(\) \{[\s\S]*?\n  \}/)?.[0] || '', /scrollTop|scrollIntoView/);
    assert.match(source, /const viewport = window\.visualViewport;[\s\S]*viewport\?\.offsetLeft[\s\S]*viewport\?\.offsetTop[\s\S]*viewport\?\.width[\s\S]*viewport\?\.height/);
    assert.match(source, /window\.visualViewport\?\.addEventListener\("scroll", positionStationActionModal\)/);
    assert.match(css, /\.nch-station-action-modal\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*2147483000[^}]*place-items:\s*center[^}]*safe-area-inset/s);
    assert.match(css, /\.nch-station-action-panel\s*\{[^}]*width:\s*min\(34rem, 100%\)[^}]*max-height:\s*100%[^}]*overflow:\s*hidden/s);
});

test('phone module resize handles are absent and every resize path is guarded', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    const css = read('client/dist/public/css/nco-logger.css');
    assert.match(source, /function syncModuleResizeAvailability\(\)[\s\S]*const enabled = !currentLayoutContext\.startsWith\("phone"\)[\s\S]*handle\.hidden = !enabled[\s\S]*handle\.tabIndex = enabled \? 0 : -1/);
    assert.match(source, /function resizeModuleBy\([^)]*\) \{\s*if \(currentLayoutContext\.startsWith\("phone"\)/);
    assert.match(source, /if \(moduleResizer && !currentLayoutContext\.startsWith\("phone"\)\)/);
    assert.match(source, /if \(!id \|\| currentLayoutContext\.startsWith\("phone"\)\) return/);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-resize-zone\s*\{[^}]*display:\s*none !important[^}]*pointer-events:\s*none !important/s);
    assert.match(css, /#netcontrol-ncs-helper \.nch-resize-zone\s*\{[^}]*display:\s*block/s);
    assert.match(source, /handle\.tabIndex = enabled \? 0 : -1/);
});
