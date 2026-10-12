/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const netOps = require('../server/dist/lib/sharedNetOps');
const { sanitizeLoggerState, setCheckedState, lookupQrzProfile } = require('../server/dist/controllers/ncoLoggerController');

test('NCO logger state keeps shared operational fields and excludes private notes', () => {
    const state = sanitizeLoggerState({
        order: ['w1abc', 'W1ABC', 'K7XYZ'],
        checkedOutOrder: [],
        lurkerOrder: [],
        manualOrder: true,
        hiddenCalls: ['k7xyz'],
        selectedNextCall: 'not a call',
        details: {
            w1abc: {
                note: 'private browser note',
                tags: { neededNext: true, mobile: 1, unexpected: true },
                profile: {
                    name: 'Test Operator',
                    nameOverride: true,
                    nameOrigin: 'manual',
                    nameOwnerRole: 'netcontrol',
                    location: 'Stale Location',
                    locationOverride: true,
                    injected: '<script>alert(1)</script>'
                }
            }
        }
    });

    assert.deepEqual(state.order, ['W1ABC', 'K7XYZ']);
    assert.deepEqual(state.hiddenCalls, ['K7XYZ']);
    assert.equal(state.selectedNextCall, '');
    assert.equal(state.manualOrder, true);
    assert.equal(state.details.W1ABC.note, undefined);
    assert.equal(state.details.W1ABC.tags.neededNext, true);
    assert.equal(state.details.W1ABC.tags.mobile, true);
    assert.equal(state.details.W1ABC.tags.unexpected, undefined);
    assert.equal(state.details.W1ABC.profile, undefined);
});

test('logger operational tags reset between live nets without clearing local preferences', async () => {
    const { resetOperationalTagsForLiveNet } = await import('../client/dist/public/js/lib/loggerTags.js');
    const layout = { columns: 3 };
    const previous = {
        liveNetId: 'old-live-net',
        ioCalls: ['W1ABC'],
        recheckCalls: ['W1ABC'],
        sharedUpdatedAt: 123,
        layout,
        details: {
            W1ABC: {
                inOut: true,
                recheck: true,
                mobile: true,
                specialGuest: true,
                note: 'cleared with the new net',
                name: 'Test Operator'
            }
        }
    };

    const next = resetOperationalTagsForLiveNet(previous, 'new-live-net');

    assert.equal(next.liveNetId, 'new-live-net');
    assert.deepEqual(next.ioCalls, []);
    assert.deepEqual(next.recheckCalls, []);
    assert.equal(next.sharedUpdatedAt, 0);
    assert.equal(next.layout, layout);
    assert.deepEqual(next.details.W1ABC, { name: 'Test Operator' });
    assert.equal(resetOperationalTagsForLiveNet(next, 'new-live-net'), next);
});

test('station notes stay within their live occurrence', async () => {
    const { resetOperationalTagsForLiveNet } = await import('../client/dist/public/js/lib/loggerTags.js');
    const state = {
        liveNetId: 'net-1', ioCalls: [], recheckCalls: [],
        details: { W1ABC: { note: 'keep within net-1', name: 'Test Operator', location: 'Phoenix' } }
    };

    assert.equal(resetOperationalTagsForLiveNet(state, 'net-1'), state, 'refresh/reconnect keeps notes');
    assert.equal(resetOperationalTagsForLiveNet(state, ''), state, 'a missing live net id never clears notes');

    const recurring = resetOperationalTagsForLiveNet(state, 'net-2');
    assert.deepEqual(recurring.details.W1ABC, { name: 'Test Operator', location: 'Phoenix' });
    assert.equal(state.details.W1ABC.note, 'keep within net-1', 'input state is not mutated');

    const legacy = resetOperationalTagsForLiveNet({ ioCalls: [], recheckCalls: [], details: { K7XYZ: { note: 'old' } } }, 'net-3');
    assert.deepEqual(legacy.details.K7XYZ, {});
    assert.equal(legacy.liveNetId, 'net-3');
});

test('live occurrence change also discards note drafts and the open note editor', () => {
    const source = fs.readFileSync(path.join(__dirname, '../client/src/public/js/byView/liveNet/ncoLogger.js'), 'utf8');
    assert.match(source, /resetOperationalTagsForLiveNet\(local, liveNetId\);\s*noteDrafts\.clear\(\);\s*editingNoteCall = "";/);
});

for (const label of ['stale shared name', 'stale shared location', 'reconnect snapshot profile']) {
    test(`${label} cannot enter server logger state`, () => {
        const state = sanitizeLoggerState({
            details: { W1ABC: { profile: {
                name: 'Stale Name', nameOverride: true,
                location: 'Stale Location', locationOverride: true
            } } }
        });
        assert.equal(state.details.W1ABC.profile, undefined);
    });
}

test('NCO logger state rejects oversized payloads', () => {
    assert.throws(() => sanitizeLoggerState({ details: { W1ABC: { junk: 'x'.repeat(100001) } } }), /too large/);
});

test('check-state controller returns structured path timing from sharedNetOps', async t => {
    t.mock.method(netOps, 'checkState', async options => {
        options.metrics.totalMs = 12.5;
        options.metrics.stations = [{ callSign: 'W1ABC', path: 'existing-station-check-in', persistenceMs: 4.2 }];
        return [{ callSign: 'W1ABC', checkedState: true, dupe: false }];
    });
    const result = await setCheckedState({
        req: { user: { callSign: 'N0NCO' } },
        res: { locals: { flexOpts: {} } },
        liveNet: { _id: 'live-net' },
        source: { role: 'netcontrol', checkedState: true },
        target: 'W1ABC',
        state: true
    });

    assert.equal(result.stations[0].checkedState, true);
    assert.equal(result.timing.totalMs, 12.5);
    assert.equal(result.timing.stations[0].path, 'existing-station-check-in');
});

test('browser QRZ profile action returns only sanitized server lookup data and status', async () => {
    const result = await lookupQrzProfile({
        target: 'W1ABC',
        flexOpts: { qrzDataReqTimeoutMs: 1000 },
        profileLookupFn: async () => ({
            outcome: 'success', atQuota: false,
            result: {
                callSign: 'W1ABC', displayName: 'Test Operator', location: 'Phoenix, AZ',
                photo: 'https://files.qrz.com/q/w1abc/photo.jpg'
            }
        })
    });

    assert.equal(result.action, 'qrzProfile');
    assert.equal(result.qrzStatus, 'success');
    assert.equal(result.profile.displayName, 'Test Operator');
    assert.equal(result.profile.photo, 'https://files.qrz.com/q/w1abc/photo.jpg');
    assert.equal(result.manualNameOverride, false);
    assert.equal(typeof result.qrzLookupMs, 'number');
    assert.equal(JSON.stringify(result).includes('session'), false);
});
