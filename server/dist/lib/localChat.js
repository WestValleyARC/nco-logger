/* hamlive-oss — MIT License. See LICENSE. */

const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const { conf } = require('./configLib');
const { logger } = require('./logger');
const { getLiveNet } = require('../models/liveNet');
const { getStationInteraction } = require('../models/stationInteraction');
const { getChatMessage } = require('../models/chatMessage');
const { getChatBan } = require('../models/chatBan');

const ROLE_LEVELS = { netcontrol: 0, netlogger: 1, netrelay: 2, netuser: 3 };
const MAX_MESSAGE_CHARS = Math.min(Number(conf.chat_max_message_chars) || 2000, 2000);
const RATE_LIMIT_COUNT = Number(conf.chat_rate_limit_count) || 12;
const RATE_LIMIT_WINDOW_MS = Number(conf.chat_rate_limit_window_ms) || 10000;
const MAX_UPLOAD_MB = Math.min(Math.max(Number(conf.chat_max_upload_mb) || 5, 1), 10);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const UPLOAD_DIR = path.resolve(conf.chat_upload_dir || '/app/data/chat-uploads');
const IMAGE_TYPES = Object.freeze({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp'
});
const rateWindows = new Map();

const isObjectId = value => mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === value;

const toPublicMessage = (message, canModerate = false, currentUserId = '') => {
    const deleted = Boolean(message.deletedAt);
    const netProfile = message.netProfile?.toString() || '';
    const attachment = !deleted && netProfile && message.attachment?.storageName ? {
        kind: 'image',
        mimeType: message.attachment.mimeType,
        size: message.attachment.size,
        url: `/api/chat/${netProfile}/messages/${message._id}/image`
    } : null;
    return {
        id: message._id.toString(),
        callSign: message.callSign,
        displayName: message.displayName || '',
        text: deleted ? '' : message.text,
        attachment,
        createdAt: message.createdAt.toISOString(),
        editedAt: message.editedAt ? message.editedAt.toISOString() : null,
        deleted,
        mine: message.userProfile.toString() === currentUserId,
        canDelete: !deleted && (canModerate || message.userProfile.toString() === currentUserId)
    };
};

const detectImageType = buffer => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return { mimeType: 'image/png', extension: 'png' };
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { mimeType: 'image/jpeg', extension: 'jpg' };
    }
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') return { mimeType: 'image/gif', extension: 'gif' };
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
        return { mimeType: 'image/webp', extension: 'webp' };
    }
    return null;
};

const attachmentPath = storageName => {
    if (!/^[a-f0-9-]+\.(png|jpg|gif|webp)$/.test(String(storageName))) {
        throw new Error('Invalid attachment storage name');
    }
    return path.join(UPLOAD_DIR, storageName);
};

const removeAttachment = async attachment => {
    if (!attachment?.storageName) return;
    try { await fs.promises.unlink(attachmentPath(attachment.storageName)); }
    catch (err) {
        if (err.code !== 'ENOENT') logger.warn(`Chat attachment cleanup failed: ${err.message}`);
    }
};

const getNetAccess = async ({ npid, userId, db = mongoose.connection }) => {
    if (!isObjectId(npid) || !isObjectId(userId)) return null;
    const LiveNet = getLiveNet(db);
    const StationInteraction = getStationInteraction(db);
    const liveNet = await LiveNet.findOne({ netProfile: npid });
    if (!liveNet) return null;
    const interaction = await StationInteraction.findOne({ liveNet: liveNet._id, userProfile: userId });
    if (!interaction) return null;
    return {
        liveNet,
        interaction,
        canModerate: (ROLE_LEVELS[interaction.role] ?? 99) <= 1
    };
};

const cleanMessage = value => {
    if (typeof value !== 'string') return '';
    return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\r\n?/g, '\n').trim();
};

const rateLimitAllows = userId => {
    const now = Date.now();
    const recent = (rateWindows.get(userId) || []).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_COUNT) {
        rateWindows.set(userId, recent);
        return false;
    }
    recent.push(now);
    rateWindows.set(userId, recent);
    return true;
};

const sendError = (res, status, error) => res.status(status).json({ endpointVersion: '1.0', error });

