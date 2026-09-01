/* hamlive-oss — MIT License. See LICENSE. */

const { realtimeClients } = require('./realtimeClients');
const { logger } = require('./logger');
const { NetCloseReport } = require('./userNotification');
const { getFlexOptionsByUser, wellFormedCall } = require('./serverUtils');
const stationProfiles = require('./stationProfileService');
const { lookupStationProfile } = stationProfiles;
const { getNetProfile } = require('../models/netProfile');
const { getUserProfile } = require('../models/userProfile');
const { getLiveNet } = require('../models/liveNet');
const { getPendingUnfollow, getPendingAccountDelete } = require('../models/taskQueues');
const { getStationInteraction } = require('../models/stationInteraction');
const { getScheduledOccurrence } = require('../models/scheduledOccurrence');
const mongoose = require('mongoose');
const { cleanupNetChat } = require('./localChat');
const { withKeyedOperations } = require('./keyedOperation');
const { performance } = require('node:perf_hooks');

const elapsedMs = startedAt => Math.round((performance.now() - startedAt) * 10) / 10;

function getModels(db = null) {
    return {
        NetProfile: getNetProfile(db),
        UserProfile: getUserProfile(db),
        LiveNet: getLiveNet(db),
        PendingUnfollow: getPendingUnfollow(db),
        PendingAccountDelete: getPendingAccountDelete(db),
        StationInteraction: getStationInteraction(db),
        ScheduledOccurrence: getScheduledOccurrence(db)
    };
}

const roleLevels = new Map([
    ['netcontrol', 0],
    ['netlogger', 1],
    ['netrelay', 2],
    ['netuser', 3]
]);
/*  
    Any 'net function' used by 2 more modules should be moved to this lib.
    Typical example: functions used by both the command line functions and
    by controllers should be centralized here

 */
const validRoles = Array.from(roleLevels.keys());
const qrzStatus = (outcome, successful = false, deferred = false) => {
    if (successful) return deferred ? 'later-success' : 'immediate-success';
    return ({
        quota: 'quota',
        'auth-session-failure': 'auth-session-failure',
        'not-found': 'not-found',
        disabled: 'disabled',
        timeout: 'timeout',
        'network-failure': 'network-failure',
        'malformed-response': 'malformed-response',
        'service-error': 'service-error',
        'no-data': 'no-data'
    })[outcome] || 'service-error';
};

async function applyDeferredQrzEnrichment({ dia, liveNetId, callSign, baseline, lookup, db }) {
    const { StationInteraction } = getModels(db);
    let response;
    try {
        response = await lookup;
    } catch {
        response = { result: null, outcome: 'network-failure' };
    }
    const result = response?.result;
    const status = qrzStatus(response?.outcome, ['success', 'success-cache'].includes(response?.outcome), true);
    try {
        const updates = [
            ['name', 'displayName', result?.displayName],
            ['location', 'location', result?.location]
        ];
        for (const [, interactionField, value] of updates) {
            if (!value || baseline[interactionField]) continue;
            await StationInteraction.updateOne(
                { _id: dia._id, [interactionField]: baseline[interactionField] },
                { $set: { [interactionField]: value } }
            );
        }
        if (result?.photo && !baseline.photo) {
            await StationInteraction.updateOne(
                { _id: dia._id, photo: baseline.photo },
                { $set: { photo: result.photo } }
            );
        }
        await StationInteraction.updateOne(
            { _id: dia._id },
            { $set: { qrzLookupStatus: status, qrzLookupAt: new Date() } }
        );
        logger.info(`QRZ deferred enrichment ${status} for ${callSign}`);
    } catch (err) {
        logger.warn(`QRZ deferred enrichment could not update ${callSign}: ${err.message}`);
    }
    return { callSign, status };
}

async function getStationDetail({ lnid, station, db = mongoose.connection }) {
    let { LiveNet, StationInteraction } = getModels(db);

    let ia;
    let lnresult;
    const stationUpper = station.toUpperCase();

    if (!lnid || !station) {
        logger.error(`getStationDetail() missing required params, received lnid: ${lnid}, station: ${station}`);
        throw new Error('getStationDetail() missing required params');
    } else {
        if ((lnresult = await LiveNet.findById(lnid))) {
            if ((ia = await StationInteraction.findById(lnresult.lookupTable.get(stationUpper)?.stationInteraction))) {
                if (validRoles.includes(ia.role)) {
                    return {
                        role: ia.role,
                        level: roleLevels.get(ia.role),
                        checkedState: ia.checkedState
                    };
                } else {
                    throw new Error(`getStationDetail() role in ia doc: ${ia.role} not found in valid roles map`);
                }
            } else {
                throw new Error(
                    `could not find role details, make sure ${station.toLowerCase()} is checked-in or online`
                );
            }
        } else {
            throw new Error(`getStationDetail() livenet ${lnid} not found in db`);
        }
    }
}

