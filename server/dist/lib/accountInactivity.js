/* hamlive-oss — MIT License. See LICENSE. */

async function clearInactivityDeletionOnLogin({ userProfileDoc, UserProfile }) {
    if (!userProfileDoc || userProfileDoc.deletionReason === 'manual') return false;

    const hasInactivityState = Boolean(
        userProfileDoc.inactivityWarningSentAt || userProfileDoc.deletionReason === 'inactivity'
    );
    if (!hasInactivityState) return false;

    await UserProfile.updateOne(
        { _id: userProfileDoc._id, deletionReason: { $ne: 'manual' } },
        {
            $set: {
                flaggedForDeletion: false,
                inactivityWarningSentAt: null,
                deletionReason: null
            }
        }
    );

    userProfileDoc.flaggedForDeletion = false;
    userProfileDoc.inactivityWarningSentAt = null;
    userProfileDoc.deletionReason = null;
    return true;
}

module.exports = { clearInactivityDeletionOnLogin };
