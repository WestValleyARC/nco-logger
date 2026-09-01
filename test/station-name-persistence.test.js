/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const stationProfiles = require('../server/dist/lib/stationProfileService');
const { getStationProfile, updateStationProfile } = require('../server/dist/controllers/ncoLoggerController');

const clone = value => value == null ? value : structuredClone(value);
const getPath = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const setPath = (object, path, value) => {
    const keys = path.split('.');
    const last = keys.pop();
    const parent = keys.reduce((target, key) => target[key] ||= {}, object);
    parent[last] = clone(value);
};
const unsetPath = (object, path) => {
    const keys = path.split('.');
    const last = keys.pop();
    const parent = keys.reduce((target, key) => target?.[key], object);
    if (parent) delete parent[last];
};

function harness(initialOverride = null) {
    const records = new Map(initialOverride ? [['K7NNT', clone(initialOverride)]] : []);
    const StationNameOverride = {
        async findOne({ callSign }) { return clone(records.get(callSign) || null); },
        async findOneAndUpdate(filter, update, options = {}) {
            let saved = records.get(filter.callSign);
            if (!saved && !options.upsert) return null;
            if (!saved) saved = { callSign: filter.callSign };
            for (const [path, expected] of Object.entries(filter)) {
                if (path !== 'callSign' && getPath(saved, path) !== expected) return null;
            }
            for (const [path, value] of Object.entries(update.$setOnInsert || {})) {
                if (getPath(saved, path) === undefined) setPath(saved, path, value);
            }
            for (const [path, value] of Object.entries(update.$set || {})) setPath(saved, path, value);
            for (const path of Object.keys(update.$unset || {})) unsetPath(saved, path);
            records.set(filter.callSign, saved);
            return clone(saved);
        }
    };
    const interaction = { _id: 'interaction-id', displayName: 'Randy Taylor', location: 'Mesa, AZ' };
    const StationInteractionModel = {
        async findById(id) { return id === interaction._id ? clone(interaction) : null; },
        async updateOne(filter, update) {
            if (filter._id !== interaction._id) return { matchedCount: 0 };
            Object.assign(interaction, update.$set);
            return { matchedCount: 1 };
        }
    };
    const db = { model: name => name === 'StationNameOverride' ? StationNameOverride : {} };
    const liveNet = { lookupTable: new Map([['K7NNT', { stationInteraction: interaction._id }]]) };
    return { records, db, interaction, StationInteractionModel, liveNet };
}

const source = role => ({ role, checkedState: true });
const request = (callSign, fields) => ({ user: { callSign, id: `${callSign}-id` }, body: { fields } });
const update = (setup, role, callSign, fields, extra = {}) => updateStationProfile({
    req: request(callSign, fields), liveNet: setup.liveNet, source: source(role), target: 'K7NNT',
    flexOpts: {}, db: setup.db, StationInteractionModel: setup.StationInteractionModel, ...extra
});
const read = setup => getStationProfile({
    liveNet: setup.liveNet, source: source('netcontrol'), target: 'K7NNT', db: setup.db,
    StationInteractionModel: setup.StationInteractionModel
});

for (const [role, editor] of [['netcontrol', 'N0NCO'], ['netlogger', 'N0LOG']]) {
    test(`${role} can save a server-authoritative name`, async () => {
        const setup = harness();
        const result = await update(setup, role, editor, { name: { value: 'Randy', expectedRevision: 0 } });
        assert.equal(result.fields.name.status, 'accepted');
        assert.equal(result.fields.name.revision, 1);
        assert.equal(result.fields.name.editorCallSign, editor);
        assert.equal(setup.interaction.displayName, 'Randy');
    });

    test(`${role} can save a server-authoritative location`, async () => {
        const setup = harness();
        const result = await update(setup, role, editor, { location: { value: 'Tempe, AZ', expectedRevision: 0 } });
        assert.equal(result.fields.location.status, 'accepted');
        assert.equal(result.fields.location.revision, 1);
        assert.equal(setup.interaction.location, 'Tempe, AZ');
    });
}

