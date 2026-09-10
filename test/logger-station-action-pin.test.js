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

test('desktop lurker and checked-out rows use inline actions only, without a floating tray', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    assert.match(source, /usesTouchStationInteractions\(\) \|\| station\.checkedState !== true \? "" : stationActionTray\(station, details, call, busy\)/);
    assert.match(source, /function inlineRowActions\(station, call, busy\)[\s\S]*station\.checkedState === false[\s\S]*Checked out actions[\s\S]*station\.checkedState === null[\s\S]*Lurker actions/);
});

test('phone and tablet station actions use the dedicated operator-only touch toggle', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    assert.match(source, /function usesTouchStationInteractions\(\)[\s\S]*currentLayoutContext\.startsWith\("phone"\) \|\| currentLayoutContext\.startsWith\("tablet"\)[\s\S]*\(hover: none\), \(pointer: coarse\)/);
    assert.match(source, /function stationActionToggle\(station, call\)[\s\S]*usesTouchStationInteractions\(\)[\s\S]*\["netcontrol", "netlogger", "netrelay"\]\.includes\(currentUserRole\)/);
    assert.match(source, /if \(!touchActions \|\| \(station\.checkedState !== true && !canManageStations\(\)\)\) return ""/);
    assert.match(source, /data-station-actions=/);
    assert.match(source, /const stationActionButton = event\.target\.closest\?\.\("\[data-station-actions\]"\)/);
    assert.doesNotMatch(source, /if \(clickedRow && !clickedInteractive && touchStationActions\) \{\s*const call = normalizeCall\(clickedRow\.dataset\.call\);\s*pinnedActionCall = pinnedActionCall === call/);
});

