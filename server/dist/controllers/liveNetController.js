/* hamlive-oss — MIT License. See LICENSE. */

const { ResponseHandler } = require('../lib/responseUtils');
const { logger } = require('../lib/logger');
const { conf } = require('../lib/configLib');
const NetProfile = require('../models/netProfile').getNetProfile(null);
const LiveNet = require('../models/liveNet').getLiveNet(null);
const StationInteraction = require('../models/stationInteraction').getStationInteraction(null);
const ScheduledOccurrence = require('../models/scheduledOccurrence').getScheduledOccurrence(null);
const { canAccessScheduledPreparation } = require('../lib/scheduling/lifecycle');
const { netOwnerCheck } = require('../lib/sharedNetOps');
const NodeCache = require('node-cache');
const netListCache = new NodeCache({ stdTTL: 3, checkperiod: 60 });
const { NetAnnounceStart } = require('../lib/userNotification');
const oHash = require('object-hash');
const helpers = require('../lib/controllers/liveNetHelpers');
const stationProfiles = require('../lib/stationProfileService');
const { isLiveNetDetailsResponse, NetNotFoundError } = require('../types/commonTypesupport');

const getCheckInCounts = async (liveNets, StationInteractionModel = StationInteraction) => {
    const stationInteractionIds = liveNets.flatMap(item => {
        const lookupEntries = item.lookupTable instanceof Map
            ? Array.from(item.lookupTable.values())
            : Object.values(item.lookupTable || {});

        return lookupEntries.map(entry => entry.stationInteraction).filter(Boolean);
    });
    const groupedCheckInCounts = stationInteractionIds.length
        ? await StationInteractionModel.aggregate([
              { $match: { _id: { $in: stationInteractionIds }, checkedState: true } },
              { $group: { _id: '$liveNet', checkInCount: { $sum: 1 } } }
          ])
        : [];

    return new Map(groupedCheckInCounts.map(item => [item._id.toString(), item.checkInCount]));
};

const liveNetDetails = async (req, res, presenceOnly = false) => {
    const {
        params: { id: npid },
        query: { capturePresence: capturePresenceParam = 'false' } = {},
        user: { callSign: requestingCallSign }
    } = req;

    if (!npid) {
        throw new Error('Net profile id (npid) is required');
    }

    if (!res.locals.flexOpts) {
        throw new Error('flexOpts is required in res.locals');
    }

    const { flexOpts } = res.locals;
    const { baseTtlMs, awayInMs, sigReportTypeByMode } = flexOpts;

    const requiredFields = [
        { name: 'baseTtlMs', value: baseTtlMs, type: 'number' },
        { name: 'awayInMs', value: awayInMs, type: 'number' },
        { name: 'sigReportTypeByMode', value: sigReportTypeByMode, type: 'any' }
    ];

    requiredFields.forEach(field => {
        if (field.value === undefined) {
            throw new Error(`${field.name} is required`);
        } else if (field.type === 'number' && (typeof field.value !== 'number' || isNaN(field.value))) {
            throw new Error(`${field.name} must be a number`);
        }
    });

    const shouldCapturePresence = capturePresenceParam === 'true' || presenceOnly === true;
    //This buffer % should come form flexOpts eventually (common between this file, realtimeClients.ts, presence.ts and frequency.js)
    const AWAY_BUFFER_PCT = 20;
    const adjustedAwayInMs = awayInMs * (1 - AWAY_BUFFER_PCT / 100); // 80% of awayInMs

    let ttlMs;
    if (presenceOnly) {
        // request to /api/presence/livenets/:id for all clients
        ttlMs = adjustedAwayInMs;
    } else if (shouldCapturePresence) {
        // request to /api/data/livenets/:id for polling clients
        ttlMs = Math.min(baseTtlMs, adjustedAwayInMs); // whichever is smaller
    } else {
        // request to /api/data/livenets/:id for sse capable clients
        ttlMs = baseTtlMs;
    }

    const handleResponse = new ResponseHandler({ ssePath: helpers.getSsePath(npid), ttlMs });

    try {
        // fetchNetProfileAndLiveNet will throw NetNotFoundError if the netprofile or livenet is not found
        const { liveNetDoc, netProfileDoc } = await helpers.fetchNetProfileAndLiveNet(npid);

        if (liveNetDoc.occurrence && !liveNetDoc.started) {
            const occurrence = await ScheduledOccurrence.findById(liveNetDoc.occurrence);
            if (!canAccessScheduledPreparation({
                netProfile: netProfileDoc,
                liveNet: liveNetDoc,
                occurrence,
                user: req.user
            })) {
                handleResponse.sendError(res, 'FORBIDDEN', 'Scheduled net is not on the air');
                return;
            }
        }

        if (liveNetDoc.closing) {
            helpers.handleClosing(handleResponse, res, npid);
            return;
        }

        let client;
        if (shouldCapturePresence) client = await helpers.capturePresence({ req, res, netProfileDoc, liveNetDoc });

        const details =
            presenceOnly === true ? {} : await helpers.genLiveNetDetails({ npid, flexOpts, requestingCallSign });

        if (!presenceOnly && !isLiveNetDetailsResponse(details)) {
            logger.error(
                `LIVENET_Controller: genLiveNetDetails(): invalid response for npid: ${npid}, details: ${JSON.stringify(
                    details
                )}`
            );
        }

        handleResponse.sendResponse(res, 'OK', { client, ...details });
    } catch (err) {
        if (err instanceof NetNotFoundError) {
            helpers.handleNotFound(handleResponse, res, npid);
            return;
        } else {
            handleResponse.sendError(res, 'INTERNAL_SERVER_ERROR', err.message);
            logger.error(err.stack);
        }
    }
};

