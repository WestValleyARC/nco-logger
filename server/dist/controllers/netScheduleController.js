/* hamlive-oss — MIT License. See LICENSE. */
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { netOwnerCheck } = require('../lib/sharedNetOps');
const { resolveLocalDateTime } = require('../lib/scheduling/recurrence');
const NetSchedule = require('../models/netSchedule').getNetSchedule(null);
const ScheduledOccurrence = require('../models/scheduledOccurrence').getScheduledOccurrence(null);
const { prepareOccurrence, cancelPreparation } = require('../lib/scheduling/lifecycle');
const { materializeSchedule } = require('../lib/scheduling/worker');

const ENDPOINT_VERSION = '1.0';
const SCHEDULE_FIELDS = [
    'type',
    'timezone',
    'localStartTime',
    'startDate',
    'endDate',
    'weekdays',
    'monthlyOrdinal',
    'monthlyWeekday',
    'monthlyDay',
    'enabled'
];
const OCCURRENCE_EDIT_FIELDS = ['localDate', 'localStartTime'];
const MAX_RANGE_DAYS = 366;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const sendError = (res, error) => {
    const status = Number.isInteger(error?.status)
        ? error.status
        : error instanceof ApiError
        ? error.status
        : error?.code === 11000
          ? 409
          : error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError
            ? 400
            : 500;
    const message = error?.code === 11000 ? 'A schedule already exists for this net profile' : error.message;
    return res.status(status).json({ endpointVersion: ENDPOINT_VERSION, errorMessage: message });
};

const requireOwner = async (req, session = null) => {
    const { confirmed, npresult } = await netOwnerCheck({ req, session });
    if (!npresult) throw new ApiError(404, 'Net profile not found');
    if (!confirmed) throw new ApiError(403, 'Net profile owner access required');
    return npresult;
};

const rejectUnsupportedFields = (body, allowed) => {
    const unsupported = Object.keys(body || {}).filter(field => !allowed.includes(field));
    if (unsupported.length) throw new ApiError(400, `Unsupported field: ${unsupported[0]}`);
};

const selectFields = (body, allowed) =>
    allowed.reduce((result, field) => {
        if (Object.prototype.hasOwnProperty.call(body, field)) result[field] = body[field];
        return result;
    }, {});

const normalizeRecurrenceFields = schedule => {
    if (schedule.type !== 'weekly') schedule.set('weekdays', undefined);
    if (schedule.type !== 'monthlyPosition') {
        schedule.set('monthlyOrdinal', undefined);
        schedule.set('monthlyWeekday', undefined);
    }
    if (schedule.type !== 'monthlyDate') schedule.set('monthlyDay', undefined);
};

const scheduleResponse = schedule => ({
    _id: schedule._id,
    netProfile: schedule.netProfile,
    type: schedule.type,
    timezone: schedule.timezone,
    localStartTime: schedule.localStartTime,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    weekdays: schedule.weekdays,
    monthlyOrdinal: schedule.monthlyOrdinal,
    monthlyWeekday: schedule.monthlyWeekday,
    monthlyDay: schedule.monthlyDay,
    enabled: schedule.enabled,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt
});

const occurrenceResponse = occurrence => ({
    _id: occurrence._id,
    schedule: occurrence.schedule,
    netProfile: occurrence.netProfile,
    occurrenceKey: occurrence.occurrenceKey,
    originalStartAt: occurrence.originalStartAt,
    startAt: occurrence.startAt,
    isOverride: occurrence.isOverride,
    status: occurrence.status,
    liveNet: occurrence.liveNet,
    preparedAt: occurrence.preparedAt,
    startedAt: occurrence.startedAt,
    completedAt: occurrence.completedAt,
    cancelledAt: occurrence.cancelledAt,
    missedAt: occurrence.missedAt,
    cancelledBy: occurrence.cancelledBy,
    cancellationOrigin: occurrence.cancellationOrigin,
    notification: occurrence.notification,
    createdAt: occurrence.createdAt,
    updatedAt: occurrence.updatedAt
});

