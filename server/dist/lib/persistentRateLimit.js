/* hamlive-oss — MIT License. See LICENSE. */

const crypto = require('crypto');
const { getRateLimit } = require('../models/rateLimit');
const { conf } = require('./configLib');

const digestKey = value => crypto.createHmac('sha256', conf.magic_link_secret).update(value).digest('hex');

const consumeRateLimit = async ({ bucket, subject, limit, windowMs, db = null, now = new Date() }) => {
    const RateLimit = getRateLimit(db);
    const key = `${bucket}:${digestKey(String(subject).toLowerCase())}`;
    const expiresAt = new Date(now.getTime() + windowMs);
    const update = [{ $set: {
        key,
        count: { $cond: [{ $or: [{ $eq: [{ $type: '$expiresAt' }, 'missing'] }, { $lte: ['$expiresAt', now] }] }, 1, { $add: [{ $ifNull: ['$count', 0] }, 1] }] },
        expiresAt: { $cond: [{ $or: [{ $eq: [{ $type: '$expiresAt' }, 'missing'] }, { $lte: ['$expiresAt', now] }] }, expiresAt, '$expiresAt'] }
    } }];
    let record;
    try {
        record = await RateLimit.findOneAndUpdate({ key }, update, { upsert: true, new: true });
    } catch (error) {
        if (error?.code !== 11000) throw error;
        record = await RateLimit.findOneAndUpdate({ key }, update, { new: true });
    }
    return { allowed: record.count <= limit, remaining: Math.max(0, limit - record.count), expiresAt: record.expiresAt };
};

module.exports = { consumeRateLimit, digestKey };
