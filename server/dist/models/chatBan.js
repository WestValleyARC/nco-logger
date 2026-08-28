/* hamlive-oss — MIT License. See LICENSE. */

const { Schema } = require('mongoose');
const { modelMaker } = require('../lib/modelMaker');

const chatBanSchema = new Schema(
    {
        netProfile: { type: Schema.Types.ObjectId, ref: 'NetProfile', required: true },
        userProfile: { type: Schema.Types.ObjectId, ref: 'UserProfile', required: true },
        callSign: { type: String, required: true },
        reason: { type: String, maxlength: 240, default: '' },
        bannedBy: { type: Schema.Types.ObjectId, ref: 'UserProfile', required: true }
    },
    { timestamps: true }
);

chatBanSchema.index({ netProfile: 1, userProfile: 1 }, { unique: true });

module.exports = {
    getChatBan: db => modelMaker({ db, m: 'ChatBan', s: chatBanSchema }),
    chatBanSchema
};
