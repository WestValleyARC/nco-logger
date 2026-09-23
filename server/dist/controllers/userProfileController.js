/* hamlive-oss — MIT License. See LICENSE. */

const { handleRequest, prepareEndPointResponse } = require('#@server/lib/responseUtils.js');
const { logger } = require('../lib/logger');
const UserProfile = require('../models/userProfile').getUserProfile(null);
const InitialReg = require('../models/initialRegTracker').getInitialReg(null);

const { getFlexOptionsByUser } = require('../lib/serverUtils');
const { flagAccountForDeletion } = require('../lib/sharedNetOps');

const callsignConflictMessage = 'This callsign is already registered to another account. Sign out and sign in with the email you originally registered with. Google sign-in uses the email of the Google account you select. If you cannot access the original email, contact support; accounts cannot be combined from this page.';

const handleProfileUpdateRequest = async (res, callback, successMessage) => {
    const ttl = res.locals.flexOpts.baseTtlMs;
    try {
        const result = await callback();
        logger.info(successMessage);
        return res.status(200).json(prepareEndPointResponse(result, undefined, undefined, ttl));
    } catch (error) {
        const conflict = error.code === 'CALLSIGN_IN_USE'
            || (error.name === 'ValidationError' && error.errors?.callSign?.kind === 'unique')
            || (error.code === 11000 && (error.keyPattern?.callSign || error.keyValue?.callSign));
        const fieldMessages = {
            displayName: 'Name must be 2–20 characters using letters, spaces, apostrophes or hyphens.',
            callSign: 'Enter a valid callsign (3–7 characters).',
            location: 'Location must be 5–24 characters using letters, numbers, spaces or supported punctuation.'
        };
        const validation = error.name === 'ValidationError'
            ? Object.keys(error.errors || {}).map(field => fieldMessages[field]).filter(Boolean).join(' ')
            : '';
        const status = conflict ? 409 : validation ? 400 : 500;
        const message = conflict ? callsignConflictMessage : validation || 'Your profile could not be saved. Please try again or contact support.';
        logger[status === 500 ? 'error' : 'warn'](`Account profile save failed: ${conflict ? 'callsign-conflict' : validation ? 'invalid-fields' : 'internal-error'}`);
        return res.status(status).json(prepareEndPointResponse({}, message, undefined, ttl));
    }
};

const userProfileDetails = async (req, res) => {
    handleRequest(
        res,
        async () => {
            const { id } = req.user;
            const userProfileDoc = await UserProfile.findById(id);

            const { _id, displayName, callSign, location, newAccount, policyConsent, flaggedForDeletion } =
                userProfileDoc.toObject();

            const computedFlexOptions = {
                option: await getFlexOptionsByUser({ user: userProfileDoc, cachedResponse: false })
            };

            return {
                _id,
                displayName,
                callSign,
                location,
                newAccount,
                policyConsent,
                flaggedForDeletion,
                computedFlexOptions
            };
        },
        `USERPROFILE_Controller: User profile found: ${req.user.id}`
    );
};

const handleCallSignRegistration = async (userProfileDoc, updatedData) => {
    if (userProfileDoc.callSign?.toUpperCase() === updatedData.callSign.toUpperCase()) {
        logger.info('USERPROFILE_Controller: callSign unchanged, skipping callSign registration');
        return;
    }

    let priorStartOfGracePeriod = null;

    if (
        userProfileDoc.initialReg?._id &&
        userProfileDoc.callSign.toUpperCase() !== updatedData.callSign.toUpperCase()
    ) {
        //callSign has changed, use the startOfGracePeriod that the current account was linked to
        logger.info('USERPROFILE_Controller: callSign is changing, using prior grace period');
        priorStartOfGracePeriod = (await InitialReg.findById(userProfileDoc.initialReg._id)).startOfGracePeriod || null;
    }

    //see if the target callSign already exists in the tracker

    const { _id: priorRegId } = (await InitialReg.findOne({ callSign: updatedData.callSign })) || {};

    if (priorRegId) {
        //target callSign already exists in the tracker
        logger.info(`USERPROFILE_Controller: Linking callSign: ${updatedData.callSign} to existing record`);
        updatedData.initialReg = priorRegId;
    } else {
        //callSign does not exist in the tracker, create a new entry with either the prior grace period or a new one
        logger.info(
            `USERPROFILE_Controller: Registering new callSign: ${updatedData.callSign}, with ${priorStartOfGracePeriod ? 'prior grace period' : 'new grace period'}`
        );
        updatedData.initialReg = (
            await InitialReg.create({
                callSign: updatedData.callSign,
                startOfGracePeriod: priorStartOfGracePeriod || new Date()
            })
        )._id;
    }
};

