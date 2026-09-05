/* hamlive-oss — MIT License. See LICENSE. */

const { Schema } = require('mongoose');
const { modelMaker } = require('../lib/modelMaker');

const rateLimitSchema = new Schema({
    key: { type: String, required: true, unique: true },
    count: { type: Number, required: true, min: 0 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true });

module.exports = {
    getRateLimit: db => modelMaker({ db, m: 'RateLimit', s: rateLimitSchema }),
    rateLimitSchema
};
