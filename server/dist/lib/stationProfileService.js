/* hamlive-oss — MIT License. See LICENSE. */

const mongoose = require('mongoose');
const { getStationNameOverride } = require('../models/stationNameOverride');

const PROFILE_FIELDS = ['name', 'location'];
const normalizeCall = value => String(value || '').trim().toUpperCase();
const normalizeValue = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
const normalizeName = normalizeValue;
const normalizeLocation = normalizeValue;
const emptyField = () => ({
    value: '', revision: 0, editorCallSign: '', editorUserId: '', serverUpdatedAt: null, origin: 'legacy'
});
const plain = value => typeof value?.toObject === 'function' ? value.toObject() : value;

function fieldState(saved, field, fallbackValue = '') {
    const doc = plain(saved) || {};
    const current = plain(doc.fields?.[field]);
    if (field === 'name' && normalizeName(doc.displayName) &&
        (!current || (!normalizeName(current.value) && Number(current.revision) === 0))) {
        return {
            ...emptyField(), value: normalizeName(doc.displayName), revision: 1,
            editorCallSign: normalizeCall(doc.updatedBy), serverUpdatedAt: doc.updatedAt || null, origin: 'manual'
        };
    }
    if (current && Number.isInteger(Number(current.revision))) {
        const automaticFallback = ['qrz', 'legacy'].includes(current.origin) && normalizeValue(fallbackValue);
        return {
            ...emptyField(), ...current,
            value: automaticFallback || normalizeValue(current.value),
            revision: Number(current.revision)
        };
    }
    return { ...emptyField(), value: normalizeValue(fallbackValue) };
}

async function findProfile(callSign, db = mongoose.connection) {
    return getStationNameOverride(db).findOne({ callSign: normalizeCall(callSign) });
}

async function ensureProfile(callSign, fallback = {}, db = mongoose.connection) {
    const StationProfile = getStationNameOverride(db);
    const normalizedCall = normalizeCall(callSign);
    let saved = await StationProfile.findOne({ callSign: normalizedCall });
    const name = fieldState(saved, 'name', fallback.name);
    const location = fieldState(saved, 'location', fallback.location);
    if (saved && saved.fields?.name && saved.fields?.location && !normalizeName(saved.displayName)) return saved;
    try {
        saved = await StationProfile.findOneAndUpdate(
            { callSign: normalizedCall },
            { $setOnInsert: { callSign: normalizedCall }, $set: { 'fields.name': name, 'fields.location': location },
                $unset: { displayName: 1, updatedBy: 1 } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    } catch (error) {
        if (error?.code !== 11000) throw error;
        saved = await StationProfile.findOne({ callSign: normalizedCall });
    }
    return saved;
}

async function getProfileState(callSign, fallback = {}, db = mongoose.connection) {
    const saved = await findProfile(callSign, db);
    return {
        callSign: normalizeCall(callSign),
        fields: Object.fromEntries(PROFILE_FIELDS.map(field => [field, fieldState(saved, field, fallback[field])]))
    };
}

async function getManualOverrides(callSign, db = mongoose.connection) {
    const state = await getProfileState(callSign, {}, db);
    return Object.fromEntries(PROFILE_FIELDS.flatMap(field =>
        ['manual', 'participant'].includes(state.fields[field].origin) && state.fields[field].value
            ? [[field, state.fields[field].value]] : []
    ));
}

async function syncParticipantProfile({ callSign, name, location, editorCallSign, editorUserId,
    db = mongoose.connection }) {
    const incoming = { name: normalizeName(name), location: normalizeLocation(location) };
    const fields = {};
    await ensureProfile(callSign, {}, db);
    for (const field of PROFILE_FIELDS) {
        for (let attempt = 0; attempt < 3; attempt++) {
            const current = (await getProfileState(callSign, {}, db)).fields[field];
            if (current.origin === 'manual') {
                fields[field] = { status: 'protected', field, ...current };
                break;
            }
            const origin = incoming[field] ? 'participant' : 'legacy';
            if (current.value === incoming[field] && current.origin === origin) {
                fields[field] = { status: 'unchanged', field, ...current };
                break;
            }
            const result = await compareAndSetField({
                callSign, field, value: incoming[field], expectedRevision: current.revision,
                editorCallSign, editorUserId, origin, db
            });
            if (result.status === 'accepted' || result.origin === 'manual' || attempt === 2) {
                fields[field] = result.origin === 'manual' && result.status === 'conflict'
                    ? { ...result, status: 'protected' }
                    : result;
                break;
            }
        }
    }
    return { callSign: normalizeCall(callSign), fields };
}

async function compareAndSetField({ callSign, field, value, expectedRevision, editorCallSign, editorUserId,
    origin = 'manual', fallback = {}, db = mongoose.connection }) {
    if (!PROFILE_FIELDS.includes(field)) throw new Error('Invalid station profile field');
    const expected = Number(expectedRevision);
    if (!Number.isInteger(expected) || expected < 0) throw new Error(`Invalid expected ${field} revision`);
    const StationProfile = getStationNameOverride(db);
    await ensureProfile(callSign, fallback, db);
    const next = {
        value: normalizeValue(value), revision: expected + 1,
        editorCallSign: normalizeCall(editorCallSign), editorUserId: String(editorUserId || ''),
        serverUpdatedAt: new Date(), origin
    };
    const saved = await StationProfile.findOneAndUpdate(
        { callSign: normalizeCall(callSign), [`fields.${field}.revision`]: expected },
        { $set: { [`fields.${field}`]: next } },
        { new: true }
    );
    if (saved) return { status: 'accepted', field, ...fieldState(saved, field) };
    const authoritative = await StationProfile.findOne({ callSign: normalizeCall(callSign) });
    return { status: 'conflict', field, ...fieldState(authoritative, field) };
}

async function applyManualOverrides(callSign, lookup, db = mongoose.connection) {
    const fallback = { name: lookup?.result?.displayName, location: lookup?.result?.location };
    const state = await getProfileState(callSign, fallback, db);
    const hasManual = PROFILE_FIELDS.some(field => state.fields[field].origin === 'manual');
    const result = lookup?.result || hasManual
        ? { ...(lookup?.result || {}), callSign: normalizeCall(callSign) }
        : null;
    for (const field of PROFILE_FIELDS) {
        if (!['manual', 'participant'].includes(state.fields[field].origin) || !state.fields[field].value) continue;
        result[field === 'name' ? 'displayName' : 'location'] = state.fields[field].value;
    }
    return {
        ...lookup, result, profileFields: state.fields,
        manualNameOverride: state.fields.name.origin === 'manual',
        manualLocationOverride: state.fields.location.origin === 'manual'
    };
}

async function lookupStationProfile(callSign, flexOpts, db = mongoose.connection, qrzLookupFn) {
    const lookupFn = qrzLookupFn || require('./serverUtils').qrzLookup;
    const lookup = await lookupFn(normalizeCall(callSign), flexOpts, db);
    return applyManualOverrides(callSign, lookup, db);
}

module.exports = {
    PROFILE_FIELDS,
    applyManualOverrides,
    compareAndSetField,
    fieldState,
    findProfile,
    getManualOverrides,
    getProfileState,
    lookupStationProfile,
    normalizeLocation,
    normalizeName,
    syncParticipantProfile
};
