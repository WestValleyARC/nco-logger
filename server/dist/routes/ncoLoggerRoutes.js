/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const { ncoLoggerAction } = require('../controllers/ncoLoggerController');
const { authCheck, REQ_CALLSIGN } = require('../lib/serverUtils');
const { accessMiddleware } = require('../lib/privateTestNet');

router.post('/:id', authCheck(REQ_CALLSIGN), accessMiddleware, ncoLoggerAction);

module.exports = router;
