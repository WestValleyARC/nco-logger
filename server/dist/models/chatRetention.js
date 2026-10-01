/* hamlive-oss — MIT License. See LICENSE. */
const { Schema } = require('mongoose');
const { modelMaker } = require('../lib/modelMaker');

const chatRetentionSchema = new Schema(
    {
        liveNet: { type: Schema.Types.ObjectId, required: true, unique: true },
        netProfile: { type: Schema.Types.ObjectId, required: true },
        closedAt: { type: Date, required: true },
        expiresAt: { type: Date, required: true, index: true },
        reportState: { type: String, enum: ['pending', 'sent', 'skipped', 'external', 'failed'], required: true },
        reportInput: Schema.Types.Mixed,
        recipientIds: [{ type: Schema.Types.ObjectId }],
        attempts: { type: Number, default: 0 },
        nextAttemptAt: { type: Date, required: true, index: true },
        leaseUntil: { type: Date, default: null },
        lastError: { type: String, default: null },
        completedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

// Durable ownership is recorded BEFORE writing bytes. A crashed upload or failed
// unlink remains discoverable without guessing ownership from directory contents.
const chatImageAssetSchema = new Schema({
    storageName: { type: String, required: true, unique: true },
    liveNet: { type: Schema.Types.ObjectId, required: true, index: true },
    netProfile: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, default: Date.now }
});
module.exports = {
    getChatRetention: db => modelMaker({ db, m: 'ChatRetention', s: chatRetentionSchema }),
    getChatImageAsset: db => modelMaker({ db, m: 'ChatImageAsset', s: chatImageAssetSchema })
};
