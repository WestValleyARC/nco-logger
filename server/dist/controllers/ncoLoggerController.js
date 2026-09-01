/* hamlive-oss — MIT License. See LICENSE. */

const mongoose = require('mongoose');
const { ResponseHandler } = require('../lib/responseUtils');
const { logger } = require('../lib/logger');
const { wellFormedCall, qrzLookup } = require('../lib/serverUtils');
const stationProfiles = require('../lib/stationProfileService');
const netOps = require('../lib/sharedNetOps');
const NetProfile = require('../models/netProfile').getNetProfile(null);
const LiveNet = require('../models/liveNet').getLiveNet(null);
const UserProfile = require('../models/userProfile').getUserProfile(null);
const StationInteraction = require('../models/stationInteraction').getStationInteraction(null);
const { realtimeClients } = require('../lib/realtimeClients');

const MANAGER_ROLES = new Set(['netcontrol', 'netlogger']);
const VALID_ROLES = new Set(['netcontrol', 'netlogger', 'netrelay', 'netuser']);

const normalizeCall = value => String(value || '').trim().toUpperCase();

async function loadContext(req) {
    const netProfile = await NetProfile.findById(req.params.id);
    if (!netProfile) throw new Error('Net profile not found');
    const liveNet = await LiveNet.findById(netProfile.liveNet);
    if (!liveNet) throw new Error('Active net not found');
    const source = await netOps.getStationDetail({
        lnid: liveNet._id,
        station: req.user.callSign
    });
    return { netProfile, liveNet, source };
}

function requireManager(source) {
    if (!MANAGER_ROLES.has(source.role) || source.checkedState !== true) {
        throw new Error('Only a checked-in NCO or Logger can manage the station log');
    }
}

function requireNco(source) {
    if (source.role !== 'netcontrol' || source.checkedState !== true) {
        throw new Error('Only the checked-in NCO can perform this action');
    }
}

function validateTarget(callSign) {
    const target = normalizeCall(callSign);
    if (!target || !wellFormedCall(target)) throw new Error('A valid destination callsign is required');
    return target;
}

async function setCheckedState({ req, res, liveNet, source, target, state, highlight = false }) {
    requireManager(source);
    const timing = {};
    const result = await netOps.checkState({
        liveNet,
        srcStation: req.user.callSign,
        dstStations: [target],
        state,
        highlight,
        flexOpts: res.locals.flexOpts,
        metrics: timing
    });
    return { action: 'checkState', stations: result, timing };
}

async function lookupQrzProfile({ target, flexOpts, db = mongoose.connection, profileLookupFn = stationProfiles.lookupStationProfile }) {
    const startedAt = performance.now();
    const lookup = await profileLookupFn(target, flexOpts, db);
    return {
        action: 'qrzProfile',
        callSign: target,
        qrzStatus: lookup.outcome,
        qrzLookupMs: Math.round((performance.now() - startedAt) * 100) / 100,
        profile: lookup.result || null,
        manualNameOverride: Boolean(lookup.manualNameOverride),
        profileFields: lookup.profileFields || null
    };
}

async function stationProfileFallback({ liveNet, target, StationInteractionModel = StationInteraction }) {
    const interactionId = liveNet.lookupTable.get(target)?.stationInteraction;
    const interaction = interactionId ? await StationInteractionModel.findById(interactionId) : null;
    return { name: interaction?.displayName || '', location: interaction?.location || '' };
}

async function getStationProfile({ liveNet, source, target, db = mongoose.connection,
    profileService = stationProfiles, StationInteractionModel = StationInteraction }) {
    requireManager(source);
    const fallback = await stationProfileFallback({ liveNet, target, StationInteractionModel });
    const state = await profileService.getProfileState(target, fallback, db);
    return { action: 'stationProfile', ...state };
}

