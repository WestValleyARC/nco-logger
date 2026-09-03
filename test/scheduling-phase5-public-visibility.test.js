const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { queryPublicLiveNets } = require('../server/dist/controllers/liveNetController');
const {
    MAX_LIMIT,
    resolvePublicWindow,
    listPublicOccurrences
} = require('../server/dist/lib/scheduling/publicSchedule');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const NOW = new Date('2030-01-02T06:30:00.000Z'); // Jan 1, 11:30 PM America/Phoenix

test('Phase 5 public scheduling visibility', async t => {
    const externalUri = process.env.TEST_MONGODB_URI;
    let mongod;
    if (externalUri) assert.match(externalUri, /scheduling_phase5_test/, 'TEST_MONGODB_URI must target the Phase 5 test database');
    if (!externalUri) {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        mongod = await MongoMemoryServer.create();
    }
    const db = await mongoose.createConnection(externalUri || mongod.getUri()).asPromise();
    const NetProfile = require('../server/dist/models/netProfile').getNetProfile(db);
    const NetSchedule = require('../server/dist/models/netSchedule').getNetSchedule(db);
    const ScheduledOccurrence = require('../server/dist/models/scheduledOccurrence').getScheduledOccurrence(db);
    const LiveNet = require('../server/dist/models/liveNet').getLiveNet(db);
    const StationInteraction = require('../server/dist/models/stationInteraction').getStationInteraction(db);
    await Promise.all([
        NetProfile.init(), NetSchedule.init(), ScheduledOccurrence.init(), LiveNet.init(), StationInteraction.init()
    ]);

    const ownerId = new mongoose.Types.ObjectId();
    let sequence = 0;
    const createProfile = overrides => NetProfile.create({
        title: `Public Net ${++sequence}`,
        frequency: '146.520',
        mode: 'FM',
        owners: [ownerId],
        permanent: true,
        ...overrides
    });
    const createLive = async ({ profile = null, started = true, closing = false, link = true, occurrence } = {}) => {
        const netProfile = profile || await createProfile();
        const liveNet = await LiveNet.create({
            netProfile: netProfile._id,
            occurrence,
            netControl: ownerId,
            started,
            startedAt: started ? NOW : null,
            closing,
            url: `/views/livenet/${netProfile._id}`,
            lookupTable: {}
        });
        if (link) {
            netProfile.liveNet = liveNet._id;
            await netProfile.save({ validateBeforeSave: false });
        }
        return { profile: netProfile, liveNet };
    };
    const createSchedule = async profile => NetSchedule.create({
        netProfile: profile._id,
        type: 'oneTime',
        timezone: 'America/Phoenix',
        localStartTime: '19:00',
        startDate: '2030-01-01'
    });
    const createOccurrence = async ({ startAt, status = 'scheduled', invisible = false } = {}) => {
        const profile = await createProfile({ invisible });
        const schedule = await createSchedule(profile);
        const occurrence = await ScheduledOccurrence.create({
            schedule: schedule._id,
            netProfile: profile._id,
            occurrenceKey: `public-${sequence}`,
            originalStartAt: startAt,
            startAt,
            status
        });
        return { profile, schedule, occurrence };
    };

    try {
        await t.test('public Live Nets includes only current visible linked started sessions with accurate counts', async () => {
            const eligible = await createLive();
            const interactions = await StationInteraction.create([
                { callSign: 'W1TRUE', createdBy: 'user', checkedState: true, liveNet: eligible.liveNet._id, netProfile: eligible.profile._id },
                { callSign: 'W1FALSE', createdBy: 'user', checkedState: false, liveNet: eligible.liveNet._id, netProfile: eligible.profile._id },
                { callSign: 'W1NULL', createdBy: 'user', checkedState: null, liveNet: eligible.liveNet._id, netProfile: eligible.profile._id }
            ]);
            eligible.liveNet.lookupTable = new Map(interactions.map(item => [item.callSign, { stationInteraction: item._id }]));
            await eligible.liveNet.save();

            await createLive({ started: false });
            await createLive({ closing: true });
            await createLive({ profile: await createProfile({ invisible: true }) });
            await createLive({ link: false });
            const preparingData = await createOccurrence({ startAt: new Date('2030-01-02T02:00:00Z'), status: 'preparing' });
            const preparing = await createLive({ profile: preparingData.profile, started: false, occurrence: preparingData.occurrence._id });
            preparingData.occurrence.liveNet = preparing.liveNet._id;
            await preparingData.occurrence.save();
            await LiveNet.collection.insertOne({
                netProfile: new mongoose.Types.ObjectId(), netControl: ownerId, started: true,
                closing: false, url: `/views/livenet/orphan-${sequence}`, lookupTable: {}, createdAt: NOW, updatedAt: NOW
            });

            const result = await queryPublicLiveNets(LiveNet, StationInteraction);
            assert.equal(result.length, 1);
            assert.equal(String(result[0].id), String(eligible.profile._id));
            assert.equal(result[0].checkInCount, 1);
            assert.equal(result[0].started, true);
        });

        await t.test('manual genuinely-started LiveNet remains publicly visible', async () => {
            await Promise.all([LiveNet.deleteMany({}), NetProfile.deleteMany({}), StationInteraction.deleteMany({})]);
            const manual = await createLive();
            const result = await queryPublicLiveNets(LiveNet, StationInteraction);
            assert.deepEqual(result.map(item => String(item.id)), [String(manual.profile._id)]);
        });

        await t.test('viewer-local Today includes eligible rows and excludes terminal, live, and invisible rows', async () => {
            await Promise.all([ScheduledOccurrence.deleteMany({}), NetSchedule.deleteMany({}), NetProfile.deleteMany({})]);
            const eligible = await createOccurrence({ startAt: new Date('2030-01-02T06:45:00Z') });
            for (const status of ['cancelled', 'missed', 'completed', 'live']) {
                await createOccurrence({ startAt: new Date('2030-01-02T06:50:00Z'), status });
            }
            await createOccurrence({ startAt: new Date('2030-01-02T06:55:00Z'), invisible: true });
            const result = await listPublicOccurrences({
                window: 'today', timezone: 'America/Phoenix', now: NOW, db
            });
            assert.equal(result.range.localStart, '2030-01-01');
            assert.deepEqual(result.occurrences.map(item => String(item.id)), [String(eligible.occurrence._id)]);
            assert.ok(!Object.hasOwn(result.occurrences[0], 'notification'));
            assert.ok(!Object.hasOwn(result.occurrences[0], 'schedule'));
        });

        await t.test('Upcoming excludes Today and spans the following seven viewer-local days', async () => {
            await Promise.all([ScheduledOccurrence.deleteMany({}), NetSchedule.deleteMany({}), NetProfile.deleteMany({})]);
            const today = await createOccurrence({ startAt: new Date('2030-01-02T06:45:00Z') });
            const firstUpcoming = await createOccurrence({ startAt: new Date('2030-01-02T07:00:00Z') });
            const lastUpcoming = await createOccurrence({ startAt: new Date('2030-01-09T06:59:59Z') });
            await createOccurrence({ startAt: new Date('2030-01-09T07:00:00Z') });
            const result = await listPublicOccurrences({
                window: 'upcoming', timezone: 'America/Phoenix', now: NOW, db
            });
            const ids = result.occurrences.map(item => String(item.id));
            assert.ok(!ids.includes(String(today.occurrence._id)));
            assert.deepEqual(ids, [String(firstUpcoming.occurrence._id), String(lastUpcoming.occurrence._id)]);
        });

        await t.test('timezone and public query bounds are validated and seven-day windows remain bounded', () => {
            assert.throws(
                () => resolvePublicWindow({ window: 'today', timezone: 'Not/AZone', now: NOW }),
                error => error.status === 400
            );
            assert.throws(
                () => resolvePublicWindow({ window: 'today', timezone: 'UTC', limit: MAX_LIMIT + 1, now: NOW }),
                error => error.status === 400
            );
            const fallback = resolvePublicWindow({ window: 'today', now: NOW });
            assert.equal(fallback.timezone, 'UTC');
            const sevenDay = resolvePublicWindow({
                window: 'seven-day', timezone: 'America/New_York', start: '2030-03-08', now: NOW
            });
            assert.equal(sevenDay.localStart, '2030-03-08');
            assert.equal(sevenDay.localEnd, '2030-03-14');
        });

        await t.test('dashboard previews, links, pages, local formatting, and auth boundaries are wired', () => {
            const dashboard = read('server/dist/views/dashboard.ejs');
            const dashboardClient = read('client/dist/public/js/byView/dashboard/main.js');
            const livePage = read('server/dist/views/liveNets.ejs');
            const liveClient = read('client/dist/public/js/byView/liveNets/main.js');
            const schedulePage = read('server/dist/views/netSchedule.ejs');
            const scheduleClient = read('client/dist/public/js/byView/netSchedule/main.js');
            const viewRoutes = read('server/dist/routes/viewRoutes.js');
            const dataRoutes = read('server/dist/routes/dataLiveNetRoutes.js');
            const css = read('client/dist/public/css/app-shell.css');

            assert.match(dashboardClient, /activeNets\.slice\(0, 4\)/);
            assert.match(dashboardClient, /const previewLimit = kind === 'upcoming' \? 3 : 4/);
            assert.match(dashboardClient, /occurrences\.slice\(0, previewLimit\)/);
            assert.match(dashboard, /href="\/views\/livenets"/);
            assert.match(dashboard, /href="\/views\/schedule\?view=today"/);
            assert.match(dashboard, /href="\/views\/schedule\?view=upcoming"/);
            assert.match(css, /\.landing-page \.landing-net-panel \{[\s\S]*height: 26rem/);
            assert.match(viewRoutes, /router\.get\('\/livenets'/);
            assert.match(viewRoutes, /router\.get\('\/schedule'/);
            assert.match(livePage, /No nets are currently live|public-live-state/);
            assert.doesNotMatch(liveClient, /slice\(0, 4\)/);
            assert.match(schedulePage, /Net Schedule/);
            assert.match(schedulePage, /data-schedule-view="today"/);
            assert.match(schedulePage, /data-schedule-view="upcoming"/);
            assert.match(scheduleClient, /formatViewerTime/);
            assert.match(scheduleClient, /window\.setInterval\(refresh, 30000\)/);
            assert.match(dataRoutes, /authCheck\(REQ_CALLSIGN\)/);
        });
    } finally {
        await db.dropDatabase();
        await db.close();
        if (mongod) await mongod.stop();
    }
});
