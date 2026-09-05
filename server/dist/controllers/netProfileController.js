/* hamlive-oss — MIT License. See LICENSE. */

const { logger } = require('../lib/logger');
const { netOwnerCheck, delNet } = require('../lib/sharedNetOps');
const mongoose = require('mongoose');
const NetProfile = require('../models/netProfile').getNetProfile(null);
const UserProfile = require('../models/userProfile').getUserProfile(null);
const LiveNet = require('../models/liveNet').getLiveNet(null);
const ScheduledOccurrence = require('../models/scheduledOccurrence').getScheduledOccurrence(null);
const { loadProfileSchedulingSummaries } = require('../lib/scheduling/profileSummary');
const { sanitizeNotes } = require('../lib/serverUtils');

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const apiError = (status, message) => Object.assign(new Error(message), { status });

const requirePrimaryOwner = async (req, session = null) => {
    const profile = await NetProfile.findById(req.params.id).session(session);
    if (!profile) throw apiError(404, 'Net profile not found');
    if (String(profile.owners[0]) !== String(req.user._id || req.user.id)) {
        throw apiError(403, 'Only the primary owner may manage co-owners');
    }
    return profile;
};

const coOwnerResponse = user => ({ id: user._id, callSign: user.callSign, displayName: user.displayName });
const sendCoOwnerError = (res, error) => res.status(error.status || 500).json({
    endpointVersion: '1.0', errorMessage: error.message
});
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
            isPrimaryOwner: String(profile.owners[0]) === String(req.user._id || req.user.id),
            scheduling: summaries.get(String(profile._id))
        }));
        return res.json({ endpointVersion: '1.0', netlist });
    } catch (err) {
        logger.error(err.stack);
        return res.status(500).json({
            endpointVersion: '1.0',
            errorMessage: 'Unable to list net profiles'
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
            errorMessage: 'Unable to load the net profile'
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
                ...(hasOwn(req.body, 'restrictedSigReports')
                    ? { restrictedSigReports: req.body.restrictedSigReports ? true : false }
                    : {}),
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
            errorMessage: 'Unable to update the net profile',
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
            errorMessage: 'Unable to delete the net profile'
        });
        logger.error(err.stack);
    }
};

const netProfileAddNetOwner = async (req, res) => {
    const identifier = String(req.body.identifier || req.body.email || '').trim();
    const session = await mongoose.connection.startSession();
    try {
        if (!identifier || identifier.length > 254) throw apiError(400, 'Enter a valid callsign or email address');
        let added;
        await session.withTransaction(async () => {
            const profile = await requirePrimaryOwner(req, session);
            if (profile.owners.length >= res.locals.flexOpts.maxOwnersPerNet) {
                throw apiError(409, 'This net already has the maximum number of owners');
            }
            const exact = new RegExp(`^${escapeRegExp(identifier)}$`, 'i');
            const target = await UserProfile.findOne({ $or: [{ callSign: exact }, { email: exact }] }).session(session);
            if (!target || !target.callSign) throw apiError(404, 'No registered operator found for that callsign or email');
            if (profile.owners.some(owner => String(owner) === String(target._id))) {
                throw apiError(409, 'That operator is already an owner of this net');
            }
            const maxNets = target.flexOptions?.maxNetsPerUser || res.locals.flexOpts.maxNetsPerUser;
            if (target.myNets.length >= maxNets) throw apiError(409, 'That operator is already at their net-profile limit');

            profile.owners.push(target._id);
            await profile.save({ session });
            await UserProfile.updateOne(
                { _id: target._id },
                { $addToSet: { myNets: profile._id } },
                { session }
            );
            added = coOwnerResponse(target);
        });
        return res.status(200).json({ endpointVersion: '1.0', coOwner: added });
    } catch (err) {
        logger.error(err.stack);
        return sendCoOwnerError(res, err);
    } finally {
        await session.endSession();
    }
};

const netProfileCoOwners = async (req, res) => {
    try {
        const profile = await requirePrimaryOwner(req);
        await profile.populate({ path: 'owners', select: 'callSign displayName' });
        return res.json({ endpointVersion: '1.0', coOwners: profile.owners.slice(1).map(coOwnerResponse) });
    } catch (err) {
        logger.error(err.stack);
        return sendCoOwnerError(res, err);
    }
};

const netProfileRemoveCoOwner = async (req, res) => {
    const session = await mongoose.connection.startSession();
    try {
        let removed;
        await session.withTransaction(async () => {
            const profile = await requirePrimaryOwner(req, session);
            const targetId = String(req.params.userId || '');
            if (String(profile.owners[0]) === targetId) throw apiError(400, 'The primary owner cannot be removed');
            if (!profile.owners.some(owner => String(owner) === targetId)) {
                throw apiError(404, 'Co-owner not found on this net');
            }
            const target = await UserProfile.findById(targetId).session(session);
            if (!target) throw apiError(404, 'Co-owner account not found');

            profile.owners.pull(target._id);
            await profile.save({ session });
            await UserProfile.updateOne(
                { _id: target._id },
                { $pull: { myNets: profile._id } },
                { session }
            );
            removed = coOwnerResponse(target);
        });
        return res.json({ endpointVersion: '1.0', coOwner: removed });
    } catch (err) {
        logger.error(err.stack);
        return sendCoOwnerError(res, err);
    } finally {
        await session.endSession();
    }
};

const netProfileCreatePost = async (req, res) => {
    const session = await mongoose.connection.startSession();
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
            let npresult;
            await session.withTransaction(async () => {
                [npresult] = await NetProfile.create([netprofile.toObject()], { session });
                const ownerUpdate = await UserProfile.updateOne(
                    { _id: req.user._id }, { $addToSet: { myNets: npresult._id } }, { session }
                );
                if (ownerUpdate.matchedCount !== 1) throw new Error('Net owner account was not found');
            });
            logger.info('NETPROFILE_Controller: Net profile and owner relationship saved');
            return res.json({ endpointVersion: '1.0', ...npresult.toObject() });
        } else {
            throw new Error('at max nets per user');
        }
    } catch (err) {
        logger.error(err.stack);
        return res.status(500).json({
            endpointVersion: '1.0',
            errorMessage: 'Unable to create the net profile',
            status: 500
        });
    } finally {
        await session.endSession();
    }
};

module.exports = {
    netProfileAddNetOwner,
    netProfileCoOwners,
    netProfileRemoveCoOwner,
    netProfileList,
    netProfileDetails,
    netProfileCreatePost,
    netProfileDelete,
    netProfileUpdate
};
