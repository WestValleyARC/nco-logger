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
const QUICK_REACTIONS = Object.freeze(['👍', '❤️', '😂', '😮']);
const PIN_ROLES = new Set(['netcontrol', 'netlogger']);
const rateWindows = new Map();

const isObjectId = value => mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === value;

const authorizeChatAction = ({ role = 'netuser', action, mine = false, deleted = false, cleared = false }) => {
    if (cleared) return false;
    if (action === 'clear') return role === 'netcontrol';
    if (action === 'ban') return role === 'netcontrol' && !mine && !deleted;
    if (action === 'pin') return PIN_ROLES.has(role) && !deleted;
    if (action === 'edit' || action === 'delete') return mine && !deleted;
    if (action === 'react' || action === 'reply') return !deleted;
    return false;
};

const summarizeReactions = (reactions = [], currentUserId = '') => QUICK_REACTIONS.map(emoji => {
    const matching = reactions.filter(reaction => reaction.emoji === emoji);
    return {
        emoji,
        count: matching.length,
        reactedByMe: matching.some(reaction => reaction.userProfile?.toString() === currentUserId)
    };
}).filter(reaction => reaction.count > 0);

const toggleReactionValue = (reactions = [], emoji, userId) => {
    const unique = new Map();
    reactions.forEach(reaction => {
        const userProfile = reaction.userProfile?._id || reaction.userProfile;
        unique.set(`${reaction.emoji}:${userProfile?.toString()}`, { emoji: reaction.emoji, userProfile });
    });
    const key = `${emoji}:${userId}`;
    const alreadyReacted = unique.delete(key);
    if (!alreadyReacted) unique.set(key, { emoji, userProfile: userId });
    const normalized = [...unique.values()];
    return normalized;
};

const toPublicMessage = (message, role = 'netuser', currentUserId = '') => {
    const deleted = Boolean(message.deletedAt);
    const cleared = Boolean(message.clearedAt);
    const mine = message.userProfile.toString() === currentUserId;
    const netProfile = message.netProfile?.toString() || '';
    const attachment = !deleted && !cleared && netProfile && message.attachment?.storageName ? {
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
        cleared,
        replyTo: message.replyTo?.toString() || null,
        reactions: cleared || deleted ? [] : summarizeReactions(message.reactions || [], currentUserId),
        pinned: !cleared && Boolean(message.pinnedAt),
        mine,
        canReact: authorizeChatAction({ role, action: 'react', mine, deleted, cleared }),
        canReply: authorizeChatAction({ role, action: 'reply', mine, deleted, cleared }),
        canEdit: authorizeChatAction({ role, action: 'edit', mine, deleted, cleared }),
        canDelete: authorizeChatAction({ role, action: 'delete', mine, deleted, cleared }),
        canPin: authorizeChatAction({ role, action: 'pin', mine, deleted, cleared }),
        canBan: authorizeChatAction({ role, action: 'ban', mine, deleted, cleared })
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
        role: interaction.role
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

const isBanned = async ({ npid, userId, db = mongoose.connection }) => {
    const ChatBan = getChatBan(db);
    return Boolean(await ChatBan.exists({ netProfile: npid, userProfile: userId }));
};

const findReplyTarget = async ({ ChatMessage, npid, replyTo }) => {
    if (replyTo === undefined || replyTo === null || replyTo === '') return null;
    if (!isObjectId(String(replyTo))) throw Object.assign(new Error('Invalid reply message identifier'), { status: 400 });
    const target = await ChatMessage.findOne({ _id: replyTo, netProfile: npid, clearedAt: null });
    if (!target || target.deletedAt) throw Object.assign(new Error('Reply target is unavailable'), { status: 409 });
    return target;
};

const listMessages = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.id)) return sendError(res, 400, 'Invalid net identifier');
        const access = await getNetAccess({ npid: req.params.id, userId: req.user._id.toString() });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId: req.user._id.toString() })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
        const ChatMessage = getChatMessage();
        const messages = await ChatMessage.find({ netProfile: req.params.id, clearedAt: null })
            .sort({ createdAt: -1, _id: -1 }).limit(500);
        messages.reverse();
        return res.json({
            endpointVersion: '1.0',
            messages: messages.map(message => toPublicMessage(message, access.role, req.user._id.toString())),
            viewerRole: access.role,
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
        if (!isObjectId(req.params.id)) return sendError(res, 400, 'Invalid net identifier');
        if (!req.user.callSign) return sendError(res, 403, 'A callsign is required');
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
        if (!rateLimitAllows(userId)) return sendError(res, 429, 'Please wait before sending more messages');
        const text = cleanMessage(req.body?.text);
        if (!text) return sendError(res, 400, 'Message text is required');
        if (text.length > MAX_MESSAGE_CHARS) return sendError(res, 400, `Message exceeds ${MAX_MESSAGE_CHARS} characters`);
        const ChatMessage = getChatMessage();
        const replyTarget = await findReplyTarget({ ChatMessage, npid: req.params.id, replyTo: req.body?.replyTo });
        const message = await ChatMessage.create({
            liveNet: access.liveNet._id,
            netProfile: req.params.id,
            userProfile: req.user._id,
            callSign: req.user.callSign,
            displayName: req.user.displayName || req.user.callSign,
            text,
            replyTo: replyTarget?._id || null
        });
        return res.status(201).json({ endpointVersion: '1.0', message: toPublicMessage(message, access.role, userId) });
    } catch (err) {
        if (err.status) return sendError(res, err.status, err.message);
        logger.error(`Local chat send failed: ${err.message}`);
        return sendError(res, 500, 'Message could not be sent');
    }
};

