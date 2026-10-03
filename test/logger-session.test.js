/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const loadSession = () => import(pathToFileURL(path.resolve(
    __dirname, '../client/dist/public/js/lib/loggerSession.js'
)).href);
const npid = '507f1f77bcf86cd799439011';
const stateKey = `ncs-helper:${npid}`;
const sessionKey = `ncs-helper:session:${npid}`;
const firstNet = '2026-10-01T01:00:00.000Z';
const secondNet = '2026-10-02T01:00:00.000Z';
const tags = ['mobile', 'portable', 'shortTime', 'specialGuest', 'neededNext',
    'notResponding', 'skipped', 'inOut', 'recheck', 'pendingRole'];

function storageWith(entries = {}) {
    const data = new Map(Object.entries(entries));
    return {
        getItem: key => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: key => data.delete(key)
    };
}

function taggedState() {
    return {
        details: {
            W1ABC: { ...Object.fromEntries(tags.map(tag => [tag, true])),
                tags: { mobile: true }, name: 'Alex', location: 'Phoenix, AZ', note: 'Private note' },
            K7XYZ: { shortTime: true, qrzPhoto: 'https://example.com/photo.jpg' }
        },
        ioCalls: ['W1ABC'], recheckCalls: ['K7XYZ'], sharedUpdatedAt: 123,
        moduleLayout: { active: { x: 0, y: 0 } }
    };
}

function assertCleared(storage) {
    const state = JSON.parse(storage.getItem(stateKey));
    for (const details of Object.values(state.details)) {
        for (const tag of tags) assert.equal(details[tag], undefined);
        assert.equal(details.tags, undefined);
    }
    assert.deepEqual(state.ioCalls, []);
    assert.deepEqual(state.recheckCalls, []);
    assert.equal(state.sharedUpdatedAt, 0);
    assert.equal(state.details.W1ABC.name, 'Alex');
    assert.equal(state.details.W1ABC.location, 'Phoenix, AZ');
    assert.equal(state.details.W1ABC.note, 'Private note');
    assert.equal(state.details.K7XYZ.qrzPhoto, 'https://example.com/photo.jpg');
    assert.deepEqual(state.moduleLayout, taggedState().moduleLayout);
}

test('net close clears all session statuses without removing profiles or preferences', async () => {
    const { clearLoggerSession } = await loadSession();
    const storage = storageWith({
        [stateKey]: JSON.stringify(taggedState()), [sessionKey]: firstNet,
        'ncs-helper:layout': '{"font":"large"}',
        'ncs-helper:shared-profiles': '{"W1ABC":{"name":"Alex"}}',
        'ncs-helper:another-net': '{"details":{"W1ABC":{"mobile":true}}}'
    });
    clearLoggerSession(storage, npid);
    assertCleared(storage);
    assert.equal(storage.getItem(sessionKey), null);
    assert.equal(storage.getItem('ncs-helper:layout'), '{"font":"large"}');
    assert.equal(storage.getItem('ncs-helper:shared-profiles'), '{"W1ABC":{"name":"Alex"}}');
    assert.equal(storage.getItem('ncs-helper:another-net'), '{"details":{"W1ABC":{"mobile":true}}}');
});

test('a later net clears cached statuses even when the browser missed net close', async () => {
    const { prepareLoggerSession } = await loadSession();
    const storage = storageWith({ [stateKey]: JSON.stringify(taggedState()), [sessionKey]: firstNet });
    prepareLoggerSession(storage, npid, secondNet);
    assertCleared(storage);
    assert.equal(storage.getItem(sessionKey), secondNet);
});

test('reloads in the same live net retain assigned statuses', async () => {
    const { prepareLoggerSession } = await loadSession();
    const saved = JSON.stringify(taggedState());
    const storage = storageWith({ [stateKey]: saved, [sessionKey]: firstNet });
    prepareLoggerSession(storage, npid, new Date(firstNet));
    assert.equal(storage.getItem(stateKey), saved);
});

test('legacy unscoped statuses are cleared on first session initialization', async () => {
    const { prepareLoggerSession } = await loadSession();
    const storage = storageWith({ [stateKey]: JSON.stringify(taggedState()) });
    prepareLoggerSession(storage, npid, firstNet);
    assertCleared(storage);
    const saved = JSON.stringify(taggedState());
    storage.setItem(stateKey, saved);
    prepareLoggerSession(storage, npid, firstNet);
    assert.equal(storage.getItem(stateKey), saved);
});

test('missing and malformed browser state do not prevent session initialization', async () => {
    const { prepareLoggerSession } = await loadSession();
    for (const raw of [null, 'invalid JSON', 'null', '[]', '42']) {
        const storage = storageWith(raw === null ? {} : { [stateKey]: raw });
        prepareLoggerSession(storage, npid, firstNet);
        assert.equal(storage.getItem(stateKey), null);
        assert.equal(storage.getItem(sessionKey), firstNet);
    }
});

test('logger startup waits for session preparation before loading cached statuses', () => {
    const source = fs.readFileSync(path.resolve(
        __dirname, '../client/src/public/js/byView/liveNet/main.ts'
    ), 'utf8');
    assert.match(source, /new LoggerSessionReactiveStore\(liveNetEndpoint, NPID\.toString\(\)\)/);
    assert.ok(source.indexOf('await liveNetStore.loggerReady;') < source.indexOf('await import(`./ncoLogger.js'));
    const stores = fs.readFileSync(path.resolve(__dirname, '../client/src/public/js/lib/stores.ts'), 'utf8');
    assert.match(stores, /this\.onNetClose\(\);\s*window\.location\.href = '\/'/);
});

test('session store prepares once, clears on close, and tolerates disabled storage', async t => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    t.after(() => {
        globalThis.document = originalDocument;
        globalThis.window = originalWindow;
    });
    t.mock.method(console, 'table', () => {});
    globalThis.document = { querySelector: () => ({ dataset: {
        nodeEnv: 'production', app: 'logger', view: 'liveNet',
        cmdHelpUrl: '', logLevel: 'info', ts: String(Date.now())
    } }) };
    const storage = storageWith({ [stateKey]: JSON.stringify(taggedState()) });
    globalThis.window = { localStorage: storage };
    const { LoggerSessionReactiveStore } = await import(pathToFileURL(path.resolve(
        __dirname, '../client/dist/public/js/lib/loggerSessionStore.js'
    )).href);
    function makeStore() {
        const store = new LoggerSessionReactiveStore({}, npid);
        store.client = Promise.resolve({ callSign: 'N0NCO', level: 0 });
        store.stations.process = () => {};
        Object.defineProperty(store, 'mainCache', { value: { net: { createdAt: firstNet } } });
        return store;
    }
    const store = makeStore();
    await store.newData();
    await store.loggerReady;
    assertCleared(storage);
    storage.setItem(stateKey, JSON.stringify(taggedState()));
    await store.newData();
    assert.equal(JSON.parse(storage.getItem(stateKey)).details.W1ABC.mobile, true);
    store.onNetClose();
    assertCleared(storage);
    const restricted = makeStore();
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage disabled'); } });
    await restricted.newData();
    await restricted.loggerReady;
    assert.doesNotThrow(() => restricted.onNetClose());
});
