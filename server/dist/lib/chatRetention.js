/* hamlive-oss — MIT License. See LICENSE. */
const mongoose = require('mongoose');
const { conf } = require('./configLib');
const { logger } = require('./logger');
const { getChatRetention, getChatImageAsset } = require('../models/chatRetention');
const { getLiveNet } = require('../models/liveNet');
const { getLiveNetAutoClose } = require('../models/liveNetAutoClose');
const { getChatMessage } = require('../models/chatMessage');
const DAY_MS = 86400000;
const RETRY_MS = 15 * 60000;
const LEASE_MS = 15 * 60000;
const retentionDays = () => {
    const days = Number(conf.chat_retention_days ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 365)
        throw new Error('CHAT_RETENTION_DAYS must be an integer between 1 and 365');
    return days;
};

const enqueueChatRetention = async ({
    liveNetId,
    netProfileId,
    closedAt,
    quiet,
    reportInput,
    recipientIds,
    refreshClose = false,
    db = mongoose.connection
}) => {
    const external = quiet && (await getLiveNetAutoClose(db).exists({ liveNet: liveNetId }));
    const fields = {
        netProfile: netProfileId,
        closedAt,
        expiresAt: new Date(closedAt.getTime() + retentionDays() * DAY_MS),
        nextAttemptAt: closedAt,
        reportState: external ? 'external' : quiet ? 'skipped' : 'pending',
        reportInput,
        recipientIds
    };
    return getChatRetention(db).findOneAndUpdate(
        { liveNet: liveNetId },
        refreshClose ? { $set: fields } : { $setOnInsert: fields },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

const sendReport = async (job, db) => {
    const { NetCloseReport } = require('./userNotification');
    const report = await NetCloseReport.init({ ...job.reportInput, db });
    if (!report) throw new Error('Report generation failed');
    const result = await report.sendMailToUPIDs({ upids: job.recipientIds, db, throwOnError: true });
    // false means preferences excluded every recipient; exceptions are failures.
    if (result === false) return 'skipped';
    if (!result || result.console || result.rejected?.length)
        throw new Error('Report was not accepted for every recipient');
    return 'sent';
};

const processChatRetentionJob = async ({
    liveNetId,
    now = new Date(),
    db = mongoose.connection,
    deliverReport = sendReport,
    cleanup
} = {}) => {
    const Job = getChatRetention(db);
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const job = await Job.findOneAndUpdate(
        {
            liveNet: liveNetId,
            completedAt: null,
            nextAttemptAt: { $lte: now },
            $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }]
        },
        { $set: { leaseUntil }, $inc: { attempts: 1 } },
        { new: true }
    );
    if (!job) return false;
    const claim = { _id: job._id, leaseUntil };
    let state = job.reportState;
    try {
        // A failed close or restarted profile must never cause deletion of an
        // active session. All cleanup is keyed by liveNet, not reusable profile.
        if (await getLiveNet(db).exists({ _id: job.liveNet })) {
            await Job.updateOne(claim, {
                $set: { leaseUntil: null, nextAttemptAt: new Date(now.getTime() + RETRY_MS) }
            });
            return false;
        }
        if (state === 'external') {
            const event = await getLiveNetAutoClose(db).findOne({ liveNet: job.liveNet }).lean();
            if (event?.email?.state === 'sent') state = 'sent';
            else {
                // The existing auto-close outbox owns sending. Requeue failures
                // there, never send a second competing report from this worker.
                if (event?.email?.state === 'failed')
                    await getLiveNetAutoClose(db).updateOne(
                        { _id: event._id, 'email.state': 'failed' },
                        { $set: { 'email.state': 'pending' } }
                    );
                throw new Error('Auto-close report is awaiting delivery');
            }
        } else if (state === 'pending' || state === 'failed') {
            state = await deliverReport(job, db);
            if (!['sent', 'skipped'].includes(state)) throw new Error('Report outcome is not confirmed');
        }
        const owned = await Job.updateOne(claim, { $set: { reportState: state, lastError: null } });
        if (!owned.matchedCount) return false;
        if (job.expiresAt > now) {
            await Job.updateOne(claim, { $set: { leaseUntil: null, nextAttemptAt: job.expiresAt } });
            return true;
        }
        const result = await (cleanup || require('./localChat').cleanupNetChat)(job.liveNet, db);
        await getLiveNetAutoClose(db).updateOne(
            { liveNet: job.liveNet, 'email.state': 'sent' },
            { $unset: { reportSnapshot: 1 } }
        );
        await Job.updateOne(claim, {
            $set: { completedAt: now, leaseUntil: null, lastError: null },
            $unset: { reportInput: 1, recipientIds: 1 }
        });
        logger.info(`Chat retention completed for session ${job.liveNet}: ${JSON.stringify(result)}`);
        return true;
    } catch (error) {
        // Do not persist SMTP error strings, which may contain personal addresses.
        const lastError =
            error.code || (job.reportState === 'external' ? 'external-report-pending' : 'report-or-cleanup-failed');
        await Job.updateOne(claim, {
            $set: {
                leaseUntil: null,
                lastError,
                reportState: ['pending', 'failed'].includes(state) ? 'failed' : state,
                nextAttemptAt: new Date(now.getTime() + RETRY_MS)
            }
        });
        logger.warn(`Chat retention retry scheduled for session ${job.liveNet}: ${lastError}`);
        return false;
    }
};

const runChatRetentionPass = async ({ now = new Date(), db = mongoose.connection } = {}) => {
    const jobs = await getChatRetention(db)
        .find({ completedAt: null, nextAttemptAt: { $lte: now } })
        .sort({ nextAttemptAt: 1 })
        .limit(20)
        .lean();
    for (const job of jobs) await processChatRetentionJob({ liveNetId: job.liveNet, now, db });
    // Recover only ledger-owned failed uploads. Unknown legacy directory files
    // are never deleted automatically; there is no blind directory sweep.
    const assets = await getChatImageAsset(db)
        .find({ createdAt: { $lte: new Date(now.getTime() - retentionDays() * DAY_MS) } })
        .limit(100)
        .lean();
    for (const asset of assets) {
        if (await getLiveNet(db).exists({ _id: asset.liveNet })) continue;
        if (await getChatMessage(db).exists({ 'attachment.storageName': asset.storageName })) continue;
        const retention = await getChatRetention(db).findOne({ liveNet: asset.liveNet }).lean();
        if (retention && (!retention.completedAt || retention.expiresAt > now)) continue;
        try {
            const { removeAttachment } = require('./localChat');
            await removeAttachment(asset);
            await getChatImageAsset(db).deleteOne({ _id: asset._id });
            logger.info(`Recovered orphan chat image ${asset.storageName}`);
        } catch (error) {
            logger.warn(`Orphan chat image retry pending ${asset.storageName}: ${error.code || 'unlink error'}`);
        }
    }
};

const startChatRetentionWorker = ({ runPass = runChatRetentionPass, intervalMs = 60000 } = {}) => {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            await runPass();
        } catch (error) {
            logger.error(`Chat retention worker failed: ${error.code || 'persistence failure'}`);
        } finally {
            running = false;
        }
    };
    const immediate = setImmediate(run);
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => {
        clearImmediate(immediate);
        clearInterval(timer);
    };
};
module.exports = {
    retentionDays,
    enqueueChatRetention,
    processChatRetentionJob,
    runChatRetentionPass,
    startChatRetentionWorker,
    DAY_MS,
    RETRY_MS
};
