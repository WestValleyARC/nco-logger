const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createTestDatabase } = require('./helpers/testDatabase');
const { prepareOccurrence, processOccurrenceLifecycle } = require('../server/dist/lib/scheduling/lifecycle');
const { canUserAccessRoom } = require('../server/dist/lib/scheduling/roomAccess');
const { queryPublicLiveNets } = require('../server/dist/controllers/liveNetController');
const { getNetAccess } = require('../server/dist/lib/localChat');
const { capturePresence } = require('../server/dist/lib/controllers/liveNetHelpers');
const { checkState, closeNet } = require('../server/dist/lib/sharedNetOps');
const { processAbandonedLiveNets } = require('../server/dist/lib/scheduling/hardening');

test('explicit scheduled room opening', async t => {
    const database = await createTestDatabase({ databaseName: 'scheduled_room_opening_test', replicaSet: true });
    await mongoose.connect(database.uri);
    const NetProfile = require('../server/dist/models/netProfile').getNetProfile();
    const NetSchedule = require('../server/dist/models/netSchedule').getNetSchedule();
    const ScheduledOccurrence = require('../server/dist/models/scheduledOccurrence').getScheduledOccurrence();
    const LiveNet = require('../server/dist/models/liveNet').getLiveNet();
    const StationInteraction = require('../server/dist/models/stationInteraction').getStationInteraction();
    await Promise.all([NetProfile.init(), NetSchedule.init(), ScheduledOccurrence.init(), LiveNet.init(), StationInteraction.init()]);
    const now = new Date(Date.now() - 10000);
    // Six hours, not a fixed 30-minute early preparation allowance.
    const startAt = new Date(now.getTime() + 6 * 3600000);
    const owner = { _id: new mongoose.Types.ObjectId(), callSign: 'W1OWN', displayName: 'Owner', location: 'Phoenix, AZ', flexOptions: { option: { chat: true } } };
    const participant = { _id: new mongoose.Types.ObjectId(), callSign: 'W1PAR', displayName: 'Participant', location: 'Phoenix, AZ', flexOptions: { option: { chat: true } } };
    owner.id = owner._id.toString();
    participant.id = participant._id.toString();
    const app = require('express')();
    app.use(require('express').json());
    app.use((req, res, next) => { req.user = req.get('x-test-user') === 'participant' ? participant : owner; next(); });
    app.use('/profiles', require('../server/dist/routes/dataNetProfileRoutes'));
    app.post('/room/:id', require('../server/dist/lib/scheduling/roomAccess').roomAccessMiddleware, (req, res) => res.json({ allowed: true }));
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const request = async (path, { method = 'GET', body, participant = false } = {}) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
            method, headers: { 'content-type': 'application/json', 'x-test-user': participant ? 'participant' : 'owner' },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        return { status: response.status, body: await response.json() };
    };
    let sequence = 0;
    const create = async () => {
        const profile = await NetProfile.create({ title: `Room Opening ${++sequence}`, frequency: '146.520', mode: 'FM', owners: [owner._id], permanent: true });
        const schedule = await NetSchedule.create({ netProfile: profile._id, type: 'oneTime', timezone: 'America/Phoenix', localStartTime: '19:00', startDate: '2030-01-10' });
        const occurrence = await ScheduledOccurrence.create({ schedule: schedule._id, netProfile: profile._id, occurrenceKey: `room-${sequence}`, originalStartAt: startAt, startAt, status: 'scheduled' });
        return { profile, occurrence };
    };
    const open = (data, roomOpening, user = owner) => prepareOccurrence({ npid: data.profile._id, occurrenceId: data.occurrence._id, user, roomOpening, now });
    const visible = at => queryPublicLiveNets(LiveNet, StationInteraction, null, at);
    try {
        await t.test('HTTP start requires an explicit choice, verifies ownership and persists the selected mode', async () => {
            const data = await create();
            const path = `/profiles/${data.profile._id}/occurrences/${data.occurrence._id}`;
            const choice = await request(`${path}/prepare`, { method: 'POST' });
            assert.equal(choice.status, 200, JSON.stringify(choice.body));
            assert.match(choice.body.liveNet.url, /^\/views\/scheduled-start\//);
            assert.equal(await LiveNet.countDocuments({ netProfile: data.profile._id }), 0);
            assert.equal((await request(`${path}/opening`, { participant: true })).status, 403);
            assert.equal((await request(`${path}/prepare`, { method: 'POST', body: { roomOpening: 'early' }, participant: true })).status, 403);
            assert.equal((await request(`${path}/opening`)).body.startAt, startAt.toISOString());
            const opened = await request(`${path}/prepare`, { method: 'POST', body: { roomOpening: 'scheduled' } });
            assert.equal(opened.status, 200);
            assert.equal(opened.body.liveNet.roomOpening, 'scheduled');
            assert.equal((await request(`/room/${data.profile._id}`, { method: 'POST', participant: true })).status, 403);
            assert.equal((await request(`/room/${data.profile._id}`, { method: 'POST' })).status, 200);
        });
        await t.test('early room persists, is public and permits participant presence, chat and NCO check-ins before on-air start', async () => {
            const data = await create();
            const result = await open(data, 'early');
            const room = await LiveNet.findById(result.liveNet._id);
            assert.equal(room.started, false);
            assert.equal(room.startedAt, null);
            assert.equal(room.roomOpening, 'early');
            assert.equal(room.roomOpensAt.toISOString(), now.toISOString());
            assert.equal((await ScheduledOccurrence.findById(data.occurrence._id)).startAt.toISOString(), startAt.toISOString());
            assert.ok((await visible(now)).some(net => String(net.id) === String(data.profile._id)));
            assert.equal(await canUserAccessRoom({ liveNet: room, user: participant, now }), true);
            await capturePresence({ req: { user: participant }, res: { locals: { flexOpts: { awayInMs: 25000 } } }, netProfileDoc: data.profile, liveNetDoc: room });
            assert.ok(await getNetAccess({ npid: String(data.profile._id), userId: String(participant._id) }));
            await checkState({ netProfile: data.profile, liveNet: await LiveNet.findById(room._id), srcStation: owner.callSign, dstStations: [participant.callSign], state: true });
            assert.equal((await StationInteraction.findOne({ liveNet: room._id, callSign: participant.callSign })).checkedState, true);
            assert.equal((await LiveNet.findById(room._id)).started, false);
        });
        await t.test('waiting hides the room, then opens at the UTC instant without NCO refresh or heartbeat', async () => {
            const data = await create();
            const { liveNet: room } = await open(data, 'scheduled');
            assert.equal(room.roomOpensAt.toISOString(), startAt.toISOString());
            assert.equal(await canUserAccessRoom({ liveNet: room, user: participant, now }), false);
            assert.equal(await canUserAccessRoom({ liveNet: room, user: owner, now }), true);
            // A station record alone must not bypass waiting-room access.
            await StationInteraction.create({ liveNet: room._id, netProfile: data.profile._id, userProfile: participant._id, callSign: participant.callSign, createdBy: 'user' });
            assert.equal(await getNetAccess({ npid: String(data.profile._id), userId: String(participant._id) }), null);
            assert.ok(!(await visible(new Date(startAt.getTime() - 1))).some(net => String(net.id) === String(data.profile._id)));
            assert.equal(await canUserAccessRoom({ liveNet: room, user: participant, now: startAt }), true);
            assert.ok((await visible(startAt)).some(net => String(net.id) === String(data.profile._id)));
            await processOccurrenceLifecycle({ now: startAt });
            assert.equal((await LiveNet.findById(room._id)).started, true);
            await processAbandonedLiveNets({ now: startAt, sendInactivityEmail: async () => {} });
            assert.ok(await LiveNet.findById(room._id), 'stale preparation heartbeat must not close a newly opened room');
        });
        await t.test('same-net concurrent choices preserve the winning session while distinct nets coexist', async () => {
            const same = await create();
            const results = await Promise.allSettled([open(same, 'early'), open(same, 'scheduled')]);
            const successes = results.filter(result => result.status === 'fulfilled');
            assert.ok(successes.length >= 1);
            assert.equal(await LiveNet.countDocuments({ netProfile: same.profile._id }), 1);
            const persisted = await LiveNet.findOne({ netProfile: same.profile._id });
            const repeat = await open(same, persisted.roomOpening === 'early' ? 'scheduled' : 'early');
            assert.equal(String(repeat.liveNet._id), String(persisted._id));
            assert.equal(repeat.liveNet.roomOpening, persisted.roomOpening);
            const distinct = await Promise.all(Array.from({ length: 3 }, create));
            const sessions = await Promise.all(distinct.map((data, index) => open(data, index % 2 ? 'scheduled' : 'early')));
            assert.equal(new Set(sessions.map(session => String(session.liveNet._id))).size, 3);
            assert.equal(await LiveNet.countDocuments({ netProfile: { $in: distinct.map(data => data.profile._id) } }), 3);
        });
        await t.test('closing an early room removes public access and cannot be resurrected by the worker', async () => {
            const data = await create();
            const { liveNet } = await open(data, 'early');
            assert.equal(await closeNet({ netProfileDoc: data.profile, liveNetDoc: liveNet, quiet: true }), true);
            assert.equal((await ScheduledOccurrence.findById(data.occurrence._id)).status, 'completed');
            await processOccurrenceLifecycle({ now: new Date(startAt.getTime() + 3600000) });
            assert.equal(await LiveNet.findById(liveNet._id), null);
            assert.ok(!(await visible(startAt)).some(net => String(net.id) === String(data.profile._id)));
        });
        await t.test('owner authorization and explicit mode validation still apply', async () => {
            const data = await create();
            await assert.rejects(open(data, 'early', participant), error => error.status === 403);
            await assert.rejects(open(data, 'invalid'), error => error.status === 400);
            assert.equal(await LiveNet.countDocuments({ netProfile: data.profile._id }), 0);
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
        await mongoose.disconnect();
        await database.cleanup();
    }
});
