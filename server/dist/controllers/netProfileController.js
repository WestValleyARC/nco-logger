/* hamlive-oss — MIT License. See LICENSE. */

const { logger } = require('../lib/logger');
const { netOwnerCheck, addNetOwner, delNet } = require('../lib/sharedNetOps');
const NetProfile = require('../models/netProfile').getNetProfile(null);
const UserProfile = require('../models/userProfile').getUserProfile(null);
const LiveNet = require('../models/liveNet').getLiveNet(null);
const ScheduledOccurrence = require('../models/scheduledOccurrence').getScheduledOccurrence(null);
const { loadProfileSchedulingSummaries } = require('../lib/scheduling/profileSummary');
const { sanitizeNotes } = require('../lib/serverUtils');

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const legacyFieldsForConnections = connections => {
    if (!Array.isArray(connections)) throw new Error('connections must be an array');
    if (!connections.length) return { frequency: '', mode: 'CUSTOM', modeDetails: '' };
    const primary = connections[0] || {};
    if (primary.type === 'FM') {
        return { frequency: primary.frequency || '', mode: 'FM', modeDetails: primary.tone || '' };
    }
    if (primary.type === 'Other') {
        return { frequency: '', mode: 'CUSTOM', modeDetails: String(primary.label || '').slice(0, 15) };
    }
    return { frequency: '', mode: 'Reflector', modeDetails: String(primary.type || '').slice(0, 15) };
};

const validateLegacyOperatingFields = ({ frequency, mode, modeDetails }) => {
    const customOrReflector = mode === 'CUSTOM' || mode === 'Reflector';
    if (!frequency && !customOrReflector) {
        throw new Error('empty frequency only permitted for CUSTOM or Digital Reflector modes');
    }
    if (customOrReflector && !modeDetails) {
        throw new Error('mode details required for CUSTOM or Digital Reflector modes');
    }
};

const netProfileList = async (req, res) => {
    try {
        const foundProfiles = await NetProfile.find({ _id: { $in: req.user.myNets } });
        const profilesById = new Map(foundProfiles.map(profile => [String(profile._id), profile]));
        const profiles = req.user.myNets.map(id => profilesById.get(String(id))).filter(Boolean);
        const summaries = await loadProfileSchedulingSummaries({ profiles });
        const netlist = profiles.map(profile => ({
            ...profile.toObject(),
            scheduling: summaries.get(String(profile._id))
        }));
        return res.json({ endpointVersion: '1.0', netlist });
    } catch (err) {
        logger.error(err.stack);
        return res.status(500).json({
            endpointVersion: '1.0',
            errorMessage: err.message
        });
    }
};

const netProfileDetails = async (req, res) => {
    try {
        const npresult = await NetProfile.findById(req.params.id);
        const liveNet = npresult?.liveNet ? await LiveNet.findById(npresult.liveNet) : null;
        const occurrence = liveNet?.occurrence
            ? await ScheduledOccurrence.findById(liveNet.occurrence)
            : await ScheduledOccurrence.findOne({
                  netProfile: req.params.id,
                  status: { $in: ['scheduled', 'preparing'] },
                  startAt: { $gt: new Date() }
              }).sort({ startAt: 1 });
        return res.json({
            endpointVersion: '1.0',
            _id: npresult._id,
            title: npresult.title,
            frequency: npresult.frequency,
            mode: npresult.mode,
            restrictedSigReports: npresult?.restrictedSigReports ? true : false,
            autoIn: npresult?.autoIn ? true : false,
            modeDetails: npresult.modeDetails,
            connections: npresult.connections || [],
            notes: sanitizeNotes(npresult.notes),
            live: Boolean(liveNet && (!liveNet.occurrence || liveNet.started)),
            scheduledStartAt: occurrence?.startAt || null
        });
    } catch (err) {
        res.status(500).json({
            endpointVersion: '1.0',
            errorMessage: err.message
        });
        logger.error(err.stack);
    }
};

