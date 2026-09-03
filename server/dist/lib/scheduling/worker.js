/* hamlive-oss — MIT License. See LICENSE. */
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { generateOccurrences } = require('./recurrence');
const { getNetSchedule } = require('../../models/netSchedule');
const { getScheduledOccurrence } = require('../../models/scheduledOccurrence');
const { getNetProfile } = require('../../models/netProfile');
const { NetScheduledReminder } = require('../userNotification');
const { processOccurrenceLifecycle } = require('./lifecycle');
const { processLiveNetHardening } = require('./hardening');
const { logger } = require('../logger');

const WORKER_INTERVAL_MS = 60 * 1000;
const HORIZON_DAYS = 90;
const NOTIFICATION_LEAD_MS = 10 * 60 * 1000;
const STALE_CLAIM_MS = 15 * 60 * 1000;
const MAX_NOTIFICATIONS_PER_PASS = 100;
const MAX_NOTIFICATION_ATTEMPTS = 3;
const NOTIFICATION_RETRY_DELAY_MS = 60 * 1000;

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
            durationMinutes: candidate.durationMinutes,
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

    const restoredOverrides = await ScheduledOccurrence.updateMany(
        {
            schedule: schedule._id,
            status: 'cancelled',
            cancellationOrigin: 'schedule-disabled',
            isOverride: true,
            startAt: { $gt: now }
        },
        {
            $set: { status: 'scheduled' },
            $unset: { cancelledAt: 1, cancelledBy: 1, cancellationOrigin: 1 }
        }
    );
    synchronized += restoredOverrides.modifiedCount;

    for (const candidate of candidates) {
        const { occurrence, inserted } = await findOrCreateOccurrence({ candidate, schedule, ScheduledOccurrence });
        if (inserted) created++;
        const restoreDisabled = occurrence.status === 'cancelled' &&
            occurrence.cancellationOrigin === 'schedule-disabled' &&
            occurrence.isOverride === false && occurrence.startAt > now;
        const timingUpdate = {
            $set: {
                originalStartAt: candidate.originalStartAt,
                startAt: candidate.startAt,
                ...(candidate.durationMinutes == null ? {} : { durationMinutes: candidate.durationMinutes })
            },
            ...(candidate.durationMinutes == null ? { $unset: { durationMinutes: 1 } } : {})
        };
        const result = restoreDisabled
            ? await ScheduledOccurrence.updateOne(
                  {
                      _id: occurrence._id,
                      status: 'cancelled',
                      cancellationOrigin: 'schedule-disabled',
                      isOverride: false,
                      startAt: { $gt: now }
                  },
                  {
                      $set: {
                          status: 'scheduled',
                          ...timingUpdate.$set
                      },
                      $unset: {
                          cancelledAt: 1,
                          cancelledBy: 1,
                          cancellationOrigin: 1,
                          ...(timingUpdate.$unset || {})
                      }
                  }
              )
            : await ScheduledOccurrence.updateOne(
                  {
                      _id: occurrence._id,
                      status: 'scheduled',
                      isOverride: false,
                      $or: [
                          { startAt: { $ne: candidate.startAt } },
                          { originalStartAt: { $ne: candidate.originalStartAt } },
                          { durationMinutes: { $ne: candidate.durationMinutes } }
                      ]
                  },
                  timingUpdate
              );
        synchronized += result.modifiedCount;
    }

    const ordinaryFuture = await ScheduledOccurrence.find({
        schedule: schedule._id,
        isOverride: false,
        startAt: { $gt: now },
        $or: [
            { status: 'scheduled' },
            { status: 'cancelled', cancellationOrigin: 'schedule-disabled' }
        ]
    }).select('_id occurrenceKey');
    const staleIds = ordinaryFuture
        .filter(occurrence => !generatedKeys.has(occurrence.occurrenceKey))
        .map(occurrence => occurrence._id);
    const removal = staleIds.length
        ? await ScheduledOccurrence.deleteMany({
              _id: { $in: staleIds },
              isOverride: false,
              $or: [
                  { status: 'scheduled' },
                  { status: 'cancelled', cancellationOrigin: 'schedule-disabled' }
              ]
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
                startAt: { $gt: now, $lte: dueThrough },
                $or: [
                    { 'notification.retryAt': { $exists: false } },
                    { 'notification.retryAt': null },
                    { 'notification.retryAt': { $lte: now } }
                ]
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
                {
                    $set: {
                        'notification.state': 'sent',
                        'notification.sentAt': new Date(now)
                    },
                    $unset: {
                        'notification.claimedAt': 1,
                        'notification.retryAt': 1,
                        'notification.failedAt': 1
                    }
                }
            );
            totals.sent += sent.modifiedCount;
        } catch (error) {
            const retryAt = new Date(now.getTime() + NOTIFICATION_RETRY_DELAY_MS);
            const canRetry =
                occurrence.notification.attempts < MAX_NOTIFICATION_ATTEMPTS &&
                retryAt < occurrence.startAt;

            await ScheduledOccurrence.updateOne(
                { _id: occurrence._id, 'notification.state': 'claimed', 'notification.claimedAt': claimedAt },
                canRetry
                    ? {
                          $set: {
                              'notification.state': 'pending',
                              'notification.retryAt': retryAt,
                              'notification.failedAt': new Date(now)
                          },
                          $unset: { 'notification.claimedAt': 1 }
                      }
                    : {
                          $set: {
                              'notification.state': 'failed',
                              'notification.failedAt': new Date(now)
                          },
                          $unset: {
                              'notification.claimedAt': 1,
                              'notification.retryAt': 1
                          }
                      }
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
    const lifecycle = await processOccurrenceLifecycle({ now, db });
    const hardening = await processLiveNetHardening({ now, db });
    return { materialized, notifications, lifecycle, hardening };
};

const containsActivity = value => typeof value === 'number'
    ? value > 0
    : value && typeof value === 'object' && Object.values(value).some(containsActivity);

let passRunning = false;
const startSchedulingWorker = ({ intervalMs = WORKER_INTERVAL_MS, runPass = runSchedulingPass } = {}) => {
    const run = async () => {
        if (passRunning) return;
        passRunning = true;
        try {
            const result = await runPass();
            const activity = containsActivity(result);
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
    MAX_NOTIFICATION_ATTEMPTS,
    NOTIFICATION_RETRY_DELAY_MS,
    materializeSchedule,
    materializeEnabledSchedules,
    processDueNotifications,
    runSchedulingPass,
    startSchedulingWorker
};
