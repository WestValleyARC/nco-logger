/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { stripLegacyNameState } = require('../server/dist/lib/legacyStationNameCleanup');

test('legacy server name state is removed while location, tags, and ordering remain intact', () => {
    const state = {
        order: ['K7NNT'],
        details: {
            K7NNT: {
                tags: { mobile: true },
                profile: {
                    name: 'Randy', nameOverride: true, nameOrigin: 'manual',
                    nameOwnerRole: 'netcontrol', nameChangedAt: 123,
                    location: 'Mesa, AZ', locationOverride: true, locationOrigin: 'lookup'
                }
            }
        }
    };
    const result = stripLegacyNameState(state);
    assert.equal(result.changed, true);
    assert.deepEqual(result.affectedCallSigns, ['K7NNT']);
    assert.equal(state.details.K7NNT.profile.name, undefined);
    assert.equal(state.details.K7NNT.profile.nameOverride, undefined);
    assert.equal(state.details.K7NNT.profile.location, 'Mesa, AZ');
    assert.equal(state.details.K7NNT.tags.mobile, true);
    assert.deepEqual(state.order, ['K7NNT']);
});

test('name-only legacy profiles are removed without disturbing station details', () => {
    const state = { details: { W1ABC: { tags: { portable: true }, profile: {
        name: 'Alex', nameOverride: true, nameOrigin: 'lookup'
    } } } };
    stripLegacyNameState(state);
    assert.equal(state.details.W1ABC.profile, undefined);
    assert.equal(state.details.W1ABC.tags.portable, true);
});
