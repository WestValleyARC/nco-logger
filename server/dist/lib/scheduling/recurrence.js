/* hamlive-oss — MIT License. See LICENSE. */
const { DateTime } = require('luxon');

const parseDate = value => DateTime.fromISO(value, { zone: 'UTC' }).startOf('day');

const sameWallTime = (dateTime, parts) =>
    dateTime.year === parts.year &&
    dateTime.month === parts.month &&
    dateTime.day === parts.day &&
    dateTime.hour === parts.hour &&
    dateTime.minute === parts.minute;

/**
 * Resolve a requested local wall-clock time according to the product DST rules.
 * Luxon advances nonexistent times by the DST gap. For overlaps, all possible
 * offsets are inspected and the earlier UTC instant is selected explicitly.
 */
const resolveLocalDateTime = (localDate, localStartTime, timezone) => {
    const [hour, minute] = localStartTime.split(':').map(Number);
    const parts = {
        year: localDate.year,
        month: localDate.month,
        day: localDate.day,
        hour,
        minute
    };
    const resolved = DateTime.fromObject(parts, { zone: timezone });
    if (!resolved.isValid) throw new Error(`Unable to resolve local occurrence: ${resolved.invalidExplanation}`);

    // A mismatch identifies a spring gap. Luxon's forward normalization is the
    // required behavior (for example, 02:30 becomes 03:30 across a one-hour gap).
    if (!sameWallTime(resolved, parts)) return resolved;

    const possibleOffsets = resolved.getPossibleOffsets();
    if (possibleOffsets.length > 1) {
        return possibleOffsets.reduce((earlier, candidate) =>
            candidate.toMillis() < earlier.toMillis() ? candidate : earlier
        );
    }
    return resolved;
};

const nthWeekdayOfMonth = (date, ordinal, weekday) => {
    if (ordinal === -1) {
        const last = date.endOf('month').startOf('day');
        return last.day - ((last.weekday - weekday + 7) % 7);
    }
    const first = date.startOf('month');
    const day = 1 + ((weekday - first.weekday + 7) % 7) + (ordinal - 1) * 7;
    return day <= date.daysInMonth ? day : null;
};

const matchesSchedule = (schedule, date) => {
    switch (schedule.type) {
        case 'oneTime':
            return date.toFormat('yyyy-MM-dd') === schedule.startDate;
        case 'weekly':
            return schedule.weekdays.includes(date.weekday);
        case 'monthlyPosition':
            return date.day === nthWeekdayOfMonth(date, schedule.monthlyOrdinal, schedule.monthlyWeekday);
        case 'monthlyDate':
            return date.day === Math.min(schedule.monthlyDay, date.daysInMonth);
        default:
            throw new Error(`Unsupported schedule type: ${schedule.type}`);
    }
};

/**
 * Generate occurrence candidates in an inclusive local-calendar range.
 * rangeStartDate defaults to the schedule start. rangeEndDate is required for
 * an indefinite recurring schedule so generation is always horizon-bounded.
 */
const generateOccurrences = (schedule, { rangeStartDate, rangeEndDate } = {}) => {
    const scheduleStart = parseDate(schedule.startDate);
    const requestedStart = parseDate(rangeStartDate || schedule.startDate);
    const requestedEndValue = rangeEndDate || schedule.endDate || (schedule.type === 'oneTime' ? schedule.startDate : null);
    if (!requestedEndValue) throw new Error('rangeEndDate is required for an indefinite recurring schedule');
    const requestedEnd = parseDate(requestedEndValue);
    const scheduleEnd = schedule.endDate ? parseDate(schedule.endDate) : requestedEnd;

    if (![scheduleStart, requestedStart, requestedEnd, scheduleEnd].every(value => value.isValid)) {
        throw new Error('Occurrence range must use valid YYYY-MM-DD dates');
    }

    const effectiveStart = requestedStart > scheduleStart ? requestedStart : scheduleStart;
    const effectiveEnd = scheduleEnd < requestedEnd ? scheduleEnd : requestedEnd;

    if (effectiveEnd < effectiveStart) return [];

    const occurrences = [];
    for (let date = effectiveStart; date <= effectiveEnd; date = date.plus({ days: 1 })) {
        if (!matchesSchedule(schedule, date)) continue;
        const occurrenceKey = date.toFormat('yyyy-MM-dd');
        const instant = resolveLocalDateTime(date, schedule.localStartTime, schedule.timezone).toUTC().toJSDate();
        occurrences.push({
            occurrenceKey,
            localDate: occurrenceKey,
            originalStartAt: instant,
            startAt: new Date(instant.getTime())
        });
    }
    return occurrences;
};

module.exports = {
    generateOccurrences,
    resolveLocalDateTime
};
