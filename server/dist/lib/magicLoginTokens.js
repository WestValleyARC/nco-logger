/* hamlive-oss — MIT License. See LICENSE. */

const crypto = require('crypto');
const { conf } = require('./configLib');
const { getMagicLoginToken } = require('../models/magicLoginToken');

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const normalizedEmail = destination => String(destination).trim().toLowerCase();
const keyedDigest = (purpose, value) => crypto.createHmac('sha256', conf.magic_link_secret)
    .update(`${purpose}\0${value}`).digest('hex');

const issueMagicLoginToken = async ({ destination, db = null, now = new Date() }) => {
    const MagicLoginToken = getMagicLoginToken(db);
    const normalized = normalizedEmail(destination);
    const identityHash = keyedDigest('identity', normalized);
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenDigest = keyedDigest('token', token);
    await MagicLoginToken.findOneAndUpdate(
        { identityHash },
        { $set: { tokenDigest, destination: normalized, expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS) } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return token;
};

const consumeMagicLoginToken = async ({ token, db = null, now = new Date() }) => {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const MagicLoginToken = getMagicLoginToken(db);
    return MagicLoginToken.findOneAndDelete({ tokenDigest: keyedDigest('token', token), expiresAt: { $gt: now } });
};

const revokeMagicLoginToken = async ({ token, db = null }) => {
    if (typeof token !== 'string') return;
    await getMagicLoginToken(db).deleteOne({ tokenDigest: keyedDigest('token', token) });
};

module.exports = { MAGIC_LINK_TTL_MS, consumeMagicLoginToken, issueMagicLoginToken, revokeMagicLoginToken };
