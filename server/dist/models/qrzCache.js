/* hamlive-oss — MIT License. See LICENSE. */

const { modelMaker } = require('../lib/modelMaker');
const { Schema } = require('mongoose');
const uniqueValidator = require('mongoose-unique-validator');

const qrzCacheSchema = new Schema(
    {
        displayName: String,
        localNickname: {
            type: String,
            unique: false,
            minlength: 2,
            maxlength: 20,
            validate: {
                validator: function (v) {
                    return /^[A-zÀ-ú-' ]+$/.test(v);
                },
                message: 'invalid characters in nickname'
            }
        },
        callSign: {
            type: String,
            unique: true,
            sparse: true
        },

        location: {
            type: String,
            unique: false
        },
        geo: {
            type: { type: String },
            coordinates: [Number]
        }
    },
    { timestamps: true }
);

qrzCacheSchema.plugin(uniqueValidator, {
    message: 'QRZ Cache: A user already exists with this callsign'
});

// Remove untouched QRZ-derived records after seven days. The lookup layer also
// enforces the configurable refresh age before returning a cached record.
qrzCacheSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = {
    getQrzCache: db => modelMaker({ db, m: 'QrzCache', s: qrzCacheSchema }),
    qrzCacheSchema
};
