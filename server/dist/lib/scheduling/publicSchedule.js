/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const { DateTime, IANAZone } = require('luxon');
const he = require('he');
const sanitizeHtml = require('sanitize-html');
const { modelMaker } = require('../modelMaker');
const { scheduledOccurrenceSchema } = require('../../models/scheduledOccurrence');

const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const VALID_WINDOWS = new Set(['today', 'upcoming', 'seven-day']);
const PUBLIC_STATUSES = ['scheduled', 'preparing'];
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BLOCK_END_TAG_PATTERN = /<\s*\/\s*(?:address|article|aside|blockquote|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tr|ul)\s*>/gi;
const BREAK_TAG_PATTERN = /<\s*br\b[^>]*>/gi;

class PublicScheduleError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const parseLimit = value => {
    if (value == null || value === '') return DEFAULT_LIMIT;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new PublicScheduleError(400, `limit must be an integer from 1 to ${MAX_LIMIT}`);
    }
    return limit;
};

const resolvePublicWindow = ({ window: requestedWindow = 'today', timezone, start, now = new Date(), limit }) => {
    if (!VALID_WINDOWS.has(requestedWindow)) {
        throw new PublicScheduleError(400, 'window must be today, upcoming, or seven-day');
    }

    const zone = timezone || DEFAULT_TIMEZONE;
    if (!IANAZone.isValidZone(zone)) throw new PublicScheduleError(400, 'timezone must be a valid IANA timezone');

    const localToday = DateTime.fromJSDate(now, { zone }).startOf('day');
    let rangeStart;
    let rangeEnd;

    if (requestedWindow === 'today') {
        rangeStart = localToday;
        rangeEnd = localToday.plus({ days: 1 });
    } else if (requestedWindow === 'upcoming') {
        rangeStart = localToday.plus({ days: 1 });
        rangeEnd = rangeStart.plus({ days: 7 });
    } else {
        if (start != null && (!LOCAL_DATE_PATTERN.test(start) || !DateTime.fromISO(start, { zone }).isValid)) {
            throw new PublicScheduleError(400, 'start must be a valid YYYY-MM-DD date');
        }
        rangeStart = start ? DateTime.fromISO(start, { zone }).startOf('day') : localToday;
        rangeEnd = rangeStart.plus({ days: 7 });
    }

    return {
        window: requestedWindow,
        timezone: zone,
        start: rangeStart.toUTC().toJSDate(),
        end: rangeEnd.toUTC().toJSDate(),
        localStart: rangeStart.toISODate(),
        localEnd: rangeEnd.minus({ days: 1 }).toISODate(),
        limit: parseLimit(limit)
    };
};

const plainTextDescription = value => {
    if (typeof value !== 'string' || !value) return '';
    const decoded = he.decode(value)
        .replace(BREAK_TAG_PATTERN, '\n')
        .replace(BLOCK_END_TAG_PATTERN, '\n');
    return he.decode(sanitizeHtml(decoded, { allowedTags: [], allowedAttributes: {} }))
        .replace(/\r\n?|\n[ \t]+|[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

const publicOccurrenceResponse = occurrence => ({
    id: occurrence._id,
    netProfileId: occurrence.netProfile._id,
    title: occurrence.netProfile.title,
    description: plainTextDescription(occurrence.netProfile.notes),
    frequency: occurrence.netProfile.frequency || '',
    mode: occurrence.netProfile.mode || '',
    modeDetails: occurrence.netProfile.modeDetails || '',
    connections: occurrence.netProfile.connections || [],
    startAt: occurrence.startAt,
    durationMinutes: occurrence.durationMinutes,
    url: `/views/livenet/${occurrence.netProfile._id}`
});

const listPublicOccurrences = async ({ window, timezone, start, limit, now = new Date(), db = null } = {}) => {
    const range = resolvePublicWindow({ window, timezone, start, limit, now });
    const ScheduledOccurrence = modelMaker({ db, m: 'ScheduledOccurrence', s: scheduledOccurrenceSchema });
    const occurrences = await ScheduledOccurrence.find({
        status: { $in: PUBLIC_STATUSES },
        startAt: { $gte: range.start, $lt: range.end }
    })
        .sort({ startAt: 1, _id: 1 })
        .limit(range.limit)
        .populate('netProfile', 'title frequency mode modeDetails connections notes invisible')
        .lean();

    return {
        range,
        occurrences: occurrences
            .filter(occurrence => occurrence.netProfile && occurrence.netProfile.invisible !== true)
            .map(publicOccurrenceResponse)
    };
};

module.exports = {
    DEFAULT_TIMEZONE,
    DEFAULT_LIMIT,
    MAX_LIMIT,
    PUBLIC_STATUSES,
    PublicScheduleError,
    resolvePublicWindow,
    listPublicOccurrences,
    publicOccurrenceResponse,
    plainTextDescription
};
