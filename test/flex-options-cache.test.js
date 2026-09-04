/* hamlive-oss — MIT License. See LICENSE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { getFlexOptionsByUser } = require('../server/dist/lib/serverUtils');

test('cached global flex options are shared across users and concurrent requests', async () => {
    let reads = 0;
    const globalOptions = { option: { baseTtlMs: 5000 }, toObject() { return { option: this.option }; } };
    const db = {
        model() {
            return {
                async findOne() {
                    reads++;
                    await new Promise(resolve => setTimeout(resolve, 10));
                    return globalOptions;
                }
            };
        }
    };
    const users = Array.from({ length: 20 }, (_, id) => ({ id, flexOptions: { option: {} } }));
    const results = await Promise.all(users.map(user => getFlexOptionsByUser({ user, cachedResponse: true, db })));
    assert.equal(reads, 1);
    assert.ok(results.every(options => options.baseTtlMs === 5000));
});
