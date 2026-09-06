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

test('phone and tablet station actions use the dedicated operator-only touch toggle', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    assert.match(source, /function usesTouchStationInteractions\(\)[\s\S]*currentLayoutContext\.startsWith\("phone"\) \|\| currentLayoutContext\.startsWith\("tablet"\)[\s\S]*\(hover: none\), \(pointer: coarse\)/);
    assert.match(source, /function stationActionToggle\(station, call\)[\s\S]*usesTouchStationInteractions\(\)[\s\S]*\["netcontrol", "netlogger", "netrelay"\]\.includes\(currentUserRole\)/);
    assert.match(source, /if \(!touchActions \|\| station\.checkedState !== true\) return ""/);
    assert.match(source, /data-station-actions=/);
    assert.match(source, /const stationActionButton = event\.target\.closest\?\.\("\[data-station-actions\]"\)/);
    assert.doesNotMatch(source, /if \(clickedRow && !clickedInteractive && touchStationActions\) \{\s*const call = normalizeCall\(clickedRow\.dataset\.call\);\s*pinnedActionCall = pinnedActionCall === call/);
});

test('tablet touch rows keep active selection while lurker and checked-out taps reveal inline actions', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    const css = read('client/dist/public/css/nco-logger.css');
    assert.match(source, /if \(clickedRow && !clickedInteractive && touchStationActions\)[\s\S]*station\?\.checkedState !== true[\s\S]*clickedRow\.focus\(\{ preventScroll: true \}\)[\s\S]*if \(clickedRow && !clickedInteractive && canManageStations\(\)\)[\s\S]*station\?\.checkedState === true[\s\S]*selectedNextCall = selectedNextCall === call \? "" : call/);
    assert.match(source, /panel\.addEventListener\("contextmenu"[\s\S]*if \(usesTouchStationInteractions\(\)\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/);
    assert.match(source, /\$\{usesTouchStationInteractions\(\) \? "" : stationActionTray/);
    assert.match(css, /\[data-layout-context="tabletPortrait"\] \.nch-checked-out:not\(:focus-within\) button\.nch-hand-toggle\s*\{[^}]*pointer-events:\s*none/s);
    assert.doesNotMatch(css, /\[data-layout-context="tabletLandscape"\][^{]*nch-hand-toggle\s*\{[^}]*pointer-events:\s*none/s);
});

test('tablet portrait active rows reserve a fixed action track and keep tags ahead of identity text', () => {
    const css = read('client/dist/public/css/nco-logger.css');
    assert.match(css, /\[data-layout-context="tabletPortrait"\] \.nch-active-section \.nch-row\s*\{[^}]*grid-template-columns:\s*18px minmax\(96px, 112px\) minmax\(0, 1fr\) 36px/s);
    assert.match(css, /\[data-layout-context="tabletPortrait"\] \.nch-active-section \.nch-meta\s*\{[^}]*overflow:\s*hidden[^}]*flex:\s*1 1 0/s);
    assert.match(css, /\[data-layout-context="tabletPortrait"\] \.nch-active-section \.nch-status-tags\s*\{[^}]*max-width:\s*none[^}]*flex:\s*0 0 auto[^}]*flex-wrap:\s*nowrap/s);
    assert.doesNotMatch(css, /\[data-layout-context="tabletLandscape"\][^{]*nch-active-section \.nch-row\s*\{[^}]*36px/s);
});

test('phone and tablet station actions render in one visual-viewport modal with complete dismissal', () => {
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
    assert.match(source, /const allowed = usesTouchStationInteractions\(\) && station\?\.checkedState === true/);
    assert.match(css, /\.nch-station-action-modal\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*2147483000[^}]*place-items:\s*center[^}]*safe-area-inset/s);
    assert.match(css, /\.nch-station-action-panel\s*\{[^}]*width:\s*min\(34rem, 100%\)[^}]*max-height:\s*100%[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.nch-station-action-panel \.nch-tray-title\s*\{[^}]*position:\s*sticky[^}]*grid-template-columns:\s*78px minmax\(0, 1fr\) 36px 36px[^}]*gap:\s*6px/s);
    assert.match(css, /\.nch-station-action-panel \.nch-tray-title > :is\(button\.nch-tray-help, button\.nch-tray-close\)\s*\{[^}]*width:\s*36px[^}]*height:\s*36px[^}]*min-width:\s*36px[^}]*min-height:\s*36px[^}]*aspect-ratio:\s*1[^}]*border-radius:\s*50%/s);
    assert.match(css, /@media \(max-width: 400px\)[\s\S]*\.nch-station-action-panel > \.nch-row-actions\.nch-active-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    assert.match(css, /\.nch-station-action-panel :is\(\.nch-management-actions, \.nch-status-actions, \.nch-attention-actions\) > span\s*\{[^}]*repeat\(auto-fit, minmax\(min\(100%, 126px\), 1fr\)\)/s);
    assert.match(css, /\.nch-station-action-panel \.nch-role-actions > span\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s);
    assert.match(css, /button:not\(\.nch-tray-help\):not\(\.nch-tray-close\)\s*\{\s*min-height:\s*44px/s);
    assert.match(css, /:is\(\[data-layout-context\^="phone"\], \[data-layout-context\^="tablet"\]\) button\.nch-station-action-toggle\s*\{[^}]*display:\s*inline-flex[^}]*width:\s*36px[^}]*height:\s*36px/s);
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