async function checkStateUnlocked({
    liveNet,
    srcStation,
    state,
    dstStations,
    highlight = false,
    hand = false,
    flexOpts,
    metrics = null,
    qrzLookupFn = lookupStationProfile,
    deferredTasks = null,
    db = mongoose.connection
}) {
    const operationStartedAt = performance.now();
    const stationMetrics = new Map();
    // Validate state
    if (typeof state !== 'boolean' && state !== null) {
        throw new Error('checkState(): valid state options are true, false, or null');
    }

    // Validate liveNet
    if (!liveNet || !liveNet.lookupTable) {
        throw new Error('checkState(): missing liveNet doc as param or missing lookupTable in liveNet doc');
    }

    // Validate dstStations
    dstStations.forEach(dstStation => {
        if (typeof dstStation !== 'string') {
            throw new Error('checkState() expects dstStations[] to each be of type string');
        }
        if (!wellFormedCall(dstStation)) {
            throw new Error(`Malformed callsign: ${dstStation}`);
        }
    });

    const { level: myLevel, checkedState: myCheckedState } = await getStationDetail({
        lnid: liveNet._id,
        station: srcStation.toUpperCase(),
        db
    });

    if (myCheckedState === false) {
        throw new Error(`You must be checked-in to alter check-state`);
    }

    // Check role level
    if (myLevel > 1) throw new Error(`Only NCS or logger can alter checked state`);

    let { StationInteraction, UserProfile } = getModels(db);

    const knownStations = [];
    const newStations = [];
    const deferredQrz = [];
    const tsIndex = new Map();
    const tsBase = Date.now();

    let stateDescription = '';
    if (state === true) {
        stateDescription = 'IN';
    } else if (state === false) {
        stateDescription = 'OUT';
    } else if (state === null) {
        stateDescription = 'default';
    }

    logger.info(
        `checkState(): ${srcStation} is changing check-state to '${stateDescription}' for ${dstStations.length} stations`
    );

    // Process stations
    dstStations.forEach((s, index, arr) => {
        const station = s.trim().toUpperCase();

        if (s.length) {
            if (!wellFormedCall(station)) throw new Error(`Malformed callsign: ${station}`);

            if (srcStation.toUpperCase() === station) {
                throw new Error(`Cannot alter your *own check-state`);
            }

            const ts = tsBase + index;
            tsIndex.set(station, ts);

            if (liveNet.lookupTable.has(station.toUpperCase())) {
                knownStations.push(station);
                stationMetrics.set(station, {
                    path: state === true
                        ? 'existing-station-check-in'
                        : state === false
                            ? 'existing-station-check-out'
                            : 'existing-station-update'
                });
            } else {
                if (state === false) {
                    throw new Error(`${s} must be checked-*in prior to check-*out (use io command for in-out)`);
                } else {
                    newStations.push(station);
                    stationMetrics.set(station, { path: 'new-station-local-profile' });
                }
            }
        }
    });

    // Check role-level privs
    if (knownStations.length) {
        await Promise.all(
            knownStations.map(async dstStation => {
                const { level: targetLevel } = await getStationDetail({
                    lnid: liveNet._id,
                    station: dstStation,
                    db
                });

                if (myLevel >= targetLevel) {
                    throw new Error(
                        `Insufficient Privileges: ${srcStation.toLowerCase()} cannot alter ${dstStation.toLowerCase()}'s check-state`
                    );
                }
            })
        );
    }

    // Process known stations
    const knownIaDocs = await Promise.all(
        knownStations.map(dstStation => {
            let diaId;

            if ((diaId = liveNet.lookupTable.get(dstStation.toUpperCase())?.stationInteraction)) {
                return StationInteraction.findById(diaId);
            }
        })
    );

    // Process new stations
    const newIaDocs = await Promise.all(
        newStations.map(async dstStation => {
            let userData;
            let manualOverrides;
            let qrzData = null;
            const dstStationUpper = dstStation.toUpperCase();
            const timing = stationMetrics.get(dstStationUpper);
            const profileStartedAt = performance.now();
            let lookupStatus = 'deferred';

            [userData, manualOverrides] = await Promise.all([
                UserProfile.findOne({ callSign: dstStationUpper }),
                stationProfiles.getManualOverrides(dstStationUpper, db)
            ]);
            if (timing) timing.profileLookupMs = elapsedMs(profileStartedAt);
            // Ordinary account display names are not authoritative station-log names.
            // Start QRZ for every new station, while preserving the non-blocking
            // local-profile path and any local location/photo/account data.
            const qrzStartedAt = performance.now();
            const lookup = Promise.resolve()
                .then(() => qrzLookupFn(dstStationUpper, flexOpts, db))
                .catch(() => ({ result: null, outcome: 'network-failure' }));
            const configuredWait = Number(flexOpts?.qrzCheckInWaitMs);
            const configuredBudget = Math.min(5000, Math.max(0, Number.isFinite(configuredWait) ? configuredWait : 0));
            const waitMs = userData ? 0 : configuredBudget;
            let lookupResponse = null;
            if (waitMs > 0) {
                lookupResponse = await Promise.race([
                    lookup,
                    new Promise(resolve => setTimeout(() => resolve(null), waitMs))
                ]);
            }
            if (lookupResponse) {
                qrzData = lookupResponse.result;
                lookupStatus = qrzStatus(lookupResponse.outcome, Boolean(qrzData), false);
            }
            if (timing) {
                timing.path = userData ? 'new-station-local-profile' : 'new-station-qrz';
                timing.qrzStatus = lookupResponse ? lookupStatus : 'deferred';
                timing.qrzWaitMs = waitMs;
                if (lookupResponse) timing.qrzLookupMs = elapsedMs(qrzStartedAt);
            }
            if (!lookupResponse) deferredQrz.push({ callSign: dstStationUpper, lookup });

            return new StationInteraction({
                netProfile: liveNet.netProfile,
                liveNet: liveNet._id,
                callSign: dstStationUpper,
                createdBy: 'admin',
                userProfile: userData?._id || null,
                displayName: manualOverrides.name || qrzData?.displayName || null,
                photo: userData?.photo || qrzData?.photo || null,
                email: userData?.email || null,
                location: manualOverrides.location || userData?.location || qrzData?.location || null,
                qrzLookupStatus: lookupStatus,
                qrzLookupAt: lookupStatus === 'deferred' ? null : new Date(),
                chatEnabled: false,
                highlight: highlight,
                hand: hand,
                checkedState: state,
                checkedInAt: state === true ? tsIndex.get(dstStationUpper) : null,
                sigReports: {
                    rst: {}
                }
            });
        })
    );

    // Update known stations
    const knownResponses = await Promise.all(knownIaDocs.map(async dia => {
        const ts = tsIndex.get(dia.callSign.toUpperCase());
        const dupe = dia.checkedState === state;

        // Throw an error if trying to check out a station that hasn't checked in
        if (dia.checkedState === null && state === false) {
            throw new Error(`${dia.callSign} must be checked-in prior to check-out (use io command for in-out)`);
        }

        if (state === null) {
            //changing to lurker:
            dia.checkedState = null;
            dia.checkedInAt = null;
        } else {
            //changing to in or out:
            dia.checkedState = state;
            if (state) {
                //changing to in:
                dia.checkedInAt = ts;
            }
        }

        // If the requested check-state is not a dupe, save the document
        if (!dupe) {
            const persistenceStartedAt = performance.now();
            try {
                await dia.save();
                const timing = stationMetrics.get(dia.callSign.toUpperCase());
                if (timing) timing.persistenceMs = elapsedMs(persistenceStartedAt);
            } catch (err) {
                logger.error(`In dia.save(): ${err}`);
                throw err;
            }
        }

        return {
            callSign: dia.callSign,
            checkedState: dia.checkedState,
            dupe,
            ts
        };
    }));

    // Save new stations
    const newResponses = await Promise.all(
        newIaDocs.map(async dia => {
            const persistenceStartedAt = performance.now();
            try {
                await dia.save();
                const timing = stationMetrics.get(dia.callSign.toUpperCase());
                if (timing) timing.persistenceMs = elapsedMs(persistenceStartedAt);
            } catch (err) {
                logger.error(`In dia.save(): ${err}`);
                throw err;
            }

            liveNet.lookupTable.set(dia.callSign.toUpperCase(), {
                stationInteraction: dia._id
            });

            const { callSign, checkedState, checkedInAt: ts } = dia;

            return {
                callSign,
                checkedState,
                dupe: false,
                ts
            };
        })
    );

    // Save liveNet if new stations were added
    if (newIaDocs.length) {
        logger.debug(`checkState(): adding ${newIaDocs.length} new stations to lookupTable`);
        try {
            await liveNet.save();
        } catch (err) {
            logger.error(`In liveNet.save(): ${err}`);
            throw err;
        }
    }

    for (const pending of deferredQrz) {
        const dia = newIaDocs.find(item => item.callSign.toUpperCase() === pending.callSign);
        if (!dia) continue;
        const task = applyDeferredQrzEnrichment({
            dia,
            liveNetId: liveNet._id,
            callSign: pending.callSign,
            baseline: { displayName: dia.displayName ?? null, location: dia.location ?? null, photo: dia.photo ?? null },
            lookup: pending.lookup,
            db
        });
        if (Array.isArray(deferredTasks)) deferredTasks.push(task);
        else void task;
    }

    if (metrics && typeof metrics === 'object') {
        metrics.totalMs = elapsedMs(operationStartedAt);
        metrics.stations = [...stationMetrics.entries()].map(([callSign, timing]) => ({ callSign, ...timing }));
    }

    return [...knownResponses, ...newResponses].sort((a, b) => a.ts - b.ts);
}

