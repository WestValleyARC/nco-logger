/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
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
    assert.equal(state.details.W1ABC.profile.name, 'Test Operator');
    assert.equal(state.details.W1ABC.profile.injected, undefined);
});

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
        qrzLookupFn: async () => ({
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
    assert.equal(typeof result.qrzLookupMs, 'number');
    assert.equal(JSON.stringify(result).includes('session'), false);
});
