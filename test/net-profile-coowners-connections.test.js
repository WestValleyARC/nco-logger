/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');

test('Net Profile co-owner management and new connection types', async t => {
    const uri = process.env.TEST_MONGODB_URI;
    assert.match(uri || '', /net_profile_coowners_connections_test/, 'TEST_MONGODB_URI must target the focused test database');
    await mongoose.connect(uri);
    const NetProfile = require('../server/dist/models/netProfile').getNetProfile();
    const UserProfile = require('../server/dist/models/userProfile').getUserProfile();
    const NetSchedule = require('../server/dist/models/netSchedule').getNetSchedule();
    await Promise.all([NetProfile.init(), UserProfile.init(), NetSchedule.init()]);
    await Promise.all([NetProfile.deleteMany({}), UserProfile.deleteMany({}), NetSchedule.deleteMany({})]);

    const createUser = async values => {
        const user = new UserProfile({
            displayName: values.displayName,
            callSign: values.callSign,
            lastAuthVia: 'email',
            email: values.email
        });
        await user.save({ validateBeforeSave: false });
        return user;
    };
    const owner = await createUser({ displayName: 'Primary Owner', callSign: 'W1OWN', email: 'owner@example.test' });
    const coOwner = await createUser({ displayName: 'Co Owner', callSign: 'W2COO', email: 'coowner@example.test' });
    const other = await createUser({ displayName: 'Other User', callSign: 'W3OTH', email: 'other@example.test' });
    let currentUserId = owner._id;

    const app = express();
    app.use(express.json());
    app.use(async (req, res, next) => {
        req.user = await UserProfile.findById(currentUserId);
        res.locals.flexOpts = { maxNetsPerUser: 50, maxOwnersPerNet: 5 };
        next();
    });
    app.use('/api/data/netprofiles', require('../server/dist/routes/dataNetProfileRoutes'));
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/data/netprofiles`;
    const request = async (url, { method = 'GET', body } = {}) => {
        const response = await fetch(`${baseUrl}${url}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
    };

    try {
        await t.test('validates, saves, reloads, and formats M17, NXDN, and Zello in array order', async () => {
            const connections = [
                { type: 'Zello', channel: 'WVARC Net' },
                { type: 'M17', reflector: 'M17-ABC', module: 'A' },
                { type: 'NXDN', talkgroup: '3100' },
                { type: 'M17', reflector: 'M17-XYZ' }
            ];
            const profile = await NetProfile.create({ title: 'Digital Connections', mode: 'Reflector', owners: [owner._id], connections });
            const reloaded = await NetProfile.findById(profile._id);
            assert.deepEqual(reloaded.connections.map(item => item.type), ['Zello', 'M17', 'NXDN', 'M17']);

            const formatterSource = fs.readFileSync(path.join(__dirname, '../client/dist/public/js/lib/publicSchedule.js'), 'utf8');
            const moduleCode = await import(`data:text/javascript;base64,${Buffer.from(formatterSource).toString('base64')}`);
            assert.deepEqual(moduleCode.formatConnectionLines(reloaded.toObject()), [
                'Zello: WVARC Net', 'M17: M17-ABC / A', 'NXDN: TG 3100', 'M17: M17-XYZ'
            ]);
            for (const connection of [{ type: 'M17' }, { type: 'NXDN' }, { type: 'Zello' }]) {
                await assert.rejects(new NetProfile({ title: 'Invalid Connection', mode: 'Reflector', owners: [owner._id], connections: [connection] }).validate());
            }
        });

        await t.test('editor exposes the new types in the required order and existing reorder controls', () => {
            const client = fs.readFileSync(path.join(__dirname, '../client/dist/public/js/byView/myNets/main.js'), 'utf8');
            const types = ['FM:', 'HF:', 'AllStarLink:', 'EchoLink:', 'DMR:', "'D-STAR':", 'YSF:', 'P25:', 'M17:', 'NXDN:', 'Zello:', 'Other:'];
            let previous = -1;
            types.forEach(type => {
                const index = client.indexOf(type);
                assert.ok(index > previous, `${type} appears in selector order`);
                previous = index;
            });
            assert.match(client, /dragHandle\.draggable = true/);
            assert.match(client, /connectionRows = indexes\.map/);
        });

        await t.test('primary owner adds and removes a registered co-owner without changing profile identity or schedule', async () => {
            const profile = await NetProfile.create({ title: 'Shared Net', mode: 'FM', frequency: '146.520', owners: [owner._id] });
            await UserProfile.updateOne({ _id: owner._id }, { $addToSet: { myNets: profile._id } });
            const schedule = await NetSchedule.create({
                netProfile: profile._id,
                type: 'oneTime',
                timezone: 'UTC',
                localStartTime: '19:00',
                startDate: '2030-01-01'
            });

            let response = await request(`/${profile._id}/coowners`, {
                method: 'POST', body: { identifier: coOwner.callSign.toLowerCase() }
            });
            assert.equal(response.status, 200);
            let saved = await NetProfile.findById(profile._id);
            assert.equal(String(saved._id), String(profile._id));
            assert.deepEqual(saved.owners.map(String), [String(owner._id), String(coOwner._id)]);
            assert.ok((await UserProfile.findById(coOwner._id)).myNets.map(String).includes(String(profile._id)));
            assert.equal(String((await NetSchedule.findById(schedule._id)).netProfile), String(profile._id));

            response = await request(`/${profile._id}/coowners`, { method: 'POST', body: { identifier: coOwner.email } });
            assert.equal(response.status, 409);
            response = await request(`/${profile._id}/coowners`, { method: 'POST', body: { identifier: 'N0NONE' } });
            assert.equal(response.status, 404);

            response = await request(`/${profile._id}/coowners/${coOwner._id}`, { method: 'DELETE' });
            assert.equal(response.status, 200);
            saved = await NetProfile.findById(profile._id);
            assert.deepEqual(saved.owners.map(String), [String(owner._id)]);
            assert.ok(!(await UserProfile.findById(coOwner._id)).myNets.map(String).includes(String(profile._id)));
            assert.ok(await NetSchedule.findById(schedule._id));
        });

        await t.test('co-owners and unrelated users cannot manage ownership or remove the primary owner', async () => {
            const profile = await NetProfile.create({ title: 'Protected Net', mode: 'FM', frequency: '146.520', owners: [owner._id, coOwner._id] });
            currentUserId = coOwner._id;
            let response = await request(`/${profile._id}/coowners`, { method: 'POST', body: { identifier: other.callSign } });
            assert.equal(response.status, 403);
            currentUserId = other._id;
            response = await request(`/${profile._id}/coowners/${coOwner._id}`, { method: 'DELETE' });
            assert.equal(response.status, 403);
            currentUserId = owner._id;
            response = await request(`/${profile._id}/coowners/${owner._id}`, { method: 'DELETE' });
            assert.equal(response.status, 400);
            assert.deepEqual((await NetProfile.findById(profile._id)).owners.map(String), [String(owner._id), String(coOwner._id)]);
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
});