for (const order of [['location', 'name'], ['name', 'location']]) {
    test(`independent ${order.join(' then ')} edits from two clients coexist`, async () => {
        const setup = harness();
        const initial = await read(setup);
        const values = { name: 'Randy', location: 'Tempe, AZ' };
        await update(setup, 'netlogger', 'N0LOG', {
            [order[0]]: { value: values[order[0]], expectedRevision: initial.fields[order[0]].revision }
        });
        await update(setup, 'netcontrol', 'N0NCO', {
            [order[1]]: { value: values[order[1]], expectedRevision: initial.fields[order[1]].revision }
        });
        const final = await read(setup);
        assert.equal(final.fields.name.value, 'Randy');
        assert.equal(final.fields.location.value, 'Tempe, AZ');
    });
}

for (const field of ['name', 'location']) {
    test(`a stale same-field ${field} edit conflicts and returns the newer server value`, async () => {
        const setup = harness();
        const firstValue = field === 'name' ? 'Randy' : 'Tempe, AZ';
        const staleValue = field === 'name' ? 'Randall' : 'Phoenix, AZ';
        await update(setup, 'netlogger', 'N0LOG', { [field]: { value: firstValue, expectedRevision: 0 } });
        const stale = await update(setup, 'netcontrol', 'N0NCO', { [field]: { value: staleValue, expectedRevision: 0 } });
        assert.equal(stale.fields[field].status, 'conflict');
        assert.equal(stale.fields[field].value, firstValue);
        assert.equal(stale.fields[field].revision, 1);
    });
}

test('QRZ refresh cannot overwrite a persistent manual override', async () => {
    const setup = harness();
    await update(setup, 'netcontrol', 'N0NCO', { name: { value: 'Randy', expectedRevision: 0 } });
    const refreshed = await stationProfiles.lookupStationProfile('K7NNT', {}, setup.db, async () => ({
        outcome: 'success', result: { displayName: 'Randall Taylor', location: 'Mesa, AZ' }
    }));
    assert.equal(refreshed.result.displayName, 'Randy');
    assert.equal(refreshed.manualNameOverride, true);
});

test('clearing a manual name advances its revision and restores the QRZ full name', async () => {
    const setup = harness();
    await update(setup, 'netcontrol', 'N0NCO', { name: { value: 'Randy', expectedRevision: 0 } });
    const cleared = await update(setup, 'netlogger', 'N0LOG', { name: { value: '', expectedRevision: 1 } }, {
        qrzLookupFn: async () => ({ outcome: 'success', result: { displayName: 'Randy Taylor' } })
    });
    assert.equal(cleared.fields.name.status, 'accepted');
    assert.equal(cleared.fields.name.value, 'Randy Taylor');
    assert.equal(cleared.fields.name.origin, 'qrz');
    assert.equal(cleared.fields.name.revision, 2);
});

test('legacy name records migrate deterministically and remain safe for CAS writes', async () => {
    const setup = harness({ callSign: 'K7NNT', displayName: 'Randy', updatedBy: 'N0OLD' });
    const initial = await read(setup);
    assert.equal(initial.fields.name.value, 'Randy');
    assert.equal(initial.fields.name.revision, 1);
    assert.equal(initial.fields.name.origin, 'manual');
    const changed = await update(setup, 'netlogger', 'N0LOG', { name: { value: 'R.T.', expectedRevision: 1 } });
    assert.equal(changed.fields.name.status, 'accepted');
    assert.equal(changed.fields.name.revision, 2);
});

test('station profile permissions remain limited to checked-in NCO and Logger roles', async () => {
    const setup = harness();
    await assert.rejects(
        update(setup, 'netuser', 'N0USR', { name: { value: 'Nope', expectedRevision: 0 } }),
        /Only a checked-in NCO or Logger/
    );
});