async function checkState(options) {
    const { LiveNet } = getModels(options.db || mongoose.connection);
    const liveNetId = options.liveNet?._id;
    const keys = (options.dstStations || []).map(station => `${liveNetId}:${String(station).trim().toUpperCase()}`);
    return withKeyedOperations(keys, async () => {
        const latestLiveNet = liveNetId ? await LiveNet.findById(liveNetId) : null;
        return checkStateUnlocked({ ...options, liveNet: latestLiveNet || options.liveNet });
    });
}

async function hand({ liveNet, srcStation, dstStation, state, db = mongoose.connection }) {
    if (!dstStation || !liveNet) {
        throw new Error('hand(): missing required params');
    }

    if (typeof state !== 'boolean') {
        throw new Error(`hand(): expected boolean param and received ${state}`);
    }

    const { StationInteraction } = getModels(db);
    const diaId = liveNet.lookupTable.get(dstStation.toUpperCase())?.stationInteraction;
    if (!diaId) {
        throw new Error(`hand(): could not find interaction for ${dstStation}. Is callsign correct?`);
    }

    const dia = await StationInteraction.findById(diaId);
    if (!dia) {
        throw new Error(`hand(): could not retrieve hand state for ${dstStation}.`);
    }

    if (srcStation !== dstStation) {
        const { level: myLevel, checkedState: myCheckedState } = await getStationDetail({
            lnid: liveNet._id,
            station: srcStation.toUpperCase()
        });
        if (myCheckedState === false) {
            throw new Error(`You must be checked-in to alter hand state`);
        }

        if (myLevel > 1) {
            throw new Error('only NCS or logger can alter hand state');
        }
    }

    dia.hand = state;

    const savedDia = await dia.save();
    if (!savedDia) {
        throw new Error(`hand() could not save state in interaction doc for ${dstStation}`);
    }

    return savedDia.hand;
}

