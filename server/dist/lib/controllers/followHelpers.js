/* hamlive-oss — MIT License. See LICENSE. */

const NetProfile = require('../../models/netProfile').getNetProfile(null);
const UserProfile = require('../../models/userProfile').getUserProfile(null);

// Helper functions for the follow controller.

// Finds a net profile by its ID.
const findNetProfile = async id => {
    return await NetProfile.findById(id);
};

// Checks if a user is already following a net.
const isAlreadyFollowing = (npresult, userId) => {
    return npresult.followers.includes(userId);
};

// Checks if a net can have more followers.
const canFollowMoreNets = (npresult, maxFollowersPerNet) => {
    return npresult.followers.length < maxFollowersPerNet;
};

// Checks if a user can follow more nets.
const canUserFollowMore = (reqUser, maxFollowingPerUser) => {
    return reqUser.following.length < maxFollowingPerUser;
};

// Updates the followers list of a net profile by adding a user.
const updateNetProfileFollowers = async (npresult, userId) => {
    return await NetProfile.findOneAndUpdate({ _id: npresult._id }, { $push: { followers: userId } });
};

// Updates the following list of a user profile by adding a net.
const updateUserProfileFollowing = async (reqUser, npresultId) => {
    return await UserProfile.findByIdAndUpdate({ _id: reqUser._id }, { $push: { following: npresultId } });
};

// Transforms a net profile object to a simplified format.
const transformNetProfile = (net, scheduling = null) => {
    const { id, title, frequency, mode, permanent, modeDetails, followers } = net;
    return {
        id,
        title,
        frequency,
        mode,
        permanent,
        modeDetails,
        scheduling,
        followCount: followers.length
    };
};

module.exports = {
    findNetProfile,
    isAlreadyFollowing,
    canFollowMoreNets,
    canUserFollowMore,
    updateNetProfileFollowers,
    updateUserProfileFollowing,
    transformNetProfile
};
