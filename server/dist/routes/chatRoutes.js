/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const { listMessages, createMessage, deleteMessage, streamEvents } = require('../lib/localChat');

router.get('/:id/messages', listMessages);
router.post('/:id/messages', createMessage);
router.delete('/:id/messages/:messageId', deleteMessage);
router.get('/:id/events', streamEvents);

module.exports = router;
