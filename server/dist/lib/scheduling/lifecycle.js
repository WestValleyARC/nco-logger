/* hamlive-oss — MIT License. See LICENSE. */
const mongoose = require('mongoose');
const { netOwnerCheck } = require('../sharedNetOps');
const stationProfiles = require('../stationProfileService');
const { cleanupNetChat } = require('../localChat');
const { realtimeClients } = require('../realtimeClients');
const { getNetProfile } = require('../../models/netProfile');
const { getNetSchedule } = require('../../models/netSchedule');
const { getScheduledOccurrence } = require('../../models/scheduledOccurrence');
const { getLiveNet } = require('../../models/liveNet');
const { getStationInteraction } = require('../../models/stationInteraction');
const { getFlexOption } = require('../../models/flexOptions');
const { logger } = require('../logger');

const PREPARATION_WINDOW_MS = 30 * 60 * 1000;
const GRACE_PERIOD_MS = 30 * 60 * 1000;
const DEFAULT_AWAY_IN_MS = 25000;

class LifecycleError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const getModels = db => ({
    NetProfile: getNetProfile(db),
    NetSchedule: getNetSchedule(db),
    ScheduledOccurrence: getScheduledOccurrence(db),
    LiveNet: getLiveNet(db),
    StationInteraction: getStationInteraction(db),
    FlexOption: getFlexOption(db)
});

const timingFor = occurrence => ({
    opensAt: new Date(occurrence.startAt.getTime() - PREPARATION_WINDOW_MS),
    graceEndsAt: new Date(occurrence.startAt.getTime() + GRACE_PERIOD_MS)
});

const configuredAwayInMs = async (db, session = null) => {
    const { FlexOption } = getModels(db);
    const options = await FlexOption.findOne({ scope: 'global' }).session(session).lean();
    return Number(options?.option?.awayInMs) || DEFAULT_AWAY_IN_MS;
};

const hasRecentNco = async ({ liveNetId, now, awayInMs, db, session = null }) => {
    const { StationInteraction } = getModels(db);
    return Boolean(await StationInteraction.exists({
        liveNet: liveNetId,
        role: 'netcontrol',
        checkedState: true,
        lastSeen: { $gte: new Date(now.getTime() - awayInMs) }
    }).session(session));
};

const canAccessScheduledPreparation = ({ netProfile, liveNet, occurrence, user, now = new Date() }) => {
    if (!liveNet?.occurrence || liveNet.started) return true;
    if (!occurrence || occurrence.status !== 'preparing') return false;
    if (now >= timingFor(occurrence).graceEndsAt) return false;
    const userId = String(user?._id || user?.id || '');
    return netProfile.owners.some(owner => String(owner) === userId) || String(liveNet.netControl) === userId;
};