const liveNetPresence = (req, res) => liveNetDetails(req, res, true);

const liveNetList = async (req, res) => {
    let queryResult;
    let cachedObj;

    try {
        if ((cachedObj = netListCache.get('netlist'))) {
            logger.debug('LIVENET_Controller: Cache HIT for liveNet LIST');

            cachedObj['hash'] = oHash(cachedObj, {
                respectType: false,
                ignoreUnknown: true
            });
            cachedObj['now'] = Date.now();
            cachedObj['servedFromCache'] = true;

            return res.status(200).json({ ...{ endpointVersion: '1.0' }, ...cachedObj });
        } else {
            logger.debug('LIVENET_Controller: Cache MISS for liveNet LIST');

            queryResult = await LiveNet.find({})
                .lean()
                .populate('netProfile', 'title frequency mode modeDetails permanent')
                .select('lookupTable started closing url countdownTimer createdAt netProfile');

            const checkInCountsByLiveNet = await getCheckInCounts(queryResult);

            const netlist = queryResult
                .map(item => {
                    if (item.netProfile) {
                        return {
                            id: item.netProfile._id,
                            title: item.netProfile.title,
                            frequency: item.netProfile.frequency,
                            mode: item.netProfile.mode,
                            permanent: item.netProfile.permanent,
                            closing: item.closing,
                            modeDetails: item.netProfile.modeDetails,
                            countdownTimer: item.countdownTimer,
                            started: item.started,
                            url: item.url,
                            createdAt: item.createdAt,
                            checkInCount: checkInCountsByLiveNet.get(item._id.toString()) || 0
                        };
                    }
                })
                .filter(Boolean); // This will remove any undefined items from the array

            netlist.sort((a, b) => {
                if (a.permanent === true) {
                    return -1;
                } else if (b.permanent === true) {
                    return 1;
                }
                if (a.started === true) {
                    return -1;
                } else if (b.started === true) {
                    return 1;
                }

                const aStartTime = new Date(a.createdAt);
                aStartTime.setMinutes(aStartTime.getMinutes() + a.countdownTimer);
                const bStartTime = new Date(b.createdAt);
                bStartTime.setMinutes(bStartTime.getMinutes() + b.countdownTimer);

                if (aStartTime < bStartTime) {
                    return -1;
                } else if (bStartTime < aStartTime) {
                    return 1;
                } else return 0;
            });

            if (res.locals.flexOpts.requestRateFactor) {
                logger.debug(
                    `LIVENET_Controller: liveNet LIST set w/TTL: ${
                        30 / Math.round(parseInt(res.locals.flexOpts.requestRateFactor))
                    }s`
                );
                netListCache.set(
                    'netlist',
                    { netlist },
                    30 / Math.round(parseInt(res.locals.flexOpts.requestRateFactor))
                );
            } else {
                netListCache.set('netlist', { netlist });
            }

            const response = {};
            response['netlist'] = netlist;
            response['hash'] = oHash(response, {
                respectType: false,
                ignoreUnknown: true
            });
            response['now'] = Date.now();
            response['servedFromCache'] = false;

            return res.status(200).json({ ...{ endpointVersion: '1.0' }, ...response });
        }
    } catch (err) {
        res.status(500).json({
            endpointVersion: '1.0',
            errorMessage: err.message
        });
        logger.error(err.stack);
    }
};

