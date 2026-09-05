/* hamlive-oss — MIT License. See LICENSE. */

const { logger } = require('../lib/logger');
const { unFollow } = require('../lib/sharedNetOps');
const { prepareEndPointResponse, handleRequest } = require('../lib/responseUtils');
const { isFollowListResponse } = require('../types/commonTypesupport');
const helpers = require('../lib/controllers/followHelpers');
const NetProfile = require('../models/netProfile').getNetProfile(null);
const { loadProfileSchedulingSummaries } = require('../lib/scheduling/profileSummary');
const mongoose = require('mongoose');
const UserProfile = require('../models/userProfile').getUserProfile(null);

// Handles the REST endpoint for creating a follow request
const followCreatePost = (req, res) => {
    handleRequest(
        res,
        async () => {
            const id = req.params.id;
            if (req.body?.follow) {
                const session = await mongoose.connection.startSession();
                try {
                    await session.withTransaction(async () => {
                        const npresult = await NetProfile.findById(id).session(session);
                        const user = await UserProfile.findById(req.user._id).session(session);
                        if (!npresult || !user) throw new Error('Follow relationship target was not found');
                        if (npresult.followers.some(value => String(value) === String(user._id))) return;
                        if (!helpers.canFollowMoreNets(npresult, res.locals.flexOpts.maxFollowersPerNet)) {
                            throw new Error('This net has reached its follower limit');
                        }
                        if (!helpers.canUserFollowMore(user, res.locals.flexOpts.maxFollowingPerUser)) {
                            throw new Error('This account has reached its followed-net limit');
                        }
                        await Promise.all([
                            NetProfile.updateOne({ _id: id }, { $addToSet: { followers: user._id } }, { session }),
                            UserProfile.updateOne({ _id: user._id }, { $addToSet: { following: npresult._id } }, { session })
                        ]);
                    });
                } finally {
                    await session.endSession();
                }

                return { message: `${req.user._id} following ${id}` };
            } else {
                throw new Error('followCreatePost: follow request body is invalid');
            }
        },
        `FOLLOW_Controller: user ${req.user._id} now following net ${req.params.id}`
    );
};

// Handles the REST endpoint for listing all nets the user is following
const followList = (req, res) => {
    handleRequest(res, async () => {
        const { maxFollowersPerNet, maxFollowingPerUser, baseTtlMs: ttlMs } = res.locals.flexOpts;
        const netProfiles = await NetProfile.find({ _id: { $in: req.user.following } });
        const summaries = await loadProfileSchedulingSummaries({ profiles: netProfiles });
        const validNetProfiles = netProfiles.map(net => helpers.transformNetProfile(
            net,
            summaries.get(String(net._id))
        ));

        // Prepare the response with the list of nets and limits
        const response = prepareEndPointResponse(
            {
                message: {
                    netlist: validNetProfiles.sort((a, b) => a.title.localeCompare(b.title)),
                    limits: {
                        maxFollowersPerNet,
                        maxFollowingPerUser
                    }
                }
            },
            undefined,
            undefined,
            ttlMs
        );

        // Validate the response
        if (!isFollowListResponse(response)) {
            throw new Error('FOLLOW_Controller: Follow list response is invalid');
        }

        return response;
    });
};

// Handles the REST endpoint for checking if the user is following a specific net
const followDetails = (req, res) => {
    handleRequest(
        res,
        async () => {
            const id = req.params.id;
            logger.debug(`FOLLOW_Controller: Follow inquiry of ${id} for ${req.user.callSign}`);
            return { message: { following: req.user.following.includes(id) } };
        },
        `FOLLOW_Controller: Follow inquiry handled for ${req.params.id}`
    );
};

// Handles the REST endpoint for unfollowing a net
const followDelete = (req, res) => {
    handleRequest(
        res,
        async () => {
            // Unfollow the net
            const result = await unFollow({ upid: req.user.id, npid: req.params.id });
            return { message: result };
        },
        `FOLLOW_Controller: User ${req.user.id} unfollowed net ${req.params.id}`
    );
};

module.exports = {
    followCreatePost,
    followList,
    followDetails,
    followDelete
};
