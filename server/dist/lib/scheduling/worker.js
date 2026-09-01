/* hamlive-oss — MIT License. See LICENSE. */
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { generateOccurrences } = require('./recurrence');
const { getNetSchedule } = require('../../models/netSchedule');
const { getScheduledOccurrence } = require('../../models/scheduledOccurrence');
const { getNetProfile } = require('../../models/netProfile');
const { NetScheduledReminder } = require('../userNotification');
const { logger } = require('../logger');

const WORKER_INTERVAL_MS = 60 * 1000;
const HORIZON_DAYS = 90;
const NOTIFICATION_LEAD_MS = 30 * 60 * 1000;
const STALE_CLAIM_MS = 15 * 60 * 1000;
const MAX_NOTIFICATIONS_PER_PASS = 100;

const getModels = db => ({
    NetSchedule: getNetSchedule(db),
    ScheduledOccurrence: getScheduledOccurrence(db),
    NetProfile: getNetProfile(db)
});

const materializationRange = (schedule, now) => {
    if (schedule.type === 'oneTime') {
        return { rangeStartDate: schedule.startDate, rangeEndDate: schedule.startDate };
    }
    const localNow = DateTime.fromJSDate(now, { zone: schedule.timezone });
    return {
        rangeStartDate: localNow.toFormat('yyyy-MM-dd'),
        rangeEndDate: localNow.plus({ days: HORIZON_DAYS }).toFormat('yyyy-MM-dd')
    };
};

const findOrCreateOccurrence = async ({ candidate, schedule, ScheduledOccurrence }) => {
    const identity = { schedule: schedule._id, occurrenceKey: candidate.occurrenceKey };
    const existing = await ScheduledOccurrence.findOne(identity);
    if (existing) return { occurrence: existing, inserted: false };
    try {
        const occurrence = await ScheduledOccurrence.create({
            ...identity,
            netProfile: schedule.netProfile,
            originalStartAt: candidate.originalStartAt,
            startAt: candidate.startAt,
            isOverride: false,
            status: 'scheduled',
            notification: { state: 'pending', attempts: 0 }
        });
        return { occurrence, inserted: true };
    } catch (error) {
        if (error?.code !== 11000) throw error;
        return { occurrence: await ScheduledOccurrence.findOne(identity), inserted: false };
    }
};

const materializeSchedule = async ({ schedule, now = new Date(), db = mongoose.connection }) => {
    if (!schedule.enabled) return { created: 0, synchronized: 0, removed: 0 };
    const { ScheduledOccurrence } = getModels(db);
    const range = materializationRange(schedule, now);
    const candidates = generateOccurrences(schedule, range).filter(candidate => candidate.startAt > now);
    const generatedKeys = new Set(candidates.map(candidate => candidate.occurrenceKey));
    let created = 0;
    let synchronized = 0;

    for (const candidate of candidates) {
        const { occurrence, inserted } = await findOrCreateOccurrence({ candidate, schedule, ScheduledOccurrence });
        if (inserted) created++;
        const result = await ScheduledOccurrence.updateOne(
            { _id: occurrence._id, status: 'scheduled', isOverride: false, startAt: { $ne: candidate.startAt } },
            { $set: { startAt: candidate.startAt } }
        );
        synchronized += result.modifiedCount;
    }

    const ordinaryFuture = await ScheduledOccurrence.find({
        schedule: schedule._id,
        status: 'scheduled',
        isOverride: false,
        startAt: { $gt: now }
    }).select('_id occurrenceKey');
    const staleIds = ordinaryFuture
        .filter(occurrence => !generatedKeys.has(occurrence.occurrenceKey))
        .map(occurrence => occurrence._id);
    const removal = staleIds.length
        ? await ScheduledOccurrence.deleteMany({
              _id: { $in: staleIds },
              status: 'scheduled',
              isOverride: false
          })
        : { deletedCount: 0 };

    return { created, synchronized, removed: removal.deletedCount };
};

const materializeEnabledSchedules = async ({ now = new Date(), db = mongoose.connection } = {}) => {
    const { NetSchedule } = getModels(db);
    const schedules = await NetSchedule.find({ enabled: true });
    const totals = { created: 0, synchronized: 0, removed: 0 };
    for (const schedule of schedules) {
        try {
            const result = await materializeSchedule({ schedule, now, db });
            Object.keys(totals).forEach(key => (totals[key] += result[key]));
        } catch (error) {
            logger.error(`Scheduling materialization failed for schedule ${schedule._id}: ${error.message}`);
        }
    }
    return totals;
};

