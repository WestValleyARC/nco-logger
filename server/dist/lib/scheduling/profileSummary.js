/* hamlive-oss — MIT License. See LICENSE. */

const { DateTime } = require('luxon');
const { getNetSchedule } = require('../../models/netSchedule');
const { getScheduledOccurrence } = require('../../models/scheduledOccurrence');
const { getLiveNet } = require('../../models/liveNet');

const PREPARATION_WINDOW_MS = 30 * 60 * 1000;
const GRACE_PERIOD_MS = 30 * 60 * 1000;
const ACTIVE_STATUSES = ['scheduled', 'preparing', 'live'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ORDINALS = new Map([[1, 'First'], [2, 'Second'], [3, 'Third'], [4, 'Fourth'], [5, 'Fifth'], [-1, 'Last']]);

const timeLabel = value => DateTime.fromFormat(value, 'HH:mm', { zone: 'UTC' }).toFormat('h:mm a');

const ordinalDay = value => {
    const mod100 = value % 100;
    const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th');
    return `${value}${suffix}`;
};

const recurrenceSummary = schedule => {
    const time = timeLabel(schedule.localStartTime);
    if (schedule.type === 'oneTime') {
        const date = DateTime.fromISO(schedule.startDate, { zone: schedule.timezone });
        return `One time · ${date.toFormat('LLL d, yyyy')} · ${time}`;
    }
    if (schedule.type === 'weekly') {
        const days = [...(schedule.weekdays || [])].sort((a, b) => a - b).map(day => WEEKDAYS[day - 1]);
        return days.length === 1 ? `Weekly · ${days[0]} · ${time}` : `${days.join(', ')} · ${time}`;
    }
    if (schedule.type === 'monthlyPosition') {
        return `${ORDINALS.get(schedule.monthlyOrdinal)} ${WEEKDAYS[schedule.monthlyWeekday - 1]} · ${time}`;
    }
    return `${ordinalDay(schedule.monthlyDay)} of each month · ${time}`;
};

const occurrencePayload = occurrence => occurrence ? {
    id: String(occurrence._id),
    startAt: occurrence.startAt,
    status: occurrence.status
} : null;

const loadProfileSchedulingSummaries = async ({ profiles, now = new Date(), db = null }) => {
    const ids = profiles.map(profile => profile._id);
    if (!ids.length) return new Map();

    const NetSchedule = getNetSchedule(db);
    const ScheduledOccurrence = getScheduledOccurrence(db);
    const LiveNet = getLiveNet(db);
    const [schedules, occurrences, liveNets] = await Promise.all([
        NetSchedule.find({ netProfile: { $in: ids }, enabled: true }).lean(),
        ScheduledOccurrence.find({
            netProfile: { $in: ids },
            status: { $in: ACTIVE_STATUSES },
            $or: [{ status: { $in: ['preparing', 'live'] } }, { startAt: { $gte: now } }]
        }).sort({ startAt: 1 }).lean(),
        LiveNet.find({ netProfile: { $in: ids }, closing: { $ne: true } }).lean()
    ]);

    const schedulesByProfile = new Map(schedules.map(schedule => [String(schedule.netProfile), schedule]));
    const liveNetsById = new Map(liveNets.map(liveNet => [String(liveNet._id), liveNet]));
    const occurrencesByProfile = new Map();
    for (const occurrence of occurrences) {
        const key = String(occurrence.netProfile);
        const list = occurrencesByProfile.get(key) || [];
        list.push(occurrence);
        occurrencesByProfile.set(key, list);
    }

    return new Map(profiles.map(profile => {
        const key = String(profile._id);
        const schedule = schedulesByProfile.get(key);
        const linkedLiveNet = profile.liveNet ? liveNetsById.get(String(profile.liveNet)) : null;
        const validRelationship = Boolean(linkedLiveNet && String(linkedLiveNet.netProfile) === key);
        const onAir = Boolean(validRelationship && linkedLiveNet.started === true);
        const preparingLiveNet = validRelationship && linkedLiveNet.started === false ? linkedLiveNet : null;
        const nextOccurrence = (occurrencesByProfile.get(key) || []).find(occurrence => {
            if (occurrence.status === 'live') {
                return onAir && String(occurrence.liveNet) === String(linkedLiveNet._id);
            }
            if (occurrence.status === 'preparing') {
                return Boolean(preparingLiveNet && String(occurrence.liveNet) === String(preparingLiveNet._id));
            }
            return occurrence.startAt >= now;
        }) || null;
        const preparing = Boolean(preparingLiveNet);
        const opensAt = nextOccurrence ? new Date(nextOccurrence.startAt.getTime() - PREPARATION_WINDOW_MS) : null;
        const graceEndsAt = nextOccurrence ? new Date(nextOccurrence.startAt.getTime() + GRACE_PERIOD_MS) : null;
        const canPrepare = Boolean(
            schedule && nextOccurrence?.status === 'scheduled' && now >= opensAt && now < graceEndsAt
        );

        return [key, {
            enabled: Boolean(schedule),
            summary: schedule ? recurrenceSummary(schedule) : null,
            timezone: schedule?.timezone || null,
            nextOccurrence: occurrencePayload(nextOccurrence),
            preparing,
            onAir,
            canPrepare,
            preparationOpensAt: opensAt,
            actionUrl: onAir || preparing ? linkedLiveNet.url : null
        }];
    }));
};

module.exports = { recurrenceSummary, loadProfileSchedulingSummaries };