const getSchedule = async (req, res) => {
    try {
        await requireOwner(req);
        const schedule = await NetSchedule.findOne({ netProfile: req.params.id });
        if (!schedule) throw new ApiError(404, 'Schedule not found');
        return res.json({ endpointVersion: ENDPOINT_VERSION, schedule: scheduleResponse(schedule) });
    } catch (error) {
        return sendError(res, error);
    }
};

const createSchedule = async (req, res) => {
    try {
        await requireOwner(req);
        rejectUnsupportedFields(req.body, SCHEDULE_FIELDS);
        const schedule = new NetSchedule({
            ...selectFields(req.body, SCHEDULE_FIELDS),
            netProfile: req.params.id
        });
        await schedule.save();
        return res.status(201).json({ endpointVersion: ENDPOINT_VERSION, schedule: scheduleResponse(schedule) });
    } catch (error) {
        return sendError(res, error);
    }
};

const updateSchedule = async (req, res) => {
    try {
        await requireOwner(req);
        rejectUnsupportedFields(req.body, SCHEDULE_FIELDS);
        const schedule = await NetSchedule.findOne({ netProfile: req.params.id });
        if (!schedule) throw new ApiError(404, 'Schedule not found');
        schedule.set(selectFields(req.body, SCHEDULE_FIELDS));
        normalizeRecurrenceFields(schedule);
        await schedule.save();
        await materializeSchedule({ schedule });
        return res.json({ endpointVersion: ENDPOINT_VERSION, schedule: scheduleResponse(schedule) });
    } catch (error) {
        return sendError(res, error);
    }
};

const disableSchedule = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            await requireOwner(req, session);
            const schedule = await NetSchedule.findOne({ netProfile: req.params.id }).session(session);
            if (!schedule) throw new ApiError(404, 'Schedule not found');

            const activeOccurrence = await ScheduledOccurrence.exists({
                schedule: schedule._id,
                status: { $in: ['preparing', 'live'] }
            }).session(session);
            if (activeOccurrence) throw new ApiError(409, 'Cannot disable a schedule with a preparing or live occurrence');

            schedule.enabled = false;
            await schedule.save({ session });
            const cancelledAt = new Date();
            const cancellation = await ScheduledOccurrence.updateMany(
                { schedule: schedule._id, status: 'scheduled', startAt: { $gte: cancelledAt } },
                {
                    $set: {
                        status: 'cancelled',
                        cancelledAt,
                        cancelledBy: req.user._id,
                        cancellationOrigin: 'schedule-disabled'
                    }
                },
                { session }
            );
            result = { schedule: scheduleResponse(schedule), cancelledOccurrences: cancellation.modifiedCount };
        });
        return res.json({ endpointVersion: ENDPOINT_VERSION, ...result });
    } catch (error) {
        return sendError(res, error);
    } finally {
        await session.endSession();
    }
};

const parseRange = query => {
    const now = DateTime.utc();
    const from = query.from ? DateTime.fromISO(query.from, { setZone: true }) : now;
    const to = query.to ? DateTime.fromISO(query.to, { setZone: true }) : from.plus({ days: 90 });
    const limit = query.limit == null ? DEFAULT_LIMIT : Number(query.limit);
    if (!from.isValid || !to.isValid) throw new ApiError(400, 'from and to must be valid ISO date/time values');
    if (to < from) throw new ApiError(400, 'to must be on or after from');
    if (to.diff(from, 'days').days > MAX_RANGE_DAYS) throw new ApiError(400, `Occurrence range cannot exceed ${MAX_RANGE_DAYS} days`);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new ApiError(400, `limit must be an integer from 1 to ${MAX_LIMIT}`);
    }
    return { from: from.toJSDate(), to: to.toJSDate(), limit };
};

