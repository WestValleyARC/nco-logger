/* hamlive-oss — MIT License. See LICENSE. */
const { Schema } = require('mongoose');
const { modelMaker } = require('../lib/modelMaker');

const liveNetAutoCloseSchema = new Schema(
    {
        liveNet: { type: Schema.Types.ObjectId, required: true, unique: true },
        netProfile: { type: Schema.Types.ObjectId, required: true },
        netTitle: { type: String, required: true },
        ownerIds: [{ type: Schema.Types.ObjectId, ref: 'UserProfile' }],
        firstObservedAt: { type: Date, required: true },
        lastNcoPresenceAt: { type: Date, default: null },
        closeState: {
            type: String,
            enum: ['pending', 'claimed', 'completed'],
            default: 'pending',
            index: true
        },
        closeClaimedAt: { type: Date, default: null },
        closeCommittedAt: { type: Date, default: null },
        closeCompletedAt: { type: Date, default: null },
        reportSnapshot: { type: Schema.Types.Mixed, default: null },
        email: {
            state: {
                type: String,
                enum: ['pending', 'claimed', 'sent', 'failed'],
                default: 'pending'
            },
            claimedAt: { type: Date, default: null },
            sentAt: { type: Date, default: null },
            failedAt: { type: Date, default: null }
        }
    },
    { timestamps: true }
);

liveNetAutoCloseSchema.index({ 'email.state': 1, closeState: 1 });

module.exports = {
    getLiveNetAutoClose: db => modelMaker({ db, m: 'LiveNetAutoClose', s: liveNetAutoCloseSchema }),
    liveNetAutoCloseSchema
};
