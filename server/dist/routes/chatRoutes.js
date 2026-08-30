/* hamlive-oss — MIT License. See LICENSE. */

const express = require('express');
const router = express.Router();
const {
    listMessages,
    createMessage,
    editMessage,
    uploadImage,
    serveImage,
    deleteMessage,
    streamEvents,
    MAX_UPLOAD_BYTES
} = require('../lib/localChat');

const imageBody = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });

router.get('/:id/messages', listMessages);
router.post('/:id/messages', createMessage);
router.patch('/:id/messages/:messageId', editMessage);
router.post('/:id/images', imageBody, uploadImage);
router.get('/:id/messages/:messageId/image', serveImage);
router.delete('/:id/messages/:messageId', deleteMessage);
router.get('/:id/events', streamEvents);

router.use((err, _req, res, next) => {
    if (err?.type === 'entity.too.large') {
        return res.status(413).json({ endpointVersion: '1.0', error: 'Image exceeds the upload size limit' });
    }
    return next(err);
});

module.exports = router;
