/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const { stationEventProcessor } = require('../controllers/interactionController');
const { authCheck, REQ_CALLSIGN } = require('../lib/serverUtils');
const { accessMiddleware } = require('../lib/privateTestNet');
router.post('/:id', authCheck(REQ_CALLSIGN), accessMiddleware, stationEventProcessor);

module.exports = router;
