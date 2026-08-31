/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const stationProfiles = require('../server/dist/lib/stationProfileService');
const { setStationName } = require('../server/dist/controllers/ncoLoggerController');

function harness() {
    const overrides = new Map();
    const StationNameOverride = {
        async findOne({ callSign }) { return overrides.get(callSign) || null; },
        async findOneAndUpdate({ callSign }, update) {
            const saved = { callSign, ...update.$set };
            overrides.set(callSign, saved);
            return saved;
        },
        async deleteOne({ callSign }) {
            return { deletedCount: overrides.delete(callSign) ? 1 : 0 };
        }
    };
    const db = { model: name => name === 'StationNameOverride' ? StationNameOverride : {} };
    const interaction = { displayName: 'Randy Taylor' };
    const StationInteractionModel = {
        async updateOne(filter, update) {
            assert.equal(filter._id, 'interaction-id');
            Object.assign(interaction, update.$set);
            return { matchedCount: 1 };
        }
    };
    const liveNet = { lookupTable: new Map([['K7NNT', { stationInteraction: 'interaction-id' }]]) };
    return { overrides, db, interaction, StationInteractionModel, liveNet };
}

const lookupResult = displayName => async () => ({
    outcome: 'success', atQuota: false,
    result: { callSign: 'K7NNT', displayName, location: 'Mesa, AZ' }
});

test('manual NCO name persists on the server and later QRZ refresh cannot overwrite it', async () => {
    const setup = harness();
    const req = { user: { callSign: 'N0NCO' }, body: { displayName: 'Randy' } };
    const saved = await setStationName({
        req, liveNet: setup.liveNet, source: { role: 'netcontrol', checkedState: true }, target: 'K7NNT',
        flexOpts: {}, db: setup.db, StationInteractionModel: setup.StationInteractionModel
    });
    assert.equal(saved.displayName, 'Randy');
    assert.equal(saved.manualNameOverride, true);
    assert.equal(setup.overrides.get('K7NNT').displayName, 'Randy');
    assert.equal(setup.interaction.displayName, 'Randy');

    const refreshed = await stationProfiles.lookupStationProfile(
        'K7NNT', {}, setup.db, lookupResult('Randall Taylor')
    );
    assert.equal(refreshed.result.displayName, 'Randy');
    assert.equal(refreshed.manualNameOverride, true);
});

test('clearing the persistent override restores the QRZ full first-and-last name', async () => {
    const setup = harness();
    await stationProfiles.saveNameOverride({
        callSign: 'K7NNT', displayName: 'Randy', updatedBy: 'N0NCO', db: setup.db
    });
    const cleared = await setStationName({
        req: { user: { callSign: 'N0NCO' }, body: { displayName: '' } },
        liveNet: setup.liveNet, source: { role: 'netcontrol', checkedState: true }, target: 'K7NNT',
        flexOpts: {}, db: setup.db, qrzLookupFn: lookupResult('Randy Taylor'),
        StationInteractionModel: setup.StationInteractionModel
    });
    assert.equal(cleared.displayName, 'Randy Taylor');
    assert.equal(cleared.manualNameOverride, false);
    assert.equal(setup.overrides.has('K7NNT'), false);
    assert.equal(setup.interaction.displayName, 'Randy Taylor');

    const nextLookup = await stationProfiles.lookupStationProfile(
        'K7NNT', {}, setup.db, lookupResult('Randy Taylor')
    );
    assert.equal(nextLookup.result.displayName, 'Randy Taylor');
    assert.equal(nextLookup.manualNameOverride, false);
});
