/* hamlive-oss — MIT License. See LICENSE. */

const express = require('express');
const router = express.Router();
const {
    listMessages,
    listDirectMessages,
    setPrivateIgnore,
    createMessage,
    editMessage,
    uploadImage,
    serveImage,
    deleteMessage,
    toggleReaction,
    setMessagePin,
    banMessageAuthor,
    clearPublicChat,
    streamEvents,
    MAX_UPLOAD_BYTES
} = require('../lib/localChat');

const imageBody = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });

const requireSameOriginMutation = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const fetchSite = String(req.get?.('sec-fetch-site') || '').toLowerCase();
    if (fetchSite === 'cross-site') {
        return res.status(403).json({ endpointVersion: '1.1', error: 'Cross-site chat request rejected' });
    }
    const origin = req.get?.('origin');
    if (!origin) return next();
    try {
        const forwardedProto = String(req.get?.('x-forwarded-proto') || '').split(',')[0].trim();
        const forwardedHost = String(req.get?.('x-forwarded-host') || '').split(',')[0].trim();
        const protocol = forwardedProto || req.protocol;
        const host = forwardedHost || req.get?.('host');
        if (host && new URL(origin).origin === `${protocol}://${host}`) return next();
    } catch (_err) {
        // Invalid Origin values are rejected below.
    }
    return res.status(403).json({ endpointVersion: '1.1', error: 'Cross-site chat request rejected' });
};

const chatRouteErrorHandler = (err, _req, res, next) => {
    if (err?.type === 'entity.too.large') {
        return res.status(413).json({ endpointVersion: '1.1', error: 'Request exceeds the chat size limit' });
    }
    if (err instanceof SyntaxError && err.status === 400 && Object.hasOwn(err, 'body')) {
        return res.status(400).json({ endpointVersion: '1.1', error: 'Malformed JSON request' });
    }
    return next(err);
};

router.use(requireSameOriginMutation);

router.get('/:id/messages', listMessages);
router.post('/:id/messages', createMessage);
router.get('/:id/direct/:userId/messages', listDirectMessages);
router.post('/:id/direct/:userId/messages', createMessage);
router.post('/:id/direct/:userId/images', imageBody, uploadImage);
router.put('/:id/direct/:userId/ignore', setPrivateIgnore);
router.patch('/:id/messages/:messageId', editMessage);
router.post('/:id/images', imageBody, uploadImage);
router.delete('/:id/messages', clearPublicChat);
router.get('/:id/messages/:messageId/image', serveImage);
router.delete('/:id/messages/:messageId', deleteMessage);
router.put('/:id/messages/:messageId/reaction', toggleReaction);
router.put('/:id/messages/:messageId/pin', setMessagePin);
router.post('/:id/messages/:messageId/ban', banMessageAuthor);
router.get('/:id/events', streamEvents);

router.use(chatRouteErrorHandler);

module.exports = router;
module.exports.requireSameOriginMutation = requireSameOriginMutation;
module.exports.chatRouteErrorHandler = chatRouteErrorHandler;