const editMessage = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.id) || !isObjectId(req.params.messageId)) {
            return sendError(res, 400, 'Invalid chat identifier');
        }
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
        const ChatMessage = getChatMessage();
        const message = await ChatMessage.findOne({ _id: req.params.messageId, netProfile: req.params.id });
        if (!message) return sendError(res, 404, 'Message not found');
        if (message.userProfile.toString() !== userId) return sendError(res, 403, 'Not authorized');
        if (message.deletedAt) return sendError(res, 409, 'Deleted messages cannot be edited');
        if (!rateLimitAllows(userId)) return sendError(res, 429, 'Please wait before editing more messages');
        const text = cleanMessage(req.body?.text);
        if (!text && !message.attachment?.storageName) return sendError(res, 400, 'Message text is required');
        if (text.length > MAX_MESSAGE_CHARS) {
            return sendError(res, 400, `Message exceeds ${MAX_MESSAGE_CHARS} characters`);
        }
        message.text = text;
        message.editedAt = new Date();
        await message.save();
        return res.json({ endpointVersion: '1.0', message: toPublicMessage(message, access.role, userId) });
    } catch (err) {
        logger.error(`Local chat edit failed: ${err.message}`);
        return sendError(res, 500, 'Message could not be edited');
    }
};

const uploadImage = async (req, res) => {
    let storageName;
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.id)) return sendError(res, 400, 'Invalid net identifier');
        if (!req.user.callSign) return sendError(res, 403, 'A callsign is required');
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId })) {
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
        const replyTarget = await findReplyTarget({
            ChatMessage,
            npid: req.params.id,
            replyTo: req.get?.('x-chat-reply-to')
        });
        const message = await ChatMessage.create({
            liveNet: access.liveNet._id,
            netProfile: req.params.id,
            userProfile: req.user._id,
            callSign: req.user.callSign,
            displayName: req.user.displayName || req.user.callSign,
            text: '',
            replyTo: replyTarget?._id || null,
            attachment: {
                kind: 'image', storageName, mimeType: detected.mimeType, size: req.body.length
            }
        });
        return res.status(201).json({
            endpointVersion: '1.0',
            message: toPublicMessage(message, access.role, userId)
        });
    } catch (err) {
        if (storageName) await removeAttachment({ storageName });
        if (err.status) return sendError(res, err.status, err.message);
        logger.error(`Local chat image upload failed: ${err.message}`);
        return sendError(res, 500, 'Image could not be uploaded');
    }
};

const serveImage = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.id) || !isObjectId(req.params.messageId)) {
            return sendError(res, 400, 'Invalid chat identifier');
        }
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
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
        if (!isObjectId(req.params.id) || !isObjectId(req.params.messageId)) {
            return sendError(res, 400, 'Invalid chat identifier');
        }
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
        const ChatMessage = getChatMessage();
        const message = await ChatMessage.findOne({ _id: req.params.messageId, netProfile: req.params.id });
        if (!message) return sendError(res, 404, 'Message not found');
        if (message.userProfile.toString() !== userId) return sendError(res, 403, 'Not authorized');
        if (message.deletedAt || message.clearedAt) return sendError(res, 409, 'Message is already unavailable');
        await removeAttachment(message.attachment);
        message.text = '';
        message.attachment = undefined;
        message.reactions = [];
        message.pinnedAt = null;
        message.pinnedBy = null;
        message.deletedAt = new Date();
        message.moderatedBy = null;
        await message.save();
        logger.info(`Chat message ${message._id} deleted in net ${req.params.id}`);
        return res.json({ endpointVersion: '1.0', message: toPublicMessage(message, access.role, userId) });
    } catch (err) {
        logger.error(`Local chat delete failed: ${err.message}`);
        return sendError(res, 500, 'Message could not be deleted');
    }
};