const prepareOccurrence = async ({ npid, occurrenceId, user, now = new Date(), db = mongoose.connection }) => {
    const { NetProfile, NetSchedule, ScheduledOccurrence, LiveNet, StationInteraction } = getModels(db);
    const preliminaryOwner = await netOwnerCheck({ npid, upid: user._id, db });
    if (!preliminaryOwner.npresult) throw new LifecycleError(404, 'Net profile not found');
    if (!preliminaryOwner.confirmed) throw new LifecycleError(403, 'Net profile owner access required');
    const profileState = await stationProfiles.syncParticipantProfile({
        callSign: user.callSign,
        name: user.displayName,
        location: user.location,
        editorCallSign: user.callSign,
        editorUserId: user._id,
        db
    });
    const session = await db.startSession();
    let result;
    try {
        await session.withTransaction(async () => {
            const { confirmed, npresult: netProfile } = await netOwnerCheck({
                npid,
                upid: user._id,
                db,
                session
            });
            if (!netProfile) throw new LifecycleError(404, 'Net profile not found');
            if (!confirmed) throw new LifecycleError(403, 'Net profile owner access required');
            const schedule = await NetSchedule.findOne({ netProfile: npid }).session(session);
            if (!schedule) throw new LifecycleError(404, 'Schedule not found');
            const occurrence = await ScheduledOccurrence.findOne({
                _id: occurrenceId,
                netProfile: npid,
                schedule: schedule._id
            }).session(session);
            if (!occurrence) throw new LifecycleError(404, 'Scheduled occurrence not found');

            const { opensAt, graceEndsAt } = timingFor(occurrence);
            if (now < opensAt) throw new LifecycleError(409, 'Preparation window has not opened');
            if (now >= graceEndsAt) throw new LifecycleError(409, 'Preparation grace period has ended');

            if (occurrence.status === 'preparing' && occurrence.liveNet) {
                const existing = await LiveNet.findById(occurrence.liveNet).session(session);
                if (existing && String(netProfile.liveNet) === String(existing._id)) {
                    result = { occurrence, liveNet: existing, idempotent: true };
                    return;
                }
                throw new LifecycleError(409, 'Prepared occurrence has inconsistent LiveNet state');
            }
            if (occurrence.status !== 'scheduled') {
                throw new LifecycleError(409, `Occurrence cannot be prepared from ${occurrence.status} status`);
            }
            if (netProfile.liveNet || await LiveNet.exists({ netProfile: npid }).session(session)) {
                throw new LifecycleError(409, 'Net profile already has an active or preparing LiveNet');
            }

            const [interaction] = await StationInteraction.create([{
                netProfile: netProfile._id,
                callSign: user.callSign,
                displayName: profileState.fields.name.value,
                location: profileState.fields.location.value,
                photo: user.photo,
                email: user.email,
                createdBy: 'admin',
                role: 'netcontrol',
                checkedState: true,
                checkedInAt: now,
                lastSeen: now,
                userProfile: user._id,
                chatEnabled: user.flexOptions?.option?.chat ?? true,
                sigReports: { rst: {} }
            }], { session });
            const shouldStart = now >= occurrence.startAt;
            const [liveNet] = await LiveNet.create([{
                lookupTable: { [user.callSign]: { stationInteraction: interaction._id } },
                netProfile: netProfile._id,
                occurrence: occurrence._id,
                netControl: user._id,
                countdownTimer: 0,
                started: shouldStart,
                startedAt: shouldStart ? now : null,
                url: `/views/livenet/${netProfile._id}`
            }], { session });
            interaction.liveNet = liveNet._id;
            await interaction.save({ session });
            netProfile.liveNet = liveNet._id;
            await netProfile.save({ session, validateBeforeSave: false });
            occurrence.liveNet = liveNet._id;
            occurrence.status = shouldStart ? 'live' : 'preparing';
            occurrence.preparedAt = now;
            if (shouldStart) occurrence.startedAt = now;
            await occurrence.save({ session });
            result = { occurrence, liveNet, idempotent: false };
        });
        return result;
    } finally {
        await session.endSession();
    }
};

const transitionPreparedOccurrence = async ({ occurrenceId, now = new Date(), db = mongoose.connection }) => {
    const { ScheduledOccurrence, LiveNet } = getModels(db);
    const session = await db.startSession();
    let transitioned = false;
    try {
        await session.withTransaction(async () => {
            const occurrence = await ScheduledOccurrence.findOne({
                _id: occurrenceId,
                status: 'preparing',
                startAt: { $lte: now }
            }).session(session);
            if (!occurrence || now >= timingFor(occurrence).graceEndsAt || !occurrence.liveNet) return;
            const liveNet = await LiveNet.findOne({
                _id: occurrence.liveNet,
                occurrence: occurrence._id,
                started: false
            }).session(session);
            if (!liveNet) return;
            const awayInMs = await configuredAwayInMs(db, session);
            if (!await hasRecentNco({ liveNetId: liveNet._id, now, awayInMs, db, session })) return;
            occurrence.status = 'live';
            occurrence.startedAt = now;
            liveNet.started = true;
            liveNet.startedAt = now;
            await Promise.all([occurrence.save({ session }), liveNet.save({ session })]);
            transitioned = true;
        });
        return transitioned;
    } finally {
        await session.endSession();
    }
};

const cleanPreparation = async ({ occurrence, now, finalStatus, cancelledBy, db, session }) => {
    const { NetProfile, LiveNet, StationInteraction } = getModels(db);
    const liveNetId = occurrence.liveNet;
    if (liveNetId) {
        const liveNet = await LiveNet.findOne({
            _id: liveNetId,
            occurrence: occurrence._id,
            started: false
        }).session(session);
        if (!liveNet) throw new LifecycleError(409, 'Preparation LiveNet integrity check failed');
        await StationInteraction.deleteMany({ liveNet: liveNetId }).session(session);
        await liveNet.deleteOne({ session });
        await NetProfile.updateOne(
            { _id: occurrence.netProfile, liveNet: liveNetId },
            { $unset: { liveNet: 1 } },
            { session }
        );
    }
    occurrence.status = finalStatus;
    occurrence.liveNet = undefined;
    if (finalStatus === 'missed') occurrence.missedAt = now;
    if (finalStatus === 'cancelled') {
        occurrence.cancelledAt = now;
        occurrence.cancelledBy = cancelledBy;
    }
    await occurrence.save({ session });
    return liveNetId;
};

