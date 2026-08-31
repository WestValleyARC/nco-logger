/* hamlive-oss — MIT License. See LICENSE. */

const mongoose = require('mongoose');
const { qrzLookup } = require('./serverUtils');
const { getStationNameOverride } = require('../models/stationNameOverride');

const normalizeCall = value => String(value || '').trim().toUpperCase();
const normalizeName = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);

async function findNameOverride(callSign, db = mongoose.connection) {
    const StationNameOverride = getStationNameOverride(db);
    return StationNameOverride.findOne({ callSign: normalizeCall(callSign) });
}

async function applyNameOverride(callSign, lookup, db = mongoose.connection) {
    const saved = await findNameOverride(callSign, db);
    const displayName = normalizeName(saved?.displayName);
    if (!displayName) return { ...lookup, manualNameOverride: false };
    return {
        ...lookup,
        result: { ...(lookup?.result || {}), callSign: normalizeCall(callSign), displayName },
        manualNameOverride: true
    };
}

async function lookupStationProfile(callSign, flexOpts, db = mongoose.connection, qrzLookupFn = qrzLookup) {
    const lookup = await qrzLookupFn(normalizeCall(callSign), flexOpts, db);
    return applyNameOverride(callSign, lookup, db);
}

async function saveNameOverride({ callSign, displayName, updatedBy, db = mongoose.connection }) {
    const StationNameOverride = getStationNameOverride(db);
    const normalizedName = normalizeName(displayName);
    if (!normalizedName) throw new Error('A manual station name is required');
    return StationNameOverride.findOneAndUpdate(
        { callSign: normalizeCall(callSign) },
        { $set: { displayName: normalizedName, updatedBy: normalizeCall(updatedBy) } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
}

async function clearNameOverride(callSign, db = mongoose.connection) {
    const StationNameOverride = getStationNameOverride(db);
    return StationNameOverride.deleteOne({ callSign: normalizeCall(callSign) });
}

module.exports = {
    applyNameOverride,
    clearNameOverride,
    findNameOverride,
    lookupStationProfile,
    normalizeName,
    saveNameOverride
};