const listMessages = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        const access = await getNetAccess({ npid: req.params.id, userId: req.user._id.toString() });
        if (!access) return sendError(res, 403, 'Net access required');
        const ChatMessage = getChatMessage();
        const messages = await ChatMessage.find({ netProfile: req.params.id }).sort({ createdAt: -1, _id: -1 }).limit(500);
        messages.reverse();
        return res.json({
            endpointVersion: '1.0',
            messages: messages.map(message => toPublicMessage(message, access.canModerate, req.user._id.toString())),
            limits: {
                maxMessageChars: MAX_MESSAGE_CHARS,
                maxUploadBytes: MAX_UPLOAD_BYTES,
                imageMimeTypes: Object.keys(IMAGE_TYPES)
            },
            ssePath: `/api/chat/${req.params.id}/events`
        });
    } catch (err) {
        logger.error(`Local chat history failed: ${err.message}`);
        return sendError(res, 500, 'Chat history is temporarily unavailable');
    }
};

const createMessage = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!req.user.callSign) return sendError(res, 403, 'A callsign is required');
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        const ChatBan = getChatBan();
        if (await ChatBan.exists({ netProfile: req.params.id, userProfile: userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
        if (!rateLimitAllows(userId)) return sendError(res, 429, 'Please wait before sending more messages');
        const text = cleanMessage(req.body?.text);
        if (!text) return sendError(res, 400, 'Message text is required');
        if (text.length > MAX_MESSAGE_CHARS) return sendError(res, 400, `Message exceeds ${MAX_MESSAGE_CHARS} characters`);
        const ChatMessage = getChatMessage();
        const message = await ChatMessage.create({
            liveNet: access.liveNet._id,
            netProfile: req.params.id,
            userProfile: req.user._id,
            callSign: req.user.callSign,
            displayName: req.user.displayName || req.user.callSign,
            text
        });
        return res.status(201).json({ endpointVersion: '1.0', message: toPublicMessage(message, access.canModerate, userId) });
    } catch (err) {
        logger.error(`Local chat send failed: ${err.message}`);
        return sendError(res, 500, 'Message could not be sent');
    }
};

const uploadImage = async (req, res) => {
    let storageName;
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!req.user.callSign) return sendError(res, 403, 'A callsign is required');
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        const ChatBan = getChatBan();
        if (await ChatBan.exists({ netProfile: req.params.id, userProfile: userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
        if (!rateLimitAllows(userId)) return sendError(res, 429, 'Please wait before sending more messages');
        if (!Buffer.isBuffer(req.body) || !req.body.length) return sendError(res, 400, 'Image data is required');
        if (req.body.length > MAX_UPLOAD_BYTES) return sendError(res, 413, `Image exceeds ${MAX_UPLOAD_MB} MB`);

        const detected = detectImageType(req.body);
        if (!detected) return sendError(res, 415, 'Only PNG, JPEG, GIF, and WebP images are supported');
        const declaredType = String(req.get?.('content-type') || '').split(';')[0].toLowerCase();
        if (declaredType && declaredType !== 'application/octet-stream' && declaredType !== detected.mimeType) {
            return sendError(res, 415, 'Image content does not match its declared type');
        }

        await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
        storageName = `${crypto.randomUUID()}.${detected.extension}`;
        await fs.promises.writeFile(attachmentPath(storageName), req.body, { flag: 'wx', mode: 0o600 });

        const ChatMessage = getChatMessage();
        const message = await ChatMessage.create({
            liveNet: access.liveNet._id,
            netProfile: req.params.id,
            userProfile: req.user._id,
            callSign: req.user.callSign,
            displayName: req.user.displayName || req.user.callSign,
            text: '',
            attachment: {
                kind: 'image', storageName, mimeType: detected.mimeType, size: req.body.length
            }
        });
        return res.status(201).json({
            endpointVersion: '1.0',
            message: toPublicMessage(message, access.canModerate, userId)
        });
    } catch (err) {
        if (storageName) await removeAttachment({ storageName });
        logger.error(`Local chat image upload failed: ${err.message}`);
        return sendError(res, 500, 'Image could not be uploaded');
    }
};

const serveImage = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.messageId)) return sendError(res, 400, 'Invalid message identifier');
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        const ChatMessage = getChatMessage();
        const message = await ChatMessage.findOne({
            _id: req.params.messageId,
            netProfile: req.params.id,
            deletedAt: null,
            'attachment.kind': 'image'
        });
        if (!message?.attachment?.storageName) return sendError(res, 404, 'Image not found');
        const data = await fs.promises.readFile(attachmentPath(message.attachment.storageName));
        res.set({
            'Content-Type': message.attachment.mimeType,
            'Content-Length': String(data.length),
            'Content-Disposition': `inline; filename="chat-image.${IMAGE_TYPES[message.attachment.mimeType]}"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox"
        });
        return res.send(data);
    } catch (err) {
        if (err.code === 'ENOENT') return sendError(res, 404, 'Image not found');
        logger.error(`Local chat image retrieval failed: ${err.message}`);
        return sendError(res, 500, 'Image is temporarily unavailable');
    }
};

const deleteMessage = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.messageId)) return sendError(res, 400, 'Invalid message identifier');
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        const ChatMessage = getChatMessage();
        const message = await ChatMessage.findOne({ _id: req.params.messageId, netProfile: req.params.id });
        if (!message) return sendError(res, 404, 'Message not found');
        if (!access.canModerate && message.userProfile.toString() !== userId) return sendError(res, 403, 'Not authorized');
        await removeAttachment(message.attachment);
        message.text = '';
        message.attachment = undefined;
        message.deletedAt = new Date();
        message.moderatedBy = access.canModerate ? req.user._id : null;
        await message.save();
        logger.info(`Chat message ${message._id} deleted in net ${req.params.id}`);
        return res.json({ endpointVersion: '1.0', message: toPublicMessage(message, access.canModerate, userId) });
    } catch (err) {
        logger.error(`Local chat delete failed: ${err.message}`);
        return sendError(res, 500, 'Message could not be deleted');
    }
};

const streamEvents = async (req, res) => {
    let userId;
    let access;
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        userId = req.user._id.toString();
        access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
    } catch (err) {
        logger.error(`Local chat SSE authorization failed: ${err.message}`);
        return sendError(res, 500, 'Chat events are temporarily unavailable');
    }

    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write(`event: ready\ndata: ${JSON.stringify({ netProfile: req.params.id })}\n\n`);
    const ChatMessage = getChatMessage();
    let changeStream;
    try {
        changeStream = ChatMessage.watch([{ $match: { 'fullDocument.netProfile': new mongoose.Types.ObjectId(req.params.id) } }], {
            fullDocument: 'updateLookup'
        });
        changeStream.on('change', change => {
            if (change.fullDocument) {
                const message = toPublicMessage(change.fullDocument, access.canModerate, userId);
                res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
            }
        });
        changeStream.on('error', err => {
            logger.warn(`Local chat SSE change stream closed: ${err.message}`);
            res.end();
        });
    } catch (err) {
        logger.warn(`Local chat SSE unavailable: ${err.message}`);
        return res.end();
    }
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25000);
    req.on('close', () => {
        clearInterval(heartbeat);
        if (changeStream) void changeStream.close();
    });
};

async function* fetchChatHistory({ npid, since, db = mongoose.connection }) {
    if (!isObjectId(npid)) throw new Error('Malformed net profile identifier');
    const ChatMessage = getChatMessage(db);
    const query = { netProfile: npid, deletedAt: null };
    if (since) query.createdAt = { $gte: new Date(since) };
    const messages = await ChatMessage.find(query).sort({ createdAt: 1, _id: 1 }).lean();
    const batchSize = 100;
    for (let index = 0; index < messages.length; index += batchSize) {
        yield messages.slice(index, index + batchSize).map(message => ({
            username: message.callSign || message.displayName || 'Unknown',
            body: [message.text, message.attachment?.storageName ? '[Image attachment]' : ''].filter(Boolean).join(' '),
            createdAt: message.createdAt.toISOString(),
            reactions: '',
            edited: Boolean(message.editedAt)
        }));
    }
}

const cleanupNetChat = async (npid, db = mongoose.connection) => {
    const ChatMessage = getChatMessage(db);
    const ChatBan = getChatBan(db);
    const attachments = await ChatMessage.find({ netProfile: npid, 'attachment.storageName': { $exists: true } })
        .select('attachment.storageName').lean();
    await Promise.all(attachments.map(message => removeAttachment(message.attachment)));
    await Promise.all([ChatMessage.deleteMany({ netProfile: npid }), ChatBan.deleteMany({ netProfile: npid })]);
};

const banUserHelper = async ({ npid, userIdToBan, bannedByUserId, targetCallsign, reason = '' }) => {
    const ChatBan = getChatBan();
    await ChatBan.findOneAndUpdate(
        { netProfile: npid, userProfile: userIdToBan },
        { callSign: targetCallsign, reason: cleanMessage(reason).slice(0, 240), bannedBy: bannedByUserId },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

const unbanUserHelper = async ({ npid, userIdToUnban }) => {
    const ChatBan = getChatBan();
    await ChatBan.deleteOne({ netProfile: npid, userProfile: userIdToUnban });
};

module.exports = {
    listMessages,
    createMessage,
    uploadImage,
    serveImage,
    deleteMessage,
    streamEvents,
    fetchChatHistory,
    cleanupNetChat,
    banUserHelper,
    unbanUserHelper,
    getNetAccess,
    cleanMessage,
    toPublicMessage,
    detectImageType,
    MAX_UPLOAD_BYTES,
    IMAGE_TYPES,
    UPLOAD_DIR
};
