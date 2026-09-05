/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const { createTestDatabase } = require('./helpers/testDatabase');

test('Net Profile Overhaul Phase 2 create/edit integration', async t => {
    const testDatabase = await createTestDatabase({ databaseName: 'net_profile_overhaul_phase2_test', replicaSet: true });
    await mongoose.connect(testDatabase.uri);
    const NetProfile = require('../server/dist/models/netProfile').getNetProfile();
    const UserProfile = require('../server/dist/models/userProfile').getUserProfile();
    const NetSchedule = require('../server/dist/models/netSchedule').getNetSchedule();
    await Promise.all([NetProfile.init(), UserProfile.init(), NetSchedule.init()]);
    await Promise.all([NetProfile.deleteMany({}), UserProfile.deleteMany({}), NetSchedule.deleteMany({})]);

    const owner = new UserProfile({
        displayName: 'Test Owner', callSign: 'W1OWN', lastAuthVia: 'email', email: 'owner@example.test'
    });
    await owner.save({ validateBeforeSave: false });
    const app = express();
    app.use(express.json());
    app.use(async (req, res, next) => {
        req.user = await UserProfile.findById(owner._id);
        res.locals.flexOpts = { maxNetsPerUser: 50 };
        next();
    });
    app.use('/api/data/netprofiles', require('../server/dist/routes/dataNetProfileRoutes'));
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/data/netprofiles`;
    const request = async (url = '', { method = 'GET', body } = {}) => {
        const response = await fetch(`${baseUrl}${url}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
    };
    const formBody = overrides => ({
        title: 'Profile Test', connections: [], restrictedSigReports: false, autoIn: false, notes: '', ...overrides
    });

    try {
        await t.test('UI exposes 100-character names and structured connection controls', () => {
            const template = fs.readFileSync(path.join(__dirname, '../server/dist/views/myNets.ejs'), 'utf8');
            const client = fs.readFileSync(path.join(__dirname, '../client/dist/public/js/byView/myNets/main.js'), 'utf8');
            assert.match(template, /id="input_title"[^>]*maxlength="100"/);
            assert.ok(template.includes('Add Connection'));
            assert.ok(!template.includes('Signal Reports'));
            assert.ok(template.includes('Automatically Check In Lurkers'));
            for (const type of ['FM', 'HF', 'AllStarLink', 'EchoLink', 'DMR', 'D-STAR', 'YSF', 'P25', 'Other']) {
                assert.ok(client.includes(type));
            }
            assert.ok(client.indexOf('FM: [') < client.indexOf('HF: ['));
            assert.match(client, /options: \['Repeater', 'Simplex'\]/);
            assert.match(client, /delete connection\.offset/);
            assert.match(client, /dragHandle\.draggable = true/);
            assert.match(client, /Drag .* connection to reorder/);
            assert.match(client, /Move .* connection up/);
            assert.match(client, /Move .* connection down/);
            assert.match(client, /moveUp\.disabled = index === 0/);
            assert.match(client, /moveDown\.disabled = index === connectionRows\.length - 1/);
            assert.doesNotMatch(client, /^\s*Legacy:/m);
        });

        await t.test('100-character mixed-case name is preserved and duplicate names are allowed', async () => {
            const title = `nCo @ Home | #1 * A&B / C+D (Test)., 'Call': Now!${'x'.repeat(51)}`;
            assert.equal(title.length, 100);
            const first = await request('', { method: 'POST', body: formBody({ title }) });
            const second = await request('', { method: 'POST', body: formBody({ title }) });
            assert.equal(first.status, 200);
            assert.equal(second.status, 200);
            assert.equal(first.body.title, title);
            assert.equal(await NetProfile.countDocuments({ title }), 2);
        });

        await t.test('creates one, multiple, and repeated connection types', async () => {
            const one = await request('', {
                method: 'POST', body: formBody({ title: 'One Connection', connections: [{ type: 'FM', frequency: '146.940' }] })
            });
            assert.equal(one.status, 200);
            assert.equal(one.body.connections[0].frequency, '146.940');

            const multiple = await request('', {
                method: 'POST',
                body: formBody({
                    title: 'Multiple Connections',
                    connections: [
                        { type: 'FM', frequency: '146.520', tone: '100.0' },
                        { type: 'FM', frequency: '448.200' },
                        { type: 'DMR', talkgroup: '3100', colorCode: '1' }
                    ]
                })
            });
            assert.equal(multiple.status, 200);
            assert.equal(multiple.body.connections.length, 3);
            assert.equal(multiple.body.connections.filter(item => item.type === 'FM').length, 2);
        });

        await t.test('edits and removes structured connections', async () => {
            const created = await request('', {
                method: 'POST',
                body: formBody({
                    title: 'Editable Connections',
                    connections: [{ type: 'FM', frequency: '146.520' }, { type: 'AllStarLink', node: '12345' }]
                })
            });
            const edited = await request(`/${created.body._id}`, {
                method: 'PATCH',
                body: formBody({ title: 'Editable Connections', connections: [{ type: 'FM', frequency: '146.940', tone: '162.2' }] })
            });
            assert.equal(edited.status, 200);
            const saved = await NetProfile.findById(created.body._id);
            assert.equal(saved.connections.length, 1);
            assert.equal(saved.connections[0].frequency, '146.940');
            assert.equal(saved.connections[0].tone, '162.2');
        });

        await t.test('preserves user-selected connection order through save, edit, and reload', async () => {
            const initialConnections = [
                { type: 'AllStarLink', node: '63916' },
                { type: 'FM', frequency: '146.940', operation: 'Repeater', offset: '-0.600' },
                { type: 'EchoLink', callsign: 'NY7S-R' },
                { type: 'HF', frequency: '7.268', mode: 'LSB' }
            ];
            const created = await request('', {
                method: 'POST', body: formBody({ title: 'Ordered Connections', connections: initialConnections })
            });
            assert.deepEqual(created.body.connections.map(connection => connection.type),
                ['AllStarLink', 'FM', 'EchoLink', 'HF']);

            const reordered = [initialConnections[3], initialConnections[2], initialConnections[1], initialConnections[0]];
            const edited = await request(`/${created.body._id}`, {
                method: 'PATCH', body: formBody({ title: 'Ordered Connections', connections: reordered })
            });
            assert.deepEqual(edited.body.connections.map(connection => connection.type),
                ['HF', 'EchoLink', 'FM', 'AllStarLink']);
            const reloaded = await request(`/${created.body._id}`);
            assert.deepEqual(reloaded.body.connections.map(connection => connection.type),
                ['HF', 'EchoLink', 'FM', 'AllStarLink']);
        });

        await t.test('legacy Reflector survives unrelated edit and scheduling relationship is preserved', async () => {
            const legacy = await NetProfile.create({
                title: 'Legacy Reflector', mode: 'Reflector', modeDetails: 'REF030C', owners: [owner._id],
                restrictedSigReports: true
            });
            await UserProfile.updateOne({ _id: owner._id }, { $push: { myNets: legacy._id } });
            const schedule = await NetSchedule.create({
                netProfile: legacy._id, type: 'oneTime', timezone: 'UTC', localStartTime: '19:00', startDate: '2030-01-01'
            });
            const response = await request(`/${legacy._id}`, {
                method: 'PATCH',
                body: { title: 'Legacy Reflector Updated', autoIn: false, notes: 'Updated notes' }
            });
            assert.equal(response.status, 200);
            const saved = await NetProfile.findById(legacy._id);
            assert.equal(saved.mode, 'Reflector');
            assert.equal(saved.modeDetails, 'REF030C');
            assert.equal(saved.connections, undefined);
            assert.equal(saved.restrictedSigReports, true);
            assert.equal(String((await NetSchedule.findById(schedule._id)).netProfile), String(legacy._id));
        });

        await t.test('Signal Reports and Automatically Check In Lurkers save independently', async () => {
            const created = await request('', {
                method: 'POST', body: formBody({ title: 'Settings Profile', restrictedSigReports: true, autoIn: true })
            });
            assert.equal(created.status, 200);
            let saved = await NetProfile.findById(created.body._id);
            assert.equal(saved.restrictedSigReports, true);
            assert.equal(saved.autoIn, true);
            await request(`/${saved._id}`, {
                method: 'PATCH', body: formBody({ title: saved.title, restrictedSigReports: false, autoIn: false })
            });
            saved = await NetProfile.findById(saved._id);
            assert.equal(saved.restrictedSigReports, false);
            assert.equal(saved.autoIn, false);
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
        await testDatabase.cleanup();
    }
});