const netProfileUpdate = async (req, res) => {
    const id = req.params.id;

    logger.debug(req.body);

    try {
        const { confirmed, npresult } = await netOwnerCheck({ req });

        if (confirmed) {
            logger.info('NETPROFILE_Controller: editing: ' + npresult.toObject().title);

            const hasConnections = hasOwn(req.body, 'connections');
            const hasLegacyFields = ['frequency', 'mode', 'modeDetails'].some(field => hasOwn(req.body, field));
            const operatingFields = hasConnections
                ? { ...legacyFieldsForConnections(req.body.connections), connections: req.body.connections }
                : hasLegacyFields
                  ? {
                        frequency: req.body.frequency && req.body.frequency.trim(),
                        mode: req.body.mode && req.body.mode.trim(),
                        modeDetails: req.body.modeDetails && req.body.modeDetails.trim()
                    }
                  : {};
            if (!hasConnections && hasLegacyFields) validateLegacyOperatingFields(operatingFields);

            npresult.set({
                title: req.body.title.trim(),
                restrictedSigReports: req.body.restrictedSigReports ? true : false,
                autoIn: req.body.autoIn ? true : false,
                notes: sanitizeNotes(req.body.notes),
                ...operatingFields
            });
            const updateResult = await npresult.save();
            res.json({ endpointVersion: '1.0', ...updateResult.toObject() });
        } else {
            throw new Error('user is not owner for this net');
        }
    } catch (err) {
        res.status(500).json({
            endpointVersion: '1.0',
            errorMessage: err.message,
            status: 500
        });
        logger.error(err.stack);
    }
};

const netProfileDelete = async (req, res) => {
    let result;

    try {
        result = await delNet({ upid: req.user.id, npid: req.params.id });

        res.status(200).json({
            endpointVersion: '1.0',
            message: result
        });
        logger.info('NETPROFILE_Controller: ' + result);
    } catch (err) {
        res.status(500).json({
            endpointVersion: '1.0',
            errorMessage: err.message
        });
        logger.error(err.stack);
    }
};

const netProfileAddNetOwner = async (req, res) => {
    const newOwnerEmail = req.body.email && req.body.email.trim();
    let result;
    let netProfileDoc;

    try {
        if (({ npresult: netProfileDoc } = await netOwnerCheck({ req }))) {
            result = await addNetOwner({
                newOwnerEmail,
                netProfiles: netProfileDoc,
                flexOpts: res.locals.flexOpts
            });

            res.status(200).json({
                endpointVersion: '1.0',
                message: result
            });
            logger.info('NETPROFILE_Controller: ' + result);
        } else {
            throw new Error('requestor must have net owner privileges');
        }
    } catch (err) {
        logger.error(err.stack);
        res.status(500).json({
            endpointVersion: '1.0',
            errorMessage: err.message
        });
    }
};

const netProfileCreatePost = async (req, res) => {
    console.debug(req.body);

    try {
        const { title, frequency, mode, restrictedSigReports, autoIn, modeDetails, notes } = req.body;
        const hasConnections = hasOwn(req.body, 'connections');
        const operatingFields = hasConnections
            ? { ...legacyFieldsForConnections(req.body.connections), connections: req.body.connections }
            : {
                  frequency: typeof frequency === 'string' ? frequency.trim() : undefined,
                  mode: typeof mode === 'string' ? mode.trim() : undefined,
                  modeDetails: typeof modeDetails === 'string' ? modeDetails.trim() : undefined
              };
        const netprofile = new NetProfile({
            title: typeof title === 'string' ? title.trim() : undefined,
            restrictedSigReports: restrictedSigReports ? true : false,
            autoIn: autoIn ? true : false,
            notes: sanitizeNotes(notes),
            owners: req.user._id,
            ...operatingFields
        });
        if (!hasConnections) validateLegacyOperatingFields(operatingFields);

        if (req.user.myNets.length < res.locals.flexOpts['maxNetsPerUser']) {
            const npresult = await netprofile.save();
            res.json({ ...{ endpointVersion: '1.0' }, ...npresult.toObject() });
            logger.info('NETPROFILE_Controller: Net profile saved: ' + npresult.toObject().title);

            if (npresult) {
                logger.info('NETPROFILE_Controller: Add owner for new net');
                try {
                    const upresult = await UserProfile.findOneAndUpdate(
                        { _id: req.user._id },
                        {
                            $push: { myNets: npresult._id }
                        }
                    );

                    logger.info(
                        'NETPROFILE_Controller: User profile updated (+Net Owner): ' + upresult.toObject().callSign
                    );
                } catch (err) {
                    res.status(500).json({
                        endpointVersion: '1.0',
                        errorMessage: err.message
                    });
                    logger.error(err.stack);
                }
            }
        } else {
            throw new Error('at max nets per user');
        }
    } catch (err) {
        res.status(500).json({
            endpointVersion: '1.0',
            errorMessage: err.message,
            status: 500
        });
        logger.error(err.stack);
    }
};

module.exports = {
    netProfileAddNetOwner,
    netProfileList,
    netProfileDetails,
    netProfileCreatePost,
    netProfileDelete,
    netProfileUpdate
};