async function highlight({ liveNet, srcStation, dstStation, state, db = mongoose.connection }) {
    let { StationInteraction } = getModels(db);

    let dia;

    if (typeof state === 'boolean') {
        if (dstStation && liveNet) {
            dia = await StationInteraction.findById(
                liveNet.lookupTable.get(dstStation.toUpperCase())?.stationInteraction
            );

            if (liveNet && dia) {
                if (dia.checkedState !== true && state)
                    throw new Error('highlight() can only highlight checked-in stations');

                if ((await getStationDetail({ lnid: liveNet._id, station: srcStation.toUpperCase() })).level > 1)
                    throw new Error(`only NCS or logger can alter highlight state`);

                dia.highlight = state;
                if (!(await dia.save())) {
                    throw new Error(`highlight() could not save state in interaction doc for ${dstStation}`);
                }

                return dia.highlight;
            } else {
                throw new Error(
                    `highlight(): could not retreive state from db for ${dstStation}. Is callsign correct?`
                );
            }
        } else {
            throw new Error('highlight(): missing required params - livenetdoc or dst station');
        }
    } else {
        throw new Error(`highlight(): expected boolean param and received ${state}`);
    }
}

async function setNetRole({ lnid, station, newRole, db = mongoose.connection, session = null }) {
    // Parameter validation
    if (!lnid) throw new Error('setNetRole(): missing lnid param');
    if (typeof station !== 'string' || !station) throw new Error('setNetRole(): missing or invalid station param');
    if (!validRoles.includes(newRole)) throw new Error('setNetRole() called with invalid role as param');

    let { LiveNet, StationInteraction } = getModels(db);

    let ia;
    let lnresult;
    const stationUpper = station.toUpperCase();

    // Pass session to findById
    if ((lnresult = await LiveNet.findById(lnid).session(session))) {
        const lookup = lnresult.lookupTable.get(stationUpper);
        if (lookup && (ia = await StationInteraction.findById(lookup.stationInteraction).session(session))) {
            //checks on target station:
            const hasAccount = Boolean(ia.userProfile);
            const isOwner = hasAccount
                ? (await netOwnerCheck({ npid: lnresult.netProfile, upid: ia.userProfile, session })).confirmed
                : false;

            if ((newRole === 'netcontrol' || newRole === 'netlogger') && !hasAccount)
                throw new Error(`have ${ia.callSign.toLowerCase()} create an account first`);

            if (newRole === 'netcontrol') {
                if (!isOwner)
                    throw new Error(
                        `${ia.callSign.toLowerCase()} must also be an owner. type "help owner" for more info`
                    );

                //update livenetdoc with new ncs
                lnresult.netControl = ia.userProfile;

                //save with session
                if (!(await lnresult.save({ session }))) {
                    throw new Error(`setNetRole() could not update livenetdoc with new ncs`);
                }
            }

            ia.role = newRole;

            // Save with session
            if (!(await ia.save({ session }))) {
                throw new Error(`setNetRole() could not save interaction doc with role update for ${ia._id}`);
            }
        } else {
            throw new Error(`setNetRole() make sure ${station} is in attendance`);
        }
    } else {
        throw new Error(`setNetRole() livenet ${lnid} not found in db`);
    }
}

