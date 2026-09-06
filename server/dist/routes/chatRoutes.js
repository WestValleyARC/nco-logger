/* hamlive-oss — MIT License. See LICENSE. */

const express = require('express');
const fs = require('fs');
const router = express.Router();
const { curatedGifPath, getCuratedGif, listCuratedGifs, manifest } = require('../lib/curatedGifs');
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
    setTypingState,
    streamEvents,
    MAX_UPLOAD_BYTES
} = require('../lib/localChat');

const imageBody = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });

const safeExternalUrl = value => {
    try {
        const url = new URL(String(value));
        return url.protocol === 'https:' ? url.href : '#';
    } catch (_err) {
        return '#';
    }
};

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

router.get('/gifs', (_req, res) => res.json({
    endpointVersion: '1.1',
    source: manifest.source,
    licenseName: manifest.license_name,
    licenseUrl: manifest.license_url,
    categories: [...new Set(manifest.items.map(item => item.category))],
    defaultCategory: manifest.default_category,
    gifs: listCuratedGifs()
}));
router.get('/gifs/credits', (_req, res) => {
    const escape = value => String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
    const rows = manifest.items.map(item => `<li><a href="${escape(safeExternalUrl(item.source_file_page_url))}">${
        escape(item.title)}</a> — ${escape(item.attribution_text)}</li>`).join('');
    res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GIF Credits</title><body><main><h1>NCO Logger GIF Credits</h1><p>This self-hosted catalog uses public-domain and Creative Commons footage from <a href="${escape(safeExternalUrl(manifest.source_url))}">Wikimedia Commons</a>, plus a small OpenMoji subset. Each item below includes its source and license.</p><ul>${rows}</ul></main></body></html>`);
});
router.get('/gifs/:gifId/file', (req, res) => {
    const gif = getCuratedGif(req.params.gifId);
    const filename = curatedGifPath(req.params.gifId);
    if (!gif || !filename) return res.status(404).json({ endpointVersion: '1.1', error: 'GIF not found' });
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('gif');
    return fs.createReadStream(filename).pipe(res);
});
router.get('/gifs/:gifId/thumbnail', (req, res) => {
    const gif = getCuratedGif(req.params.gifId);
    const filename = curatedGifPath(req.params.gifId, true);
    if (!gif || !filename) return res.status(404).json({ endpointVersion: '1.1', error: 'GIF not found' });
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('png');
    return fs.createReadStream(filename).pipe(res);
});

router.get('/:id/messages', listMessages);
router.post('/:id/messages', createMessage);
router.post('/:id/typing', express.json({ limit: '1kb' }), setTypingState);
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
