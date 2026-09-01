/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

const router = require('express').Router();
const { scheduledOccurrenceList } = require('../controllers/publicScheduleController');

router.get('/', scheduledOccurrenceList);

module.exports = router;