async function handoffNetControl({ lnid, sourceStation, targetStation, db = mongoose.connection, session }) {
    if (!lnid) throw new Error('handoffNetControl(): missing lnid param');
    if (!session) throw new Error('handoffNetControl(): transaction session required');
    if (typeof sourceStation !== 'string' || !sourceStation)
        throw new Error('handoffNetControl(): missing or invalid source station');
    if (typeof targetStation !== 'string' || !targetStation)
        throw new Error('handoffNetControl(): missing or invalid target station');

    const sourceUpper = sourceStation.toUpperCase();
    const targetUpper = targetStation.toUpperCase();
    if (sourceUpper === targetUpper) throw new Error('handoffNetControl(): source and target must be different');

    const { LiveNet, StationInteraction } = getModels(db);
    const liveNet = await LiveNet.findById(lnid).session(session);
    if (!liveNet) throw new Error(`handoffNetControl(): livenet ${lnid} not found in db`);

    const sourceLookup = liveNet.lookupTable.get(sourceUpper);
    const targetLookup = liveNet.lookupTable.get(targetUpper);
    const source = sourceLookup
        ? await StationInteraction.findById(sourceLookup.stationInteraction).session(session)
        : null;
    const target = targetLookup
        ? await StationInteraction.findById(targetLookup.stationInteraction).session(session)
        : null;

    if (!source || source.checkedState !== true || source.role !== 'netcontrol')
        throw new Error('Only the checked-in NCO can perform this action');
    if (!source.userProfile || String(source.userProfile) !== String(liveNet.netControl))
        throw new Error('The current NCO does not match the active net');
    if (!target || target.checkedState !== true) throw new Error(`${targetUpper} must be checked in`);
    if (!target.userProfile) throw new Error(`have ${targetUpper.toLowerCase()} create an account first`);

    liveNet.netControl = target.userProfile;
    target.role = 'netcontrol';
    source.role = 'netlogger';

    await liveNet.save({ session });
    await target.save({ session });
    await source.save({ session });
}