const sendScheduledNotification = async ({ occurrence, netProfile, schedule, db }) => {
    if (!netProfile.followers?.length) return false;
    const email = new NetScheduledReminder({
        netProfileDoc: netProfile,
        startAt: occurrence.startAt,
        timezone: schedule.timezone
    });
    return email.sendMailToUPIDs({ upids: netProfile.followers, db, throwOnError: true });
};

const expireIneligibleNotifications = async ({ now, ScheduledOccurrence }) => {
    const failedAt = new Date(now);
    const pastDue = await ScheduledOccurrence.updateMany(
        { status: 'scheduled', 'notification.state': 'pending', startAt: { $lte: now } },
        { $set: { 'notification.state': 'failed', 'notification.failedAt': failedAt } }
    );
    const staleClaimed = await ScheduledOccurrence.updateMany(
        {
            'notification.state': 'claimed',
            'notification.claimedAt': { $lte: new Date(now.getTime() - STALE_CLAIM_MS) }
        },
        { $set: { 'notification.state': 'failed', 'notification.failedAt': failedAt } }
    );
    return { expired: pastDue.modifiedCount, staleClaims: staleClaimed.modifiedCount };
};

const processDueNotifications = async ({
    now = new Date(),
    db = mongoose.connection,
    sendNotification = sendScheduledNotification
} = {}) => {
    const { NetSchedule, ScheduledOccurrence, NetProfile } = getModels(db);
    const totals = await expireIneligibleNotifications({ now, ScheduledOccurrence });
    totals.sent = 0;
    totals.failed = 0;
    const dueThrough = new Date(now.getTime() + NOTIFICATION_LEAD_MS);

    for (let processed = 0; processed < MAX_NOTIFICATIONS_PER_PASS; processed++) {
        const claimedAt = new Date(now);
        const occurrence = await ScheduledOccurrence.findOneAndUpdate(
            {
                status: 'scheduled',
                'notification.state': 'pending',
                startAt: { $gt: now, $lte: dueThrough }
            },
            {
                $set: { 'notification.state': 'claimed', 'notification.claimedAt': claimedAt },
                $inc: { 'notification.attempts': 1 }
            },
            { new: true, sort: { startAt: 1 } }
        );
        if (!occurrence) break;

        try {
            const [schedule, netProfile] = await Promise.all([
                NetSchedule.findOne({ _id: occurrence.schedule, enabled: true }),
                NetProfile.findById(occurrence.netProfile)
            ]);
            if (!schedule || !netProfile) throw new Error('Scheduled notification references unavailable data');
            await sendNotification({ occurrence, netProfile, schedule, db });
            const sent = await ScheduledOccurrence.updateOne(
                { _id: occurrence._id, 'notification.state': 'claimed', 'notification.claimedAt': claimedAt },
                { $set: { 'notification.state': 'sent', 'notification.sentAt': new Date(now) } }
            );
            totals.sent += sent.modifiedCount;
        } catch (error) {
            await ScheduledOccurrence.updateOne(
                { _id: occurrence._id, 'notification.state': 'claimed', 'notification.claimedAt': claimedAt },
                { $set: { 'notification.state': 'failed', 'notification.failedAt': new Date(now) } }
            );
            totals.failed++;
            logger.error(`Scheduled notification failed for occurrence ${occurrence._id}: ${error.message}`);
        }
    }
    return totals;
};

const runSchedulingPass = async ({ now = new Date(), db = mongoose.connection, sendNotification } = {}) => {
    const materialized = await materializeEnabledSchedules({ now, db });
    const notifications = await processDueNotifications({ now, db, sendNotification });
    return { materialized, notifications };
};

let passRunning = false;
const startSchedulingWorker = ({ intervalMs = WORKER_INTERVAL_MS, runPass = runSchedulingPass } = {}) => {
    const run = async () => {
        if (passRunning) return;
        passRunning = true;
        try {
            const result = await runPass();
            const activity = Object.values(result.materialized).some(Boolean) || Object.values(result.notifications).some(Boolean);
            if (activity) logger.info(`Scheduling worker pass: ${JSON.stringify(result)}`);
        } catch (error) {
            logger.error(`Scheduling worker pass failed: ${error.message}`);
        } finally {
            passRunning = false;
        }
    };
    setImmediate(run);
    const timer = setInterval(run, intervalMs);
    timer.unref();
    logger.info(`Scheduling worker started (${intervalMs}ms interval)`);
    return () => clearInterval(timer);
};

module.exports = {
    WORKER_INTERVAL_MS,
    HORIZON_DAYS,
    NOTIFICATION_LEAD_MS,
    STALE_CLAIM_MS,
    materializeSchedule,
    materializeEnabledSchedules,
    processDueNotifications,
    runSchedulingPass,
    startSchedulingWorker
};
