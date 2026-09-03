/* hamlive-oss — MIT License. See LICENSE. */
const { Schema } = require('mongoose');
const { DateTime, IANAZone } = require('luxon');
const { modelMaker } = require('../lib/modelMaker');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const isLocalDate = value => {
    if (!DATE_PATTERN.test(value)) return false;
    const parsed = DateTime.fromISO(value, { zone: 'UTC' });
    return parsed.isValid && parsed.toFormat('yyyy-MM-dd') === value;
};

const netScheduleSchema = new Schema(
    {
        netProfile: {
            type: Schema.Types.ObjectId,
            ref: 'NetProfile',
            required: true
        },
        type: {
            type: String,
            enum: ['oneTime', 'weekly', 'monthlyPosition', 'monthlyDate'],
            required: true
        },
        timezone: {
            type: String,
            required: true,
            validate: {
                validator: value => IANAZone.isValidZone(value),
                message: 'timezone must be a valid IANA timezone'
            }
        },
        localStartTime: {
            type: String,
            required: true,
            match: [TIME_PATTERN, 'localStartTime must use HH:mm format']
        },
        durationMinutes: {
            type: Number,
            min: 1,
            max: 1440,
            default: undefined,
            validate: {
                validator: value => value == null || Number.isInteger(value),
                message: 'durationMinutes must be a whole number of minutes'
            }
        },
        startDate: {
            type: String,
            required: true,
            validate: {
                validator: isLocalDate,
                message: 'startDate must be a valid YYYY-MM-DD date'
            }
        },
        endDate: {
            type: String,
            default: undefined,
            validate: {
                validator: value => value == null || isLocalDate(value),
                message: 'endDate must be a valid YYYY-MM-DD date'
            }
        },
        weekdays: {
            type: [{ type: Number, min: 1, max: 7 }],
            default: undefined
        },
        monthlyOrdinal: {
            type: Number,
            enum: [1, 2, 3, 4, 5, -1],
            default: undefined
        },
        monthlyWeekday: {
            type: Number,
            min: 1,
            max: 7,
            default: undefined
        },
        monthlyDay: {
            type: Number,
            min: 1,
            max: 31,
            default: undefined
        },
        enabled: {
            type: Boolean,
            default: true,
            index: true
        }
    },
    { timestamps: true }
);

netScheduleSchema.pre('validate', function validateRecurrenceFields(next) {
    const hasWeekdays = Array.isArray(this.weekdays) && this.weekdays.length > 0;
    const hasPosition = this.monthlyOrdinal != null || this.monthlyWeekday != null;
    const hasMonthlyDay = this.monthlyDay != null;

    if (this.endDate && this.startDate && this.endDate < this.startDate) {
        this.invalidate('endDate', 'endDate must be on or after startDate');
    }

    if (this.type === 'weekly') {
        if (!hasWeekdays) this.invalidate('weekdays', 'weekly schedules require at least one weekday');
        if (hasWeekdays && new Set(this.weekdays).size !== this.weekdays.length) {
            this.invalidate('weekdays', 'weekly schedule weekdays must be unique');
        }
    } else if (hasWeekdays) {
        this.invalidate('weekdays', 'weekdays are only valid for weekly schedules');
    }

    if (this.type === 'monthlyPosition') {
        if (this.monthlyOrdinal == null) {
            this.invalidate('monthlyOrdinal', 'monthlyPosition schedules require monthlyOrdinal');
        }
        if (this.monthlyWeekday == null) {
            this.invalidate('monthlyWeekday', 'monthlyPosition schedules require monthlyWeekday');
        }
    } else if (hasPosition) {
        this.invalidate(
            this.monthlyOrdinal != null ? 'monthlyOrdinal' : 'monthlyWeekday',
            'monthlyOrdinal and monthlyWeekday are only valid for monthlyPosition schedules'
        );
    }

    if (this.type === 'monthlyDate') {
        if (!hasMonthlyDay) this.invalidate('monthlyDay', 'monthlyDate schedules require monthlyDay');
    } else if (hasMonthlyDay) {
        this.invalidate('monthlyDay', 'monthlyDay is only valid for monthlyDate schedules');
    }

    next();
});

netScheduleSchema.index({ netProfile: 1 }, { unique: true });

module.exports = {
    getNetSchedule: db => modelMaker({ db, m: 'NetSchedule', s: netScheduleSchema }),
    netScheduleSchema
};