async function updateStationProfile({
    req, liveNet, source, target, flexOpts, db = mongoose.connection,
    profileService = stationProfiles, qrzLookupFn = qrzLookup,
    StationInteractionModel = StationInteraction
}) {
    requireManager(source);
    const requested = req.body?.fields;
    if (!requested || typeof requested !== 'object' || Array.isArray(requested)) {
        throw new Error('Station profile fields are required');
    }
    const fields = profileService.PROFILE_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(requested, field));
    if (!fields.length) throw new Error('At least one station profile field is required');

    const fallback = await stationProfileFallback({ liveNet, target, StationInteractionModel });
    const current = await profileService.getProfileState(target, fallback, db);
    const results = {};
    for (const field of fields) {
        const expected = Number(requested[field]?.expectedRevision);
        if (!Number.isInteger(expected) || expected < 0) throw new Error(`Invalid expected ${field} revision`);
        if (expected !== current.fields[field].revision) {
            results[field] = { status: 'conflict', field, ...current.fields[field] };
        }
    }
    const eligible = fields.filter(field => !results[field]);
    const cleared = eligible.filter(field => !profileService.normalizeName(requested[field]?.value));
    const lookup = cleared.length ? await qrzLookupFn(target, flexOpts, db) : null;
    const automatic = { name: lookup?.result?.displayName || '', location: lookup?.result?.location || '' };
    for (const field of eligible) {
        const manualValue = profileService.normalizeName(requested[field]?.value);
        const value = manualValue || profileService.normalizeName(automatic[field]);
        if (!manualValue && !value) {
            results[field] = { status: 'unavailable', field, ...current.fields[field] };
            continue;
        }
        results[field] = await profileService.compareAndSetField({
            callSign: target,
            field,
            value,
            expectedRevision: requested[field]?.expectedRevision,
            editorCallSign: req.user.callSign,
            editorUserId: req.user._id || req.user.id,
            origin: manualValue ? 'manual' : 'qrz',
            fallback,
            db
        });
    }

    const interactionId = liveNet.lookupTable.get(target)?.stationInteraction;
    const acceptedUpdates = {};
    if (results.name?.status === 'accepted') acceptedUpdates.displayName = results.name.value;
    if (results.location?.status === 'accepted') acceptedUpdates.location = results.location.value;
    if (interactionId && Object.keys(acceptedUpdates).length) {
        await StationInteractionModel.updateOne({ _id: interactionId }, { $set: acceptedUpdates });
    }
    return {
        action: 'stationProfileUpdate', callSign: target, fields: results,
        conflicts: fields.filter(field => results[field].status !== 'accepted')
    };
}

async function toggleRole({ req, liveNet, source, target, desiredRole }) {
    requireManager(source);
    if (!VALID_ROLES.has(desiredRole)) throw new Error('Invalid station role');
    if (target === normalizeCall(req.user.callSign)) throw new Error('You cannot change your own role');

    const destination = await netOps.getStationDetail({ lnid: liveNet._id, station: target });
    if (source.level >= destination.level) throw new Error('Insufficient privileges to change that station role');
    if (source.role !== 'netcontrol' && !['netrelay', 'netuser'].includes(desiredRole)) {
        throw new Error('Only the NCO can assign Logger or NCO roles');
    }

    const nextRole = destination.role === desiredRole ? 'netuser' : desiredRole;
    await netOps.setNetRole({ lnid: liveNet._id, station: target, newRole: nextRole });
    return { action: 'role', callSign: target, role: nextRole };
}

async function handoff({ req, liveNet, source, target }) {
    requireNco(source);
    if (target === normalizeCall(req.user.callSign)) throw new Error('The NCO is already assigned to that station');
    const destination = await netOps.getStationDetail({ lnid: liveNet._id, station: target });
    if (destination.checkedState !== true) throw new Error(`${target} must be checked in`);

    const targetInteractionId = liveNet.lookupTable.get(target)?.stationInteraction;
    const StationInteraction = require('../models/stationInteraction').getStationInteraction(null);
    const targetInteraction = await StationInteraction.findById(targetInteractionId);
    if (!targetInteraction?.lastSeen || Date.now() - targetInteraction.lastSeen.getTime() >= resAwayInMs(req)) {
        throw new Error(`${target} must be online and present`);
    }

    const session = await mongoose.connection.startSession();
    session.startTransaction();
    try {
        await netOps.setNetRole({ lnid: liveNet._id, station: target, newRole: 'netcontrol', session });
        await netOps.setNetRole({
            lnid: liveNet._id,
            station: normalizeCall(req.user.callSign),
            newRole: 'netlogger',
            session
        });
        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        await session.endSession();
    }
    return { action: 'handoff', callSign: target };
}

// The request-local FlexOptions are not attached to req. Presence is already
// enforced by the UI and role checks; use a conservative fallback here.
function resAwayInMs(req) {
    return Number(req.res?.locals?.flexOpts?.awayInMs) || 120000;
}

function cleanCallList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(normalizeCall).filter(call => call && wellFormedCall(call)))].slice(0, 500);
}

