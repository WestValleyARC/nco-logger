/* hamlive-oss — MIT License. See LICENSE. */

const { Schema } = require('mongoose');
const { modelMaker } = require('../lib/modelMaker');

const chatMessageSchema = new Schema(
    {
        liveNet: { type: Schema.Types.ObjectId, ref: 'LiveNet', required: true, index: true },
        netProfile: { type: Schema.Types.ObjectId, ref: 'NetProfile', required: true, index: true },
        userProfile: { type: Schema.Types.ObjectId, ref: 'UserProfile', required: true, index: true },
        callSign: { type: String, required: true, maxlength: 12 },
        displayName: { type: String, default: '', maxlength: 80 },
        text: {
            type: String,
            required: function () { return !this.deletedAt; },
            maxlength: 2000
        },
        editedAt: { type: Date, default: null },
        deletedAt: { type: Date, default: null },
        moderatedBy: { type: Schema.Types.ObjectId, ref: 'UserProfile', default: null }
    },
    { timestamps: true }
);

chatMessageSchema.index({ netProfile: 1, createdAt: 1, _id: 1 });

module.exports = {
    getChatMessage: db => modelMaker({ db, m: 'ChatMessage', s: chatMessageSchema }),
    chatMessageSchema
};
