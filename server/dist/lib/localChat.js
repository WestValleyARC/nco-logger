/* hamlive-oss — MIT License. See LICENSE. */

const mongoose = require('mongoose');
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
const rateWindows = new Map();

const isObjectId = value => mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === value;

const toPublicMessage = (message, canModerate = false, currentUserId = '') => {
    const deleted = Boolean(message.deletedAt);
    return {
        id: message._id.toString(),
        callSign: message.callSign,
        displayName: message.displayName || '',
        text: deleted ? '' : message.text,
        createdAt: message.createdAt.toISOString(),
        editedAt: message.editedAt ? message.editedAt.toISOString() : null,
        deleted,
        mine: message.userProfile.toString() === currentUserId,
        canDelete: !deleted && (canModerate || message.userProfile.toString() === currentUserId)
    };
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
            limits: { maxMessageChars: MAX_MESSAGE_CHARS },
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
        message.text = '';
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
            body: message.text,
            createdAt: message.createdAt.toISOString(),
            reactions: '',
            edited: Boolean(message.editedAt)
        }));
    }
}

const cleanupNetChat = async (npid, db = mongoose.connection) => {
    const ChatMessage = getChatMessage(db);
    const ChatBan = getChatBan(db);
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
    deleteMessage,
    streamEvents,
    fetchChatHistory,
    cleanupNetChat,
    banUserHelper,
    unbanUserHelper,
    getNetAccess,
    cleanMessage,
    toPublicMessage
};
