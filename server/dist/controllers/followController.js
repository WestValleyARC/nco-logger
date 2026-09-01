/* hamlive-oss — MIT License. See LICENSE. */

const { logger } = require('../lib/logger');
const { unFollow } = require('../lib/sharedNetOps');
const { prepareEndPointResponse, handleRequest } = require('../lib/responseUtils');
const { isFollowListResponse } = require('../types/commonTypesupport');
const helpers = require('../lib/controllers/followHelpers');
const NetProfile = require('../models/netProfile').getNetProfile(null);
const { loadProfileSchedulingSummaries } = require('../lib/scheduling/profileSummary');

// Handles the REST endpoint for creating a follow request
const followCreatePost = (req, res) => {
    handleRequest(
        res,
        async () => {
            const id = req.params.id;
            if (req.body?.follow) {
                // Find the net profile by ID
                const npresult = await helpers.findNetProfile(id);
                if (!npresult) throw new Error(`could not find npid ${id} for fav request`);

                // Check if the user is already following the net
                if (helpers.isAlreadyFollowing(npresult, req.user._id)) {
                    throw new Error(`user ${req.user._id} already follows net ${id}`);
                }

                // Check if the net can have more followers
                if (!helpers.canFollowMoreNets(npresult, res.locals.flexOpts.maxFollowersPerNet)) {
                    throw new Error(`user ${req.user._id} cant follow net ${id} due to net at max followers`);
                }

                // Check if the user can follow more nets
                if (!helpers.canUserFollowMore(req.user, res.locals.flexOpts.maxFollowingPerUser)) {
                    throw new Error(`user ${req.user._id} cant follow net ${id} due to user at max following`);
                }

                // Update the net profile to add the user as a follower
                if (!(await helpers.updateNetProfileFollowers(npresult, req.user._id))) {
                    throw new Error(`Could not update followers array in netprofile ${npresult.id}`);
                }

                // Update the user profile to add the net to the user's following list
                if (!(await helpers.updateUserProfileFollowing(req.user, npresult._id))) {
                    throw new Error(`Could not update following array in userprofile ${req.user.id}`);
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
