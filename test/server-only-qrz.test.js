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
