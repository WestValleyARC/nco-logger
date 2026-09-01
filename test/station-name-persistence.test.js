/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
const participant = (setup, values) => stationProfiles.syncParticipantProfile({
    callSign: 'K7NNT', name: values.name, location: values.location,
    editorCallSign: 'K7NNT', editorUserId: 'participant-id', db: setup.db
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

for (const [field, participantValue, correctedValue] of [
    ['name', 'Joke Name', 'Randy Taylor'],
    ['location', 'The Moon', 'Mesa, AZ']
]) {
    for (const [role, editor] of [['netcontrol', 'N0NCO'], ['netlogger', 'N0LOG']]) {
        test(`${role} can correct a participant-entered ${field}`, async () => {
            const setup = harness();
            const entered = await participant(setup, { [field]: participantValue });
            assert.equal(entered.fields[field].origin, 'participant');
            const corrected = await update(setup, role, editor, {
                [field]: { value: correctedValue, expectedRevision: entered.fields[field].revision }
            });
            assert.equal(corrected.fields[field].status, 'accepted');
            assert.equal(corrected.fields[field].origin, 'manual');
            assert.equal(corrected.fields[field].value, correctedValue);
        });
    }
}

test('manager correction survives a fresh server profile load', async () => {
    const setup = harness();
    const entered = await participant(setup, { name: 'Joke Name' });
    await update(setup, 'netcontrol', 'N0NCO', {
        name: { value: 'Randy Taylor', expectedRevision: entered.fields.name.revision }
    });
    const reloaded = await read(setup);
    assert.equal(reloaded.fields.name.value, 'Randy Taylor');
    assert.equal(reloaded.fields.name.origin, 'manual');
});

for (const [field, oldValue, correctedValue] of [
    ['name', 'Joke Name', 'Randy Taylor'],
    ['location', 'The Moon', 'Mesa, AZ']
]) {
    test(`stale participant snapshot cannot restore an old ${field}`, async () => {
        const setup = harness();
        const entered = await participant(setup, { [field]: oldValue });
        await update(setup, 'netlogger', 'N0LOG', {
            [field]: { value: correctedValue, expectedRevision: entered.fields[field].revision }
        });
        const stale = await participant(setup, { [field]: oldValue });
        assert.equal(stale.fields[field].status, 'protected');
        assert.equal(stale.fields[field].value, correctedValue);
    });
}

test('participant reconnect cannot overwrite a newer manager revision', async () => {
    const setup = harness();
    const entered = await participant(setup, { name: 'Old Name', location: 'Old Place' });
    await update(setup, 'netcontrol', 'N0NCO', {
        name: { value: 'Correct Name', expectedRevision: entered.fields.name.revision },
        location: { value: 'Correct Place', expectedRevision: entered.fields.location.revision }
    });
    const reconnect = await participant(setup, { name: 'Old Name', location: 'Old Place' });
    assert.equal(reconnect.fields.name.value, 'Correct Name');
    assert.equal(reconnect.fields.location.value, 'Correct Place');
    assert.equal(reconnect.fields.name.status, 'protected');
    assert.equal(reconnect.fields.location.status, 'protected');
});

test('QRZ cannot overwrite a manager correction made over participant data', async () => {
    const setup = harness();
    const entered = await participant(setup, { name: 'Participant Name' });
    await update(setup, 'netlogger', 'N0LOG', {
        name: { value: 'Correct Name', expectedRevision: entered.fields.name.revision }
    });
    const lookup = await stationProfiles.lookupStationProfile('K7NNT', {}, setup.db, async () => ({
        outcome: 'success', result: { displayName: 'QRZ Name', location: 'QRZ Place' }
    }));
    assert.equal(lookup.result.displayName, 'Correct Name');
});

test('QRZ cannot overwrite current participant-entered data', async () => {
    const setup = harness();
    await participant(setup, { name: 'Participant Name', location: 'Participant Place' });
    const lookup = await stationProfiles.lookupStationProfile('K7NNT', {}, setup.db, async () => ({
        outcome: 'success', result: { displayName: 'QRZ Name', location: 'QRZ Place' }
    }));
    assert.equal(lookup.result.displayName, 'Participant Name');
    assert.equal(lookup.result.location, 'Participant Place');
});

test('participant name update cannot disturb a manager-corrected location revision', async () => {
    const setup = harness();
    const entered = await participant(setup, { name: 'First Name', location: 'Bad Place' });
    const corrected = await update(setup, 'netcontrol', 'N0NCO', {
        location: { value: 'Mesa, AZ', expectedRevision: entered.fields.location.revision }
    });
    const changed = await participant(setup, { name: 'Second Name', location: 'Bad Place' });
    assert.equal(changed.fields.name.value, 'Second Name');
    assert.equal(changed.fields.location.value, 'Mesa, AZ');
    assert.equal(changed.fields.location.revision, corrected.fields.location.revision);
});

test('participant-origin values participate in Unit 4 revision conflicts', async () => {
    const setup = harness();
    await participant(setup, { name: 'Participant Name' });
    const stale = await update(setup, 'netcontrol', 'N0NCO', {
        name: { value: 'Manager Name', expectedRevision: 0 }
    });
    assert.equal(stale.fields.name.status, 'conflict');
    assert.equal(stale.fields.name.origin, 'participant');
    assert.equal(stale.fields.name.value, 'Participant Name');
});

test('legacy participant data acquires a deterministic participant revision', async () => {
    const setup = harness();
    const migrated = await participant(setup, { name: 'Legacy Participant', location: 'Legacy Place' });
    assert.equal(migrated.fields.name.revision, 1);
    assert.equal(migrated.fields.location.revision, 1);
    assert.equal(migrated.fields.name.origin, 'participant');
    assert.equal(migrated.fields.location.origin, 'participant');
});

test('live-net creation and reconnect route participant fields through server revisions', () => {
    const helpers = fs.readFileSync(path.resolve(
        __dirname, '../server/dist/lib/controllers/liveNetHelpers.js'
    ), 'utf8');
    const controller = fs.readFileSync(path.resolve(
        __dirname, '../server/dist/controllers/liveNetController.js'
    ), 'utf8');
    assert.match(helpers, /const updateStationInteraction[\s\S]*syncParticipantProfile[\s\S]*displayName: profile\.fields\.name\.value/);
    assert.match(helpers, /location: profile\.fields\.location\.value/);
    assert.match(controller, /liveNetCreatePost[\s\S]*syncParticipantProfile/);
});
