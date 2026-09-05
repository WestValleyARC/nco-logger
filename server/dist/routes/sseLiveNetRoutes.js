/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const { authCheck, REQ_CALLSIGN } = require('../lib/serverUtils');
const { genLiveNetDetails } = require('../lib/controllers/liveNetHelpers');
const { realtimeClients } = require('../lib/realtimeClients');
const NetProfile = require('../models/netProfile').getNetProfile(null);
const LiveNet = require('../models/liveNet').getLiveNet(null);
const ScheduledOccurrence = require('../models/scheduledOccurrence').getScheduledOccurrence(null);
const { canAccessScheduledPreparation } = require('../lib/scheduling/lifecycle');
const { logger } = require('../lib/logger');
realtimeClients.init(genLiveNetDetails);
router.use('/:id', authCheck(REQ_CALLSIGN));
router.use('/:id', async (req, res, next) => {
    try {
        const netProfile = await NetProfile.findById(req.params.id);
        const liveNet = netProfile?.liveNet ? await LiveNet.findById(netProfile.liveNet) : null;
        if (!liveNet?.occurrence || liveNet.started) return next();
        const occurrence = await ScheduledOccurrence.findById(liveNet.occurrence);
        if (canAccessScheduledPreparation({ netProfile, liveNet, occurrence, user: req.user })) return next();
        return res.status(403).json({ endpointVersion: '1.0', errorMessage: 'Scheduled net is not on the air' });
    } catch (error) {
        logger.error(`Live-net SSE authorization failed: ${error.message}`);
        return res.status(500).json({ endpointVersion: '1.0', errorMessage: 'Live-net stream unavailable' });
    }
});
router.use('/:id', realtimeClients.middleware());

module.exports = router;
