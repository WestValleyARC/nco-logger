const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const uri = process.env.TEST_MONGODB_URI;

test('two net users exchange, stream, retrieve, and moderate local chat', { skip: !uri }, async () => {
    await mongoose.connect(uri);
    try {
    const { getLiveNet } = require('../server/dist/models/liveNet');
    const { getStationInteraction } = require('../server/dist/models/stationInteraction');
    const { getChatMessage } = require('../server/dist/models/chatMessage');
    const { createMessage, deleteMessage, fetchChatHistory } = require('../server/dist/lib/localChat');
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

    const history = [];
    for await (const batch of fetchChatHistory({ npid: netProfile.toString(), since: null })) history.push(...batch);
    assert.equal(history[0].body, 'Hello two');

    const moderated = await invoke(deleteMessage, {
        ...makeReq(userTwo, 'W1BBB', 'Bob'),
        params: { id: netProfile.toString(), messageId: sent.payload.message.id }
    });
    assert.equal(moderated.status, 200);
    assert.equal(moderated.payload.message.deleted, true);
    assert.equal(moderated.payload.message.text, '');

    } finally {
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
});
