/* hamlive-oss — MIT License. See LICENSE. */

const { logger } = require('../../lib/logger');
const NetProfile = require('../../models/netProfile').getNetProfile(null);
const { getLiveNet } = require('../../models/liveNet');
const LiveNet = getLiveNet(null);
const StationInteraction = require('../../models/stationInteraction').getStationInteraction(null);
const { getSigReportType, roleLevels } = require('../../lib/sharedNetOps');
const { realtimeClients } = require('../../lib/realtimeClients');
const NodeCache = require('node-cache');
const { sanitizeNotes } = require('../../lib/serverUtils');
const netDetailsCache = new NodeCache({ stdTTL: 3, checkperiod: 60 });
const { prepareEndPointResponse } = require('../../lib/responseUtils');
const { NetNotFoundError } = require('../../types/commonTypesupport');
const stationProfiles = require('../../lib/stationProfileService');

// liveNetDetails Helper Functions:

/**
 * Generates live network details.
 *
 * @param {import('./liveNetHelpers').GenLiveNetDetailsParams} params - The parameters for generating livenet details.
 * @returns {Promise<import('../../../../client/src/public/js/shared/types').LiveNetDetailsResponse>} The livenet details.
 */
const genLiveNetDetails = async ({ npid, flexOpts = {}, permitCachedResponse = false, requestingCallSign }) => {
    const { baseTtlMs, awayInMs, sigReportTypeByMode } = flexOpts;

    if (permitCachedResponse) {
        const cachedResponse = netDetailsCache.get(npid);
        if (cachedResponse) {
            logger.debug(`genLiveNetDetails: Cache HIT for liveNet DETAILS (npid ${npid})`);
            return prepareEndPointResponse(cachedResponse, undefined, getSsePath(npid), baseTtlMs);
        } else {
            logger.debug(`genLiveNetDetails: Cache MISS for liveNet DETAILS (npid ${npid})`);
        }
    }

    // fetchNetProfileAndLiveNet will throw NetNotFoundError if the netprofile or livenet is not found
    // this will be caught (and used) by the caller (RTC and LiveNetController) to cleanup the client connection / send 404 response
    const { netProfileDoc, liveNetDoc } = await fetchNetProfileAndLiveNet(npid);

    const response = buildResponseSkeleton(netProfileDoc, liveNetDoc, sigReportTypeByMode);
    const stationInteractions = await fetchStationInteractions(liveNetDoc);

    stationInteractions.forEach(ia => {
        if (ia) {
            response.stations.push(buildStationResponse(ia, awayInMs, requestingCallSign));
        }
    });

    response.stations = response.stations.filter(s => !(s.checkedState === null && s.presence === 'offline')); //Leave out offline lurkers
    response.stations.sort(sortStations);

    netDetailsCache.set(npid, response);

    return prepareEndPointResponse(response, undefined, getSsePath(npid), baseTtlMs);
};

const fetchNetProfileAndLiveNet = async npid => {
    try {
        const netProfileDoc = await NetProfile.findById(npid);
        if (!netProfileDoc) {
            throw new NetNotFoundError('fetchNetProfileAndLiveNet(): NetProfile not found');
        }

        const liveNetDoc = await LiveNet.findById(netProfileDoc.liveNet);
        if (!liveNetDoc) {
            throw new NetNotFoundError('fetchNetProfileAndLiveNet(): LiveNet not found');
        }

        return { netProfileDoc, liveNetDoc };
    } catch (err) {
        if (err instanceof NetNotFoundError) {
            // NetNotFoundError is a special case, used by the callers (realtimeClients and the liveNetController) of genLiveNetDetails() to
            // cleanup the client connection and send a 404 response to the client.
            throw err;
        } else {
            logger.error(err.message);
        }
    }
};

