/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const loadCoordination = () => import(pathToFileURL(
    path.join(root, 'client/dist/public/js/lib/requestCoordination.js')
).href);

test('keyed operation gate rejects rapid duplicate and conflicting check-state actions for one callsign', async () => {
    const { ExclusiveKeyedOperation } = await loadCoordination();
    const gate = new ExclusiveKeyedOperation();

    assert.equal(gate.begin('W1ABC'), true);
    assert.equal(gate.begin('W1ABC'), false);
    assert.equal(gate.isActive('W1ABC'), true);
    assert.equal(gate.begin('K7XYZ'), true);
    gate.end('W1ABC');
    assert.equal(gate.begin('W1ABC'), true);
});

test('refresh coordinator never overlaps requests and coalesces repeated triggers into one trailing request', async () => {
    const { CoalescedAsyncRequest } = await loadCoordination();
    const resolvers = [];
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const coordinator = new CoalescedAsyncRequest(async () => {
        calls++;
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => resolvers.push(resolve));
        active--;
    });

    const first = coordinator.request();
    await Promise.resolve();
    await Promise.resolve();
    coordinator.request();
    coordinator.request();
    assert.equal(calls, 1);
    assert.equal(resolvers.length, 1);

    resolvers.shift()();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls, 2);
    assert.equal(resolvers.length, 1);

    resolvers.shift()();
    await first;
    assert.equal(maxActive, 1);
    assert.equal(calls, 2);
    assert.equal(coordinator.active, false);
});

test('NCO logger routes command and polling refreshes through the coordination helpers', () => {
    const source = fs.readFileSync(
        path.join(root, 'client/src/public/js/byView/liveNet/ncoLogger.js'), 'utf8'
    );

    assert.match(source, /pendingCheckStateCalls\.begin\(pendingCall\)/);
    assert.match(source, /finally\s*\{\s*if \(pendingCallAcquired\) pendingCheckStateCalls\.end\(pendingCall\)/);
    assert.match(source, /scheduleRefresh\(350\)/);
    assert.match(source, /new CoalescedAsyncRequest\(refreshOnce\)/);
    assert.match(source, /setInterval\(\(\) => scheduleRefresh\(\), POLL_MS\)/);
    assert.doesNotMatch(source, /setTimeout\(refresh, 350\)/);
});
