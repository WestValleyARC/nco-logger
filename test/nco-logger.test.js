/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeLoggerState } = require('../server/dist/controllers/ncoLoggerController');

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
