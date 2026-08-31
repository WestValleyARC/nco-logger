/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(
    __dirname, '../client/src/public/js/byView/liveNet/ncoLogger.js'
), 'utf8');

test('browser QRZ profile and photo lookup always uses the authenticated application server', () => {
    assert.match(source, /body: JSON\.stringify\(\{ action: "qrzProfile", callSign: call \}\)/);
    assert.match(source, /fetch\(`\/api\/nco-logger\/\$\{npid\}`/);
    assert.doesNotMatch(source, /fetch\("https:\/\/xmldata\.qrz\.com/);
    assert.doesNotMatch(source, /new DOMParser\(\)/);
    assert.doesNotMatch(source, /async function qrzLogin/);
});

test('legacy personal QRZ credentials are removed from browser storage', () => {
    assert.match(source, /browserStorage\.remove\(legacyQrzUserKey\)/);
    assert.match(source, /browserStorage\.remove\(legacyQrzAuthKey\)/);
    assert.doesNotMatch(source, /qrzPassword\s*=/);
    assert.doesNotMatch(source, /qrzSessionKey\s*=/);
});

test('manual station names are saved through the authenticated server action', () => {
    assert.match(source, /action: "stationName", callSign: normalizeCall\(callSign\), displayName/);
    assert.match(source, /const savedName = await saveStationName\(call, savedDetails\.nameOverride/);
});

test('legacy automatic QRZ names are migrated instead of treated as manual overrides', () => {
    assert.match(source, /if \(field === "name" && origin === "lookup"\) continue/);
    assert.match(source, /Number\(details\?\.qrzNameVersion \|\| 0\) < QRZ_NAME_VERSION/);
});

test('legacy logger-state names are not synchronized after server persistence is available', () => {
    assert.match(source, /const SHARED_PROFILE_FIELDS = \["location"\]/);
    assert.match(source, /if \(field === "name"\) continue/);
});