function sanitizeLoggerState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid logger state');
    if (JSON.stringify(value).length > 100000) throw new Error('Logger state is too large');

    const details = {};
    for (const [rawCall, rawValue] of Object.entries(value.details || {})) {
        const call = normalizeCall(rawCall);
        if (!call || !wellFormedCall(call) || !rawValue || typeof rawValue !== 'object') continue;
        const tags = rawValue.tags && typeof rawValue.tags === 'object' ? rawValue.tags : {};
        const clean = {
            tags: Object.fromEntries(
                ['specialGuest', 'neededNext', 'notResponding', 'skipped', 'mobile', 'portable', 'shortTime', 'inOut', 'recheck']
                    .map(key => [key, Boolean(tags[key])])
            )
        };
        details[call] = clean;
    }

    return {
        revision: String(Date.now()),
        updated_at: Date.now(),
        order: cleanCallList(value.order),
        checkedOutOrder: cleanCallList(value.checkedOutOrder),
        lurkerOrder: cleanCallList(value.lurkerOrder),
        manualOrder: Boolean(value.manualOrder),
        hiddenCalls: cleanCallList(value.hiddenCalls),
        selectedNextCall: cleanCallList([value.selectedNextCall])[0] || '',
        details
    };
}

async function runAction(req, res) {
    const { netProfile, liveNet, source } = await loadContext(req);
    const action = String(req.body?.action || '').trim();
    const target = req.body?.callSign ? validateTarget(req.body.callSign) : '';

    switch (action) {
        case 'checkIn':
            return setCheckedState({ req, res, liveNet, source, target, state: true, highlight: false });
        case 'checkInHighlighted':
            return setCheckedState({ req, res, liveNet, source, target, state: true, highlight: true });
        case 'checkOut':
            return setCheckedState({ req, res, liveNet, source, target, state: false });
        case 'undoCheckIn':
            return setCheckedState({ req, res, liveNet, source, target, state: null });
        case 'checkInOut':
            await setCheckedState({ req, res, liveNet, source, target, state: true });
            return setCheckedState({ req, res, liveNet: await LiveNet.findById(liveNet._id), source, target, state: false });
        case 'setLogger':
            return toggleRole({ req, liveNet, source, target, desiredRole: 'netlogger' });
        case 'setRelay':
            return toggleRole({ req, liveNet, source, target, desiredRole: 'netrelay' });
        case 'handoff':
            return handoff({ req, liveNet, source, target });
        case 'frequency':
            requireNco(source);
            netProfile.frequency = String(req.body?.frequency || '').trim().slice(0, 40);
            await netProfile.save();
            return { action, frequency: netProfile.frequency };
        case 'stationInfo': {
            const callSign = target || normalizeCall(req.user.callSign);
            const detail = await netOps.getStationDetail({ lnid: liveNet._id, station: callSign });
            const user = await UserProfile.findOne({ callSign }).select('_id');
            const owner = user ? (await netOps.netOwnerCheck({ npid: netProfile._id, upid: user._id })).confirmed : false;
            return { action, callSign, ...detail, owner };
        }
        case 'qrzProfile':
            return lookupQrzProfile({ target, flexOpts: res.locals.flexOpts });
        case 'stationProfile':
            return getStationProfile({ liveNet, source, target });
        case 'stationProfileUpdate': {
            const result = await updateStationProfile({ req, liveNet, source, target, flexOpts: res.locals.flexOpts });
            await realtimeClients.push(req.params.id);
            return result;
        }
        case 'loggerState':
            requireManager(source);
            liveNet.loggerState = sanitizeLoggerState(req.body?.state);
            liveNet.markModified('loggerState');
            await liveNet.save();
            await realtimeClients.push(req.params.id);
            return { action, loggerState: liveNet.loggerState };
        case 'close':
            requireNco(source);
            void netOps.closeNet({ netProfileDoc: netProfile, liveNetDoc: liveNet });
            return { action, closing: true };
        default:
            throw new Error('Unknown NCO logger action');
    }
}

async function ncoLoggerAction(req, res) {
    const response = new ResponseHandler({ ttlMs: res.locals.flexOpts.baseTtlMs });
    try {
        const result = await runAction(req, res);
        response.sendResponse(res, 'OK', { message: result });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(error instanceof Error ? error.stack : message);
        response.sendError(res, 'INTERNAL_SERVER_ERROR', message);
    }
}

module.exports = {
    ncoLoggerAction, sanitizeLoggerState, setCheckedState, lookupQrzProfile,
    getStationProfile, updateStationProfile
};
