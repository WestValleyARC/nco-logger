/* hamlive-oss — MIT License. See LICENSE. */

const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { conf } = require('./configLib');
const { getChangeStreamDb } = require('./changeStreamClient');
const { logger } = require('./logger');
const { getLiveNet } = require('../models/liveNet');
const { getStationInteraction } = require('../models/stationInteraction');
const { getChatMessage } = require('../models/chatMessage');
const { getChatBan } = require('../models/chatBan');
const { getUserProfile } = require('../models/userProfile');
const { getQrzCache } = require('../models/qrzCache');
const stationProfiles = require('./stationProfileService');

const MAX_MESSAGE_CHARS = Math.min(Number(conf.chat_max_message_chars) || 2000, 2000);
const RATE_LIMIT_COUNT = Number(conf.chat_rate_limit_count) || 12;
const RATE_LIMIT_WINDOW_MS = Number(conf.chat_rate_limit_window_ms) || 10000;
const MAX_UPLOAD_MB = Math.min(Math.max(Number(conf.chat_max_upload_mb) || 5, 1), 10);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const PUBLIC_HISTORY_LIMIT = 1000;
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
let lastRateWindowSweep = 0;
const TYPING_TTL_MS = 5000;
const TYPING_RATE_WINDOW_MS = 10000;
const TYPING_RATE_LIMIT_COUNT = 20;
const PUBLIC_SCOPE_QUERY = Object.freeze({
    $or: [
        { scope: 'public', recipientUserProfile: null },
        { scope: { $exists: false }, recipientUserProfile: null }
    ]
});
const DIRECT_SCOPE_QUERY = Object.freeze({
    $or: [
        { scope: 'direct' },
        { scope: { $exists: false }, recipientUserProfile: { $exists: true, $ne: null } }
    ]
});

const isObjectId = value => mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === value;

const participantId = value => (value?._id || value)?.toString?.() || '';
const chatFirstName = value => String(value || '').trim().split(/\s+/)[0] || '';
const chatDisplayName = ({ manualName, qrzFirstName, accountFirstName, callSign }) =>
    chatFirstName(manualName) || chatFirstName(qrzFirstName) || chatFirstName(accountFirstName)
    || String(callSign || '').trim().toUpperCase();
const resolveChatDisplayName = async ({ callSign, accountFirstName, db = mongoose.connection }) => {
    const normalizedCall = String(callSign || '').trim().toUpperCase();
    const [profile, qrz] = await Promise.all([
        stationProfiles.getProfileState(normalizedCall, {}, db),
        getQrzCache(db).findOne({ callSign: normalizedCall }).select('firstName').lean()
    ]);
    const manualName = profile.fields.name.origin === 'manual' ? profile.fields.name.value : '';
    return chatDisplayName({ manualName, qrzFirstName: qrz?.firstName, accountFirstName, callSign: normalizedCall });
};
// A recipient always makes a message private, including legacy or malformed
// records whose explicit scope is missing. Fail closed rather than exposing a
// private record through public history, SSE, moderation, or exports.
const messageScope = message => message?.scope === 'direct' || participantId(message?.recipientUserProfile)
    ? 'direct'
    : 'public';
const isDirectParticipant = (message, userId) => messageScope(message) === 'direct'
    && [participantId(message.userProfile), participantId(message.recipientUserProfile)].includes(String(userId));
const canViewMessage = (message, userId) => messageScope(message) === 'public' || isDirectParticipant(message, userId);
const shouldDeliverMessage = (message, userId, ignoredUserIds = new Set()) => {
    if (messageScope(message) === 'public') return true;
    if (!isDirectParticipant(message, userId)) return false;
    const incoming = participantId(message.recipientUserProfile) === String(userId);
    return !incoming || !ignoredUserIds.has(participantId(message.userProfile));
};

const authorizeChatAction = ({
    role = 'netuser', action, mine = false, deleted = false, cleared = false, scope = 'public', participant = true
}) => {
    if (!participant) return false;
    if (cleared) return false;
    if (action === 'clear') return scope === 'public' && role === 'netcontrol';
    if (action === 'ban') return scope === 'public' && role === 'netcontrol' && !mine && !deleted;
    if (action === 'pin') return scope === 'public' && PIN_ROLES.has(role) && !deleted;
    if (action === 'edit' || action === 'delete') return mine && !deleted;
    if (action === 'react' || action === 'reply') return !deleted;
    return false;
};

