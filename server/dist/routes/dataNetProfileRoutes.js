/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const netProfileController = require('../controllers/netProfileController');
const netScheduleController = require('../controllers/netScheduleController');
const { authCheck, REQ_CALLSIGN } = require('../lib/serverUtils');

router.post('/addnetowner/:id', authCheck(REQ_CALLSIGN), netProfileController.netProfileAddNetOwner);
router.post('/', authCheck(REQ_CALLSIGN), netProfileController.netProfileCreatePost);
router.get('/', authCheck(REQ_CALLSIGN), netProfileController.netProfileList);
router.get('/:id/schedule', authCheck(REQ_CALLSIGN), netScheduleController.getSchedule);
router.post('/:id/schedule', authCheck(REQ_CALLSIGN), netScheduleController.createSchedule);
router.patch('/:id/schedule', authCheck(REQ_CALLSIGN), netScheduleController.updateSchedule);
router.delete('/:id/schedule', authCheck(REQ_CALLSIGN), netScheduleController.disableSchedule);
router.get('/:id/occurrences', authCheck(REQ_CALLSIGN), netScheduleController.listOccurrences);
router.patch('/:id/occurrences/:occurrenceId', authCheck(REQ_CALLSIGN), netScheduleController.updateOccurrence);
router.delete('/:id/occurrences/:occurrenceId', authCheck(REQ_CALLSIGN), netScheduleController.cancelOccurrence);
router.post(
    '/:id/occurrences/:occurrenceId/prepare',
    authCheck(REQ_CALLSIGN),
    netScheduleController.prepareScheduledOccurrence
);
router.post(
    '/:id/occurrences/:occurrenceId/cancel-preparation',
    authCheck(REQ_CALLSIGN),
    netScheduleController.cancelScheduledPreparation
);
router.patch('/:id', authCheck(REQ_CALLSIGN), netProfileController.netProfileUpdate);
router.get('/:id', authCheck(REQ_CALLSIGN), netProfileController.netProfileDetails);
router.delete('/:id', authCheck(REQ_CALLSIGN), netProfileController.netProfileDelete);

module.exports = router;
