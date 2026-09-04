const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const fs = require('fs');
const os = require('os');
const path = require('path');

const uri = process.env.TEST_MONGODB_URI;

test('net participants exchange, interact with, and moderate local chat', { skip: !uri }, async () => {
    let uploadDir;
    await mongoose.connect(uri);
    try {
    uploadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hamlive-chat-test-'));
    const { conf } = require('../server/dist/lib/configLib');
    conf.chat_upload_dir = uploadDir;
    conf.chat_max_upload_mb = 1;
    delete require.cache[require.resolve('../server/dist/lib/localChat')];
    const { getLiveNet } = require('../server/dist/models/liveNet');
    const { getStationInteraction } = require('../server/dist/models/stationInteraction');
    const { getChatMessage } = require('../server/dist/models/chatMessage');
    const { getUserProfile } = require('../server/dist/models/userProfile');
    const {
        createMessage, editMessage, uploadImage, deleteMessage, fetchChatHistory, toggleReaction,
        setMessagePin, banMessageAuthor, clearPublicChat, listMessages, listDirectMessages,
        setPrivateIgnore, serveImage, PUBLIC_SCOPE_QUERY, PUBLIC_HISTORY_LIMIT, RATE_LIMIT_COUNT
    } = require('../server/dist/lib/localChat');
    const userOne = new mongoose.Types.ObjectId();
    const userTwo = new mongoose.Types.ObjectId();
    const userNco = new mongoose.Types.ObjectId();
    const userOtherLogger = new mongoose.Types.ObjectId();
    const userRelay = new mongoose.Types.ObjectId();
    const netProfile = new mongoose.Types.ObjectId();
    const LiveNet = getLiveNet();
    const StationInteraction = getStationInteraction();
    const ChatMessage = getChatMessage();
    const UserProfile = getUserProfile();
    const liveNet = await LiveNet.create({
        netProfile, netControl: userOne, url: `/views/livenet/${netProfile}`, lookupTable: {}
    });
    await StationInteraction.create([
        { callSign: 'W1AAA', createdBy: 'user', role: 'netuser', userProfile: userOne, liveNet: liveNet._id, netProfile },
        { callSign: 'W1BBB', createdBy: 'user', role: 'netlogger', userProfile: userTwo, liveNet: liveNet._id, netProfile },
        { callSign: 'W1NCO', createdBy: 'user', role: 'netcontrol', userProfile: userNco, liveNet: liveNet._id, netProfile },
        { callSign: 'W1LOG', createdBy: 'user', role: 'netlogger', userProfile: userOtherLogger, liveNet: liveNet._id, netProfile },
        { callSign: 'W1RLY', createdBy: 'user', role: 'netrelay', userProfile: userRelay, liveNet: liveNet._id, netProfile }
    ]);
    await UserProfile.create([
        { _id: userOne, callSign: 'W1AAA', displayName: 'Alice', email: 'alice-phase3@example.com', lastAuthVia: 'email' },
        { _id: userTwo, callSign: 'W1BBB', displayName: 'Bobby', email: 'bob-phase3@example.com', lastAuthVia: 'email' },
        { _id: userNco, callSign: 'W1NCO', displayName: 'Net Control', email: 'nco-phase3@example.com', lastAuthVia: 'email' },
        { _id: userOtherLogger, callSign: 'W1LOG', displayName: 'Logger', email: 'logger-phase3@example.com', lastAuthVia: 'email' },
        { _id: userRelay, callSign: 'W1RLY', displayName: 'Relay', email: 'relay-phase4b@example.com', lastAuthVia: 'email' }
    ]);

    const invoke = async (handler, req) => {
        let status = 200;
        let payload;
        const headers = {};
        const res = {
            status(code) { status = code; return this; },
            json(body) { payload = body; return this; },
            set(name, value) {
                if (typeof name === 'object') Object.assign(headers, name);
                else headers[name] = value;
                return this;
            }
        };
        await handler(req, res);
        return { status, payload, headers };
    };
    const makeReq = (userId, callSign, displayName, body = {}) => ({
        params: { id: netProfile.toString() }, body,
        user: { _id: userId, callSign, displayName }
    });

    const change = new Promise((resolve, reject) => {
        const stream = ChatMessage.watch([{ $match: { operationType: 'insert' } }], { fullDocument: 'updateLookup' });
        const timer = setTimeout(() => { void stream.close(); reject(new Error('chat change stream timeout')); }, 5000);
        stream.once('change', event => { clearTimeout(timer); void stream.close(); resolve(event); });
    });
    const sent = await invoke(createMessage, makeReq(userOne, 'W1AAA', 'Alice', { text: '<b>Hello two</b>' }));
    assert.equal(sent.status, 201);
    assert.equal(sent.payload.message.text, 'Hello two');
    assert.equal((await change).fullDocument.callSign, 'W1AAA');

    const reply = await invoke(createMessage, makeReq(userTwo, 'W1BBB', 'Bob', {
        text: 'Reply received', replyTo: sent.payload.message.id
    }));
    assert.equal(reply.status, 201);
    assert.equal(reply.payload.message.replyTo, sent.payload.message.id);

    const reacted = await invoke(toggleReaction, {
        ...makeReq(userTwo, 'W1BBB', 'Bob', { emoji: '👍' }),
        params: { id: netProfile.toString(), messageId: sent.payload.message.id }
    });
    assert.equal(reacted.status, 200);
    assert.deepEqual(reacted.payload.message.reactions, [{ emoji: '👍', count: 1, reactedByMe: true }]);
    const unreacted = await invoke(toggleReaction, {
        ...makeReq(userTwo, 'W1BBB', 'Bob', { emoji: '👍' }),
        params: { id: netProfile.toString(), messageId: sent.payload.message.id }
    });
    assert.deepEqual(unreacted.payload.message.reactions, []);

    const pinned = await invoke(setMessagePin, {
        ...makeReq(userTwo, 'W1BBB', 'Bob', { pinned: true }),
        params: { id: netProfile.toString(), messageId: sent.payload.message.id }
    });
    assert.equal(pinned.status, 200);
    assert.equal(pinned.payload.message.pinned, true);
    assert.match(pinned.payload.message.pinnedAt, /^\d{4}-\d{2}-\d{2}T/);
    const forbiddenPin = await invoke(setMessagePin, {
        ...makeReq(userOne, 'W1AAA', 'Alice', { pinned: false }),
        params: { id: netProfile.toString(), messageId: sent.payload.message.id }
    });
    assert.equal(forbiddenPin.status, 403);
    const relayPin = await invoke(setMessagePin, {
        ...makeReq(userRelay, 'W1RLY', 'Relay', { pinned: false }),
        params: { id: netProfile.toString(), messageId: sent.payload.message.id }
    });
    assert.equal(relayPin.status, 403);

    const forbiddenBan = await invoke(banMessageAuthor, {
        ...makeReq(userTwo, 'W1BBB', 'Bob'),
        params: { id: netProfile.toString(), messageId: sent.payload.message.id }
    });
    assert.equal(forbiddenBan.status, 403);
    const relayBan = await invoke(banMessageAuthor, {
        ...makeReq(userRelay, 'W1RLY', 'Relay'),
        params: { id: netProfile.toString(), messageId: sent.payload.message.id }
    });
    assert.equal(relayBan.status, 403);

    const longCreate = await invoke(createMessage, makeReq(userOne, 'W1AAA', 'Alice', { text: 'x'.repeat(2001) }));
    assert.equal(longCreate.status, 400);

    const originalId = sent.payload.message.id;
    const originalCreatedAt = sent.payload.message.createdAt;
    const editedChange = new Promise((resolve, reject) => {
        const stream = ChatMessage.watch([{ $match: { operationType: 'update' } }], { fullDocument: 'updateLookup' });
        const timer = setTimeout(() => { void stream.close(); reject(new Error('chat edit stream timeout')); }, 5000);
        stream.once('change', event => { clearTimeout(timer); void stream.close(); resolve(event); });
    });
    const edited = await invoke(editMessage, {
        ...makeReq(userOne, 'W1AAA', 'Alice', { text: '  Updated hello  ' }),
        params: { id: netProfile.toString(), messageId: originalId }
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.payload.message.id, originalId);
    assert.equal(edited.payload.message.createdAt, originalCreatedAt);
    assert.equal(edited.payload.message.text, 'Updated hello');
    assert.ok(edited.payload.message.editedAt);
    assert.equal((await editedChange).fullDocument.text, 'Updated hello');

    const forbiddenEdit = await invoke(editMessage, {
        ...makeReq(userTwo, 'W1BBB', 'Bob', { text: 'Not mine' }),
        params: { id: netProfile.toString(), messageId: originalId }
    });
    assert.equal(forbiddenEdit.status, 403);

    const longEdit = await invoke(editMessage, {
        ...makeReq(userOne, 'W1AAA', 'Alice', { text: 'x'.repeat(2001) }),
        params: { id: netProfile.toString(), messageId: originalId }
    });
    assert.equal(longEdit.status, 400);

    const rejectedImage = await invoke(uploadImage, {
        ...makeReq(userOne, 'W1AAA', 'Alice'),
        body: Buffer.from('not-an-image'),
        get: header => header === 'content-type' ? 'image/png' : undefined
    });
    assert.equal(rejectedImage.status, 415);

    const oversizedImage = await invoke(uploadImage, {
        ...makeReq(userOne, 'W1AAA', 'Alice'),
        body: Buffer.alloc(1024 * 1024 + 1),
        get: header => header === 'content-type' ? 'image/png' : undefined
    });
    assert.equal(oversizedImage.status, 413);

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const imageSent = await invoke(uploadImage, {
        ...makeReq(userOne, 'W1AAA', 'Alice'),
        body: png,
        get: header => header === 'content-type' ? 'image/png' : undefined
    });
    assert.equal(imageSent.status, 201);
    assert.equal(imageSent.payload.message.attachment.mimeType, 'image/png');
    const imageDoc = await ChatMessage.findById(imageSent.payload.message.id);
    const imagePath = path.join(uploadDir, imageDoc.attachment.storageName);
    assert.equal((await fs.promises.stat(imagePath)).size, png.length);

    const imageEdited = await invoke(editMessage, {
        ...makeReq(userOne, 'W1AAA', 'Alice', { text: 'Weather map' }),
        params: { id: netProfile.toString(), messageId: imageSent.payload.message.id }
    });
    assert.equal(imageEdited.status, 200);
    assert.equal(imageEdited.payload.message.attachment.url, imageSent.payload.message.attachment.url);
    assert.equal(imageEdited.payload.message.text, 'Weather map');

    const history = [];
    for await (const batch of fetchChatHistory({ npid: netProfile.toString(), since: null })) history.push(...batch);
    assert.equal(history[0].body, 'Updated hello');
    assert.equal(history[0].edited, true);
    assert.equal(history.some(entry => entry.body === 'Weather map [Image attachment]'), true);

    const moderated = await invoke(deleteMessage, {
        ...makeReq(userOne, 'W1AAA', 'Alice'),
        params: { id: netProfile.toString(), messageId: sent.payload.message.id }
    });
    assert.equal(moderated.status, 200);
    assert.equal(moderated.payload.message.deleted, true);
    assert.equal(moderated.payload.message.text, '');
    assert.equal(moderated.payload.message.canEdit, false);

    const deletedEdit = await invoke(editMessage, {
        ...makeReq(userOne, 'W1AAA', 'Alice', { text: 'Restore me' }),
        params: { id: netProfile.toString(), messageId: sent.payload.message.id }
    });
    assert.equal(deletedEdit.status, 409);

    const forbiddenImageDelete = await invoke(deleteMessage, {
        ...makeReq(userTwo, 'W1BBB', 'Bob'),
        params: { id: netProfile.toString(), messageId: imageSent.payload.message.id }
    });
    assert.equal(forbiddenImageDelete.status, 403);
    const imageDeleted = await invoke(deleteMessage, {
        ...makeReq(userOne, 'W1AAA', 'Alice'),
        params: { id: netProfile.toString(), messageId: imageSent.payload.message.id }
    });
    assert.equal(imageDeleted.status, 200);
    assert.equal(imageDeleted.payload.message.attachment, null);
    await assert.rejects(fs.promises.access(imagePath));

    const directSent = await invoke(createMessage, {
        ...makeReq(userOne, 'W1AAA', 'Alice', { text: 'Private hello' }),
        params: { id: netProfile.toString(), userId: userTwo.toString() }
    });
    assert.equal(directSent.status, 201);
    assert.equal(directSent.payload.message.scope, 'direct');
    assert.equal(directSent.payload.message.recipientUserId, userTwo.toString());
    assert.equal(directSent.payload.message.canPin, false);
    assert.equal(Object.hasOwn(directSent.payload, 'ignored'), false);

    const directReply = await invoke(createMessage, {
        ...makeReq(userTwo, 'W1BBB', 'Bobby', { text: 'Private reply', replyTo: directSent.payload.message.id }),
        params: { id: netProfile.toString(), userId: userOne.toString() }
    });
    assert.equal(directReply.status, 201);
    assert.equal(directReply.payload.message.replyTo, directSent.payload.message.id);
    assert.equal(directReply.payload.message.scope, 'direct');

    await ChatMessage.collection.insertOne({
        liveNet: liveNet._id, netProfile, userProfile: userOne, recipientUserProfile: userTwo,
        callSign: 'W1AAA', displayName: 'Alice', text: 'Legacy private', reactions: [],
        createdAt: new Date(), updatedAt: new Date()
    });
    const publicIsolation = await invoke(listMessages, {
        ...makeReq(userNco, 'W1NCO', 'Net Control'),
        res: { locals: { flexOpts: { awayInMs: 120000 } } }
    });
    assert.equal(publicIsolation.payload.messages.some(message => message.text === 'Legacy private'), false);

    const privateHistory = await invoke(listDirectMessages, {
        ...makeReq(userTwo, 'W1BBB', 'Bobby'),
        params: { id: netProfile.toString(), userId: userOne.toString() }
    });
    assert.equal(privateHistory.status, 200);
    assert.deepEqual(privateHistory.payload.messages.map(message => message.text), [
        'Private hello', 'Private reply', 'Legacy private'
    ]);
    const unrelatedNcoHistory = await invoke(listDirectMessages, {
        ...makeReq(userNco, 'W1NCO', 'Net Control'),
        params: { id: netProfile.toString(), userId: userOne.toString() }
    });
    assert.deepEqual(unrelatedNcoHistory.payload.messages, []);
    const unrelatedLoggerHistory = await invoke(listDirectMessages, {
        ...makeReq(userOtherLogger, 'W1LOG', 'Logger'),
        params: { id: netProfile.toString(), userId: userOne.toString() }
    });
    assert.deepEqual(unrelatedLoggerHistory.payload.messages, []);
    const unrelatedUserHistory = await invoke(listDirectMessages, {
        ...makeReq(userRelay, 'W1RLY', 'Relay'),
        params: { id: netProfile.toString(), userId: userOne.toString() }
    });
    assert.deepEqual(unrelatedUserHistory.payload.messages, []);

    const unrelatedReaction = await invoke(toggleReaction, {
        ...makeReq(userNco, 'W1NCO', 'Net Control', { emoji: '👍' }),
        params: { id: netProfile.toString(), messageId: directSent.payload.message.id }
    });
    assert.equal(unrelatedReaction.status, 404);

    const directImage = await invoke(uploadImage, {
        ...makeReq(userOne, 'W1AAA', 'Alice'), body: png,
        params: { id: netProfile.toString(), userId: userTwo.toString() },
        get: header => header === 'content-type' ? 'image/png' : undefined
    });
    assert.equal(directImage.status, 201);
    const directImageDoc = await ChatMessage.findById(directImage.payload.message.id);
    const directImagePath = path.join(uploadDir, directImageDoc.attachment.storageName);
    const invokeImage = async (userId, callSign, requestedNet = netProfile.toString()) => {
        let status = 200;
        let payload;
        const headers = {};
        const res = {
            status(code) { status = code; return this; },
            json(body) { payload = body; return this; },
            set(values) { Object.assign(headers, values); return this; },
            send(body) { payload = body; return this; }
        };
        await serveImage({
            ...makeReq(userId, callSign, callSign),
            params: { id: requestedNet, messageId: directImage.payload.message.id }
        }, res);
        return { status, payload, headers };
    };
    assert.equal((await invokeImage(userOne, 'W1AAA')).status, 200);
    const recipientImage = await invokeImage(userTwo, 'W1BBB');
    assert.equal(recipientImage.status, 200);
    assert.equal(recipientImage.headers['Cache-Control'], 'private, no-store');
    assert.equal(recipientImage.headers['Cross-Origin-Resource-Policy'], 'same-origin');
    assert.equal((await invokeImage(userNco, 'W1NCO')).status, 404);
    assert.equal((await invokeImage(userOtherLogger, 'W1LOG')).status, 404);
    assert.equal((await invokeImage(userRelay, 'W1RLY')).status, 404);

    const invalidIgnore = await invoke(setPrivateIgnore, {
        ...makeReq(userTwo, 'W1BBB', 'Bobby', { ignored: 'false' }),
        params: { id: netProfile.toString(), userId: userOne.toString() }
    });
    assert.equal(invalidIgnore.status, 400);

    const ignored = await invoke(setPrivateIgnore, {
        ...makeReq(userTwo, 'W1BBB', 'Bobby', { ignored: true }),
        params: { id: netProfile.toString(), userId: userOne.toString() }
    });
    assert.equal(ignored.payload.ignored, true);
    const ownerProfile = await UserProfile.findById(userOne).lean();
    const ignoringProfile = await UserProfile.findById(userTwo).lean();
    assert.deepEqual((ownerProfile.ignoredPrivateUsers || []).map(String), []);
    assert.deepEqual((ignoringProfile.ignoredPrivateUsers || []).map(String), [userOne.toString()]);
    const ignoredHistory = await invoke(listDirectMessages, {
        ...makeReq(userTwo, 'W1BBB', 'Bobby'),
        params: { id: netProfile.toString(), userId: userOne.toString() }
    });
    assert.deepEqual(ignoredHistory.payload.messages.map(message => message.text), ['Private reply']);
    assert.equal((await invokeImage(userTwo, 'W1BBB')).status, 404);
    const publicWhileIgnored = await invoke(listMessages, {
        ...makeReq(userTwo, 'W1BBB', 'Bobby'),
        res: { locals: { flexOpts: { awayInMs: 120000 } } }
    });
    assert.equal(publicWhileIgnored.payload.messages.some(message => message.callSign === 'W1AAA'), true);
    const unignored = await invoke(setPrivateIgnore, {
        ...makeReq(userTwo, 'W1BBB', 'Bobby', { ignored: false }),
        params: { id: netProfile.toString(), userId: userOne.toString() }
    });
    assert.equal(unignored.payload.ignored, false);
    assert.equal((await invokeImage(userTwo, 'W1BBB')).status, 200);
    const forbiddenDirectEdit = await invoke(editMessage, {
        ...makeReq(userTwo, 'W1BBB', 'Bobby', { text: 'Not my private message' }),
        params: { id: netProfile.toString(), messageId: directSent.payload.message.id }
    });
    assert.equal(forbiddenDirectEdit.status, 403);
    const editedDirect = await invoke(editMessage, {
        ...makeReq(userOne, 'W1AAA', 'Alice', { text: 'Private hello edited' }),
        params: { id: netProfile.toString(), messageId: directSent.payload.message.id }
    });
    assert.equal(editedDirect.status, 200);
    assert.equal(editedDirect.payload.message.scope, 'direct');
    const deletedDirectReply = await invoke(deleteMessage, {
        ...makeReq(userTwo, 'W1BBB', 'Bobby'),
        params: { id: netProfile.toString(), messageId: directReply.payload.message.id }
    });
    assert.equal(deletedDirectReply.status, 200);
    assert.equal(deletedDirectReply.payload.message.deleted, true);

    const ncoMessage = await invoke(createMessage, makeReq(userNco, 'W1NCO', 'Net Control', { text: 'NCO note' }));
    const selfBan = await invoke(banMessageAuthor, {
        ...makeReq(userNco, 'W1NCO', 'Net Control'),
        params: { id: netProfile.toString(), messageId: ncoMessage.payload.message.id }
    });
    assert.equal(selfBan.status, 403);

    const banTarget = await invoke(createMessage, makeReq(userTwo, 'W1BBB', 'Bob', { text: 'Ban target' }));
    const banned = await invoke(banMessageAuthor, {
        ...makeReq(userNco, 'W1NCO', 'Net Control', { reason: 'Test moderation' }),
        params: { id: netProfile.toString(), messageId: banTarget.payload.message.id }
    });
    assert.equal(banned.status, 200);
    assert.equal(banned.payload.callSign, 'W1BBB');
    const bannedSend = await invoke(createMessage, makeReq(userTwo, 'W1BBB', 'Bob', { text: 'Blocked' }));
    assert.equal(bannedSend.status, 403);

    const forbiddenClear = await invoke(clearPublicChat, makeReq(userOne, 'W1AAA', 'Alice'));
    assert.equal(forbiddenClear.status, 403);
    const loggerClear = await invoke(clearPublicChat, makeReq(userOtherLogger, 'W1LOG', 'Logger'));
    assert.equal(loggerClear.status, 403);
    const relayClear = await invoke(clearPublicChat, makeReq(userRelay, 'W1RLY', 'Relay'));
    assert.equal(relayClear.status, 403);
    const otherNetProfile = new mongoose.Types.ObjectId();
    const otherLiveNet = await LiveNet.create({
        netProfile: otherNetProfile, netControl: userOne,
        url: `/views/livenet/${otherNetProfile}`, lookupTable: {}
    });
    await StationInteraction.create({
        callSign: 'W1AAA', createdBy: 'user', role: 'netcontrol', userProfile: userOne,
        liveNet: otherLiveNet._id, netProfile: otherNetProfile
    });
    const otherMessage = await ChatMessage.create({
        liveNet: otherLiveNet._id, netProfile: otherNetProfile, userProfile: userOne,
        callSign: 'W1AAA', displayName: 'Alice', text: 'Other net must remain'
    });
    const crossNetHistory = await invoke(listMessages, {
        ...makeReq(userOne, 'W1AAA', 'Alice'),
        res: { locals: { flexOpts: { awayInMs: 120000 } } }
    });
    assert.equal(crossNetHistory.payload.messages.some(message => message.text === 'Other net must remain'), false);
    assert.equal((await invokeImage(userOne, 'W1AAA', otherNetProfile.toString())).status, 404);
    await invoke(setPrivateIgnore, {
        ...makeReq(userTwo, 'W1BBB', 'Bobby', { ignored: true }),
        params: { id: netProfile.toString(), userId: userOne.toString() }
    });
    const cleared = await invoke(clearPublicChat, makeReq(userNco, 'W1NCO', 'Net Control'));
    assert.equal(cleared.status, 200);
    assert.equal(cleared.payload.cleared, true);
    assert.equal(await ChatMessage.countDocuments({
        netProfile, clearedAt: null, ...PUBLIC_SCOPE_QUERY
    }), 0);
    assert.equal(await ChatMessage.countDocuments({
        netProfile,
        $or: [{ scope: 'direct' }, { scope: { $exists: false }, recipientUserProfile: { $ne: null } }],
        clearedAt: null
    }), 4);
    assert.equal((await fs.promises.stat(directImagePath)).size, png.length);
    assert.equal((await ChatMessage.findById(otherMessage._id)).text, 'Other net must remain');
    assert.deepEqual((await UserProfile.findById(userTwo).lean()).ignoredPrivateUsers.map(String), [userOne.toString()]);

    const historyStartedAt = Date.now();
    const publicHistoryDocs = Array.from({ length: 1020 }, (_value, index) => ({
        _id: new mongoose.Types.ObjectId(), liveNet: liveNet._id, netProfile, userProfile: userNco,
        scope: 'public', recipientUserProfile: null, callSign: 'W1NCO', displayName: 'Net Control',
        text: `bounded-public-${index}`, reactions: [],
        createdAt: new Date(historyStartedAt + index), updatedAt: new Date(historyStartedAt + index)
    }));
    const directHistoryDocs = Array.from({ length: 1020 }, (_value, index) => ({
        _id: new mongoose.Types.ObjectId(), liveNet: liveNet._id, netProfile, userProfile: userTwo,
        scope: 'direct', recipientUserProfile: userOne, callSign: 'W1BBB', displayName: 'Bobby',
        text: `bounded-direct-${index}`, reactions: [],
        createdAt: new Date(historyStartedAt + 1000 + index), updatedAt: new Date(historyStartedAt + 1000 + index)
    }));
    await ChatMessage.collection.insertMany([...publicHistoryDocs, ...directHistoryDocs]);
    const boundedHistory = await invoke(listMessages, {
        ...makeReq(userOne, 'W1AAA', 'Alice'),
        res: { locals: { flexOpts: { awayInMs: 120000 } } }
    });
    assert.equal(PUBLIC_HISTORY_LIMIT, 1000);
    assert.equal(boundedHistory.payload.messages.length, PUBLIC_HISTORY_LIMIT);
    assert.equal(boundedHistory.payload.messages[0].text, 'bounded-public-20');
    assert.equal(boundedHistory.payload.messages[999].text, 'bounded-public-1019');
    assert.equal(boundedHistory.payload.messages.every((message, index, messages) =>
        index === 0 || messages[index - 1].createdAt <= message.createdAt), true);
    assert.equal(await ChatMessage.countDocuments({ netProfile, clearedAt: null, ...PUBLIC_SCOPE_QUERY }), 1020);
    assert.ok(await ChatMessage.exists({ _id: publicHistoryDocs[0]._id }));
    assert.equal((await ChatMessage.findById(otherMessage._id)).text, 'Other net must remain');
    assert.equal(boundedHistory.payload.messages.some(message => message.text === 'Other net must remain'), false);
    assert.equal(boundedHistory.payload.directMessages.length, 1000);
    assert.equal(boundedHistory.payload.directMessages[0].text, 'bounded-direct-20');
    const boundedDirectHistory = await invoke(listDirectMessages, {
        ...makeReq(userOne, 'W1AAA', 'Alice'),
        params: { id: netProfile.toString(), userId: userTwo.toString() }
    });
    assert.equal(boundedDirectHistory.payload.messages.length, 500);
    assert.equal(boundedDirectHistory.payload.messages[0].text, 'bounded-direct-520');

    for (let index = 0; index < RATE_LIMIT_COUNT; index += 1) {
        const reaction = await invoke(toggleReaction, {
            ...makeReq(userRelay, 'W1RLY', 'Relay', { emoji: '👍' }),
            params: { id: netProfile.toString(), messageId: publicHistoryDocs[1019]._id.toString() }
        });
        assert.equal(reaction.status, 200);
    }
    const limitedReaction = await invoke(toggleReaction, {
        ...makeReq(userRelay, 'W1RLY', 'Relay', { emoji: '👍' }),
        params: { id: netProfile.toString(), messageId: publicHistoryDocs[1019]._id.toString() }
    });
    assert.equal(limitedReaction.status, 429);
    assert.equal(limitedReaction.payload.error, 'Please wait before trying more chat actions');
    assert.ok(Number(limitedReaction.headers['Retry-After']) >= 1);

    } finally {
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
        if (uploadDir) await fs.promises.rm(uploadDir, { recursive: true, force: true });
    }
});