test('tablet lurker and checked-out rows are menu-only and do not toggle inline actions', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    const css = read('client/dist/public/css/nco-logger.css');
    assert.match(source, /data-tablet-nonactive=\"true\"/);
    assert.match(source, /clickedRow\?\.dataset\.tabletNonactive === \"true\"[\s\S]*display-only[\s\S]*return/);
    assert.match(source, /stationActionToggle\(station, call\)[\s\S]*station\.checkedState !== true && !canManageStations\(\)/);
    assert.match(source, /stationActionTray\(station, details, call, busy, modal = false\)[\s\S]*if \(manager && !active\)[\s\S]*nch-compact-nonactive-actions/);
    assert.match(css, /\[data-layout-context\^=\"tablet\"\] \[data-tablet-nonactive=\"true\"\] > :not\(\.nch-station-action-toggle\)[^{]*\{[^}]*pointer-events:\s*none !important/s);
    assert.match(css, /\[data-layout-context\^=\"tablet\"\] \[data-tablet-nonactive=\"true\"\] \.nch-station-action-toggle[^{]*\{[^}]*pointer-events:\s*auto !important/s);
});

test('desktop clicks persistently toggle lurker and checked-out actions without replacing hover', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    const css = read('client/dist/public/css/nco-logger.css');
    assert.match(source, /function toggleDesktopInlineActions\(row\)[\s\S]*usesTouchStationInteractions\(\)[\s\S]*!canManageStations\(\)[\s\S]*station\?\.checkedState === true[\s\S]*const closing = pinnedActionCall === call[\s\S]*clearPinnedStationAction\(pinnedActionCall\)[\s\S]*if \(!closing\) pinnedActionCall = call[\s\S]*renderQueue\(\)/);
    assert.match(source, /const clickedInteractive = event\.target\.closest\?\.\("button, input, textarea, select, a, \[contenteditable='true'\], \.nch-drag, \.nch-row-actions"\)/);
    assert.match(source, /if \(clickedRow && !clickedInteractive && touchStationActions\)[\s\S]*if \(clickedRow && !clickedInteractive && toggleDesktopInlineActions\(clickedRow\)\) return;[\s\S]*station\?\.checkedState === true[\s\S]*selectedNextCall = selectedNextCall === call/);
    assert.match(source, /function syncStationActionModal\(\)[\s\S]*const touchInteractions = usesTouchStationInteractions\(\)[\s\S]*if \(!touchInteractions\)\s*\{[\s\S]*modal\.hidden = true[\s\S]*\} else if \(!allowed\)\s*\{[\s\S]*pinnedActionCall = ""/);
    assert.match(css, /:is\(\.nch-row\.nch-checked-out, \.nch-lurker-row\):is\(:hover, :focus-within, \.nch-actions-pinned\) \.nch-row-text\s*\{\s*display:\s*none/);
    assert.match(css, /:is\(\.nch-row\.nch-checked-out, \.nch-lurker-row\):is\(:hover, :focus-within, \.nch-actions-pinned\) \.nch-inline-actions\s*\{\s*display:\s*inline-flex/);
    assert.match(source, /station\.checkedState !== true && usesTouchStationInteractions\(\) && touchInlineActionCall === call \? " nch-touch-actions-open"/);
});

test('tablet active rows reserve the action track and grow only when wrapped tags need it', () => {
    const css = read('client/dist/public/css/nco-logger.css');
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    assert.match(css, /\[data-layout-context\^="tablet"\] \.nch-active-section \.nch-row\s*\{[^}]*grid-template-columns:\s*20px minmax\(112px, 136px\) minmax\(0, 1fr\) 36px/s);
    assert.match(css, /\[data-layout-context="tabletPortrait"\] \.nch-active-section \.nch-row\s*\{[^}]*grid-template-columns:\s*18px minmax\(112px, 128px\) minmax\(0, 1fr\) 36px/s);
    assert.match(css, /:is\(\[data-layout-context\^="phone"\], \[data-layout-context\^="tablet"\]\) \.nch-active-section \.nch-row-text\s*\{[^}]*flex-direction:\s*column[^}]*overflow:\s*visible/s);
    assert.match(css, /:is\(\[data-layout-context\^="phone"\], \[data-layout-context\^="tablet"\]\) \.nch-active-section \.nch-status-tags\s*\{[^}]*max-width:\s*100%[^}]*flex:\s*0 0 auto[^}]*flex-wrap:\s*wrap[^}]*overflow:\s*visible/s);
    assert.doesNotMatch(css.match(/\[data-layout-context\^="tablet"\] \.nch-active-section \.nch-row\s*\{[^}]*\}/s)?.[0] || '', /height:/);
    assert.match(source, /station\.checkedState === true && call === selectedNextCall \? " nch-selected-next"/);
    assert.match(source, /data-station-actions="\$\{escapeHtml\(call\)\}"/);
});

test('tablet portrait reserves unclipped space for representative six-character callsigns', () => {
    const css = read('client/dist/public/css/nco-logger.css');
    const portraitRule = css.match(/\[data-layout-context="tabletPortrait"\] \.nch-active-section \.nch-row\s*\{[^}]*\}/s)?.[0] || '';
    assert.match(portraitRule, /minmax\(112px, 128px\)/);
    assert.match(portraitRule, /minmax\(0, 1fr\) 36px/);
    const usableCallsignWidth = 128 - 2 - 6 - 34 - 17 - (2 * 3);
    assert.equal(usableCallsignWidth, 63, 'KD7NHM and KD8JKK receive a 63px unclipped callsign block');
    assert.match(css, /\.nch-call-block\s*\{[^}]*min-width:\s*0[^}]*flex:\s*1 1 auto/s);
    assert.match(css, /\.nch-row-info[^{]*\{[^}]*min-width:\s*0/s);
});

test('phone and tablet Active Log rows share intentional hold-to-reorder behavior', () => {
    const source = read('client/src/public/js/byView/liveNet/ncoLogger.js');
    assert.match(source, /const TOUCH_ROW_DRAG_HOLD_MS = 360/);
    assert.match(source, /const TOUCH_ROW_DRAG_CANCEL_PX = 12/);
    assert.match(source, /function touchRowDragCandidate\(target\)[\s\S]*usesTouchStationInteractions\(\)[\s\S]*canManageStations\(\)[\s\S]*button, input, select, textarea, a[\s\S]*\[data-role='active'\] \.nch-row\[draggable='true'\]\[data-group='order'\][\s\S]*dataset\.pinned === "true"/);
    assert.match(source, /panel\.addEventListener\("touchstart"[\s\S]*event\.touches\.length !== 1[\s\S]*touchRowDragCandidate\(event\.target\)[\s\S]*setTimeout\(startTouchRowDrag, TOUCH_ROW_DRAG_HOLD_MS\)/);
    assert.match(source, /function updateTouchRowDrag\(event\)[\s\S]*distance >= TOUCH_ROW_DRAG_CANCEL_PX[\s\S]*clearTouchRowDrag\(\)[\s\S]*event\.preventDefault\(\)[\s\S]*elementFromPoint[\s\S]*updateStationDropTarget/);
    assert.match(source, /panel\.addEventListener\("touchmove", updateTouchRowDrag, \{ passive: false \}\)/);
    assert.match(source, /function updateStationDropTarget\(row, clientY\)[\s\S]*const box = row\.getBoundingClientRect\(\)[\s\S]*box\.height \/ 2[\s\S]*nch-drop-after[\s\S]*scrollTop/);
    assert.match(source, /function finishTouchRowDrag\(event, cancelled = false\)[\s\S]*if \(completed\)[\s\S]*suppressStationRowClickUntil = performance\.now\(\) \+ 500[\s\S]*moveDragged\(targetCall, group, after\)/);
    assert.match(source, /suppressedRowClick[\s\S]*performance\.now\(\) < suppressStationRowClickUntil[\s\S]*event\.preventDefault\(\)[\s\S]*return/);
    assert.match(source, /if \(clickedRow && !clickedInteractive && canManageStations\(\)\)[\s\S]*station\?\.checkedState === true[\s\S]*selectedNextCall = selectedNextCall === call \? "" : call/);
    assert.match(source, /panel\.addEventListener\("dragstart"[\s\S]*usesTouchStationInteractions\(\)[\s\S]*event\.preventDefault\(\)[\s\S]*event\.dataTransfer\.effectAllowed = "move"/);
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
    assert.match(source, /const touchInteractions = usesTouchStationInteractions\(\);[\s\S]*const allowed = touchInteractions && Boolean\(station\)[\s\S]*station\.checkedState === true \|\| canManageStations\(\)/);
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

test('module move and resize affordances are visible, directional, and responsively suppressed', () => {
    const css = read('client/dist/public/css/nco-logger.css');
    const source = read('client/dist/public/js/byView/liveNet/ncoLogger.js');
    const lightCss = read('client/dist/public/css/nco-logger-light.css');
    assert.match(css, /\.nch-module-header::after\s*\{[^}]*content:\s*none/s);
    assert.match(css, /\.nch-module-header:is\(:hover, :focus-visible\)::after/);
    assert.match(css, /\.nch-resize-n::after\s*\{[^}]*repeat-x/s);
    assert.match(css, /\.nch-resize-s::after\s*\{[^}]*content:\s*none/s);
    assert.match(css, /:is\(\.nch-resize-e, \.nch-resize-w\)::after\s*\{[^}]*content:\s*none/s);
    assert.match(css, /:is\(\.nch-resize-ne, \.nch-resize-nw, \.nch-resize-se, \.nch-resize-sw\)::after\s*\{[^}]*content:\s*none/s);
    assert.doesNotMatch(css, /\.nch-resize-ne::after,[\s\S]*radial-gradient/);
    assert.match(source, /function moduleResizeZones\(id\) \{[\s\S]*id === \"controls\"[\s\S]*return \"\"/);
    assert.match(css, /\.nch-resize-zone:is\(:hover, :focus-visible, :active\)::after\s*\{[^}]*opacity:\s*1/s);
    assert.match(css, /\.nch-resize-zone\[hidden\]\s*\{[^}]*display:\s*none !important[^}]*pointer-events:\s*none !important/s);
    assert.match(css, /\[data-layout-context\^="phone"\] \.nch-resize-zone\s*\{[^}]*display:\s*none !important[^}]*pointer-events:\s*none !important/s);
    assert.match(css, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.nch-resize-zone\s*\{[^}]*min-width:\s*18px[^}]*min-height:\s*18px/s);
    assert.match(lightCss, /\.nch-module-header::after,[\s\S]*\.nch-resize-zone\s*\{[^}]*color:\s*rgba\(5, 107, 133, \.62\)/s);
});
