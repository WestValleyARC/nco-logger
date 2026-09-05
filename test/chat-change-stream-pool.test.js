/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { BSON, ObjectId } = require('mongodb');
const { openChatChangeStream } = require('../server/dist/lib/localChat');
const { toChangeStreamObjectId } = require('../server/dist/lib/changeStreamClient');

const root = path.resolve(__dirname, '..');

class FakeChangeStream extends EventEmitter {
    closeCalls = 0;

    async close() {
        this.closeCalls++;
    }
}

class FakeDb {
    streams = [];
    calls = [];

    watch(pipeline, options) {
        const stream = new FakeChangeStream();
        this.streams.push(stream);
        this.calls.push({ pipeline, options });
        return stream;
    }
}

const callbacks = events => ({
    onMessage: value => events.push(['message', value]),
    onBan: value => events.push(['ban', value]),
    onPresence: value => events.push(['presence', value]),
    onPreference: value => events.push(['preference', value]),
    onError: value => events.push(['error', value])
});

const open = (db, events = []) => openChatChangeStream({
    db,
    netProfile: 'net-id',
    liveNet: 'live-net-id',
    currentUser: 'user-id',
    ...callbacks(events)
});

test('Mongoose ObjectIds are converted at the MongoDB-driver change-stream boundary', () => {
    const mongooseId = new mongoose.Types.ObjectId();
    const changeStreamId = toChangeStreamObjectId(mongooseId);
    const db = new FakeDb();

    assert.throws(() => BSON.serialize({ id: mongooseId }), /Unsupported BSON version/);
    assert.doesNotThrow(() => BSON.serialize({ id: changeStreamId }));
    assert.ok(changeStreamId instanceof ObjectId);
    assert.equal(changeStreamId.toHexString(), mongooseId.toHexString());
    assert.notEqual(changeStreamId.constructor, mongooseId.constructor);

    openChatChangeStream({
        db,
        netProfile: changeStreamId,
        liveNet: toChangeStreamObjectId(new mongoose.Types.ObjectId()),
        currentUser: toChangeStreamObjectId(new mongoose.Types.ObjectId()),
        ...callbacks([])
    });
    const filterValues = db.calls[0].pipeline[0].$match.$or.map(filter => Object.values(filter)[1]);
    assert.equal(filterValues.length, 4);
    assert.ok(filterValues.every(value => value instanceof ObjectId));
    assert.doesNotThrow(() => BSON.serialize({ pipeline: db.calls[0].pipeline }));
});

test('multiple chat SSE clients share one database and allocate one filtered stream each', () => {
    const db = new FakeDb();
    const clients = Array.from({ length: 6 }, () => open(db));

    assert.equal(clients.length, 6);
    assert.equal(db.streams.length, 6);
    for (const call of db.calls) {
        assert.deepEqual(call.options, { fullDocument: 'updateLookup' });
        const serialized = JSON.stringify(call.pipeline);
        for (const collection of ['chatmessages', 'chatbans', 'stationinteractions', 'userprofiles']) {
            assert.match(serialized, new RegExp(collection));
        }
    }
});

test('one chat stream preserves message, ban, presence, and profile event delivery', () => {
    const db = new FakeDb();
    const events = [];
    open(db, events);
    const stream = db.streams[0];

    stream.emit('change', { ns: { coll: 'chatmessages' }, fullDocument: { text: 'hello' } });
    stream.emit('change', { ns: { coll: 'chatbans' }, fullDocument: { reason: 'test' } });
    stream.emit('change', { ns: { coll: 'stationinteractions' }, fullDocument: { callSign: 'W1ABC' } });
    stream.emit('change', { ns: { coll: 'userprofiles' }, fullDocument: { ignoredPrivateUsers: [] } });

    assert.deepEqual(events.map(([event]) => event), ['message', 'ban', 'presence', 'preference']);
});

test('disconnect cleanup is idempotent and removes stream listeners', async () => {
    const db = new FakeDb();
    const subscription = open(db);
    const stream = db.streams[0];

    await subscription.close();
    await subscription.close();

    assert.equal(stream.closeCalls, 1);
    assert.equal(stream.listenerCount('change'), 0);
    assert.equal(stream.listenerCount('error'), 0);
});

test('reconnect does not leave duplicate stream listeners active', async () => {
    const db = new FakeDb();
    const events = [];
    const first = open(db, events);
    const firstStream = db.streams[0];
    await first.close();
    open(db, events);
    const secondStream = db.streams[1];

    firstStream.emit('change', { ns: { coll: 'chatmessages' }, fullDocument: { text: 'stale' } });
    secondStream.emit('change', { ns: { coll: 'chatmessages' }, fullDocument: { text: 'current' } });

    assert.deepEqual(events, [['message', { text: 'current' }]]);
});

test('chat watchers and normal API models are wired to separate connection modules', () => {
    const chat = fs.readFileSync(path.join(root, 'server/dist/lib/localChat.js'), 'utf8');
    const realtime = fs.readFileSync(path.join(root, 'server/src/lib/realtimeClients.ts'), 'utf8');
    const connection = fs.readFileSync(path.join(root, 'server/src/lib/changeStreamClient.ts'), 'utf8');

    assert.match(chat, /getChangeStreamDb/);
    assert.match(chat, /db\.watch\(/);
    assert.doesNotMatch(chat, /(?:ChatMessage|ChatBan|StationInteraction|UserProfile)\.watch\(/);
    assert.match(realtime, /getChangeStreamDb/);
    assert.equal((connection.match(/new MongoClient\(/g) || []).length, 1);
    assert.match(connection, /maxPoolSize:\s*conf\.change_stream_poolsize/);
});
