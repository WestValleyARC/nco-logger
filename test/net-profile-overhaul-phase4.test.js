/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');

test('Net Profile Overhaul Phase 4 signal reports and automatic lurker check-in', async t => {
    const uri = process.env.TEST_MONGODB_URI;
    assert.match(uri || '', /net_profile_overhaul_phase4_test/, 'TEST_MONGODB_URI must target the Phase 4 test database');
    await mongoose.connect(uri);
    const NetProfile = require('../server/dist/models/netProfile').getNetProfile();
    const UserProfile = require('../server/dist/models/userProfile').getUserProfile();
    const LiveNet = require('../server/dist/models/liveNet').getLiveNet();
    const StationInteraction = require('../server/dist/models/stationInteraction').getStationInteraction();
    await Promise.all([NetProfile.init(), UserProfile.init(), LiveNet.init(), StationInteraction.init()]);
    await Promise.all([NetProfile.deleteMany({}), UserProfile.deleteMany({}), LiveNet.deleteMany({}), StationInteraction.deleteMany({})]);

    const users = {};
    const createUser = async (callSign, displayName) => {
        const user = new UserProfile({ callSign, displayName, email: `${callSign.toLowerCase()}@example.test`, lastAuthVia: 'email' });
        await user.save({ validateBeforeSave: false });
        users[callSign] = user;
        return user;
    };
    const nco = await createUser('W1NCO', 'Net Control');
    const participant = await createUser('W1PART', 'Participant');
    const target = await createUser('W1TGT', 'Target Station');

    const app = express();
    app.use(express.json());
    app.use(async (req, res, next) => {
        req.user = users[req.get('x-test-user')] || null;
        res.locals.flexOpts = {
            baseTtlMs: 15000,
            awayInMs: 25000,
            chat: true,
            sigReportTypeByMode: { USB: 'RS', CW: 'RST', FM: null, Reflector: null }
        };
        next();
    });
    app.use('/api/data/livenets', require('../server/dist/routes/dataLiveNetRoutes'));
    app.use('/api/station/interactions', require('../server/dist/routes/stationInteractionRoutes'));
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, { user, method = 'GET', body } = {}) => {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json', 'x-test-user': user || '' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
    };
    const createRunningNet = async ({ title, autoIn = false, restrictedSigReports = false }) => {
        const profile = await NetProfile.create({
            title, frequency: '14.250', mode: 'USB', owners: [nco._id], autoIn, restrictedSigReports
        });
        const liveNet = await LiveNet.create({
            netProfile: profile._id, netControl: nco._id, started: true, startedAt: new Date(),
            countdownTimer: 0, url: `/views/livenet/${profile._id}`, lookupTable: {}
        });
        profile.liveNet = liveNet._id;
        await profile.save({ validateBeforeSave: false });
        return { profile, liveNet };
    };
    const addInteraction = async ({ profile, liveNet, user, role = 'netuser', checkedState = true }) => {
        const interaction = await StationInteraction.create({
            netProfile: profile._id, liveNet: liveNet._id, callSign: user.callSign, createdBy: 'user',
            userProfile: user._id, displayName: user.displayName, role, checkedState,
            checkedInAt: checkedState ? new Date() : null, lastSeen: new Date(), chatEnabled: true, sigReports: { rst: {} }
        });
        liveNet.lookupTable.set(user.callSign, { stationInteraction: interaction._id });
        await liveNet.save();
        return interaction;
    };

    try {
        await t.test('autoIn off leaves an arriving participant visible as a lurker without checking in', async () => {
            const { profile } = await createRunningNet({ title: 'Manual Check-In Net', autoIn: false });
            const response = await request(`/api/data/livenets/${profile._id}?capturePresence=true`, { user: participant.callSign });
            assert.equal(response.status, 200);
            const interaction = await StationInteraction.findOne({ netProfile: profile._id, callSign: participant.callSign });
            assert.equal(interaction.checkedState, null);
            assert.equal(interaction.checkedInAt, null);
            assert.equal(response.body.stations.some(station => station.callSign === participant.callSign && station.checkedState === null), true);
        });

        await t.test('autoIn on checks an eligible arriving participant in under the existing rules', async () => {
            const { profile } = await createRunningNet({ title: 'Automatic Check-In Net', autoIn: true });
            const response = await request(`/api/data/livenets/${profile._id}?capturePresence=true`, { user: target.callSign });
            assert.equal(response.status, 200);
            const interaction = await StationInteraction.findOne({ netProfile: profile._id, callSign: target.callSign });
            assert.equal(interaction.checkedState, true);
            assert.ok(interaction.checkedInAt instanceof Date);
        });

        await t.test('Signal Reports off permits participant reports and on restricts them to Net Control', async () => {
            const { profile, liveNet } = await createRunningNet({ title: 'Signal Report Net', restrictedSigReports: false });
            await addInteraction({ profile, liveNet, user: nco, role: 'netcontrol' });
            await addInteraction({ profile, liveNet, user: participant });
            const destination = await addInteraction({ profile, liveNet, user: target });
            const report = user => request(`/api/station/interactions/${profile._id}`, {
                user,
                method: 'POST',
                body: { action: 'sigReport', dstStation: target.callSign, actionParams: { r: 5, s: 9 } }
            });

            assert.equal((await report(participant.callSign)).status, 200);
            assert.equal((await StationInteraction.findById(destination._id)).sigReports.calculated, '59');

            profile.restrictedSigReports = true;
            await profile.save();
            const denied = await report(participant.callSign);
            assert.equal(denied.status, 500);
            assert.match(denied.body.errorMessage, /restricted to NCS only/);
            assert.equal((await report(nco.callSign)).status, 200);
        });

        await t.test('existing manual check-in remains available when autoIn is off', async () => {
            const { profile, liveNet } = await createRunningNet({ title: 'Existing Check-In Net', autoIn: false });
            await addInteraction({ profile, liveNet, user: nco, role: 'netcontrol' });
            const lurker = await addInteraction({ profile, liveNet, user: participant, checkedState: null });
            const response = await request(`/api/station/interactions/${profile._id}`, {
                user: nco.callSign,
                method: 'POST',
                body: { action: 'checkState', dstStation: participant.callSign, actionParams: { state: true } }
            });
            assert.equal(response.status, 200);
            assert.equal((await StationInteraction.findById(lurker._id)).checkedState, true);
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
});
