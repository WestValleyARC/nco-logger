/* hamlive-oss — MIT License. See LICENSE. */
const router = require('express').Router();

const { adminCommandProcessor, adminCommandList } = require('../controllers/interactionController');

const { authCheck, REQ_CALLSIGN } = require('../lib/serverUtils');
const { roomAccessMiddleware } = require('../lib/scheduling/roomAccess');
const { accessMiddleware } = require('../lib/privateTestNet');

router.get('/:id', authCheck(REQ_CALLSIGN), accessMiddleware, roomAccessMiddleware, adminCommandList);
router.post('/:id', authCheck(REQ_CALLSIGN), accessMiddleware, roomAccessMiddleware, adminCommandProcessor);

module.exports = router;