const liveNetCreatePost = async (req, res) => {
    const npid = req.params.id;
    let confirmed;
    let npresult;
    let lnresult;
    let iaresult;

    try {
        ({ confirmed, npresult } = await netOwnerCheck({ req }));

        if (confirmed) {
            if (npresult.liveNet) {
                throw new Error('net already running or stale livenet reference in netprofile');
            } else {
                const profile = await stationProfiles.syncParticipantProfile({
                    callSign: req.user.callSign,
                    name: req.user.displayName,
                    location: req.user.location,
                    editorCallSign: req.user.callSign,
                    editorUserId: req.user._id
                });
                const interaction = new StationInteraction({
                    netProfile: npresult._id,
                    callSign: req.user.callSign,
                    displayName: profile.fields.name.value,
                    location: profile.fields.location.value,
                    photo: req.user.photo,
                    email: req.user.email,
                    createdBy: 'admin',
                    role: 'netcontrol',
                    checkedState: true,
                    checkedInAt: new Date(),
                    userProfile: req.user._id,
                    sigReports: {
                        rst: {}
                    }
                });

                iaresult = await interaction.save();

                const liveNet = new LiveNet({
                    countdownTimer: req.body.countdownTimer && req.body.countdownTimer.trim(),
                    netProfile: npresult._id,
                    netControl: req.user._id,
                    url: `/views/livenet/${npresult._id}`,
                    lookupTable: {
                        [req.user.callSign]: {
                            stationInteraction: iaresult._id
                        }
                    }
                });

                if ((lnresult = await liveNet.save())) {
                    interaction.liveNet = lnresult._id;

                    if (!(await interaction.save())) {
                        throw new Error('could not save livenet id in interaction object at net start');
                    }

                    if (await NetProfile.findOneAndUpdate({ _id: npresult._id }, { liveNet: lnresult._id })) {
                        logger.info(`LIVENET_Controller: Started: ${npresult.title} at ${conf.base_url}${liveNet.url}`);

                        if (npresult.followers.length) {
                            const email = new NetAnnounceStart({
                                netControl: req.user.callSign,
                                netProfileDoc: npresult,
                                liveNetDoc: lnresult
                            });

                            email.sendMailToUPIDs({ upids: npresult.followers });
                        }

                        return res.json({ ...{ endpointVersion: '1.0' }, ...lnresult.toObject() });
                    } else {
                        throw new Error('Could not update netprofile with associated livenet reference');
                    }
                } else {
                    throw new Error(`could not save livenet doc to db for ${npresult._id}`);
                }
            }
        } else {
            throw new Error('you are not owner for this net');
        }
    } catch (err) {
        logger.error(err.stack);
        res.status(500).json({
            endpointVersion: '1.0',
            errorMessage: err.message
        });
    }
};

module.exports = {
    getCheckInCounts,
    liveNetList,
    liveNetCreatePost,
    liveNetDetails,
    liveNetPresence
};
