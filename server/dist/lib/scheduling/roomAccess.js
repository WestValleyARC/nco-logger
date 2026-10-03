/* hamlive-oss — MIT License. See LICENSE. */
const { getNetProfile } = require('../../models/netProfile');
const { getLiveNet } = require('../../models/liveNet');
const { getScheduledOccurrence } = require('../../models/scheduledOccurrence');

const canAccessScheduledPreparation = ({ netProfile, liveNet, occurrence, user, now = new Date() }) => {
    if (liveNet?.closing) return false;
    if (!liveNet?.occurrence || liveNet.started) return true;
    if (!occurrence || occurrence.status !== 'preparing') return false;
    if (liveNet.roomOpening && liveNet.roomOpensAt && now >= new Date(liveNet.roomOpensAt)) return true;
    if (!liveNet.roomOpening && now >= new Date(occurrence.startAt.getTime() + 30 * 60000)) return false;
    const userId = String(user?._id || user?.id || '');
    return (netProfile?.owners || []).some(owner => String(owner) === userId) || String(liveNet.netControl) === userId;
};

const canUserAccessRoom = async ({ liveNet, netProfile, user, now = new Date(), db = null }) => {
    if (!liveNet || liveNet.closing) return false;
    if (!liveNet.occurrence || liveNet.started) return true;
    const occurrence = await getScheduledOccurrence(db).findById(liveNet.occurrence);
    const profile = netProfile || await getNetProfile(db).findById(liveNet.netProfile);
    return canAccessScheduledPreparation({ netProfile: profile, liveNet, occurrence, user, now });
};

const roomAccessMiddleware = async (req, res, next) => {
    try {
        const liveNet = await getLiveNet().findOne({ netProfile: req.params.id });
        if (liveNet && !await canUserAccessRoom({ liveNet, user: req.user })) {
            return res.status(403).json({ endpointVersion: '1.0', errorMessage: 'Scheduled room is not open' });
        }
        return next();
    } catch (error) {
        return next(error);
    }
};

module.exports = { canAccessScheduledPreparation, canUserAccessRoom, roomAccessMiddleware };
