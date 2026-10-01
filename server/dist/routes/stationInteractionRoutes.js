/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const { stationEventProcessor } = require('../controllers/interactionController');
const { authCheck, REQ_CALLSIGN } = require('../lib/serverUtils');
const { roomAccessMiddleware } = require('../lib/scheduling/roomAccess');
const { accessMiddleware } = require('../lib/privateTestNet');
router.post('/:id', authCheck(REQ_CALLSIGN), accessMiddleware, roomAccessMiddleware, stationEventProcessor);

module.exports = router;