const summarizeReactions = (reactions = [], currentUserId = '') => QUICK_REACTIONS.map(emoji => {
    const matching = new Map();
    reactions.filter(reaction => reaction.emoji === emoji).forEach(reaction => {
        const userId = participantId(reaction.userProfile);
        if (userId) matching.set(userId, reaction);
    });
    return {
        emoji,
        count: matching.size,
        reactedByMe: matching.has(currentUserId)
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

const toChatMessage = (message, role = 'netuser', currentUserId = '') => {
    const deleted = Boolean(message.deletedAt);
    const cleared = Boolean(message.clearedAt);
    const senderUserId = participantId(message.userProfile);
    const recipientUserId = participantId(message.recipientUserProfile) || null;
    const scope = messageScope(message);
    const mine = senderUserId === currentUserId;
    const participant = scope === 'public' || isDirectParticipant(message, currentUserId);
    if (!participant) throw new Error('Direct chat message cannot be serialized for a non-participant');
    const netProfile = message.netProfile?.toString() || '';
    const attachment = !deleted && !cleared && netProfile && message.attachment?.storageName ? {
        kind: 'image',
        mimeType: message.attachment.mimeType,
        size: message.attachment.size,
        url: `/api/chat/${netProfile}/messages/${message._id}/image`
    } : null;
    return {
        id: message._id.toString(),
        scope,
        senderUserId,
        recipientUserId,
        conversationUserId: scope === 'direct' ? (mine ? recipientUserId : senderUserId) : null,
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
        pinnedAt: !cleared && message.pinnedAt ? message.pinnedAt.toISOString() : null,
        mine,
        canReact: authorizeChatAction({ role, action: 'react', mine, deleted, cleared, scope, participant }),
        canReply: authorizeChatAction({ role, action: 'reply', mine, deleted, cleared, scope, participant }),
        canEdit: authorizeChatAction({ role, action: 'edit', mine, deleted, cleared, scope, participant }),
        canDelete: authorizeChatAction({ role, action: 'delete', mine, deleted, cleared, scope, participant }),
        canPin: authorizeChatAction({ role, action: 'pin', mine, deleted, cleared, scope, participant }),
        canBan: authorizeChatAction({ role, action: 'ban', mine, deleted, cleared, scope, participant }),
        canMessagePrivately: scope === 'public' && !mine && !deleted && !cleared && Boolean(senderUserId)
    };
};

const toPublicMessage = toChatMessage;

const chatEventForViewer = (message, role, userId, ignoredUserIds = new Set()) => {
    if (!shouldDeliverMessage(message, userId, ignoredUserIds)) return null;
    return toChatMessage(message, role, userId);
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
    const interaction = await StationInteraction.findOne({ liveNet: liveNet._id, userProfile: userId })
        .sort({ updatedAt: -1, _id: -1 });
    if (!interaction) return null;
    return {
        liveNet,
        interaction,
        role: interaction.role
    };
};

const getIgnoredUserIds = async (userId, db = mongoose.connection) => {
    const UserProfile = getUserProfile(db);
    const profile = await UserProfile.findById(userId).select('ignoredPrivateUsers').lean();
    return new Set((profile?.ignoredPrivateUsers || []).map(participantId).filter(Boolean));
};

const directConversationQuery = (npid, firstUserId, secondUserId) => ({
    netProfile: npid,
    $and: [
        DIRECT_SCOPE_QUERY,
        { $or: [
            { userProfile: firstUserId, recipientUserProfile: secondUserId },
            { userProfile: secondUserId, recipientUserProfile: firstUserId }
        ] }
    ]
});

const getDirectPeer = async ({ access, peerUserId, currentUserId, db = mongoose.connection }) => {
    if (!isObjectId(String(peerUserId)) || String(peerUserId) === String(currentUserId)) return null;
    const StationInteraction = getStationInteraction(db);
    return StationInteraction.findOne({
        liveNet: access.liveNet._id,
        userProfile: peerUserId
    }).sort({ updatedAt: -1 });
};

const listRecipientsForAccess = async ({ access, currentUserId, ignoredUserIds, awayInMs = 120000,
    db = mongoose.connection }) => {
    const StationInteraction = getStationInteraction(db);
    const interactions = await StationInteraction.find({
        liveNet: access.liveNet._id,
        userProfile: { $ne: null }
    }).sort({ updatedAt: -1 }).lean();
    const seen = new Set();
    const recipients = [];
    interactions.forEach(interaction => {
        const userId = participantId(interaction.userProfile);
        if (!userId || userId === String(currentUserId) || seen.has(userId)) return;
        seen.add(userId);
        const online = Boolean(interaction.lastSeen)
            && Date.now() - new Date(interaction.lastSeen).getTime() < awayInMs;
        recipients.push({
            userId,
            callSign: interaction.callSign || '',
            displayName: interaction.displayName || '',
            role: interaction.role || 'netuser',
            presence: online ? 'online' : 'offline',
            presenceLabel: online ? 'Connected to this net' : 'Not currently connected to this net',
            ignored: ignoredUserIds.has(userId)
        });
    });
    return recipients.sort((a, b) => Number(b.presence === 'online') - Number(a.presence === 'online')
        || a.callSign.localeCompare(b.callSign));
};

const cleanMessage = value => {
    if (typeof value !== 'string') return '';
    return value.replace(/\r\n?/g, '\n').trim();
};

const rateLimitAllows = (userId, now = Date.now()) => {
    if (now - lastRateWindowSweep >= RATE_LIMIT_WINDOW_MS) {
        rateWindows.forEach((timestamps, id) => {
            const active = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
            if (active.length) rateWindows.set(id, active);
            else rateWindows.delete(id);
        });
        lastRateWindowSweep = now;
    }
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
const sendRateLimit = res => {
    res.set?.('Retry-After', String(Math.max(1, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000))));
    return sendError(res, 429, 'Please wait before trying more chat actions');
};

class ChatTypingHub {
    constructor({ now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
        this.now = now;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.connections = new Map();
        this.states = new Map();
        this.rateWindows = new Map();
        this.lastRateWindowSweep = 0;
        this.expiryTimer = null;
        this.nextConnectionId = 1;
    }

    connect(connection) {
        const id = this.nextConnectionId++;
        this.connections.set(id, connection);
        return () => {
            this.connections.delete(id);
            if (![...this.connections.values()].some(item => item.npid === connection.npid
                && item.userId === connection.userId)) this.clearSender(connection.npid, connection.userId);
        };
    }

    updateViewer(npid, userId, values) {
        this.connections.forEach(connection => {
            if (connection.npid === npid && connection.userId === userId) Object.assign(connection, values);
        });
    }

    hasParticipant(npid, userId) {
        return [...this.connections.values()].some(connection => connection.npid === npid
            && connection.userId === userId);
    }

    hasState(npid, userId, recipientUserId) {
        return this.states.has(`${npid}:${userId}:${recipientUserId || 'public'}`);
    }

    allows(userId) {
        const now = this.now();
        if (now - this.lastRateWindowSweep >= TYPING_RATE_WINDOW_MS) {
            this.rateWindows.forEach((times, id) => {
                const recent = times.filter(time => now - time < TYPING_RATE_WINDOW_MS);
                if (recent.length) this.rateWindows.set(id, recent);
                else this.rateWindows.delete(id);
            });
            this.lastRateWindowSweep = now;
        }
        const recent = (this.rateWindows.get(userId) || []).filter(time => now - time < TYPING_RATE_WINDOW_MS);
        if (recent.length >= TYPING_RATE_LIMIT_COUNT) {
            this.rateWindows.set(userId, recent);
            return false;
        }
        recent.push(now);
        this.rateWindows.set(userId, recent);
        return true;
    }

    set({ npid, userId, callSign, displayName, recipientUserId, active }) {
        const key = `${npid}:${userId}:${recipientUserId || 'public'}`;
        if (!active) {
            const state = this.states.get(key);
            if (state) {
                this.states.delete(key);
                this.broadcast({ ...state, active: false, expiresAt: this.now() });
                this.scheduleExpiry();
            }
            return;
        }
        const state = {
            npid, userId, callSign, displayName, recipientUserId,
            active: true, expiresAt: this.now() + TYPING_TTL_MS
        };
        this.states.set(key, state);
        this.broadcast(state);
        this.scheduleExpiry();
    }

    clearSender(npid, userId) {
        [...this.states.entries()].forEach(([key, state]) => {
            if (state.npid !== npid || state.userId !== userId) return;
            this.states.delete(key);
            this.broadcast({ ...state, active: false, expiresAt: this.now() });
        });
        this.scheduleExpiry();
    }

    broadcast(state) {
        this.connections.forEach(connection => {
            if (connection.npid !== state.npid || connection.userId === state.userId) return;
            if (state.recipientUserId) {
                if (connection.userId !== state.recipientUserId) return;
                if (connection.ignoredUserIds?.has(state.userId)) return;
            }
            connection.writeEvent('typing', state);
        });
    }

    expire() {
        this.expiryTimer = null;
        const now = this.now();
        [...this.states.entries()].forEach(([key, state]) => {
            if (state.expiresAt > now) return;
            this.states.delete(key);
            this.broadcast({ ...state, active: false, expiresAt: now });
        });
        this.scheduleExpiry();
    }

    scheduleExpiry() {
        if (this.expiryTimer) this.clearTimer(this.expiryTimer);
        this.expiryTimer = null;
        const next = Math.min(...[...this.states.values()].map(state => state.expiresAt));
        if (Number.isFinite(next)) this.expiryTimer = this.setTimer(() => this.expire(), Math.max(0, next - this.now()));
    }
}

const chatTypingHub = new ChatTypingHub();

const setTypingState = (req, res) => {
    if (!req.user?._id) return sendError(res, 401, 'Authentication required');
    if (!isObjectId(req.params.id)) return sendError(res, 400, 'Invalid net identifier');
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['active', 'recipientUserId'].includes(key))
        || typeof body.active !== 'boolean'
        || !(body.recipientUserId === null || typeof body.recipientUserId === 'string')) {
        return sendError(res, 400, 'Invalid typing state');
    }
    const userId = req.user._id.toString();
    const sender = [...chatTypingHub.connections.values()].find(connection => connection.npid === req.params.id
        && connection.userId === userId);
    if (!sender) return sendError(res, 403, 'Active chat connection required');
    if (body.recipientUserId !== null && (!isObjectId(body.recipientUserId) || body.recipientUserId === userId
        || (!chatTypingHub.hasParticipant(req.params.id, body.recipientUserId)
            && !(!body.active && chatTypingHub.hasState(req.params.id, userId, body.recipientUserId))))) {
        return sendError(res, 404, 'Private chat recipient is not connected to this net');
    }
    if (!chatTypingHub.allows(userId)) return sendError(res, 429, 'Please wait before sending more typing updates');
    chatTypingHub.set({
        npid: req.params.id,
        userId,
        callSign: sender.callSign,
        displayName: sender.displayName,
        recipientUserId: body.recipientUserId,
        active: body.active
    });
    return res.status(204).end();
};

const isBanned = async ({ npid, userId, db = mongoose.connection }) => {
    const ChatBan = getChatBan(db);
    return Boolean(await ChatBan.exists({ netProfile: npid, userProfile: userId }));
};

const findReplyTarget = async ({ ChatMessage, npid, replyTo, scope = 'public', senderUserId, recipientUserId }) => {
    if (replyTo === undefined || replyTo === null || replyTo === '') return null;
    if (!isObjectId(String(replyTo))) throw Object.assign(new Error('Invalid reply message identifier'), { status: 400 });
    const target = await ChatMessage.findOne({ _id: replyTo, netProfile: npid, clearedAt: null });
    if (!target || target.deletedAt) throw Object.assign(new Error('Reply target is unavailable'), { status: 409 });
    if (messageScope(target) !== scope) {
        throw Object.assign(new Error('Reply scope does not match the selected conversation'), { status: 409 });
    }
    if (scope === 'direct') {
        const expected = new Set([String(senderUserId), String(recipientUserId)]);
        const actual = new Set([participantId(target.userProfile), participantId(target.recipientUserProfile)]);
        if (expected.size !== actual.size || [...expected].some(id => !actual.has(id))) {
            throw Object.assign(new Error('Reply target is outside this private conversation'), { status: 403 });
        }
    }
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
        const userId = req.user._id.toString();
        const ignoredUserIds = await getIgnoredUserIds(userId);
        const ChatMessage = getChatMessage();
        const messages = await ChatMessage.find({
            netProfile: req.params.id, clearedAt: null, ...PUBLIC_SCOPE_QUERY
        })
            .sort({ createdAt: -1, _id: -1 }).limit(PUBLIC_HISTORY_LIMIT);
        messages.reverse();
        const directMessages = await ChatMessage.find({
            netProfile: req.params.id,
            $and: [
                DIRECT_SCOPE_QUERY,
                { $or: [{ userProfile: userId }, { recipientUserProfile: userId }] }
            ]
        }).sort({ createdAt: -1, _id: -1 }).limit(1000);
        directMessages.reverse();
        const recipients = await listRecipientsForAccess({
            access,
            currentUserId: userId,
            ignoredUserIds,
            awayInMs: Number(res.locals?.flexOpts?.awayInMs) || 120000
        });
        return res.json({
            endpointVersion: '1.1',
            messages: messages.map(message => toChatMessage(message, access.role, userId)),
            directMessages: directMessages.filter(message => shouldDeliverMessage(message, userId, ignoredUserIds))
                .map(message => toChatMessage(message, access.role, userId)),
            recipients,
            currentUserId: userId,
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

const listDirectMessages = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.id) || !isObjectId(req.params.userId)) {
            return sendError(res, 400, 'Invalid private conversation identifier');
        }
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
        const peer = await getDirectPeer({ access, peerUserId: req.params.userId, currentUserId: userId });
        if (!peer) return sendError(res, 404, 'Private chat recipient is not known to this net');
        const ignoredUserIds = await getIgnoredUserIds(userId);
        const ChatMessage = getChatMessage();
        const messages = await ChatMessage.find(directConversationQuery(req.params.id, userId, req.params.userId))
            .sort({ createdAt: -1, _id: -1 }).limit(500);
        messages.reverse();
        return res.json({
            endpointVersion: '1.1',
            peerUserId: req.params.userId,
            ignored: ignoredUserIds.has(req.params.userId),
            messages: messages.filter(message => shouldDeliverMessage(message, userId, ignoredUserIds))
                .map(message => toChatMessage(message, access.role, userId))
        });
    } catch (err) {
        logger.error(`Private chat history failed: ${err.message}`);
        return sendError(res, 500, 'Private chat history is temporarily unavailable');
    }
};

const setPrivateIgnore = async (req, res) => {
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.id) || !isObjectId(req.params.userId)) {
            return sendError(res, 400, 'Invalid private conversation identifier');
        }
        const userId = req.user._id.toString();
        const access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        const peer = await getDirectPeer({ access, peerUserId: req.params.userId, currentUserId: userId });
        if (!peer) return sendError(res, 404, 'Private chat recipient is not known to this net');
        if (typeof req.body?.ignored !== 'boolean') {
            return sendError(res, 400, 'Ignore preference must be a boolean');
        }
        if (!rateLimitAllows(userId)) return sendRateLimit(res);
        const ignored = req.body.ignored;
        const UserProfile = getUserProfile();
        await UserProfile.updateOne(
            { _id: req.user._id },
            ignored
                ? { $addToSet: { ignoredPrivateUsers: peer.userProfile } }
                : { $pull: { ignoredPrivateUsers: peer.userProfile } }
        );
        return res.json({ endpointVersion: '1.1', userId: req.params.userId, ignored });
    } catch (err) {
        logger.error(`Private chat ignore update failed: ${err.message}`);
        return sendError(res, 500, 'Private chat preference could not be updated');
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
        const text = cleanMessage(req.body?.text);
        if (!text) return sendError(res, 400, 'Message text is required');
        if (text.length > MAX_MESSAGE_CHARS) return sendError(res, 400, `Message exceeds ${MAX_MESSAGE_CHARS} characters`);
        const scope = req.params.userId ? 'direct' : 'public';
        const peer = scope === 'direct' ? await getDirectPeer({
            access, peerUserId: req.params.userId, currentUserId: userId
        }) : null;
        if (scope === 'direct' && !peer) return sendError(res, 404, 'Private chat recipient is not known to this net');
        const ChatMessage = getChatMessage();
        const replyTarget = await findReplyTarget({
            ChatMessage, npid: req.params.id, replyTo: req.body?.replyTo, scope,
            senderUserId: userId, recipientUserId: participantId(peer?.userProfile)
        });
        if (!rateLimitAllows(userId)) return sendRateLimit(res);
        const callSign = req.user.callSign.trim().toUpperCase();
        const displayName = await resolveChatDisplayName({ callSign });
        const message = await ChatMessage.create({
            liveNet: access.liveNet._id,
            netProfile: req.params.id,
            userProfile: req.user._id,
            callSign,
            displayName,
            scope,
            recipientUserProfile: peer?.userProfile || null,
            text,
            replyTo: replyTarget?._id || null
        });
        return res.status(201).json({ endpointVersion: '1.1', message: toChatMessage(message, access.role, userId) });
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
        const text = cleanMessage(req.body?.text);
        if (!text && !message.attachment?.storageName) return sendError(res, 400, 'Message text is required');
        if (text.length > MAX_MESSAGE_CHARS) {
            return sendError(res, 400, `Message exceeds ${MAX_MESSAGE_CHARS} characters`);
        }
        if (!rateLimitAllows(userId)) return sendRateLimit(res);
        message.text = text;
        message.editedAt = new Date();
        await message.save();
        return res.json({ endpointVersion: '1.1', message: toChatMessage(message, access.role, userId) });
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
        if (!Buffer.isBuffer(req.body) || !req.body.length) return sendError(res, 400, 'Image data is required');
        if (req.body.length > MAX_UPLOAD_BYTES) return sendError(res, 413, `Image exceeds ${MAX_UPLOAD_MB} MB`);

        const detected = detectImageType(req.body);
        if (!detected) return sendError(res, 415, 'Only PNG, JPEG, GIF, and WebP images are supported');
        const declaredType = String(req.get?.('content-type') || '').split(';')[0].toLowerCase();
        if (declaredType && declaredType !== 'application/octet-stream' && declaredType !== detected.mimeType) {
            return sendError(res, 415, 'Image content does not match its declared type');
        }

        const scope = req.params.userId ? 'direct' : 'public';
        const peer = scope === 'direct' ? await getDirectPeer({
            access, peerUserId: req.params.userId, currentUserId: userId
        }) : null;
        if (scope === 'direct' && !peer) return sendError(res, 404, 'Private chat recipient is not known to this net');
        const ChatMessage = getChatMessage();
        const replyTarget = await findReplyTarget({
            ChatMessage,
            npid: req.params.id,
            replyTo: req.get?.('x-chat-reply-to'),
            scope,
            senderUserId: userId,
            recipientUserId: participantId(peer?.userProfile)
        });
        if (!rateLimitAllows(userId)) return sendRateLimit(res);
        const callSign = req.user.callSign.trim().toUpperCase();
        const displayName = await resolveChatDisplayName({ callSign });

        await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
        storageName = `${crypto.randomUUID()}.${detected.extension}`;
        await fs.promises.writeFile(attachmentPath(storageName), req.body, { flag: 'wx', mode: 0o600 });

        const message = await ChatMessage.create({
            liveNet: access.liveNet._id,
            netProfile: req.params.id,
            userProfile: req.user._id,
            callSign,
            displayName,
            scope,
            recipientUserProfile: peer?.userProfile || null,
            text: '',
            replyTo: replyTarget?._id || null,
            attachment: {
                kind: 'image', storageName, mimeType: detected.mimeType, size: req.body.length
            }
        });
        return res.status(201).json({
            endpointVersion: '1.1',
            message: toChatMessage(message, access.role, userId)
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
        const ignoredUserIds = await getIgnoredUserIds(userId);
        if (!shouldDeliverMessage(message, userId, ignoredUserIds)) return sendError(res, 404, 'Image not found');
        const extension = IMAGE_TYPES[message.attachment.mimeType];
        if (!extension) return sendError(res, 404, 'Image not found');
        const data = await fs.promises.readFile(attachmentPath(message.attachment.storageName));
        res.set({
            'Content-Type': message.attachment.mimeType,
            'Content-Length': String(data.length),
            'Content-Disposition': `inline; filename="chat-image.${extension}"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'same-origin',
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
        if (!rateLimitAllows(userId)) return sendRateLimit(res);
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
        return res.json({ endpointVersion: '1.1', message: toChatMessage(message, access.role, userId) });
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
        const scope = messageScope(message);
        const participant = canViewMessage(message, userId);
        if (!participant) return sendError(res, 404, 'Message not found');
        if (!authorizeChatAction({ role: access.role, action: 'react', mine,
            deleted: Boolean(message.deletedAt), cleared: Boolean(message.clearedAt), scope, participant })) {
            return sendError(res, 409, 'Message is unavailable for reactions');
        }
        if (!rateLimitAllows(userId)) return sendRateLimit(res);
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
        return res.json({ endpointVersion: '1.1', message: toChatMessage(updated, access.role, userId) });
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
        const scope = messageScope(message);
        const participant = canViewMessage(message, userId);
        if (!participant) return sendError(res, 404, 'Message not found');
        if (!authorizeChatAction({ role: access.role, action: 'pin', mine,
            deleted: Boolean(message.deletedAt), cleared: Boolean(message.clearedAt), scope, participant })) {
            return sendError(res, 403, 'Only the NCO or Logger can pin messages');
        }
        if (!rateLimitAllows(userId)) return sendRateLimit(res);
        const pinned = typeof req.body?.pinned === 'boolean' ? req.body.pinned : !message.pinnedAt;
        message.pinnedAt = pinned ? new Date() : null;
        message.pinnedBy = pinned ? req.user._id : null;
        await message.save();
        return res.json({ endpointVersion: '1.1', message: toChatMessage(message, access.role, userId) });
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
        const scope = messageScope(message);
        const participant = canViewMessage(message, userId);
        if (!participant) return sendError(res, 404, 'Message not found');
        if (!authorizeChatAction({ role: access.role, action: 'ban', mine,
            deleted: Boolean(message.deletedAt), cleared: Boolean(message.clearedAt), scope, participant })) {
            return sendError(res, 403, 'Only the NCO can ban another chat participant');
        }
        if (!rateLimitAllows(userId)) return sendRateLimit(res);
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
        if (!rateLimitAllows(userId)) return sendRateLimit(res);
        const ChatMessage = getChatMessage();
        const query = { netProfile: req.params.id, clearedAt: null, ...PUBLIC_SCOPE_QUERY };
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

const CHAT_STREAM_COLLECTIONS = Object.freeze({
    messages: 'chatmessages',
    bans: 'chatbans',
    interactions: 'stationinteractions',
    profiles: 'userprofiles'
});

const openChatChangeStream = ({ db, netProfile, liveNet, currentUser, onMessage, onBan, onPresence,
    onPreference, onError }) => {
    const changeStream = db.watch([{
        $match: {
            $or: [
                { 'ns.coll': CHAT_STREAM_COLLECTIONS.messages, 'fullDocument.netProfile': netProfile },
                { 'ns.coll': CHAT_STREAM_COLLECTIONS.bans, 'fullDocument.netProfile': netProfile },
                { 'ns.coll': CHAT_STREAM_COLLECTIONS.interactions, 'fullDocument.liveNet': liveNet },
                { 'ns.coll': CHAT_STREAM_COLLECTIONS.profiles, 'documentKey._id': currentUser }
            ]
        }
    }], { fullDocument: 'updateLookup' });

    const handleChange = change => {
        switch (change.ns?.coll) {
            case CHAT_STREAM_COLLECTIONS.messages:
                if (change.fullDocument) onMessage(change.fullDocument);
                break;
            case CHAT_STREAM_COLLECTIONS.bans:
                if (change.fullDocument) onBan(change.fullDocument);
                break;
            case CHAT_STREAM_COLLECTIONS.interactions:
                if (change.fullDocument) onPresence(change.fullDocument);
                break;
            case CHAT_STREAM_COLLECTIONS.profiles:
                onPreference(change.fullDocument);
                break;
        }
    };

    changeStream.on('change', handleChange);
    changeStream.on('error', onError);
    let closed = false;

    return {
        async close() {
            if (closed) return;
            closed = true;
            changeStream.removeListener('change', handleChange);
            changeStream.removeListener('error', onError);
            await changeStream.close();
        }
    };
};

const streamEvents = async (req, res) => {
    let userId;
    let access;
    let ignoredUserIds;
    try {
        if (!req.user?._id) return sendError(res, 401, 'Authentication required');
        if (!isObjectId(req.params.id)) return sendError(res, 400, 'Invalid net identifier');
        userId = req.user._id.toString();
        access = await getNetAccess({ npid: req.params.id, userId });
        if (!access) return sendError(res, 403, 'Net access required');
        if (await isBanned({ npid: req.params.id, userId })) {
            return sendError(res, 403, 'Chat access has been suspended for this net');
        }
        ignoredUserIds = await getIgnoredUserIds(userId);
    } catch (err) {
        logger.error(`Local chat SSE authorization failed: ${err.message}`);
        return sendError(res, 500, 'Chat events are temporarily unavailable');
    }

    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    res.flushHeaders();
    const writeEvent = (event, data) => {
        if (res.writableEnded || res.destroyed) return false;
        return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let chatChangeSubscription = null;
    let disconnectTyping = null;
    let heartbeat = null;
    let cleanedUp = false;
    const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (heartbeat) clearInterval(heartbeat);
        disconnectTyping?.();
        if (chatChangeSubscription) {
            void chatChangeSubscription.close().catch(err => {
                logger.warn(`Local chat SSE cleanup failed: ${err.message}`);
            });
        }
    };
    req.once('close', cleanup);
    res.once('close', cleanup);
    try {
        disconnectTyping = chatTypingHub.connect({
            npid: req.params.id,
            userId,
            callSign: String(req.user.callSign || access.interaction?.callSign || '').trim().toUpperCase(),
            displayName: access.interaction?.displayName || '',
            ignoredUserIds,
            writeEvent
        });
        const netProfile = new mongoose.Types.ObjectId(req.params.id);
        const currentUserObjectId = new mongoose.Types.ObjectId(userId);
        const sendRecipients = async () => {
            try {
                const recipients = await listRecipientsForAccess({
                    access,
                    currentUserId: userId,
                    ignoredUserIds,
                    awayInMs: Number(res.locals?.flexOpts?.awayInMs) || 120000
                });
                writeEvent('recipients', recipients);
            } catch (err) {
                logger.warn(`Local chat recipient refresh failed: ${err.message}`);
            }
        };
        const changeStreamDb = await getChangeStreamDb();
        if (cleanedUp) return;
        chatChangeSubscription = openChatChangeStream({
            db: changeStreamDb,
            netProfile,
            liveNet: access.liveNet._id,
            currentUser: currentUserObjectId,
            onMessage: fullDocument => {
                const message = chatEventForViewer(fullDocument, access.role, userId, ignoredUserIds);
                if (message) writeEvent('message', message);
            },
            onBan: fullDocument => {
                if (fullDocument.userProfile?.toString() !== userId) return;
                writeEvent('access', {
                    suspended: true,
                    reason: fullDocument.reason || ''
                });
                res.end();
            },
            onPresence: interaction => {
                if (participantId(interaction?.userProfile) === userId && interaction.role !== access.role) {
                    // Reconnect so history and all server-derived UI permissions
                    // are serialized with the viewer's current role.
                    return res.end();
                }
                return void sendRecipients();
            },
            onPreference: fullDocument => {
                ignoredUserIds = new Set((fullDocument?.ignoredPrivateUsers || []).map(participantId).filter(Boolean));
                chatTypingHub.updateViewer(req.params.id, userId, { ignoredUserIds });
                writeEvent('preferences', { ignoredUserIds: [...ignoredUserIds] });
                void sendRecipients();
            },
            onError: err => {
                logger.warn(`Local chat SSE change stream closed: ${err.message}`);
                res.end();
            }
        });
    } catch (err) {
        logger.warn(`Local chat SSE unavailable: ${err.message}`);
        return res.end();
    }
    writeEvent('ready', { netProfile: req.params.id, userId });
    heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) res.write(': keep-alive\n\n');
    }, 25000);
};

async function* fetchChatHistory({ npid, since, db = mongoose.connection }) {
    if (!isObjectId(npid)) throw new Error('Malformed net profile identifier');
    const ChatMessage = getChatMessage(db);
    const query = { netProfile: npid, deletedAt: null, ...PUBLIC_SCOPE_QUERY };
    if (since) query.createdAt = { $gte: new Date(since) };
    const batchSize = 100;
    const maximum = Math.min(50000, Math.max(100, Number(process.env.CHAT_REPORT_MAX_MESSAGES) || 10000));
    const cursor = ChatMessage.find(query).sort({ createdAt: 1, _id: 1 }).limit(maximum).lean().cursor({ batchSize });
    let batch = [];
    for await (const message of cursor) {
        batch.push({
            username: message.callSign || message.displayName || 'Unknown',
            body: [message.text, message.attachment?.storageName ? '[Image attachment]' : ''].filter(Boolean).join(' '),
            createdAt: message.createdAt.toISOString(),
            reactions: summarizeReactions(message.reactions || [])
                .map(reaction => `${reaction.emoji} ${reaction.count}`).join(' '),
            edited: Boolean(message.editedAt)
        });
        if (batch.length === batchSize) {
            yield batch;
            batch = [];
        }
    }
    if (batch.length) yield batch;
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
    if (participantId(userIdToBan) === participantId(bannedByUserId)) {
        throw Object.assign(new Error('You cannot ban yourself from chat'), { status: 403 });
    }
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
    openChatChangeStream,
    fetchChatHistory,
    cleanupNetChat,
    banUserHelper,
    unbanUserHelper,
    getNetAccess,
    cleanMessage,
    toPublicMessage,
    toChatMessage,
    chatEventForViewer,
    canViewMessage,
    shouldDeliverMessage,
    isDirectParticipant,
    directConversationQuery,
    messageScope,
    authorizeChatAction,
    summarizeReactions,
    toggleReactionValue,
    QUICK_REACTIONS,
    detectImageType,
    attachmentPath,
    MAX_UPLOAD_BYTES,
    PUBLIC_HISTORY_LIMIT,
    IMAGE_TYPES,
    UPLOAD_DIR,
    PUBLIC_SCOPE_QUERY,
    DIRECT_SCOPE_QUERY,
    rateLimitAllows,
    chatFirstName,
    chatDisplayName,
    resolveChatDisplayName,
    ChatTypingHub,
    chatTypingHub,
    TYPING_TTL_MS,
    RATE_LIMIT_COUNT,
    RATE_LIMIT_WINDOW_MS
};
