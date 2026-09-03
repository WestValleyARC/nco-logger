/* hamlive-oss — MIT License. See LICENSE. */
const mongoose = require('mongoose');
const { getNetSchedule } = require('../../models/netSchedule');
const { getScheduledOccurrence } = require('../../models/scheduledOccurrence');

class ScheduleStateError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const disableProfileSchedule = async ({
    netProfileId,
    cancelledBy,
    now = new Date(),
    cancelAllScheduled = false,
    db = mongoose.connection,
    session = null
}) => {
    const NetSchedule = getNetSchedule(db);
    const ScheduledOccurrence = getScheduledOccurrence(db);
    const schedule = await NetSchedule.findOne({ netProfile: netProfileId }).session(session);
    if (!schedule) return null;

    const activeOccurrence = await ScheduledOccurrence.exists({
        schedule: schedule._id,
        status: { $in: ['preparing', 'live'] }
    }).session(session);
    if (activeOccurrence)
        throw new ScheduleStateError(409, 'Cannot disable a schedule with a preparing or live occurrence');

    schedule.enabled = false;
    await schedule.save({ session });
    const cancellationFilter = { schedule: schedule._id, status: 'scheduled' };
    if (!cancelAllScheduled) cancellationFilter.startAt = { $gte: now };
    const cancellation = await ScheduledOccurrence.updateMany(
        cancellationFilter,
        {
            $set: {
                status: 'cancelled',
                cancelledAt: now,
                cancelledBy,
                cancellationOrigin: 'schedule-disabled'
            }
        },
        { session }
    );
    return { schedule, cancelledOccurrences: cancellation.modifiedCount };
};

module.exports = { ScheduleStateError, disableProfileSchedule };