const userProfileUpdate = async (req, res) => {
    return handleProfileUpdateRequest(
        res,
        async () => {
            const id = req.user.id;

            const unrestrictedProperties = [
                'displayName',
                'callSign',
                'location',
                'newAccount',
                'policyConsent',
                'flexOptions'
            ];

            const unrestrictedOptions = ['email', 'chat'];

            const incomingProps = Object.keys(req.body);
            const incomingOptions = req.body.flexOptions?.option ? Object.keys(req.body.flexOptions.option) : [];

            const propsValid = () =>
                incomingProps.every(p => unrestrictedProperties.includes(p)) &&
                (!req.body.flexOptions?.option || incomingOptions.every(o => unrestrictedOptions.includes(o)));

            if (!propsValid()) {
                throw new Error('Attempted to modify restricted property or option');
            }

            const updatedData = { ...req.body };

            incomingProps.forEach(p => {
                if (updatedData[p] && typeof updatedData[p] === 'string') {
                    updatedData[p] = updatedData[p].trim();
                }
            });

            if (updatedData.callSign) {
                updatedData.callSign = updatedData.callSign.toUpperCase();
            }

            if (updatedData.policyConsent) {
                updatedData.policyConsent = true;
            }

            const userProfileDoc = await UserProfile.findById(id);

            if (!userProfileDoc) {
                throw new Error('User profile not found');
            }

            // Detect a different account before creating registration tracker records.
            // The unique index still protects against concurrent claims at save time.
            if (updatedData.callSign && await UserProfile.exists({
                callSign: updatedData.callSign, _id: { $ne: userProfileDoc._id }
            })) {
                const error = new Error('Callsign belongs to another account');
                error.code = 'CALLSIGN_IN_USE';
                throw error;
            }

            // Merge options objects
            if (req.body.flexOptions && req.body.flexOptions.option) {
                const existingOptions = userProfileDoc.toObject().flexOptions?.option;
                const inboundOptions = req.body.flexOptions.option;

                if (typeof existingOptions === 'object' && typeof inboundOptions === 'object') {
                    updatedData.flexOptions = {
                        option: {
                            ...existingOptions,
                            ...inboundOptions
                        }
                    };

                    logger.info(
                        `USERPROFILE_Controller: FlexOptions for ${userProfileDoc.callSign}: ${JSON.stringify(updatedData.flexOptions)}`
                    );
                } else {
                    logger.error('Error: flexOptions.option must be an object');
                }
            }

            if (updatedData?.callSign) {
                try {
                    await handleCallSignRegistration(userProfileDoc, updatedData);
                } catch (err) {
                    logger.error(`USERPROFILE_Controller: Error handling callSign registration: ${err}`);
                }
            } else {
                logger.debug('CallSign missing from update payload');
            }

            delete updatedData._id;
            delete updatedData.createdAt;
            delete updatedData.updatedAt;

            const updatedUserProfileDoc = await UserProfile.findOneAndUpdate({ _id: id }, updatedData, {
                new: true,
                runValidators: true
            });

            logger.info('USERPROFILE_Controller: User profile updated: ' + updatedUserProfileDoc.id);
            return updatedUserProfileDoc.toObject();
        },
        `USERPROFILE_Controller: User profile updated: ${req.user.id}`
    );
};

const userProfileDelete = async (req, res) => {
    handleRequest(
        res,
        async () => {
            const id = req.user.id;

            if (!req.user.policyConsent) {
                logger.info('USERPROFILE_Controller: IMMEDIATELY deleting account upid:' + id);
                const deletedProfile = await UserProfile.findByIdAndDelete(id);
                return deletedProfile.toObject() || {};
            } else {
                const userProfileDoc = await UserProfile.findById(id);
                if (!userProfileDoc) {
                    throw new Error(`could not find account upid:${id} to flag for deletion`);
                }

                const flaggedAccount = await flagAccountForDeletion({ userProfileDoc, deletionReason: 'manual' });
                if (!flaggedAccount) {
                    throw new Error(`error flagging account upid:${id} for deletion`);
                }

                return flaggedAccount.toObject() || {};
            }
        },
        `USERPROFILE_Controller: User profile deleted: ${req.user.id}`
    );
};

const userProfileUnDelete = async (req, res) => {
    handleRequest(
        res,
        async () => {
            const id = req.user.id;

            // Note: We don't remove the entry from the accounts pending deletion queue, when the flag is removed here
            // (that would take too long). However, before actually deleting a flagged account, the daily delete task
            // will check if this flag is still set

            const result = await UserProfile.findOneAndUpdate(
                { _id: id },
                {
                    flaggedForDeletion: false,
                    inactivityWarningSentAt: null,
                    deletionReason: null
                },
                { new: true }
            );

            logger.info('USERPROFILE_Controller: Deletion flag removed for ' + result.callSign);
            return result.toObject() || {};
        },
        `USERPROFILE_Controller: Deletion flag removed for user: ${req.user.id}`
    );
};

module.exports = {
    userProfileDetails,
    userProfileDelete,
    userProfileUpdate,
    userProfileUnDelete
};
