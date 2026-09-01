/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const uri = process.env.TEST_MONGODB_URI;

test('authorized NCO handoff is scoped, atomic, and preserves net data', { skip: !uri }, async t => {
    assert.match(uri, /nco_handoff_test/, 'TEST_MONGODB_URI must target the NCO handoff test database');
    await mongoose.connect(uri);

    const { getUserProfile } = require('../server/dist/models/userProfile');
    const { getNetProfile } = require('../server/dist/models/netProfile');
    const { getLiveNet } = require('../server/dist/models/liveNet');
    const { getStationInteraction } = require('../server/dist/models/stationInteraction');
    const { getChatMessage } = require('../server/dist/models/chatMessage');
    const netOps = require('../server/dist/lib/sharedNetOps');
    const { ncoLoggerAction } = require('../server/dist/controllers/ncoLoggerController');

    const UserProfile = getUserProfile();
    const NetProfile = getNetProfile();
    const LiveNet = getLiveNet();
    const StationInteraction = getStationInteraction();
    const ChatMessage = getChatMessage();
    await Promise.all([
        UserProfile.init(), NetProfile.init(), LiveNet.init(), StationInteraction.init(), ChatMessage.init()
    ]);

    const clear = async () => {
        await Promise.all([
            ChatMessage.deleteMany({}), StationInteraction.deleteMany({}), LiveNet.deleteMany({}),
            NetProfile.deleteMany({}), UserProfile.deleteMany({})
        ]);
    };

    const createUser = (callSign, displayName) => new UserProfile({
        callSign,
        displayName,
        email: `${callSign.toLowerCase()}-handoff@example.com`,
        lastAuthVia: 'email'
    }).save({ validateBeforeSave: false });

    const fixture = async ({ targetRole = 'netuser', targetChecked = true, targetLastSeen = new Date(),
        targetRegistered = true } = {}) => {
        await clear();
        const [nco, target, viewer, logger] = await Promise.all([
            createUser('W1NCO', 'Net Control'),
            createUser('W1TGT', 'Target User'),
            createUser('W1VWR', 'Viewer User'),
            createUser('W1LOG', 'Logger User')
        ]);
        const profile = await NetProfile.create({
            title: 'Handoff Test Net', mode: 'FM', owners: [nco._id], autoIn: false
        });
        const liveNet = await LiveNet.create({
            netProfile: profile._id,
            netControl: nco._id,
            url: `/views/livenet/${profile._id}`,
            lookupTable: {},
            started: true,
            loggerState: { revision: 'keep-me', order: ['W1NCO', 'W1TGT'] }
        });
        const interactions = await StationInteraction.create([
            {
                callSign: 'W1NCO', createdBy: 'user', role: 'netcontrol', checkedState: true,
                lastSeen: new Date(), userProfile: nco._id, liveNet: liveNet._id, netProfile: profile._id
            },
            {
                callSign: 'W1TGT', createdBy: 'user', role: targetRole, checkedState: targetChecked,
                lastSeen: targetLastSeen, userProfile: targetRegistered ? target._id : undefined,
                liveNet: liveNet._id, netProfile: profile._id
            },
            {
                callSign: 'W1VWR', createdBy: 'user', role: 'netuser', checkedState: true,
                lastSeen: new Date(), userProfile: viewer._id, liveNet: liveNet._id, netProfile: profile._id
            },
            {
                callSign: 'W1LOG', createdBy: 'user', role: 'netlogger', checkedState: true,
                lastSeen: new Date(), userProfile: logger._id, liveNet: liveNet._id, netProfile: profile._id
            }
        ]);
        for (const interaction of interactions) {
            liveNet.lookupTable.set(interaction.callSign, { stationInteraction: interaction._id });
        }
        await liveNet.save();
        profile.liveNet = liveNet._id;
        await profile.save();
        await ChatMessage.create({
            liveNet: liveNet._id,
            netProfile: profile._id,
            userProfile: viewer._id,
            callSign: 'W1VWR',
            displayName: 'Viewer User',
            text: 'Preserve this chat message'
        });
        return { nco, target, viewer, logger, profile, liveNet };
    };

    const invoke = async ({ profile, user, target }) => {
        let status = 200;
        let payload;
        const res = {
            locals: { flexOpts: { baseTtlMs: 5000, awayInMs: 120000 } },
            status(code) { status = code; return this; },
            json(body) { payload = body; return this; }
        };
        const req = {
            params: { id: String(profile._id) },
            body: { action: 'handoff', callSign: target },
            user: { _id: user._id, id: user._id, callSign: user.callSign }
        };
        req.res = res;
        await ncoLoggerAction(req, res);
        return { status, payload };
    };

    const currentState = async profile => {
        const currentProfile = await NetProfile.findById(profile._id).lean();
        const currentLiveNet = await LiveNet.findById(currentProfile.liveNet).lean();
        const stationIds = Object.values(currentLiveNet.lookupTable).map(entry => entry.stationInteraction);
        const interactions = await StationInteraction.find({ _id: { $in: stationIds } }).lean();
        return {
            profile: currentProfile,
            liveNet: currentLiveNet,
            interactions: Object.fromEntries(interactions.map(item => [item.callSign, item])),
            chatCount: await ChatMessage.countDocuments({ netProfile: profile._id })
        };
    };

    await t.test('hands control to a registered online non-owner participant atomically', async () => {
        const data = await fixture();
        const before = await currentState(data.profile);
        const result = await invoke({ profile: data.profile, user: data.nco, target: 'W1TGT' });
        assert.equal(result.status, 200);

        const after = await currentState(data.profile);
        assert.equal(String(after.liveNet.netControl), String(data.target._id));
        assert.equal(after.interactions.W1TGT.role, 'netcontrol');
        assert.equal(after.interactions.W1NCO.role, 'netlogger');
        assert.equal(after.interactions.W1TGT.checkedState, true);
        assert.equal(after.interactions.W1NCO.checkedState, true);
        assert.deepEqual(after.profile.owners.map(String), before.profile.owners.map(String));
        assert.deepEqual(after.liveNet.loggerState, before.liveNet.loggerState);
        assert.equal(after.chatCount, before.chatCount);

        const noLongerNco = await invoke({ profile: data.profile, user: data.nco, target: 'W1LOG' });
        assert.equal(noLongerNco.status, 500);
        assert.match(noLongerNco.payload.errorMessage, /Only the checked-in NCO/);
    });

    await t.test('hands control to a registered online Logger', async () => {
        const data = await fixture({ targetRole: 'netlogger' });
        assert.equal((await invoke({ profile: data.profile, user: data.nco, target: 'W1TGT' })).status, 200);
        const after = await currentState(data.profile);
        assert.equal(after.interactions.W1TGT.role, 'netcontrol');
        assert.equal(after.interactions.W1NCO.role, 'netlogger');
    });

    await t.test('rejects Viewer and Logger initiation', async () => {
        let data = await fixture();
        let result = await invoke({ profile: data.profile, user: data.viewer, target: 'W1TGT' });
        assert.equal(result.status, 500);
        assert.match(result.payload.errorMessage, /Only the checked-in NCO/);

        data = await fixture();
        result = await invoke({ profile: data.profile, user: data.logger, target: 'W1TGT' });
        assert.equal(result.status, 500);
        assert.match(result.payload.errorMessage, /Only the checked-in NCO/);
    });

    await t.test('rejects offline, unchecked, unregistered, and self recipients', async () => {
        let data = await fixture({ targetLastSeen: new Date(Date.now() - 300000) });
        let result = await invoke({ profile: data.profile, user: data.nco, target: 'W1TGT' });
        assert.equal(result.status, 500);
        assert.match(result.payload.errorMessage, /online and present/);

        data = await fixture({ targetChecked: false });
        result = await invoke({ profile: data.profile, user: data.nco, target: 'W1TGT' });
        assert.equal(result.status, 500);
        assert.match(result.payload.errorMessage, /must be checked in/);

        data = await fixture({ targetRegistered: false });
        result = await invoke({ profile: data.profile, user: data.nco, target: 'W1TGT' });
        assert.equal(result.status, 500);
        assert.match(result.payload.errorMessage, /create an account first/);

        data = await fixture();
        result = await invoke({ profile: data.profile, user: data.nco, target: 'W1NCO' });
        assert.equal(result.status, 500);
        assert.match(result.payload.errorMessage, /already assigned/);
    });

    await t.test('ordinary NCO role assignment still requires profile ownership', async () => {
        const data = await fixture();
        await assert.rejects(
            netOps.setNetRole({ lnid: data.liveNet._id, station: 'W1TGT', newRole: 'netcontrol' }),
            /must also be an owner/
        );
        const after = await currentState(data.profile);
        assert.equal(after.interactions.W1TGT.role, 'netuser');
        assert.equal(String(after.liveNet.netControl), String(data.nco._id));
    });

    await t.test('a late transaction failure rolls back all handoff writes', async () => {
        const data = await fixture();
        await StationInteraction.collection.updateOne({ callSign: 'W1NCO' }, { $unset: { createdBy: 1 } });
        const before = await currentState(data.profile);
        const result = await invoke({ profile: data.profile, user: data.nco, target: 'W1TGT' });
        assert.equal(result.status, 500);
        const after = await currentState(data.profile);
        assert.equal(String(after.liveNet.netControl), String(before.liveNet.netControl));
        assert.equal(after.interactions.W1TGT.role, before.interactions.W1TGT.role);
        assert.equal(after.interactions.W1NCO.role, before.interactions.W1NCO.role);
        assert.equal(after.chatCount, before.chatCount);
        assert.deepEqual(after.profile.owners.map(String), before.profile.owners.map(String));
    });

    await t.test('legacy handoff uses the same scoped operation and requires checked-in presence', () => {
        const source = require('fs').readFileSync(
            require.resolve('../server/dist/lib/netAdminCommands/roleModifier'), 'utf8'
        );
        assert.match(source, /handoffNetControl\(\{/);
        assert.match(source, /ia\.checkedState === true/);
    });

    await clear();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});
