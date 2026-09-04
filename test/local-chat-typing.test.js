const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const localChat = require('../server/dist/lib/localChat');
const connect = (hub, npid, userId, ignoredUserIds = new Set()) => {
    const events = [];
    const disconnect = hub.connect({
        npid, userId, callSign: userId.toUpperCase(), displayName: '', ignoredUserIds,
        writeEvent: (name, data) => events.push({ name, data })
    });
    return { events, disconnect };
};

test('typing hub scopes public and private events and honors ignores', () => {
    const hub = new localChat.ChatTypingHub({ setTimer: () => 1, clearTimer: () => {} });
    const sender = connect(hub, 'net-a', 'sender');
    const peer = connect(hub, 'net-a', 'peer');
    const ignored = connect(hub, 'net-a', 'ignored', new Set(['sender']));
    const otherNet = connect(hub, 'net-b', 'other');

    hub.set({ npid: 'net-a', userId: 'sender', callSign: 'K7ABC', displayName: '', recipientUserId: null, active: true });
    assert.equal(sender.events.length, 0);
    assert.equal(peer.events.length, 1);
    assert.equal(ignored.events.length, 1);
    assert.equal(otherNet.events.length, 0);

    peer.events.length = 0;
    ignored.events.length = 0;
    hub.set({ npid: 'net-a', userId: 'sender', callSign: 'K7ABC', displayName: '', recipientUserId: 'peer', active: true });
    assert.equal(peer.events.length, 1);
    assert.equal(ignored.events.length, 0);
    hub.set({ npid: 'net-a', userId: 'sender', callSign: 'K7ABC', displayName: '', recipientUserId: 'ignored', active: true });
    assert.equal(ignored.events.length, 0);
});

test('typing hub retains simultaneous public typists and expires stale state', () => {
    let now = 1000;
    const hub = new localChat.ChatTypingHub({ now: () => now, setTimer: () => 1, clearTimer: () => {} });
    connect(hub, 'net-a', 'first');
    connect(hub, 'net-a', 'second');
    const viewer = connect(hub, 'net-a', 'viewer');
    hub.set({ npid: 'net-a', userId: 'first', callSign: 'K7ABC', displayName: '', recipientUserId: null, active: true });
    hub.set({ npid: 'net-a', userId: 'second', callSign: 'W1XYZ', displayName: '', recipientUserId: null, active: true });
    assert.equal(hub.states.size, 2);

    now += localChat.TYPING_TTL_MS;
    hub.expire();
    assert.equal(hub.states.size, 0);
    assert.equal(viewer.events.filter(event => !event.data.active).length, 2);
});

test('last sender disconnect clears typing without waiting for a missed stop', () => {
    const hub = new localChat.ChatTypingHub({ setTimer: () => 1, clearTimer: () => {} });
    const sender = connect(hub, 'net-a', 'sender');
    const viewer = connect(hub, 'net-a', 'viewer');
    hub.set({ npid: 'net-a', userId: 'sender', callSign: 'K7ABC', displayName: '', recipientUserId: null, active: true });
    sender.disconnect();
    assert.equal(hub.states.size, 0);
    assert.equal(viewer.events.at(-1).data.active, false);
});

test('typing implementation stays ephemeral and outside logger realtime pushes', () => {
    const server = fs.readFileSync(path.join(root, 'server/dist/lib/localChat.js'), 'utf8');
    const handler = server.slice(server.indexOf('const setTypingState'), server.indexOf('const isBanned'));
    assert.doesNotMatch(handler, /mongoose|\.findOne|\.findById|\.create\(|\.updateOne|\.watch\(|realtimeClients|\.push\(/);
    assert.match(server, /writeEvent\('typing', state\)/);
});

test('typing indicator implements compact one, two, and several participant wording', () => {
    const client = fs.readFileSync(path.join(root, 'client/src/public/js/lib/chat.ts'), 'utf8');
    assert.match(client, /callSigns\.length === 1[\s\S]*is typing…/);
    assert.match(client, /callSigns\.length === 2[\s\S]*and \$\{callSigns\[1\]\} are typing…/);
    assert.match(client, /callSigns\.length - 2\} others are typing…/);
});
