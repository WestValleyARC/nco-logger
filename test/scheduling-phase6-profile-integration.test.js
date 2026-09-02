const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const {
    recurrenceSummary,
    loadProfileSchedulingSummaries
} = require('../server/dist/lib/scheduling/profileSummary');
const { transformNetProfile } = require('../server/dist/lib/controllers/followHelpers');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const NOW = new Date('2030-01-01T18:00:00.000Z');

test('Phase 6 My Nets and Favorites scheduling integration', async t => {
    const externalUri = process.env.TEST_MONGODB_URI;
    let mongod;
    if (externalUri) assert.match(externalUri, /scheduling_phase6_test/, 'TEST_MONGODB_URI must target the Phase 6 test database');
    if (!externalUri) {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        mongod = await MongoMemoryServer.create();
    }
    const db = await mongoose.createConnection(externalUri || mongod.getUri()).asPromise();
    const NetProfile = require('../server/dist/models/netProfile').getNetProfile(db);
    const NetSchedule = require('../server/dist/models/netSchedule').getNetSchedule(db);
    const ScheduledOccurrence = require('../server/dist/models/scheduledOccurrence').getScheduledOccurrence(db);
    const LiveNet = require('../server/dist/models/liveNet').getLiveNet(db);
    await Promise.all([NetProfile.init(), NetSchedule.init(), ScheduledOccurrence.init(), LiveNet.init()]);

    const ownerId = new mongoose.Types.ObjectId();
    let sequence = 0;
    const createProfile = overrides => NetProfile.create({
        title: `Phase Six Net ${++sequence}`,
        frequency: '146.520', mode: 'FM', owners: [ownerId], permanent: true, ...overrides
    });
    const createSchedule = (profile, overrides = {}) => NetSchedule.create({
        netProfile: profile._id, type: 'weekly', timezone: 'America/Phoenix', localStartTime: '19:00',
        startDate: '2030-01-01', weekdays: [4], ...overrides
    });
    const createOccurrence = (profile, schedule, startAt, status = 'scheduled') => ScheduledOccurrence.create({
        schedule: schedule._id, netProfile: profile._id, occurrenceKey: `phase6-${++sequence}`,
        originalStartAt: startAt, startAt, status
    });
    const createLive = async (profile, { started, occurrence = null, link = true } = {}) => {
        const liveNet = await LiveNet.create({
            netProfile: profile._id, occurrence: occurrence?._id, netControl: ownerId, started,
            startedAt: started ? NOW : null, url: `/views/livenet/${profile._id}`, lookupTable: {}
        });
        if (link) {
            profile.liveNet = liveNet._id;
            await profile.save({ validateBeforeSave: false });
        }
        if (occurrence) {
            occurrence.liveNet = liveNet._id;
            await occurrence.save();
        }
        return liveNet;
    };

    try {
        await t.test('manual profiles remain valid and recurrence summaries are human-readable', async () => {
            const manual = await createProfile();
            const summaries = await loadProfileSchedulingSummaries({ profiles: [manual], now: NOW, db });
            assert.deepEqual(summaries.get(String(manual._id)), {
                enabled: false, summary: null, timezone: null, nextOccurrence: null,
                preparing: false, onAir: false, canPrepare: false, preparationOpensAt: null, actionUrl: null
            });
            assert.equal(transformNetProfile(manual, summaries.get(String(manual._id))).scheduling.enabled, false);
            assert.equal(recurrenceSummary({ type: 'weekly', weekdays: [1, 3, 5], localStartTime: '18:30' }), 'Monday, Wednesday, Friday · 6:30 PM');
            assert.equal(recurrenceSummary({ type: 'monthlyPosition', monthlyOrdinal: 1, monthlyWeekday: 4, localStartTime: '19:00' }), 'First Thursday · 7:00 PM');
            assert.equal(recurrenceSummary({ type: 'monthlyDate', monthlyDay: 15, localStartTime: '20:00' }), '15th of each month · 8:00 PM');
        });

        await t.test('earliest eligible occurrence has no 7-day or 30-day ceiling and terminal states are excluded', async () => {
            const profile = await createProfile();
            const schedule = await createSchedule(profile);
            for (const status of ['cancelled', 'missed', 'completed']) {
                await createOccurrence(profile, schedule, new Date('2030-01-02T01:00:00Z'), status);
            }
            const farFuture = await createOccurrence(profile, schedule, new Date('2030-03-15T02:00:00Z'));
            const summary = (await loadProfileSchedulingSummaries({ profiles: [profile], now: NOW, db })).get(String(profile._id));
            assert.equal(summary.enabled, true);
            assert.equal(summary.summary, 'Weekly · Thursday · 7:00 PM');
            assert.equal(summary.timezone, 'America/Phoenix');
            assert.equal(summary.nextOccurrence.id, String(farFuture._id));
            assert.ok(new Date(summary.nextOccurrence.startAt) - NOW > 30 * 86400000);
        });

        await t.test('preparing and genuinely started sessions are distinct from populated unstarted links', async () => {
            const preparingProfile = await createProfile();
            const preparingSchedule = await createSchedule(preparingProfile);
            const preparingOccurrence = await createOccurrence(preparingProfile, preparingSchedule, new Date('2030-01-01T18:20:00Z'), 'preparing');
            await createLive(preparingProfile, { started: false, occurrence: preparingOccurrence });

            const liveProfile = await createProfile();
            const liveSchedule = await createSchedule(liveProfile);
            const liveOccurrence = await createOccurrence(liveProfile, liveSchedule, NOW, 'live');
            await createLive(liveProfile, { started: true, occurrence: liveOccurrence });

            const unstartedProfile = await createProfile();
            const unstartedSchedule = await createSchedule(unstartedProfile);
            const future = await createOccurrence(unstartedProfile, unstartedSchedule, new Date('2030-01-10T19:00:00Z'));
            await createLive(unstartedProfile, { started: false });

            const summaries = await loadProfileSchedulingSummaries({
                profiles: [preparingProfile, liveProfile, unstartedProfile], now: NOW, db
            });
            assert.equal(summaries.get(String(preparingProfile._id)).preparing, true);
            assert.equal(summaries.get(String(preparingProfile._id)).onAir, false);
            assert.equal(summaries.get(String(liveProfile._id)).onAir, true);
            assert.equal(summaries.get(String(unstartedProfile._id)).onAir, false);
            assert.equal(summaries.get(String(unstartedProfile._id)).nextOccurrence.id, String(future._id));
        });

        await t.test('preparation availability matches the Phase 4 thirty-minute window', async () => {
            const inWindowProfile = await createProfile();
            const schedule = await createSchedule(inWindowProfile);
            await createOccurrence(inWindowProfile, schedule, new Date('2030-01-01T18:20:00Z'));
            const earlyProfile = await createProfile();
            const earlySchedule = await createSchedule(earlyProfile);
            await createOccurrence(earlyProfile, earlySchedule, new Date('2030-01-01T20:00:00Z'));
            const summaries = await loadProfileSchedulingSummaries({ profiles: [inWindowProfile, earlyProfile], now: NOW, db });
            assert.equal(summaries.get(String(inWindowProfile._id)).canPrepare, true);
            assert.equal(summaries.get(String(earlyProfile._id)).canPrepare, false);
        });

        await t.test('similar names remain independently associated by profile ID and owner-invisible profiles remain manageable', async () => {
            const first = await createProfile({ title: 'Similar Name A', invisible: true });
            const second = await createProfile({ title: 'Similar Name B' });
            const firstSchedule = await createSchedule(first);
            const secondSchedule = await createSchedule(second);
            const firstOccurrence = await createOccurrence(first, firstSchedule, new Date('2030-02-01T19:00:00Z'));
            const secondOccurrence = await createOccurrence(second, secondSchedule, new Date('2030-02-02T19:00:00Z'));
            const summaries = await loadProfileSchedulingSummaries({ profiles: [first, second], now: NOW, db });
            assert.equal(summaries.get(String(first._id)).nextOccurrence.id, String(firstOccurrence._id));
            assert.equal(summaries.get(String(second._id)).nextOccurrence.id, String(secondOccurrence._id));
            assert.equal(summaries.size, 2);
        });

        await t.test('list paths are batched and the approved UIs render scheduling state with viewer-local time', () => {
            const helper = read('server/dist/lib/scheduling/profileSummary.js');
            const netProfileController = read('server/dist/controllers/netProfileController.js');
            const followController = read('server/dist/controllers/followController.js');
            const myNets = read('client/dist/public/js/byView/myNets/main.js');
            const favorites = read('client/src/public/js/lib/widgets.ts');
            assert.match(helper, /Promise\.all\(\[/);
            assert.doesNotMatch(netProfileController, /req\.user\.myNets\.map\(async/);
            assert.doesNotMatch(followController, /Promise\.all\(req\.user\.following\.map/);
            assert.match(myNets, /\/occurrences\/\$\{scheduling\.nextOccurrence\.id\}\/prepare/);
            assert.match(myNets, /Intl\.DateTimeFormat/);
            assert.match(favorites, /scheduling\?\.onAir/);
            assert.match(favorites, /Starts Soon/);
            assert.match(favorites, /Intl\.DateTimeFormat/);
        });
    } finally {
        await db.dropDatabase();
        await db.close();
        if (mongod) await mongod.stop();
    }
});
