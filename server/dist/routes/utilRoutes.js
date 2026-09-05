/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const { authCheck, REQ_LOGIN, resolveLocation } = require('../lib/serverUtils');
const userProfileController = require('../controllers/userProfileController');
const notificationController = require('../controllers/notificationController');
const { logger } = require('../lib/logger');

router.post('/undeleteme', authCheck(REQ_LOGIN), userProfileController.userProfileUnDelete);
router.get('/resolvelocation', authCheck(REQ_LOGIN), async (req, res) => {
    try {
        return res.json({ ...{ endpointVersion: '1.0' }, ...(await resolveLocation(({ lat, lon } = req.query))) });
    } catch (err) {
        res.status(500).json({
            errorMessage: 'Location lookup failed'
        });
        logger.error(err.stack);
    }
});

// System Notifications API
router.get('/notifications/pending', authCheck(REQ_LOGIN), notificationController.getPendingNotifications);
router.post('/notifications/:notificationId/dismiss', authCheck(REQ_LOGIN), notificationController.dismissNotification);

module.exports = router;
