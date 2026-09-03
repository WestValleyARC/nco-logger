/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(
    __dirname, '../client/src/public/js/byView/liveNet/ncoLogger.js'
), 'utf8');

test('successful handoff immediately keeps the former NCO open in Logger mode', () => {
    const transition = source.match(
        /if \(desiredRole === "netcontrol"\) \{[\s\S]*?\n    \}\n    return true;/
    )?.[0] || '';

    assert.match(transition, /currentUserRole = "netlogger";/);
    assert.match(transition, /stationCall === ownCall[^\n]*role: "netlogger", level: 1/);
    assert.match(transition, /stationCall === call[^\n]*role: "netcontrol", level: 0/);
    assert.match(transition, /applyRoleUi\(\);/);
    assert.match(transition, /renderQueue\(\);/);
    assert.match(transition, /startSync\(\);/);
    assert.doesNotMatch(transition, /panel\?\.remove|panel = null|restoreNativeChat|unlockBackgroundScroll/);
});

test('Logger mode retains manager UI while hiding NCO-only controls', () => {
    assert.match(source, /const canManageStations = \(\) => \["netcontrol", "netlogger"\]\.includes\(currentUserRole\);/);
    assert.match(source, /if \(closeButton\) closeButton\.hidden = !isNcoUser\(\);/);
    assert.match(source, /currentUserRole === "netlogger"[^\n]*\["i", "o", "ui", "io", "r"\]/);
});
