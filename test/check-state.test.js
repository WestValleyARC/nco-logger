/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkState } = require('../server/dist/lib/sharedNetOps');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function harness({ known = true, checkedState = false, localProfile = null, saveDelayMs = 0, qrzDelayMs = 0 }) {
    const sourceId = 'source-interaction';
    const targetId = 'target-interaction';
    let persistedState = checkedState;
    let nextId = 0;
    const savedNewStations = [];
    const liveNet = {
        _id: 'live-net',
        netProfile: 'net-profile',
        lookupTable: new Map([['N0NCO', { stationInteraction: sourceId }]]),
        async save() { return this; }
    };
    if (known) liveNet.lookupTable.set('W1ABC', { stationInteraction: targetId });

    const interactionFor = id => {
        if (id === sourceId) return { callSign: 'N0NCO', role: 'netcontrol', checkedState: true };
        if (id !== targetId) return null;
        return {
            callSign: 'W1ABC',
            role: 'netuser',
            checkedState: persistedState,
            checkedInAt: null,
            async save() {
                if (saveDelayMs) await delay(saveDelayMs);
                persistedState = this.checkedState;
                return this;
            }
        };
    };

    class StationInteraction {
        constructor(value) {
            Object.assign(this, value);
            this._id = `new-interaction-${++nextId}`;
            this.role = this.role || 'netuser';
        }

        async save() {
            if (saveDelayMs) await delay(saveDelayMs);
            savedNewStations.push(this);
            return this;
        }

        static async findById(id) {
            return interactionFor(id);
        }
    }

    const models = {
        LiveNet: { findById: async () => liveNet },
        StationInteraction,
        UserProfile: { findOne: async () => localProfile }
    };
    const db = { model: name => models[name] || {} };
    const qrzLookupFn = async () => {
        if (qrzDelayMs) await delay(qrzDelayMs);
        return { result: { displayName: 'QRZ Operator', location: 'Phoenix, AZ' }, atQuota: false };
    };

    return {
        liveNet,
        db,
        qrzLookupFn,
        savedNewStations,
        persistedState: () => persistedState
    };
}

async function runCheckState(setup, state, metrics = {}) {
    return checkState({
        liveNet: setup.liveNet,
        srcStation: 'N0NCO',
        dstStations: ['W1ABC'],
        state,
        flexOpts: {},
        metrics,
        qrzLookupFn: setup.qrzLookupFn,
        db: setup.db
    });
}

test('existing-station check-in does not resolve before persistence and an immediate read sees the new state', async () => {
    const setup = harness({ known: true, checkedState: false, saveDelayMs: 30 });
    const metrics = {};
    let resolved = false;
    const pending = runCheckState(setup, true, metrics).then(result => {
        resolved = true;
        return result;
    });

    await delay(5);
    assert.equal(resolved, false);
    assert.equal(setup.persistedState(), false);

    const result = await pending;
    assert.equal(setup.persistedState(), true);
    assert.equal(result[0].checkedState, true);
    assert.equal(metrics.stations[0].path, 'existing-station-check-in');
    assert.ok(metrics.stations[0].persistenceMs >= 20);
    assert.ok(metrics.totalMs >= 20);
});

test('existing-station check-out awaits persistence and reports its path separately', async () => {
    const setup = harness({ known: true, checkedState: true, saveDelayMs: 20 });
    const metrics = {};
    await runCheckState(setup, false, metrics);

    assert.equal(setup.persistedState(), false);
    assert.equal(metrics.stations[0].path, 'existing-station-check-out');
    assert.ok(metrics.stations[0].persistenceMs >= 10);
});

test('new station with a local UserProfile reports the local-profile path without QRZ latency', async () => {
    const setup = harness({
        known: false,
        localProfile: { _id: 'user-profile', displayName: 'Local Operator', location: 'Tempe, AZ' }
    });
    let qrzCalls = 0;
    setup.qrzLookupFn = async () => {
        qrzCalls++;
        return { result: null, atQuota: false };
    };
    const metrics = {};
    await runCheckState(setup, true, metrics);

    assert.equal(qrzCalls, 0);
    assert.equal(setup.savedNewStations[0].displayName, 'Local Operator');
    assert.equal(metrics.stations[0].path, 'new-station-local-profile');
    assert.equal(metrics.stations[0].qrzLookupMs, undefined);
});

test('new station requiring QRZ reports QRZ latency separately', async () => {
    const setup = harness({ known: false, localProfile: null, qrzDelayMs: 25 });
    const metrics = {};
    await runCheckState(setup, true, metrics);

    assert.equal(setup.savedNewStations[0].displayName, 'QRZ Operator');
    assert.equal(metrics.stations[0].path, 'new-station-qrz');
    assert.ok(metrics.stations[0].qrzLookupMs >= 15);
    assert.ok(metrics.totalMs >= metrics.stations[0].qrzLookupMs);
});
