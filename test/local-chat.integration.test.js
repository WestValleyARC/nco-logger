const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const fs = require('fs');
const os = require('os');
const path = require('path');

const uri = process.env.TEST_MONGODB_URI;

test('two net users exchange, stream, retrieve, and moderate local chat', { skip: !uri }, async () => {
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
    const { createMessage, editMessage, uploadImage, deleteMessage, fetchChatHistory } = require('../server/dist/lib/localChat');
    const userOne = new mongoose.Types.ObjectId();
    const userTwo = new mongoose.Types.ObjectId();
    const netProfile = new mongoose.Types.ObjectId();
    const LiveNet = getLiveNet();
    const StationInteraction = getStationInteraction();
    const ChatMessage = getChatMessage();
    const liveNet = await LiveNet.create({
        netProfile, netControl: userOne, url: `/views/livenet/${netProfile}`, lookupTable: {}
    });
    await StationInteraction.create([
        { callSign: 'W1AAA', createdBy: 'user', role: 'netuser', userProfile: userOne, liveNet: liveNet._id, netProfile },
        { callSign: 'W1BBB', createdBy: 'user', role: 'netlogger', userProfile: userTwo, liveNet: liveNet._id, netProfile }
    ]);

    const invoke = async (handler, req) => {
        let status = 200;
        let payload;
        const res = { status(code) { status = code; return this; }, json(body) { payload = body; return this; } };
        await handler(req, res);
        return { status, payload };
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

    const imageDeleted = await invoke(deleteMessage, {
        ...makeReq(userTwo, 'W1BBB', 'Bob'),
        params: { id: netProfile.toString(), messageId: imageSent.payload.message.id }
    });
    assert.equal(imageDeleted.status, 200);
    assert.equal(imageDeleted.payload.message.attachment, null);
    await assert.rejects(fs.promises.access(imagePath));

    } finally {
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
        if (uploadDir) await fs.promises.rm(uploadDir, { recursive: true, force: true });
    }
});
