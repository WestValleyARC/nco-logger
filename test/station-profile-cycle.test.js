/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');

test('station profile resolves QRZ lookup after circular module initialization completes', async () => {
    const servicePath = require.resolve('../server/dist/lib/stationProfileService');
    const serverUtilsPath = require.resolve('../server/dist/lib/serverUtils');
    const savedService = require.cache[servicePath];
    const savedUtils = require.cache[serverUtilsPath];
    delete require.cache[servicePath];
    require.cache[serverUtilsPath] = { exports: {} };

    try {
        const stationProfiles = require(servicePath);
        require.cache[serverUtilsPath].exports.qrzLookup = async callSign => ({
            outcome: 'success', result: { callSign, firstName: 'Alex', displayName: 'Nickname Smith' }
        });
        const StationNameOverride = { findOne: async () => null };
        const db = { model: () => StationNameOverride };
        const result = await stationProfiles.lookupStationProfile('w1abc', {}, db);
        assert.equal(result.outcome, 'success');
        assert.equal(result.result.firstName, 'Alex');
    } finally {
        delete require.cache[servicePath];
        delete require.cache[serverUtilsPath];
        if (savedService) require.cache[servicePath] = savedService;
        if (savedUtils) require.cache[serverUtilsPath] = savedUtils;
    }
});
