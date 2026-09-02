/* hamlive-oss — MIT License. See LICENSE. */

const mongoose = require('mongoose');
const { getNetProfile } = require('../../models/netProfile');
const { getLiveNet } = require('../../models/liveNet');
const { getStationInteraction } = require('../../models/stationInteraction');
const { getScheduledOccurrence } = require('../../models/scheduledOccurrence');
const { getLiveNetAutoClose } = require('../../models/liveNetAutoClose');
const { closeNet } = require('../sharedNetOps');
const { cleanupNetChat } = require('../localChat');
const { realtimeClients } = require('../realtimeClients');
const { NetInactivityAutoClose } = require('../userNotification');
const { logger } = require('../logger');

const NCO_ABANDONMENT_MS = 60 * 60 * 1000;
const CLAIM_STALE_MS = 15 * 60 * 1000;
const PREPARATION_GRACE_MS = 30 * 60 * 1000;
const MAX_AUTO_CLOSE_EMAILS_PER_PASS = 50;

const getModels = db => ({
    NetProfile: getNetProfile(db),
    LiveNet: getLiveNet(db),
    StationInteraction: getStationInteraction(db),
    ScheduledOccurrence: getScheduledOccurrence(db),
    LiveNetAutoClose: getLiveNetAutoClose(db)
});

const id = value => value == null ? '' : String(value);