async function netOwnerCheck({ req, npid, upid, db = mongoose.connection, session = null }) {
    let { NetProfile } = getModels(db);
    let confirmed = false;
    let npresult;
    let count;

    try {
        if (req) {
            npid = req.params.id;
            upid = req.user.id;
        } else {
            if (!npid || !upid) {
                throw new Error('netOwnerCheck() missing required parameters (req -OR- npid AND upid');
            }
        }

        if (!(npresult = await NetProfile.findById(npid).session(session))) {
            throw new Error(`netprofile ${npid} not found`);
        }
    } catch (err) {
        if (err.message instanceof mongoose.Error.CastError) {
            logger.error(`Netprofile ${npid} does not exist`);
        }

        logger.error(err.stack);
    }

    if (npresult) {
        count = npresult.owners.length;

        npresult.owners.forEach(owner => {
            if (owner.toString() === upid.toString()) {
                confirmed = true;
            }
        });

        return {
            confirmed,
            count,
            npresult
        };
    } else {
        logger.error(`netOwnerCheck() could not find profile: ${npid}`);
        return { confirmed: false, count };
    }
}

async function addNetOwner({ newOwnerEmail, netProfiles, flexOpts, db = mongoose.connection }) {
    let { NetProfile, UserProfile } = getModels(db);

    if (!flexOpts) {
        throw new Error('addNetOwner: missing flexOpts param');
    }
    if (!netProfiles) {
        throw new Error('addNetOwner missing required netprofiles param');
    }

    if (newOwnerEmail) {
        const count = netProfiles.toObject().owners.length;
        let upresult;

        if (count < flexOpts['maxOwnersPerNet']) {
            if ((upresult = await UserProfile.findOne({ email: newOwnerEmail }))) {
                if (!upresult.callSign) {
                    throw new Error('target does not have an amateur radio callsign');
                }

                if (
                    upresult.toObject().myNets.length >=
                    (await getFlexOptionsByUser({ user: upresult, cachedResponse: false }))?.maxNetsPerUser
                ) {
                    throw new Error('target is already at max nets');
                }

                if (netProfiles.owners.includes(upresult._id)) {
                    throw new Error('target is already owner for this net');
                }

                if (
                    await UserProfile.findByIdAndUpdate({ _id: upresult._id }, { $push: { myNets: netProfiles._id } })
                ) {
                    if (
                        await NetProfile.findOneAndUpdate({ _id: netProfiles._id }, { $push: { owners: upresult._id } })
                    ) {
                        return `co-owner privileges successfully assigned to ${upresult
                            .toObject()
                            .callSign.toLowerCase()}`;
                    } else {
                        throw new Error('Could not update owners in netprofile');
                    }
                } else {
                    throw new Error('Could not update myNets in userprofile');
                }
            } else {
                throw new Error(`no account with email: ${newOwnerEmail}`);
            }
        } else {
            throw new Error(`already at max owner count for net: ${netProfiles.title}`);
        }
    } else {
        throw new Error('missing required email address param');
    }
}

