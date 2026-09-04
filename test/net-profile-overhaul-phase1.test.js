/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
    getNetProfile,
    getNetProfileConnections,
    removeLegacyTitleUniqueIndex
} = require('../server/dist/models/netProfile');
const { getNetSchedule } = require('../server/dist/models/netSchedule');
const { createTestDatabase } = require('./helpers/testDatabase');

const OWNER = new mongoose.Types.ObjectId();

test('Net Profile Overhaul Phase 1 model compatibility', async t => {
    const testDatabase = await createTestDatabase({ databaseName: 'net_profile_overhaul_phase1_test' });
    const db = await mongoose.createConnection(testDatabase.uri).asPromise();
    const NetProfile = getNetProfile(db);
    const NetSchedule = getNetSchedule(db);
    await Promise.all([NetProfile.init(), NetSchedule.init()]);
    await Promise.all([NetProfile.deleteMany({}), NetSchedule.deleteMany({})]);

    const profile = overrides => new NetProfile({
        title: 'Test Net', mode: 'FM', owners: [OWNER], ...overrides
    });

    await t.test('accepts trimmed names through 100 characters and approved common symbols', async () => {
        const symbols = "Net @ Home | #1 * A&B / C+D (Test)., 'Call': Now!";
        assert.equal((await profile({ title: `  ${symbols}  ` }).save()).title, symbols);
        await profile({ title: 'A'.repeat(100) }).validate();
        await assert.rejects(profile({ title: 'A'.repeat(101) }).validate(), /longer than the maximum/);
    });

    await t.test('duplicate display names are permitted and the legacy unique index is safely removed', async () => {
        await NetProfile.collection.createIndex({ title: 1 }, { unique: true, name: 'title_1' });
        assert.equal(await removeLegacyTitleUniqueIndex(NetProfile), true);
        assert.equal((await NetProfile.collection.indexes()).some(index => index.key?.title === 1 && index.unique), false);
        await NetProfile.create({ title: 'Duplicate Net', mode: 'FM', owners: [OWNER] });
        await NetProfile.create({ title: 'Duplicate Net', mode: 'FM', owners: [OWNER] });
    });

    await t.test('supports all connection types, multiple entries, and repeated types', async () => {
        const connections = [
            { type: 'FM', frequency: '146.940', tone: '162.2' },
            { type: 'FM', frequency: '448.200' },
            { type: 'HF', frequency: '7.268', mode: 'LSB' },
            { type: 'AllStarLink', node: '12345' },
            { type: 'EchoLink', callsign: 'W1ABC-L' },
            { type: 'DMR', talkgroup: '3100', colorCode: '1' },
            { type: 'D-STAR', reflector: 'REF001', module: 'C' },
            { type: 'YSF', room: 'America-Link' },
            { type: 'P25', talkgroup: '10200' },
            { type: 'Other', label: 'Web SDR', value: 'Example connection' },
            { type: 'Legacy', value: 'Legacy reflector value' }
        ];
        const saved = await profile({ title: 'Connection Test', connections }).save();
        assert.equal(saved.connections.length, 11);
        assert.equal(saved.connections.filter(item => item.type === 'FM').length, 2);
    });

    await t.test('enforces required data by connection type without restrictive identifier formats', async () => {
        const invalid = [
            { type: 'FM' }, { type: 'HF' }, { type: 'AllStarLink' }, { type: 'EchoLink' }, { type: 'DMR' },
            { type: 'D-STAR' }, { type: 'YSF' }, { type: 'P25' }, { type: 'Other', label: 'Only' },
            { type: 'Legacy' }
        ];
        for (const connection of invalid) {
            await assert.rejects(profile({ title: `Invalid ${connection.type}`, connections: [connection] }).validate());
        }
        await profile({ title: 'Echo Node', connections: [{ type: 'EchoLink', node: 'node/custom-1' }] }).validate();
        await profile({ title: 'YSF Reflector', connections: [{ type: 'YSF', reflector: 'US-room/42' }] }).validate();
        await assert.rejects(profile({
            title: 'Invalid FM Operation', connections: [{ type: 'FM', frequency: '146.940', operation: 'Duplex' }]
        }).validate());
        await assert.rejects(profile({
            title: 'Invalid HF Mode', connections: [{ type: 'HF', frequency: '7.268', mode: 'FT9000' }]
        }).validate());
    });

    await t.test('supports FM repeater/simplex details while retaining legacy structured FM records', async () => {
        const saved = await profile({
            title: 'FM Operation Test',
            connections: [
                { type: 'FM', frequency: '146.940', operation: 'Repeater', offset: '-0.600', tone: '100.0' },
                { type: 'FM', frequency: '146.520', operation: 'Simplex', offset: '+0.600', tone: '100.0' },
                { type: 'FM', frequency: '448.200', tone: '162.2' }
            ]
        }).save();
        assert.equal(saved.connections[0].offset, '-0.600');
        assert.equal(saved.connections[1].operation, 'Simplex');
        assert.equal(saved.connections[1].offset, undefined);
        assert.equal(saved.connections[2].operation, undefined);
        assert.equal(saved.connections[2].tone, '162.2');
    });

    await t.test('preserves legacy Reflector data and accepts existing profiles without connections', async () => {
        const legacy = await profile({ title: 'Legacy Net', mode: 'Reflector', modeDetails: 'REF123' }).save();
        assert.equal(legacy.connections, undefined);
        assert.equal(legacy.mode, 'Reflector');
        assert.equal(legacy.modeDetails, 'REF123');
        assert.deepEqual(getNetProfileConnections(legacy), [{ type: 'Legacy', value: 'REF123' }]);
        assert.deepEqual(getNetProfileConnections(await profile({ title: 'No Connections' }).save()), []);
    });

    await t.test('signal reports default remains false and scheduling relationship remains valid', async () => {
        const saved = await profile({ title: 'Scheduled Profile' }).save();
        assert.equal(saved.restrictedSigReports, false);
        const schedule = await NetSchedule.create({
            netProfile: saved._id,
            type: 'oneTime', timezone: 'UTC', localStartTime: '12:00', startDate: '2030-01-01'
        });
        assert.equal(String(schedule.netProfile), String(saved._id));
    });

    await db.dropDatabase();
    await db.close();
    await testDatabase.cleanup();
});