const observeAutoClose = async ({ liveNet, profile, lastNcoPresenceAt, now, LiveNetAutoClose }) => {
    try {
        return await LiveNetAutoClose.findOneAndUpdate(
            { liveNet: liveNet._id },
            {
                $setOnInsert: {
                    liveNet: liveNet._id,
                    netProfile: profile._id,
                    firstObservedAt: now,
                    closeState: 'pending',
                    email: { state: 'pending' }
                },
                $set: {
                    netTitle: profile.title,
                    ownerIds: profile.owners,
                    lastNcoPresenceAt: lastNcoPresenceAt || null
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    } catch (error) {
        if (error?.code !== 11000) throw error;
        return LiveNetAutoClose.findOne({ liveNet: liveNet._id });
    }
};

const recoverAutoCloseClaims = async ({ now = new Date(), db = mongoose.connection } = {}) => {
    const { LiveNet, LiveNetAutoClose } = getModels(db);
    const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);
    const staleCloseClaims = await LiveNetAutoClose.find({
        closeState: 'claimed',
        closeClaimedAt: { $lte: staleBefore }
    });
    let closeClaimsRecovered = 0;
    for (const event of staleCloseClaims) {
        const liveNet = await LiveNet.findById(event.liveNet);
        if (liveNet) {
            await LiveNet.updateOne({ _id: liveNet._id, closing: true }, { $set: { closing: false } });
            closeClaimsRecovered += (await LiveNetAutoClose.updateOne(
                { _id: event._id, closeState: 'claimed', closeClaimedAt: event.closeClaimedAt },
                { $set: { closeState: 'pending' }, $unset: { closeClaimedAt: 1, closeCommittedAt: 1 } }
            )).modifiedCount;
        } else if (event.closeCommittedAt) {
            closeClaimsRecovered += (await LiveNetAutoClose.updateOne(
                { _id: event._id, closeState: 'claimed', closeClaimedAt: event.closeClaimedAt },
                { $set: { closeState: 'completed', closeCompletedAt: event.closeClaimedAt } }
            )).modifiedCount;
        } else {
            closeClaimsRecovered += (await LiveNetAutoClose.updateOne(
                { _id: event._id, closeState: 'claimed', closeClaimedAt: event.closeClaimedAt },
                { $set: { closeState: 'pending' }, $unset: { closeClaimedAt: 1, closeCommittedAt: 1 } }
            )).modifiedCount;
        }
    }
    const ambiguousEmails = await LiveNetAutoClose.updateMany(
        {
            closeState: 'completed',
            'email.state': 'claimed',
            'email.claimedAt': { $lte: staleBefore }
        },
        { $set: { 'email.state': 'failed', 'email.failedAt': now } }
    );
    return { closeClaimsRecovered, ambiguousEmailsFailed: ambiguousEmails.modifiedCount };
};

const occurrenceCompatible = ({ liveNet, occurrence }) => {
    if (!liveNet.occurrence) return true;
    if (!occurrence) return false;
    if (id(occurrence.netProfile) !== id(liveNet.netProfile) || id(occurrence.liveNet) !== id(liveNet._id)) return false;
    return liveNet.started === true ? occurrence.status === 'live' : occurrence.status === 'preparing';
};

const reconcileOccurrenceAfterLiveNetRemoval = async ({ liveNet, occurrence, now, ScheduledOccurrence }) => {
    if (!occurrence || id(occurrence.liveNet) !== id(liveNet._id)) return false;
    let status = occurrence.status;
    const update = { $unset: { liveNet: 1 } };
    if (status === 'live') {
        update.$set = { status: 'completed', completedAt: now };
    } else if (status === 'preparing') {
        const missed = now >= new Date(occurrence.startAt.getTime() + PREPARATION_GRACE_MS);
        update.$set = missed ? { status: 'missed', missedAt: now } : { status: 'scheduled' };
        if (!missed) update.$unset.preparedAt = 1;
    }
    return Boolean((await ScheduledOccurrence.updateOne(
        { _id: occurrence._id, liveNet: liveNet._id, status },
        update
    )).modifiedCount);
};

const reconcileLiveNetPersistence = async ({ now = new Date(), db = mongoose.connection } = {}) => {
    const { NetProfile, LiveNet, StationInteraction, ScheduledOccurrence } = getModels(db);
    const liveNets = await LiveNet.find({});
    const profileIds = [...new Set(liveNets.map(item => id(item.netProfile)))];
    const profiles = await NetProfile.find({
        $or: [{ liveNet: { $exists: true } }, { _id: { $in: profileIds } }]
    });
    const occurrenceIds = liveNets.filter(item => item.occurrence).map(item => item.occurrence);
    const occurrences = await ScheduledOccurrence.find({ _id: { $in: occurrenceIds } });
    const liveById = new Map(liveNets.map(item => [id(item._id), item]));
    const profileById = new Map(profiles.map(item => [id(item._id), item]));
    const occurrenceById = new Map(occurrences.map(item => [id(item._id), item]));
    const staleClosingBefore = new Date(now.getTime() - CLAIM_STALE_MS);
    const invalidLiveIds = new Set();
    let staleProfileRefs = 0;

    for (const profile of profiles.filter(item => item.liveNet)) {
        const liveNet = liveById.get(id(profile.liveNet));
        const occurrence = liveNet?.occurrence ? occurrenceById.get(id(liveNet.occurrence)) : null;
        const recentClosing = liveNet?.closing === true && liveNet.updatedAt > staleClosingBefore;
        const valid = Boolean(
            liveNet && id(liveNet.netProfile) === id(profile._id) &&
            (recentClosing || (liveNet.closing !== true && occurrenceCompatible({ liveNet, occurrence })))
        );
        if (!valid) {
            staleProfileRefs += (await NetProfile.updateOne(
                { _id: profile._id, liveNet: profile.liveNet },
                { $unset: { liveNet: 1 } }
            )).modifiedCount;
            if (liveNet && id(liveNet.netProfile) === id(profile._id)) {
                invalidLiveIds.add(id(liveNet._id));
            }
        }
    }

    for (const liveNet of liveNets) {
        const profile = profileById.get(id(liveNet.netProfile));
        const occurrence = liveNet.occurrence ? occurrenceById.get(id(liveNet.occurrence)) : null;
        const recentClosing = liveNet.closing === true && liveNet.updatedAt > staleClosingBefore;
        const valid = Boolean(
            profile && id(profile.liveNet) === id(liveNet._id) &&
            (recentClosing || (liveNet.closing !== true && occurrenceCompatible({ liveNet, occurrence })))
        );
        if (!valid) invalidLiveIds.add(id(liveNet._id));
    }

    let orphanLiveNets = 0;
    let occurrenceLinksReconciled = 0;
    for (const liveNetId of invalidLiveIds) {
        const snapshot = liveById.get(liveNetId);
        const removed = await LiveNet.findOneAndDelete({ _id: snapshot._id, updatedAt: snapshot.updatedAt });
        if (!removed) continue;
        orphanLiveNets++;
        const profile = profileById.get(id(removed.netProfile));
        const profileOwnedLink = profile && id(profile.liveNet) === id(removed._id);
        if (profileOwnedLink) {
            await NetProfile.updateOne({ _id: profile._id, liveNet: removed._id }, { $unset: { liveNet: 1 } });
            realtimeClients.close(id(profile._id));
            try { await cleanupNetChat(profile._id, db); }
            catch (error) { logger.warn(`Integrity chat cleanup failed for net ${profile._id}: ${error.message}`); }
        }
        await StationInteraction.deleteMany({ liveNet: removed._id });
        occurrenceLinksReconciled += Number(await reconcileOccurrenceAfterLiveNetRemoval({
            liveNet: removed,
            occurrence: removed.occurrence ? occurrenceById.get(id(removed.occurrence)) : null,
            now,
            ScheduledOccurrence
        }));
        logger.warn(`Removed inconsistent LiveNet ${removed._id}`);
    }

    const remainingLiveIds = (await LiveNet.find({}).select('_id')).map(item => item._id);
    const orphanInteractions = await StationInteraction.deleteMany({
        liveNet: { $exists: true, $nin: remainingLiveIds }
    });
    const danglingOccurrences = await ScheduledOccurrence.find({
        status: { $in: ['preparing', 'live'] },
        liveNet: { $exists: true, $nin: remainingLiveIds }
    });
    for (const occurrence of danglingOccurrences) {
        const syntheticLiveNet = {
            _id: occurrence.liveNet,
            netProfile: occurrence.netProfile,
            started: occurrence.status === 'live'
        };
        occurrenceLinksReconciled += Number(await reconcileOccurrenceAfterLiveNetRemoval({
            liveNet: syntheticLiveNet, occurrence, now, ScheduledOccurrence
        }));
    }

    if (staleProfileRefs) logger.warn(`Cleared ${staleProfileRefs} stale NetProfile.liveNet reference(s)`);
    if (orphanInteractions.deletedCount) logger.warn(`Removed ${orphanInteractions.deletedCount} orphan StationInteraction record(s)`);
    return {
        staleProfileRefs,
        orphanLiveNets,
        occurrenceLinksReconciled,
        orphanInteractions: orphanInteractions.deletedCount
    };
};

const defaultSendInactivityEmail = async ({ event, db }) => {
    const email = new NetInactivityAutoClose({ title: event.netTitle });
    return email.sendMailToUPIDs({ upids: event.ownerIds, db, throwOnError: true });
};

const processAutoCloseEmails = async ({
    now = new Date(),
    db = mongoose.connection,
    sendInactivityEmail = defaultSendInactivityEmail
} = {}) => {
    const { LiveNetAutoClose } = getModels(db);
    const totals = { emailsSent: 0, emailsFailed: 0 };
    for (let count = 0; count < MAX_AUTO_CLOSE_EMAILS_PER_PASS; count++) {
        const event = await LiveNetAutoClose.findOneAndUpdate(
            { closeState: 'completed', 'email.state': 'pending' },
            { $set: { 'email.state': 'claimed', 'email.claimedAt': now } },
            { new: true, sort: { closeCompletedAt: 1 } }
        );
        if (!event) break;
        try {
            await sendInactivityEmail({ event, db });
            totals.emailsSent += (await LiveNetAutoClose.updateOne(
                { _id: event._id, 'email.state': 'claimed', 'email.claimedAt': now },
                { $set: { 'email.state': 'sent', 'email.sentAt': now } }
            )).modifiedCount;
        } catch (error) {
            await LiveNetAutoClose.updateOne(
                { _id: event._id, 'email.state': 'claimed', 'email.claimedAt': now },
                { $set: { 'email.state': 'failed', 'email.failedAt': now } }
            );
            totals.emailsFailed++;
            logger.error(`Inactivity auto-close email failed for LiveNet ${event.liveNet}: ${error.message}`);
        }
    }
    return totals;
};

const processAbandonedLiveNets = async ({
    now = new Date(),
    db = mongoose.connection,
    sendInactivityEmail = defaultSendInactivityEmail,
    beforeCloseClaim = null
} = {}) => {
    const { NetProfile, LiveNet, StationInteraction, LiveNetAutoClose } = getModels(db);
    const liveNets = await LiveNet.find({ started: true, closing: { $ne: true } });
    const profiles = await NetProfile.find({ _id: { $in: liveNets.map(item => item.netProfile) } });
    const profileById = new Map(profiles.map(item => [id(item._id), item]));
    const eligible = liveNets.filter(liveNet => {
        const profile = profileById.get(id(liveNet.netProfile));
        return profile && id(profile.liveNet) === id(liveNet._id) && profile.permanent !== true;
    });
    const interactions = await StationInteraction.find({
        liveNet: { $in: eligible.map(item => item._id) },
        role: 'netcontrol',
        checkedState: { $in: [true, false] },
        lastSeen: { $exists: true }
    }).select('liveNet checkedState lastSeen');
    const lastPresence = new Map();
    for (const interaction of interactions) {
        const key = id(interaction.liveNet);
        if (!lastPresence.has(key) || interaction.lastSeen > lastPresence.get(key)) {
            lastPresence.set(key, interaction.lastSeen);
        }
    }
    const cutoff = new Date(now.getTime() - NCO_ABANDONMENT_MS);
    let autoClosed = 0;
    let returnedNco = 0;

    for (const liveNet of eligible) {
        const profile = profileById.get(id(liveNet.netProfile));
        const lastNcoPresenceAt = lastPresence.get(id(liveNet._id)) || null;
        const event = await observeAutoClose({ liveNet, profile, lastNcoPresenceAt, now, LiveNetAutoClose });
        const baseline = lastNcoPresenceAt || new Date(Math.max(
            liveNet.startedAt?.getTime() || 0,
            event.firstObservedAt.getTime()
        ));
        if (baseline > cutoff || event.closeState === 'completed') continue;

        const claimed = await LiveNetAutoClose.findOneAndUpdate(
            { _id: event._id, closeState: 'pending' },
            { $set: { closeState: 'claimed', closeClaimedAt: now } },
            { new: true }
        );
        if (!claimed) continue;
        if (beforeCloseClaim) await beforeCloseClaim({ liveNet, profile, event: claimed });

        const recentNco = await StationInteraction.exists({
            liveNet: liveNet._id,
            role: 'netcontrol',
            checkedState: true,
            lastSeen: { $gt: cutoff }
        });
        if (recentNco) {
            await LiveNetAutoClose.updateOne(
                { _id: event._id, closeState: 'claimed', closeClaimedAt: now },
                { $set: { closeState: 'pending' }, $unset: { closeClaimedAt: 1, closeCommittedAt: 1 } }
            );
            returnedNco++;
            continue;
        }

        const closeClaim = await LiveNet.findOneAndUpdate(
            {
                _id: liveNet._id,
                netProfile: profile._id,
                started: true,
                closing: { $ne: true }
            },
            { $set: { closing: true } },
            { new: true }
        );
        if (!closeClaim) {
            await LiveNetAutoClose.updateOne(
                { _id: event._id, closeState: 'claimed', closeClaimedAt: now },
                { $set: { closeState: 'pending' }, $unset: { closeClaimedAt: 1, closeCommittedAt: 1 } }
            );
            continue;
        }

        const ncoReturnedAtBoundary = await StationInteraction.exists({
            liveNet: liveNet._id,
            role: 'netcontrol',
            checkedState: true,
            lastSeen: { $gt: cutoff }
        });
        if (ncoReturnedAtBoundary) {
            await LiveNet.updateOne({ _id: liveNet._id, closing: true }, { $set: { closing: false } });
            await LiveNetAutoClose.updateOne(
                { _id: event._id, closeState: 'claimed', closeClaimedAt: now },
                { $set: { closeState: 'pending' }, $unset: { closeClaimedAt: 1, closeCommittedAt: 1 } }
            );
            returnedNco++;
            continue;
        }

        await LiveNetAutoClose.updateOne(
            { _id: event._id, closeState: 'claimed', closeClaimedAt: now },
            { $set: { closeCommittedAt: now } }
        );

        const closed = await closeNet({
            netProfileDoc: profile,
            liveNetDoc: closeClaim,
            quiet: true,
            alreadyClosing: true,
            closedAt: now,
            db
        });
        if (!closed) {
            await LiveNet.updateOne({ _id: liveNet._id, closing: true }, { $set: { closing: false } });
            await LiveNetAutoClose.updateOne(
                { _id: event._id, closeState: 'claimed', closeClaimedAt: now },
                { $set: { closeState: 'pending' }, $unset: { closeClaimedAt: 1, closeCommittedAt: 1 } }
            );
            continue;
        }
        autoClosed += (await LiveNetAutoClose.updateOne(
            { _id: event._id, closeState: 'claimed', closeClaimedAt: now },
            { $set: { closeState: 'completed', closeCompletedAt: now } }
        )).modifiedCount;
        logger.warn(`Automatically closed LiveNet ${liveNet._id} after one hour without NCO presence`);
    }

    const emails = await processAutoCloseEmails({ now, db, sendInactivityEmail });
    return { autoClosed, returnedNco, ...emails };
};

const processLiveNetHardening = async ({
    now = new Date(),
    db = mongoose.connection,
    sendInactivityEmail = defaultSendInactivityEmail
} = {}) => {
    const recovered = await recoverAutoCloseClaims({ now, db });
    const integrity = await reconcileLiveNetPersistence({ now, db });
    const inactivity = await processAbandonedLiveNets({ now, db, sendInactivityEmail });
    return { recovered, integrity, inactivity };
};

module.exports = {
    NCO_ABANDONMENT_MS,
    CLAIM_STALE_MS,
    recoverAutoCloseClaims,
    reconcileLiveNetPersistence,
    processAutoCloseEmails,
    processAbandonedLiveNets,
    processLiveNetHardening
};
