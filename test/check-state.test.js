/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkState } = require('../server/dist/lib/sharedNetOps');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function harness({ known = true, checkedState = false, localProfile = null, manualNameOverride = null, saveDelayMs = 0, qrzDelayMs = 0 }) {
    const sourceId = 'source-interaction';
    const targetId = 'target-interaction';
    let persistedState = checkedState;
    let nextId = 0;
    let updateOneCalls = 0;
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
        const created = savedNewStations.find(item => item._id === id);
        if (created) return created;
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

        static async updateOne(filter, update) {
            updateOneCalls++;
            const interaction = interactionFor(filter._id);
            if (!interaction) return { matchedCount: 0 };
            for (const [key, value] of Object.entries(filter)) {
                if (key !== '_id' && (interaction[key] ?? null) !== (value ?? null)) return { matchedCount: 0 };
            }
            const set = Array.isArray(update) ? update[0].$set : update.$set || {};
            for (const [key, value] of Object.entries(set)) {
                if (value?.$cond) {
                    const [condition, accepted] = value.$cond;
                    const expected = condition.$eq[1];
                    if ((interaction[key] ?? null) === expected) interaction[key] = accepted;
                } else {
                    interaction[key] = value;
                }
            }
            return { matchedCount: 1 };
        }
    }

    const models = {
        LiveNet: { findById: async () => liveNet },
        StationInteraction,
        UserProfile: { findOne: async () => localProfile },
        StationNameOverride: { findOne: async () => manualNameOverride ? {
            fields: { name: { value: manualNameOverride, revision: 1, origin: 'manual' } }
        } : null }
    };
    const db = { model: name => models[name] || {} };
    const qrzLookupFn = async () => {
        if (qrzDelayMs) await delay(qrzDelayMs);
        return { result: {
            displayName: 'QRZ Operator', location: 'Phoenix, AZ', photo: 'https://files.qrz.com/q/w1abc/photo.jpg'
        }, atQuota: false, outcome: 'success' };
    };

    return {
        liveNet,
        db,
        qrzLookupFn,
        savedNewStations,
        updateOneCalls: () => updateOneCalls,
        persistedState: () => persistedState
    };
}