const listOccurrences = async (req, res) => {
    try {
        await requireOwner(req);
        const schedule = await NetSchedule.findOne({ netProfile: req.params.id });
        if (!schedule) throw new ApiError(404, 'Schedule not found');
        const { from, to, limit } = parseRange(req.query);
        const occurrences = await ScheduledOccurrence.find({
            netProfile: req.params.id,
            schedule: schedule._id,
            startAt: { $gte: from, $lte: to }
        })
            .sort({ startAt: 1 })
            .limit(limit);
        return res.json({
            endpointVersion: ENDPOINT_VERSION,
            range: { from, to, limit },
            occurrences: occurrences.map(occurrenceResponse)
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const parseOccurrenceStart = (body, timezone) => {
    rejectUnsupportedFields(body, OCCURRENCE_EDIT_FIELDS);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.localDate || '')) {
        throw new ApiError(400, 'localDate must use YYYY-MM-DD format');
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.localStartTime || '')) {
        throw new ApiError(400, 'localStartTime must use HH:mm format');
    }
    const localDate = DateTime.fromISO(body.localDate, { zone: 'UTC' });
    if (!localDate.isValid || localDate.toFormat('yyyy-MM-dd') !== body.localDate) {
        throw new ApiError(400, 'localDate must be a valid calendar date');
    }
    return resolveLocalDateTime(localDate, body.localStartTime, timezone).toUTC().toJSDate();
};

const updateOccurrence = async (req, res) => {
    try {
        await requireOwner(req);
        const schedule = await NetSchedule.findOne({ netProfile: req.params.id });
        if (!schedule) throw new ApiError(404, 'Schedule not found');
        const startAt = parseOccurrenceStart(req.body, schedule.timezone);
        const occurrence = await ScheduledOccurrence.findOneAndUpdate(
            {
                _id: req.params.occurrenceId,
                netProfile: req.params.id,
                schedule: schedule._id,
                status: 'scheduled'
            },
            { $set: { startAt, isOverride: true } },
            { new: true, runValidators: true }
        );
        if (!occurrence) throw new ApiError(409, 'Only scheduled occurrences can be rescheduled');
        return res.json({ endpointVersion: ENDPOINT_VERSION, occurrence: occurrenceResponse(occurrence) });
    } catch (error) {
        return sendError(res, error);
    }
};

const cancelOccurrence = async (req, res) => {
    try {
        await requireOwner(req);
        const schedule = await NetSchedule.findOne({ netProfile: req.params.id });
        if (!schedule) throw new ApiError(404, 'Schedule not found');
        const occurrence = await ScheduledOccurrence.findOneAndUpdate(
            {
                _id: req.params.occurrenceId,
                netProfile: req.params.id,
                schedule: schedule._id,
                status: 'scheduled'
            },
            {
                $set: {
                    status: 'cancelled',
                    cancelledAt: new Date(),
                    cancelledBy: req.user._id,
                    cancellationOrigin: 'individual'
                }
            },
            { new: true, runValidators: true }
        );
        if (!occurrence) throw new ApiError(409, 'Only scheduled occurrences can be cancelled');
        return res.json({ endpointVersion: ENDPOINT_VERSION, occurrence: occurrenceResponse(occurrence) });
    } catch (error) {
        return sendError(res, error);
    }
};

const prepareScheduledOccurrence = async (req, res) => {
    try {
        const result = await prepareOccurrence({
            npid: req.params.id,
            occurrenceId: req.params.occurrenceId,
            user: req.user
        });
        return res.json({
            endpointVersion: ENDPOINT_VERSION,
            occurrence: occurrenceResponse(result.occurrence),
            liveNet: {
                _id: result.liveNet._id,
                started: result.liveNet.started,
                startedAt: result.liveNet.startedAt,
                url: result.liveNet.url
            },
            idempotent: result.idempotent
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const cancelScheduledPreparation = async (req, res) => {
    try {
        const occurrence = await cancelPreparation({
            npid: req.params.id,
            occurrenceId: req.params.occurrenceId,
            user: req.user
        });
        return res.json({ endpointVersion: ENDPOINT_VERSION, occurrence: occurrenceResponse(occurrence) });
    } catch (error) {
        return sendError(res, error);
    }
};

module.exports = {
    getSchedule,
    createSchedule,
    updateSchedule,
    disableSchedule,
    listOccurrences,
    updateOccurrence,
    cancelOccurrence,
    prepareScheduledOccurrence,
    cancelScheduledPreparation
};