async function delNet({ upid, npid, db = mongoose.connection }) {
    let { UserProfile, LiveNet } = getModels(db);

    if (!upid || !npid) {
        throw new Error('delNet: missing required param(s)');
    }

    let upresult;
    let lnresult;

    const { confirmed, npresult, count } = await netOwnerCheck({ upid, npid, db });

    if (confirmed) {
        if (npresult.liveNet) {
            lnresult = await LiveNet.findById(npresult.liveNet);

            // Defensive: LiveNet doc may not exist even if npresult.liveNet references an _id
            // (e.g., it was removed earlier). Guard against null before accessing netControl.
            if (lnresult && lnresult.netControl && lnresult.netControl.toString() === upid.toString()) {
                logger.info(`ncs user ${upid} is deleting net ${npid}, closing first...`);
                await closeNet({ netProfileDoc: npresult, liveNetDoc: lnresult, db });
            }
        }

        if ((upresult = await UserProfile.findOneAndUpdate({ _id: upid }, { $pull: { myNets: npid } }))) {
            logger.info(
                `delNet: ${npresult.toObject().title} removed from myNets array for netOwner ${
                    upresult.toObject().callSign
                }`
            );

            if (await npresult.updateOne({ $pull: { owners: upid } })) {
                logger.info(
                    `delNet: ${upresult.toObject().callSign} removed from owners array of ${npresult.toObject().title}`
                );
            }

            if (count === 1) {
                if (npresult.followers?.length) {
                    if (
                        !(
                            npresult.followers.length === 1 &&
                            npresult.followers[0].equals(upid) &&
                            upresult.flaggedForDeletion
                        )
                    ) {
                        logger.warn('creating unfollowjob inside delnet()');
                        createBulkUnfollowJob({
                            unlink: 'userOnly',
                            npids: [npresult._id],
                            upids: npresult.followers,
                            db
                        });
                    } else {
                        logger.info(
                            `the only follower (${upid}) is flagged for deletion, no need to create unfollow job`
                        );
                    }
                }

                if (await npresult.deleteOne()) {
                    logger.info('delNet: Last net owner--net profile *immediately deleted: ' + npresult.title);

                    return 'Last net owner, netprofile hard-deleted';
                } else {
                    throw new Error('delNet: could not delete netprofile record from db');
                }
            } else if (count > 1) {
                // more net owners stations remain
                return 'delNet: some net owners remain, will not delete netprofile record from db';
            }
        } else {
            throw new Error('could not remove netprofile from users myNets array');
        }
    } else {
        throw new Error(`user (${upid}) is not net ${npid} owner`);
    }
}

async function createBulkUnfollowJob({ npids, upids, unlink = 'both', db = mongoose.connection }) {
    let { PendingUnfollow } = getModels(db);
    if (npids.length !== 0 && upids.length !== 0) {
        if (npids.length === 1 && upids.length > 1) {
            unlink = 'userOnly';
            logger.info(`defer unfollow npid:${npids[0]}, unklink:${unlink}, upid(s):${upids.join(', ')}`);
            await PendingUnfollow.insertMany(
                upids.map(upid => ({
                    unlink,
                    upid: upid,
                    npid: npids[0]
                }))
            );
        } else if (npids.length > 1 && upids.length === 1) {
            unlink = 'netOnly';
            logger.info(`defer unfollow npid(s):${npids.join(', ')}, unklink:${unlink}, upid:${upids[0]}`);
            await PendingUnfollow.insertMany(
                npids.map(npid => ({
                    unlink,
                    upid: upids[0],
                    npid: npid
                }))
            );
        } else if (upids.length === 1 && npids.length === 1) {
            logger.info(`defer unfollow npid:${npids[0]}, unklink:${unlink}, upid:${upids[0]}`);
            await PendingUnfollow.create({
                unlink,
                upid: upids[0],
                npid: npids[0]
            });
        } else {
            throw new Error('createBulkUnfollowJob: invalid params or param array lenth');
        }
    } else {
        throw new Error('createBulkUnfollowJob called with zero length param');
    }
}

async function unFollow({ upid, npid, unlink, db = mongoose.connection }) {
    let { NetProfile, UserProfile } = getModels(db);
    let output = '';

    if (!upid || !npid) {
        throw new Error('unFollow: missing required param(s)');
    }

    if (unlink != 'userOnly') {
        try {
            if (await NetProfile.findOneAndUpdate({ _id: npid }, { $pull: { followers: upid } })) {
                output += `user ${upid} removed from followers of net ${npid}. `;
            } else {
                output += `unFollow() net ${npid} does not exist. `;
            }
        } catch (err) {
            logger.error(err);
        }
    }

    if (unlink != 'netOnly') {
        try {
            if (await UserProfile.findByIdAndUpdate({ _id: upid }, { $pull: { following: npid } })) {
                output += `net ${npid} removed from following list for user ${upid}`;
            } else {
                output += `unFollow() user ${upid} does not exist. `;
            }
        } catch (err) {
            logger.error(err);
        }
    }

    return output;
}

