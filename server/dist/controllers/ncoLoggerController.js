/* hamlive-oss — MIT License. See LICENSE. */

const mongoose = require('mongoose');
const { ResponseHandler } = require('../lib/responseUtils');
const { logger } = require('../lib/logger');
const { wellFormedCall } = require('../lib/serverUtils');
const netOps = require('../lib/sharedNetOps');
const NetProfile = require('../models/netProfile').getNetProfile(null);
const LiveNet = require('../models/liveNet').getLiveNet(null);
const UserProfile = require('../models/userProfile').getUserProfile(null);
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
        const profile = rawValue.profile;
        if (profile && typeof profile === 'object') {
            clean.profile = {};
            for (const field of ['name', 'location']) {
                if (!Object.prototype.hasOwnProperty.call(profile, `${field}Override`)) continue;
                clean.profile[field] = String(profile[field] || '').trim().slice(0, 80);
                clean.profile[`${field}Override`] = Boolean(profile[`${field}Override`]);
                clean.profile[`${field}Origin`] = profile[`${field}Origin`] === 'lookup' ? 'lookup' : 'manual';
                clean.profile[`${field}ChangedAt`] = Number(profile[`${field}ChangedAt`]) || Date.now();
                if (['netcontrol', 'netlogger'].includes(profile[`${field}OwnerRole`])) {
                    clean.profile[`${field}OwnerRole`] = profile[`${field}OwnerRole`];
                }
            }
        }
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

module.exports = { ncoLoggerAction, sanitizeLoggerState, setCheckedState };
