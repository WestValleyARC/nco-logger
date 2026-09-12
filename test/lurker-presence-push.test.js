'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('new station presence forces an immediate fresh logger push', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server/dist/lib/controllers/liveNetHelpers.js'), 'utf8');
    assert.match(source, /netDetailsCache\.del\(netProfileId\.toString\(\)\)/);
    assert.match(source, /realtimeClients\.push\(netProfileId\.toString\(\), false\)/);
});