const toggleReaction = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.id) || !isObjectId(req.params.messageId)) {
            return sendError(res, 400, 'Invalid chat identifier');
        }
        const emoji = String(req.body?.emoji || '');
        if (!QUICK_REACTIONS.includes(emoji)) return sendError(res, 400, 'Unsupported reaction');
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
        const ChatMessage = getChatMessage();
        const message = await ChatMessage.findOne({ _id: req.params.messageId, netProfile: req.params.id });
        if (!message) return sendError(res, 404, 'Message not found');
        const mine = message.userProfile.toString() === userId;
        if (!authorizeChatAction({ role: access.role, action: 'react', mine,
            deleted: Boolean(message.deletedAt), cleared: Boolean(message.clearedAt) })) {
            return sendError(res, 409, 'Message is unavailable for reactions');
        }
        const reacted = (message.reactions || []).some(reaction =>
            reaction.emoji === emoji && reaction.userProfile?.toString() === userId
        );
        const updated = await ChatMessage.findOneAndUpdate(
            { _id: message._id, netProfile: req.params.id, deletedAt: null, clearedAt: null },
            reacted
                ? { $pull: { reactions: { emoji, userProfile: req.user._id } } }
                : { $addToSet: { reactions: { emoji, userProfile: req.user._id } } },
            { new: true }
        );
        if (!updated) return sendError(res, 409, 'Message is unavailable for reactions');
        return res.json({ endpointVersion: '1.0', message: toPublicMessage(updated, access.role, userId) });
    } catch (err) {
        logger.error(`Local chat reaction failed: ${err.message}`);
        return sendError(res, 500, 'Reaction could not be updated');
    }
};

const setMessagePin = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.id) || !isObjectId(req.params.messageId)) {
            return sendError(res, 400, 'Invalid chat identifier');
        }
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
        const ChatMessage = getChatMessage();
        const message = await ChatMessage.findOne({ _id: req.params.messageId, netProfile: req.params.id });
        if (!message) return sendError(res, 404, 'Message not found');
        const mine = message.userProfile.toString() === userId;
        if (!authorizeChatAction({ role: access.role, action: 'pin', mine,
            deleted: Boolean(message.deletedAt), cleared: Boolean(message.clearedAt) })) {
            return sendError(res, 403, 'Only the NCO or Logger can pin messages');
        }
        const pinned = typeof req.body?.pinned === 'boolean' ? req.body.pinned : !message.pinnedAt;
        message.pinnedAt = pinned ? new Date() : null;
        message.pinnedBy = pinned ? req.user._id : null;
        await message.save();
        return res.json({ endpointVersion: '1.0', message: toPublicMessage(message, access.role, userId) });
    } catch (err) {
        logger.error(`Local chat pin failed: ${err.message}`);
        return sendError(res, 500, 'Pin could not be updated');
    }
};

const banMessageAuthor = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.id) || !isObjectId(req.params.messageId)) {
            return sendError(res, 400, 'Invalid chat identifier');
        }
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
        const ChatMessage = getChatMessage();
        const message = await ChatMessage.findOne({ _id: req.params.messageId, netProfile: req.params.id });
        if (!message) return sendError(res, 404, 'Message not found');
        const mine = message.userProfile.toString() === userId;
        if (!authorizeChatAction({ role: access.role, action: 'ban', mine,
            deleted: Boolean(message.deletedAt), cleared: Boolean(message.clearedAt) })) {
            return sendError(res, 403, 'Only the NCO can ban another chat participant');
        }
        await banUserHelper({
            npid: req.params.id,
            userIdToBan: message.userProfile,
            bannedByUserId: req.user._id,
            targetCallsign: message.callSign,
            reason: req.body?.reason
        });
        return res.json({ endpointVersion: '1.0', banned: true, callSign: message.callSign });
    } catch (err) {
        logger.error(`Local chat ban failed: ${err.message}`);
        return sendError(res, 500, 'Participant could not be banned');
    }
};

