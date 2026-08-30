/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const { ncoLoggerAction } = require('../controllers/ncoLoggerController');
const { authCheck, REQ_CALLSIGN } = require('../lib/serverUtils');

router.post('/:id', authCheck(REQ_CALLSIGN), ncoLoggerAction);

module.exports = router;