const finalizePreparation = async ({ occurrenceId, finalStatus, cancelledBy, npid, user, now, db }) => {
    const { NetSchedule, ScheduledOccurrence } = getModels(db);
    const session = await db.startSession();
    let liveNetId;
    let netProfileId;
    try {
        await session.withTransaction(async () => {
            let scheduleId;
            if (finalStatus === 'cancelled') {
                const { confirmed, npresult } = await netOwnerCheck({ npid, upid: user._id, db, session });
                if (!npresult) throw new LifecycleError(404, 'Net profile not found');
                if (!confirmed) throw new LifecycleError(403, 'Net profile owner access required');
                const schedule = await NetSchedule.findOne({ netProfile: npid }).session(session);
                if (!schedule) throw new LifecycleError(404, 'Schedule not found');
                scheduleId = schedule._id;
            }
            const allowedStatus = finalStatus === 'cancelled' ? 'preparing' : { $in: ['scheduled', 'preparing'] };
            const occurrence = await ScheduledOccurrence.findOne({
                _id: occurrenceId,
                ...(npid ? { netProfile: npid } : {}),
                ...(scheduleId ? { schedule: scheduleId } : {}),
                status: allowedStatus,
                ...(finalStatus === 'missed' ? { startAt: { $lte: new Date(now.getTime() - GRACE_PERIOD_MS) } } : {})
            }).session(session);
            if (!occurrence) return;
            netProfileId = occurrence.netProfile;
            liveNetId = await cleanPreparation({ occurrence, now, finalStatus, cancelledBy, db, session });
        });
        if (liveNetId) {
            realtimeClients.close(String(netProfileId));
            try {
                await cleanupNetChat(netProfileId, db);
            } catch (error) {
                logger.warn(`Preparation chat cleanup failed for net ${netProfileId}: ${error.message}`);
            }
        }
        return Boolean(netProfileId);
    } finally {
        await session.endSession();
    }
};

const cancelPreparation = async ({ npid, occurrenceId, user, now = new Date(), db = mongoose.connection }) => {
    const { ScheduledOccurrence } = getModels(db);
    const cancelled = await finalizePreparation({
        occurrenceId,
        finalStatus: 'cancelled',
        cancelledBy: user._id,
        npid,
        user,
        now,
        db
    });
    if (!cancelled) throw new LifecycleError(409, 'Only a preparing occurrence can use preparation cancellation');
    return ScheduledOccurrence.findById(occurrenceId);
};

const processOccurrenceLifecycle = async ({ now = new Date(), db = mongoose.connection } = {}) => {
    const { ScheduledOccurrence } = getModels(db);
    const totals = { transitioned: 0, missed: 0 };
    const due = await ScheduledOccurrence.find({ status: 'preparing', startAt: { $lte: now } }).select('_id startAt');
    for (const occurrence of due) {
        try {
            if (now >= timingFor(occurrence).graceEndsAt) {
                totals.missed += Number(await finalizePreparation({
                    occurrenceId: occurrence._id,
                    finalStatus: 'missed',
                    now,
                    db
                }));
            } else {
                totals.transitioned += Number(await transitionPreparedOccurrence({ occurrenceId: occurrence._id, now, db }));
            }
        } catch (error) {
            logger.error(`Scheduled lifecycle failed for occurrence ${occurrence._id}: ${error.message}`);
        }
    }
    const unprepared = await ScheduledOccurrence.find({
        status: 'scheduled',
        startAt: { $lte: new Date(now.getTime() - GRACE_PERIOD_MS) }
    }).select('_id');
    for (const occurrence of unprepared) {
        try {
            totals.missed += Number(await finalizePreparation({
                occurrenceId: occurrence._id,
                finalStatus: 'missed',
                now,
                db
            }));
        } catch (error) {
            logger.error(`Scheduled missed transition failed for occurrence ${occurrence._id}: ${error.message}`);
        }
    }
    return totals;
};

module.exports = {
    PREPARATION_WINDOW_MS,
    GRACE_PERIOD_MS,
    LifecycleError,
    timingFor,
    hasRecentNco,
    canAccessScheduledPreparation,
    prepareOccurrence,
    transitionPreparedOccurrence,
    cancelPreparation,
    processOccurrenceLifecycle
};