const buildResponseSkeleton = (netProfileDoc, liveNetDoc, sigReportTypeByMode) => {
    let response;

    try {
        if (!netProfileDoc || !liveNetDoc) {
            throw new Error('netProfileDoc or liveNetDoc null in buildResponseSkeleton()');
        }

        response = {
            net: {
                title: netProfileDoc.title,
                frequency: netProfileDoc.frequency,
                mode: netProfileDoc.mode,
                modeDetails: netProfileDoc.modeDetails,
                connections: netProfileDoc.connections || [],
                notes: sanitizeNotes(netProfileDoc.notes),
                permanent: netProfileDoc.permanent,
                invisible: netProfileDoc.invisible,
                restrictedSigReports: netProfileDoc.restrictedSigReports,
                countdownTimer: liveNetDoc.countdownTimer,
                createdAt: liveNetDoc.createdAt,
                started: liveNetDoc.started
            },
            stations: [],
            loggerState: liveNetDoc.loggerState || null
        };
    } catch (err) {
        logger.error(err);
        throw err;
    }

    if (netProfileDoc.mode === 'CUSTOM' && netProfileDoc.modeDetails === 'Web Chat') {
        response.net.sigReportType = null;
    } else {
        response.net.sigReportType = getSigReportType({ mode: netProfileDoc.mode, sigReportTypeByMode });
    }

    return response;
};

const fetchStationInteractions = liveNetDoc => {
    const ids = Array.from(liveNetDoc.lookupTable.values()).map(v => v.stationInteraction);
    return StationInteraction.find({
        _id: { $in: ids }
    });
};

const buildStationResponse = (ia, awayInMs, requestingCallSign) => {
    const lastSeenDelta = Date.now() - ia.lastSeen;
    const isRequestorsInteractionDoc =
        typeof requestingCallSign === 'string' && requestingCallSign.toUpperCase() === ia.callSign.toUpperCase();
    const presence = lastSeenDelta < awayInMs || isRequestorsInteractionDoc ? 'online' : 'offline'; // Show requestor as online in their own details

    if (isRequestorsInteractionDoc) {
        logger.info(`${ia.callSign} requesting liveNet details, online`);
    }

    // Coerce every field to satisfy isStation() unconditionally. Optional fields
    // (e.g. location for a user who never set one) are otherwise undefined, which
    // fails validation and causes the entire SSE push to be silently dropped.
    return {
        callSign: ia.callSign,
        checkedState: ia.checkedState ?? null,
        checkedInAt: ia.checkedInAt ?? null,
        presence,
        role: ia.role ?? '',
        level: roleLevels.get(ia.role) ?? 3,
        hand: Boolean(ia.hand),
        highlight: Boolean(ia.highlight),
        photo: ia.photo ?? null,
        displayName: ia.displayName ?? '',
        location: ia.location ?? '',
        chatEnabled: Boolean(ia.chatEnabled),
        userProfile: ia.userProfile ?? null,
        averageSigReport: ia.sigReports?.calculated || null
    };
};

const sortStations = (a, b) => {
    if (a.checkedState === b.checkedState) {
        return a.checkedInAt - b.checkedInAt;
    }

    return a.checkedState === true
        ? -1
        : b.checkedState === true
          ? 1
          : a.checkedState === null
            ? -1
            : b.checkedState === null
              ? 1
              : 0;
};

const createStationInteraction = async ({ req, res, netProfileDoc, liveNetDoc }) => {
    const { callSign, _id: userId, photo, email, displayName, location } = req.user;
    const { _id: netProfileId, autoIn } = netProfileDoc;
    const { _id: liveNetId } = liveNetDoc;
    const { chat } = res.locals.flexOpts;
    const now = Date.now();
    const profile = await stationProfiles.syncParticipantProfile({
        callSign, name: displayName, location, editorCallSign: callSign, editorUserId: userId
    });

    const interaction = new StationInteraction({
        netProfile: netProfileId,
        liveNet: liveNetId,
        callSign,
        createdBy: 'user',
        userProfile: userId,
        photo,
        email,
        displayName: profile.fields.name.value,
        location: profile.fields.location.value,
        participantProfile: {
            name: stationProfiles.normalizeName(displayName),
            location: stationProfiles.normalizeLocation(location)
        },
        chatEnabled: chat,
        checkedState: autoIn ? true : null,
        checkedInAt: autoIn ? now : null,
        lastSeen: now,
        sigReports: {
            rst: {}
        }
    });

    const iaresult = await interaction.save();
    if (!iaresult) {
        throw new Error(`could not save new station interaction doc for ${callSign}, npid: ${netProfileId}`);
    }

    liveNetDoc.lookupTable.set(callSign, {
        stationInteraction: iaresult._id
    });

    if (!(await liveNetDoc.save())) {
        throw new Error(`could not save livenet doc with updated lookup table for npid: ${netProfileId}`);
    }

    if (autoIn) {
        logger.info(`Check-in (auto) ${iaresult.callSign.toUpperCase()} at ${new Date(now).toISOString()}`);
    }

    return iaresult;
};