const clearPublicChat = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.id)) return sendError(res, 400, 'Invalid net identifier');
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
        if (!authorizeChatAction({ role: access.role, action: 'clear' })) {
            return sendError(res, 403, 'Only the NCO can clear public chat');
        }
        const ChatMessage = getChatMessage();
        const query = { netProfile: req.params.id, clearedAt: null };
        const attachments = await ChatMessage.find({ ...query, 'attachment.storageName': { $exists: true } })
            .select('attachment.storageName').lean();
        const clearedAt = new Date();
        const result = await ChatMessage.updateMany(query, {
            $set: {
                text: '', deletedAt: clearedAt, clearedAt, moderatedBy: req.user._id,
                reactions: [], pinnedAt: null, pinnedBy: null
            },
            $unset: { attachment: 1 }
        });
        await Promise.all(attachments.map(message => removeAttachment(message.attachment)));
        return res.json({
            endpointVersion: '1.0', cleared: true,
            count: result.modifiedCount ?? result.nModified ?? 0,
            clearedAt: clearedAt.toISOString()
        });
    } catch (err) {
        logger.error(`Local chat clear failed: ${err.message}`);
        return sendError(res, 500, 'Public chat could not be cleared');
    }
};

const streamEvents = async (req, res) => {
    let userId;
    let access;
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.id)) return sendError(res, 400, 'Invalid net identifier');
        userId = req.user._id.toString();
        access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
    } catch (err) {
        logger.error(`Local chat SSE authorization failed: ${err.message}`);
        return sendError(res, 500, 'Chat events are temporarily unavailable');
    }

    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write(`event: ready\ndata: ${JSON.stringify({ netProfile: req.params.id })}\n\n`);
    const ChatMessage = getChatMessage();
    const closeStreams = [];
    try {
        const netProfile = new mongoose.Types.ObjectId(req.params.id);
        const messageChangeStream = ChatMessage.watch([{ $match: { 'fullDocument.netProfile': netProfile } }], {
            fullDocument: 'updateLookup'
        });
        closeStreams.push(messageChangeStream);
        messageChangeStream.on('change', change => {
            if (change.fullDocument) {
                const message = toPublicMessage(change.fullDocument, access.role, userId);
                res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
            }
        });
        messageChangeStream.on('error', err => {
            logger.warn(`Local chat SSE change stream closed: ${err.message}`);
            res.end();
        });

        const ChatBan = getChatBan();
        const banChangeStream = ChatBan.watch([{ $match: { 'fullDocument.netProfile': netProfile } }], {
            fullDocument: 'updateLookup'
        });
        closeStreams.push(banChangeStream);
        banChangeStream.on('change', change => {
            if (change.fullDocument?.userProfile?.toString() !== userId) return;
            res.write(`event: access\ndata: ${JSON.stringify({
                suspended: true,
                reason: change.fullDocument.reason || ''
            })}\n\n`);
            res.end();
        });
        banChangeStream.on('error', err => {
            logger.warn(`Local chat ban stream closed: ${err.message}`);
            res.end();
        });
    } catch (err) {
        logger.warn(`Local chat SSE unavailable: ${err.message}`);
        return res.end();
    }
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25000);
    req.on('close', () => {
        clearInterval(heartbeat);
        closeStreams.forEach(changeStream => void changeStream.close());
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
            reactions: summarizeReactions(message.reactions || [])
                .map(reaction => `${reaction.emoji} ${reaction.count}`).join(' '),
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

const banUserHelper = async ({ npid, userIdToBan, bannedByUserId, targetCallsign, reason = '', db = mongoose.connection }) => {
    const ChatBan = getChatBan(db);
    await ChatBan.findOneAndUpdate(
        { netProfile: npid, userProfile: userIdToBan },
        { callSign: targetCallsign, reason: cleanMessage(reason).slice(0, 240), bannedBy: bannedByUserId },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

const unbanUserHelper = async ({ npid, userIdToUnban, db = mongoose.connection }) => {
    const ChatBan = getChatBan(db);
    await ChatBan.deleteOne({ netProfile: npid, userProfile: userIdToUnban });
};

module.exports = {
    listMessages,
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
    fetchChatHistory,
    cleanupNetChat,
    banUserHelper,
    unbanUserHelper,
    getNetAccess,
    cleanMessage,
    toPublicMessage,
    authorizeChatAction,
    summarizeReactions,
    toggleReactionValue,
    QUICK_REACTIONS,
    detectImageType,
    MAX_UPLOAD_BYTES,
    IMAGE_TYPES,
    UPLOAD_DIR
};