async function closeNet({
    netProfileDoc,
    liveNetDoc,
    quiet = false,
    alreadyClosing = false,
    closedAt = new Date(),
    db = mongoose.connection
}) {
    let { NetProfile, LiveNet, StationInteraction, UserProfile, ScheduledOccurrence } = getModels(db);

    if (!alreadyClosing) {
        const claimed = await LiveNet.updateOne(
            { _id: liveNetDoc._id, closing: { $ne: true } },
            { $set: { closing: true } }
        );
        if (!claimed.modifiedCount) return false;
    }

    //cleanup SSE connection info in realtimeClients:
    realtimeClients.close(netProfileDoc._id.toString());

    liveNetDoc.closing = true;

    if (!quiet) {
        try {
            const ncr = await NetCloseReport.init({
                netProfileDoc,
                liveNetDoc,
                attendees: (
                    await Promise.all(
                        Array.from(liveNetDoc.lookupTable.values()).map(v =>
                            StationInteraction.findById(v.stationInteraction)
                        )
                    )
                )
                    .map(({ photo, callSign, role, highlight, displayName, location, checkedInAt, sigReports }) => ({
                        photo,
                        callSign,
                        role,
                        highlight,
                        displayName,
                        location,
                        checkedInAt,
                        rst: sigReports.calculated
                    }))
                    .filter(({ checkedInAt }) => checkedInAt)
            });

            // Send email report if it was created successfully
            // (may be null if chat log fetch failed and report couldn't be created)
            if (ncr) {
                //CC SuperUsers On Reports
                const suIds = (await UserProfile.find({ superUser: true })).map(su => su._id);

                await ncr.sendMailToUPIDs({ upids: [...netProfileDoc.owners, ...suIds], db });
            } else {
                logger.warn('NetCloseReport creation failed. Skipping email notification.');
            }
        } catch (err) {
            logger.error('error in close routine: report generation');
            logger.error(err.stack);
        }
    }

    // Clean local chat only AFTER report generation and delivery have been attempted.
    try {
        await cleanupNetChat(netProfileDoc._id, db);
        logger.info(`Chat history cleaned for net ${netProfileDoc.title}`);
    } catch (chatErr) {
        logger.error(`Failed to clean chat history for ${netProfileDoc.title}: ${chatErr.message}`);
    }

    try {
        if (liveNetDoc.occurrence) {
            await ScheduledOccurrence.updateOne(
                { _id: liveNetDoc.occurrence, liveNet: liveNetDoc._id, status: 'live' },
                {
                    $set: { status: 'completed', completedAt: closedAt },
                    $unset: { liveNet: 1 }
                }
            );
        }
        await StationInteraction.deleteMany({ netProfile: netProfileDoc._id });
        await LiveNet.deleteOne({ _id: liveNetDoc._id });
        await NetProfile.updateOne(
            { _id: netProfileDoc._id, liveNet: liveNetDoc._id },
            { $unset: { liveNet: 1 } }
        );

        logger.info('Net Closed');
        return true;
    } catch (error) {
        logger.error(
            `Error occurred in db cleanup while closing net ${netProfileDoc._id.toString()}: ${error.message}`
        );
        return false;
    }
}

async function flagAccountForDeletion({ userProfileDoc, deletionReason = 'manual', db = mongoose.connection }) {
    let { PendingAccountDelete } = getModels(db);

    if (userProfileDoc.locked === false && userProfileDoc.flaggedForDeletion !== true) {
        userProfileDoc.flaggedForDeletion = true;
        userProfileDoc.deletionReason = deletionReason;
        if (deletionReason !== 'inactivity') userProfileDoc.inactivityWarningSentAt = null;

        if (await userProfileDoc.save({ validateBeforeSave: false })) {
            if (
                await PendingAccountDelete.create({
                    upid: userProfileDoc._id
                })
            ) {
                logger.warn(`${userProfileDoc.id} account flagged for deletion`);
                return userProfileDoc;
            } else {
                throw new Error(`Could not enqueue account ${userProfileDoc.id} in pending account delete collection`);
            }
        } else {
            throw new Error(`Could not save account ${userProfileDoc.id} with deletion flag`);
        }
    } else {
        logger.info(`account ${userProfileDoc.id} locked or already marked for deletion`);
        return userProfileDoc;
    }
}

const getSigReportType = ({ mode, sigReportTypeByMode }) =>
    mode in sigReportTypeByMode ? sigReportTypeByMode[mode] : 'RSQ';

module.exports = {
    netOwnerCheck,
    addNetOwner,
    checkState,
    delNet,
    closeNet,
    unFollow,
    hand,
    highlight,
    createBulkUnfollowJob,
    setNetRole,
    handoffNetControl,
    getStationDetail,
    roleLevels,
    flagAccountForDeletion,
    getSigReportType
};