async function runCheckState(setup, state, metrics = {}, options = {}) {
    return checkState({
        liveNet: setup.liveNet,
        srcStation: 'N0NCO',
        dstStations: ['W1ABC'],
        state,
        flexOpts: options.flexOpts || {},
        metrics,
        qrzLookupFn: setup.qrzLookupFn,
        deferredTasks: options.deferredTasks,
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

test('ordinary server-profile nickname is ignored and QRZ full name enriches the fast local-profile path', async () => {
    const setup = harness({
        known: false,
        localProfile: { _id: 'user-profile', displayName: 'Randy', localNickname: 'Ran', location: 'Tempe, AZ' }
    });
    let qrzCalls = 0;
    setup.qrzLookupFn = async () => {
        qrzCalls++;
        return { result: { displayName: 'Randy Taylor', location: 'Mesa, AZ' }, atQuota: false, outcome: 'success' };
    };
    const metrics = {};
    const deferredTasks = [];
    await runCheckState(setup, true, metrics, { deferredTasks });

    assert.equal(qrzCalls, 1);
    assert.notEqual(setup.savedNewStations[0].displayName, 'Randy');
    assert.equal(setup.savedNewStations[0].location, 'Tempe, AZ');
    assert.equal(metrics.stations[0].path, 'new-station-local-profile');
    assert.equal(metrics.stations[0].qrzLookupMs, undefined);
    await Promise.all(deferredTasks);
    assert.equal(setup.savedNewStations[0].displayName, 'Randy Taylor');
    assert.equal(setup.savedNewStations[0].location, 'Tempe, AZ');
});

test('persistent manual name is restored immediately in a new net and QRZ cannot replace it', async () => {
    const setup = harness({ known: false, manualNameOverride: 'Randy', qrzDelayMs: 20 });
    const deferredTasks = [];
    await runCheckState(setup, true, {}, { deferredTasks });
    assert.equal(setup.savedNewStations[0].displayName, 'Randy');
    await Promise.all(deferredTasks);
    assert.equal(setup.savedNewStations[0].displayName, 'Randy');
});

test('configured QRZ check-in wait cannot delay station persistence', async () => {
    const setup = harness({ known: false, localProfile: null, qrzDelayMs: 100 });
    const metrics = {};
    const deferredTasks = [];
    const startedAt = performance.now();
    await runCheckState(setup, true, metrics, { flexOpts: { qrzCheckInWaitMs: 5000 }, deferredTasks });

    assert.ok(performance.now() - startedAt < 50);
    assert.equal(setup.savedNewStations[0].displayName, null);
    assert.equal(metrics.stations[0].path, 'new-station-qrz');
    assert.equal(metrics.stations[0].qrzStatus, 'deferred');
    assert.equal(metrics.stations[0].qrzWaitMs, 0);
    await Promise.all(deferredTasks);
    assert.equal(setup.savedNewStations[0].displayName, 'QRZ Operator');
    assert.equal(setup.updateOneCalls(), 1);
});

test('unknown station with slow QRZ logs first and enriches later', async () => {
    const setup = harness({ known: false, localProfile: null, qrzDelayMs: 30 });
    const metrics = {};
    const deferredTasks = [];
    await runCheckState(setup, true, metrics, { flexOpts: { qrzCheckInWaitMs: 5 }, deferredTasks });

    assert.equal(setup.savedNewStations[0].displayName, null);
    assert.equal(metrics.stations[0].qrzStatus, 'deferred');
    assert.equal(metrics.stations[0].qrzLookupMs, undefined);
    await Promise.all(deferredTasks);
    assert.equal(setup.savedNewStations[0].displayName, 'QRZ Operator');
    assert.equal(setup.savedNewStations[0].location, 'Phoenix, AZ');
    assert.equal(setup.savedNewStations[0].photo, 'https://files.qrz.com/q/w1abc/photo.jpg');
    assert.equal(setup.savedNewStations[0].qrzLookupStatus, 'later-success');
});

for (const [label, outcome, expectedStatus] of [
    ['timeout', 'timeout', 'timeout'],
    ['authentication/session expiry', 'auth-session-failure', 'auth-session-failure'],
    ['quota exhaustion', 'quota', 'quota'],
    ['not found', 'not-found', 'not-found'],
    ['network failure', 'network-failure', 'network-failure'],
    ['malformed response', 'malformed-response', 'malformed-response']
]) {
    test(`unknown station logging succeeds despite QRZ ${label}`, async () => {
        const setup = harness({ known: false, localProfile: null });
        setup.qrzLookupFn = async () => ({ result: null, atQuota: outcome === 'quota', outcome });
        const metrics = {};
        const deferredTasks = [];
        const result = await runCheckState(setup, true, metrics, {
            flexOpts: { qrzCheckInWaitMs: 50 }, deferredTasks
        });
        assert.equal(result[0].checkedState, true);
        assert.equal(setup.savedNewStations.length, 1);
        await Promise.all(deferredTasks);
        assert.equal(setup.savedNewStations[0].qrzLookupStatus, expectedStatus);
    });
}

test('deferred QRZ enrichment does not overwrite newer manual NCO or Logger interaction fields', async () => {
    const setup = harness({ known: false, localProfile: null, qrzDelayMs: 20 });
    const deferredTasks = [];
    await runCheckState(setup, true, {}, { deferredTasks });
    setup.savedNewStations[0].displayName = 'Manual Name';
    setup.savedNewStations[0].location = 'Manual Location';
    await Promise.all(deferredTasks);
    assert.equal(setup.savedNewStations[0].displayName, 'Manual Name');
    assert.equal(setup.savedNewStations[0].location, 'Manual Location');
});

test('deferred enrichment does not change a station check-out that happens while QRZ is pending', async () => {
    const setup = harness({ known: false, localProfile: null, qrzDelayMs: 20 });
    const deferredTasks = [];
    await runCheckState(setup, true, {}, { deferredTasks });
    setup.savedNewStations[0].checkedState = false;
    await Promise.all(deferredTasks);
    assert.equal(setup.savedNewStations[0].checkedState, false);
    assert.equal(setup.savedNewStations[0].displayName, 'QRZ Operator');
});

test('parallel check-ins for the same unknown callsign create only one interaction', async () => {
    const setup = harness({ known: false, localProfile: null, qrzDelayMs: 20 });
    const [first, second] = await Promise.all([
        runCheckState(setup, true),
        runCheckState(setup, true)
    ]);
    assert.equal(setup.savedNewStations.length, 1);
    assert.equal(first[0].dupe, false);
    assert.equal(second[0].dupe, true);
});
