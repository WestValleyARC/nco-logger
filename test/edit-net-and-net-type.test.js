/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const { createTestDatabase } = require('./helpers/testDatabase');

test('Edit Net and Net Type', async t => {
    const database = await createTestDatabase({ databaseName: 'edit_net_and_net_type_test', replicaSet: true });
    await mongoose.connect(database.uri);

    const { getNetProfile, NET_TYPES } = require('../server/dist/models/netProfile');
    const { getLiveNet } = require('../server/dist/models/liveNet');
    const { getUserProfile } = require('../server/dist/models/userProfile');
    const { getStationInteraction } = require('../server/dist/models/stationInteraction');
    const { ncoLoggerAction } = require('../server/dist/controllers/ncoLoggerController');
    const { genLiveNetDetails } = require('../server/dist/lib/controllers/liveNetHelpers');
    const NetProfile = getNetProfile();
    const LiveNet = getLiveNet();
    const UserProfile = getUserProfile();
    const StationInteraction = getStationInteraction();
    await Promise.all([NetProfile.init(), LiveNet.init(), UserProfile.init(), StationInteraction.init()]);

    const createUser = async (callSign, displayName) => {
        const user = new UserProfile({
            callSign, displayName, email: `${callSign.toLowerCase()}@example.test`, lastAuthVia: 'email'
        });
        await user.save({ validateBeforeSave: false });
        return user;
    };
    const [nco, logger, viewer] = await Promise.all([
        createUser('W1NCO', 'Net Control'),
        createUser('W1LOG', 'Logger'),
        createUser('W1VWR', 'Viewer')
    ]);

    const app = express();
    app.use(express.json());
    app.use(async (req, res, next) => {
        req.user = await UserProfile.findById(nco._id);
        res.locals.flexOpts = { maxNetsPerUser: 50, baseTtlMs: 5000 };
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

    try {
        await t.test('validates and persists exactly the supported profile net types', async () => {
            assert.deepEqual(NET_TYPES, ['Net', 'Roundtable', 'Ragchew', 'Other']);
            const legacy = await NetProfile.create({ title: 'Legacy Default Net', mode: 'FM', owners: [nco._id] });
            assert.equal(legacy.netType, 'Net');
            const punctuation = await NetProfile.create({
                title: 'Mode Details Punctuation', mode: 'CUSTOM', modeDetails: "Don't Know", owners: [nco._id]
            });
            assert.equal(punctuation.modeDetails, "Don't Know");
            await assert.rejects(
                NetProfile.create({ title: 'Invalid Type Net', netType: 'Directed', mode: 'FM', owners: [nco._id] }),
                /not a valid enum value/
            );

            const created = await request('', {
                method: 'POST',
                body: {
                    title: 'Roundtable Profile', netType: 'Roundtable',
                    connections: [{ type: 'FM', frequency: '146.940' }], notes: ''
                }
            });
            assert.equal(created.status, 200);
            assert.equal(created.body.netType, 'Roundtable');
            const updated = await request(`/${created.body._id}`, {
                method: 'PATCH',
                body: { title: created.body.title, netType: 'Ragchew', autoIn: false, notes: '' }
            });
            assert.equal(updated.status, 200);
            assert.equal(updated.body.netType, 'Ragchew');
            assert.equal((await request(`/${created.body._id}`)).body.netType, 'Ragchew');
        });

        const profile = await NetProfile.create({
            title: 'Saved Profile Name', netType: 'Roundtable', frequency: '146.940', mode: 'FM',
            modeDetails: '162.2', notes: 'Saved notes', owners: [nco._id]
        });
        const liveNet = await LiveNet.create({
            netProfile: profile._id, netControl: nco._id, url: `/views/livenet/${profile._id}`,
            lookupTable: {}, started: true
        });
        const interactions = await StationInteraction.create([
            { callSign: nco.callSign, createdBy: 'user', role: 'netcontrol', checkedState: true,
                userProfile: nco._id, liveNet: liveNet._id, netProfile: profile._id },
            { callSign: logger.callSign, createdBy: 'user', role: 'netlogger', checkedState: true,
                userProfile: logger._id, liveNet: liveNet._id, netProfile: profile._id },
            { callSign: viewer.callSign, createdBy: 'user', role: 'netuser', checkedState: true,
                userProfile: viewer._id, liveNet: liveNet._id, netProfile: profile._id }
        ]);
        interactions.forEach(interaction => {
            liveNet.lookupTable.set(interaction.callSign, { stationInteraction: interaction._id });
        });
        await liveNet.save();
        profile.liveNet = liveNet._id;
        await profile.save();

        const invoke = async (user, net) => {
            let status = 200;
            let payload;
            const res = {
                locals: { flexOpts: { baseTtlMs: 5000, awayInMs: 120000 } },
                status(code) { status = code; return this; },
                json(body) { payload = body; return this; }
            };
            const req = {
                params: { id: String(profile._id) }, body: { action: 'editNet', net },
                user: { _id: user._id, id: user._id, callSign: user.callSign }
            };
            req.res = res;
            await ncoLoggerAction(req, res);
            return { status, payload };
        };
        const override = {
            title: 'Tonight Live Session', netType: 'Other', frequency: '147.240', mode: 'FM',
            modeDetails: '100.0', notes: 'Session-only notes'
        };

        await t.test('uses the profile default, then isolates a live-session override', async () => {
            const before = await genLiveNetDetails({
                npid: String(profile._id),
                flexOpts: { baseTtlMs: 5000, awayInMs: 120000, sigReportTypeByMode: {} },
                requestingCallSign: nco.callSign
            });
            assert.equal(before.net.netType, 'Roundtable');
            assert.equal(before.net.title, 'Saved Profile Name');

            const edited = await invoke(nco, override);
            assert.equal(edited.status, 200);
            const savedProfile = await NetProfile.findById(profile._id).lean();
            const savedLiveNet = await LiveNet.findById(liveNet._id).lean();
            assert.equal(savedProfile.netType, 'Roundtable');
            assert.equal(savedProfile.title, 'Saved Profile Name');
            assert.equal(savedLiveNet.netType, 'Other');
            assert.equal(savedLiveNet.title, 'Tonight Live Session');

            const after = await genLiveNetDetails({
                npid: String(profile._id),
                flexOpts: { baseTtlMs: 5000, awayInMs: 120000, sigReportTypeByMode: {} },
                requestingCallSign: nco.callSign
            });
            for (const [field, value] of Object.entries(override)) assert.equal(after.net[field], value);

            profile.connections = [
                { type: 'FM', frequency: '146.940', tone: '162.2' },
                { type: 'AllStarLink', node: '1999' },
                { type: 'EchoLink', callsign: 'W1NCO-L' }
            ];
            await profile.save();
            const withConnections = await genLiveNetDetails({
                npid: String(profile._id),
                flexOpts: { baseTtlMs: 5000, awayInMs: 120000, sigReportTypeByMode: {} },
                requestingCallSign: nco.callSign
            });
            assert.deepEqual(
                withConnections.net.connections.map(connection => connection.type),
                ['FM', 'AllStarLink', 'EchoLink']
            );
            assert.equal(withConnections.net.frequency, override.frequency);
        });

        await t.test('rejects invalid net types and Logger/Viewer edit authority', async () => {
            const invalid = await invoke(nco, { ...override, netType: 'Directed' });
            assert.equal(invalid.status, 500);

            for (const user of [logger, viewer]) {
                const result = await invoke(user, { ...override, title: `Unauthorized ${user.callSign}` });
                assert.equal(result.status, 500);
            }
            assert.equal((await LiveNet.findById(liveNet._id)).title, override.title);
        });

        await t.test('renders only the agreed profile and live Edit Net controls', () => {
            const profileView = fs.readFileSync(path.join(__dirname, '../server/dist/views/myNets.ejs'), 'utf8');
            const profileClient = fs.readFileSync(
                path.join(__dirname, '../client/dist/public/js/byView/myNets/main.js'), 'utf8'
            );
            const liveClient = fs.readFileSync(
                path.join(__dirname, '../client/src/public/js/byView/liveNet/ncoLogger.js'), 'utf8'
            );
            assert.match(profileView, /id="input_net_type"/);
            assert.match(profileClient, /netType: String\(formDataToSend\.get\('net_type'\)/);
            assert.match(liveClient, /data-role="edit-net"[^>]*>Edit Net</);
            assert.doesNotMatch(liveClient, /data-editor-command="ui"[^>]*>Undo Check-in</);
            for (const field of ['title', 'netType', 'frequency', 'mode', 'modeDetails', 'notes']) {
                assert.match(liveClient, new RegExp(`data-net-modal="${field}"`));
            }
            assert.match(liveClient, /action: "editNet", net/);
            assert.match(liveClient, /function netNotesToPlainText\(value\)/);
            assert.match(liveClient, /field === "notes" \? netNotesToPlainText/);
            assert.match(liveClient, /field === "notes" \? netNotesToHtml/);
            assert.match(liveClient, /\[data-role='edit-net'\].*\[data-role='net-edit-modal'\]/);
            assert.doesNotMatch(
                liveClient.match(/<div class="nch-edit-modal nch-net-edit-modal"[\s\S]*?<\/div>\n        <\/div>/)?.[0] || '',
                /handoff/i
            );
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
        await mongoose.disconnect();
        await database.cleanup();
    }
});