const updateStationInteraction = async ({ req, res, netProfileDoc, liveNetDoc }) => {
    const { callSign, _id: userId, displayName, photo, location } = req.user;
    const { chat, awayInMs } = res.locals.flexOpts;
    const interactionId = liveNetDoc.lookupTable.get(callSign).stationInteraction;

    const interaction = await StationInteraction.findById(interactionId);

    if (!interaction) {
        throw new Error(`could not retrieve ia doc for ${callSign}, npid: ${netProfileDoc.id}`);
    }

    const participantProfile = {
        name: stationProfiles.normalizeName(displayName),
        location: stationProfiles.normalizeLocation(location)
    };
    const participantProfileChanged = interaction.participantProfile?.name !== participantProfile.name ||
        interaction.participantProfile?.location !== participantProfile.location;
    const profile = participantProfileChanged
        ? await stationProfiles.syncParticipantProfile({
            callSign, name: displayName, location, editorCallSign: callSign, editorUserId: userId
        })
        : null;

    const lastSeenDelta = Date.now() - interaction.lastSeen;
    const update = {
        lastSeen: Date.now(),
        displayName: profile?.fields.name.value ?? interaction.displayName,
        photo,
        userProfile: userId,
        location: profile?.fields.location.value ?? interaction.location,
        participantProfile,
        chatEnabled: chat
    };

    if (lastSeenDelta > awayInMs) {
        update.$inc = { manualPushCount: 1 };
        logger.info(`Manual changeStream push requested for ${callSign}, due to return from away`);
    }

    const updatedInteraction = await StationInteraction.findByIdAndUpdate(interactionId, update, { new: true });

    if (!updatedInteraction) {
        throw new Error(`could not save ia doc for ${callSign}, npid: ${netProfileDoc.id}`);
    }

    return updatedInteraction;
};

const capturePresence = async ({ req, res, netProfileDoc, liveNetDoc }) => {
    const now = Date.now();
    let interaction;

    if (!liveNetDoc.lookupTable || !liveNetDoc.lookupTable.has(req.user.callSign)) {
        interaction = await createStationInteraction({ req, res, netProfileDoc, liveNetDoc });
    } else {
        interaction = await updateStationInteraction({ req, res, netProfileDoc, liveNetDoc });
    }

    const { role } = interaction;
    const { callSign } = req.user;
    const level = roleLevels.get(role);

    if (!liveNetDoc.started && level === 0 && liveNetDoc.occurrence) {
        await require('../scheduling/lifecycle').transitionPreparedOccurrence({
            occurrenceId: liveNetDoc.occurrence,
            now: new Date(now)
        });
    } else if (!liveNetDoc.started && level === 0) {
        const startTime = new Date(liveNetDoc.createdAt);
        const adjustedStartTime = new Date(startTime.getTime() + liveNetDoc.countdownTimer * 60000);

        if (now > adjustedStartTime) {
            liveNetDoc.started = true;
            liveNetDoc.startedAt = now;

            try {
                await liveNetDoc.save();
                logger.debug(`LIVENET_Controller: Setting net state to "started" ${netProfileDoc.id}`);
            } catch (err) {
                logger.error(`Failed to save live net doc: ${err.message}`);
                throw err;
            }
        }
    }

    return {
        callSign,
        level
    };
};

const getSsePath = npid => `/api/sse/livenets/${npid}`;

const handleCloseAndSendError = (handleResponse, res, npid, errorCode, message) => {
    logger.info(message);
    realtimeClients.close(npid);
    handleResponse.sendError(res, errorCode, message);
};

const handleNotFound = (handleResponse, res, npid) => {
    const message = `handleNotFound(): Net profile or live net not found for npid: ${npid}`;
    handleCloseAndSendError(handleResponse, res, npid, 'NOT_FOUND', message);
};

const handleClosing = (handleResponse, res, npid) => {
    const message = `Received request while closing: ${npid}`;
    handleCloseAndSendError(handleResponse, res, npid, 'NOT_FOUND', message);
};

module.exports = {
    genLiveNetDetails,
    handleNotFound,
    handleClosing,
    capturePresence,
    fetchNetProfileAndLiveNet,
    getSsePath
};
