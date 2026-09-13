/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { getFlexOption } = require('../server/dist/models/flexOptions');

test('global FlexOptions defaults maxNetsPerUser to 20', () => {
    const FlexOption = getFlexOption(undefined);
    const flexOptions = new FlexOption();
    assert.equal(flexOptions.option.maxNetsPerUser, 20);
});
