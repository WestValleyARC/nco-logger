/* hamlive-oss — MIT License. See LICENSE. */
const { Schema } = require('mongoose');
const { modelMaker } = require('../lib/modelMaker');

const notificationSchema = new Schema(
    {
        state: {
            type: String,
            enum: ['pending', 'claimed', 'sent', 'failed'],
            default: 'pending'
        },
        claimedAt: { type: Date, default: null },
        sentAt: { type: Date, default: null },
        failedAt: { type: Date, default: null },
        retryAt: { type: Date, default: null },
        attempts: { type: Number, default: 0, min: 0 }
    },
    { _id: false }
);

const scheduledOccurrenceSchema = new Schema(
    {
        schedule: {
            type: Schema.Types.ObjectId,
            ref: 'NetSchedule',
            required: true,
            index: true
        },
        netProfile: {
            type: Schema.Types.ObjectId,
            ref: 'NetProfile',
            required: true,
            index: true
        },
        occurrenceKey: { type: String, required: true },
        originalStartAt: { type: Date, required: true },
        startAt: { type: Date, required: true, index: true },
        durationMinutes: {
            type: Number,
            min: 1,
            max: 1440,
            default: undefined
        },
        isOverride: { type: Boolean, default: false },
        status: {
            type: String,
            enum: ['scheduled', 'preparing', 'live', 'completed', 'cancelled', 'missed'],
            default: 'scheduled',
            index: true
        },
        liveNet: {
            type: Schema.Types.ObjectId,
            ref: 'LiveNet',
            default: undefined
        },
        preparedAt: { type: Date, default: null },
        startedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },
        missedAt: { type: Date, default: null },
        cancelledBy: {
            type: Schema.Types.ObjectId,
            ref: 'UserProfile',
            default: undefined
        },
        cancellationOrigin: {
            type: String,
            enum: ['individual', 'schedule-disabled', 'preparation'],
            default: undefined
        },
        notification: {
            type: notificationSchema,
            default: () => ({})
        }
    },
    { timestamps: true }
);

scheduledOccurrenceSchema.index({ schedule: 1, occurrenceKey: 1 }, { unique: true });
scheduledOccurrenceSchema.index({ status: 1, startAt: 1 });
scheduledOccurrenceSchema.index({ netProfile: 1, startAt: 1 });
scheduledOccurrenceSchema.index({ schedule: 1, startAt: 1 });
scheduledOccurrenceSchema.index({ liveNet: 1 }, { sparse: true });
scheduledOccurrenceSchema.index({ 'notification.state': 1, status: 1, startAt: 1 });
scheduledOccurrenceSchema.index({ 'notification.state': 1, 'notification.claimedAt': 1 });

module.exports = {
    getScheduledOccurrence: db => modelMaker({ db, m: 'ScheduledOccurrence', s: scheduledOccurrenceSchema }),
    scheduledOccurrenceSchema
};
