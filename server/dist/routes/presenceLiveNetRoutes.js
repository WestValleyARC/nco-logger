/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const { liveNetPresence } = require('../controllers/liveNetController');
const { authCheck, REQ_CALLSIGN } = require('../lib/serverUtils');
const { accessMiddleware } = require('../lib/privateTestNet');

router.get('/:id', authCheck(REQ_CALLSIGN), accessMiddleware, liveNetPresence);

module.exports = router;
