const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { conf } = require('../server/dist/lib/configLib');
const { qrzLookup, resetQrzSessionForTests } = require('../server/dist/lib/serverUtils');

const options = { qrzSessionReqTimeoutMs: 100, qrzDataReqTimeoutMs: 100, qrzReqQuota: 100 };
const authXml = (key = 'SESSION') => `<QRZDatabase><Session><Key>${key}</Key><Count>1</Count></Session></QRZDatabase>`;
const lookupXml = (body = '<Callsign><name_fmt>Alex Smith</name_fmt><addr2>Phoenix</addr2><state>AZ</state><country>United States</country><lat>33.4</lat><lon>-112.1</lon></Callsign><Session><Key>SESSION</Key><Count>2</Count>') => `<QRZDatabase>${body}</QRZDatabase>`;

const fakeDb = records => ({
    model: () => ({
        findOne: async ({ callSign }) => {
            const record = records.get(callSign);
            if (!record) return null;
            return {
                ...record,
                toObject: () => record,
                deleteOne: async () => records.delete(callSign)
            };
        },
        findOneAndUpdate: async ({ callSign }, value) => {
            const record = { ...value, updatedAt: new Date() };
            records.set(callSign, record);
            return record;
        }
    })
});

const configure = () => {
    conf.qrz_username = 'club-user';
    conf.qrz_password = 'p&ss?word=works';
    conf.qrz_endpoint = 'https://xmldata.qrz.com/xml/';
    conf.qrz_version = 1.34;
    conf.qrz_cache_ttl_hours = 168;
    resetQrzSessionForTests();
};

test.beforeEach(configure);

test('successful authentication and lookup safely encode special characters', async t => {
    const calls = [];
    t.mock.method(axios, 'get', async url => {
        calls.push(url);
        return { data: calls.length === 1 ? authXml() : lookupXml() };
    });
    const result = await qrzLookup('w1abc', options, fakeDb(new Map()));
    assert.equal(result.result.callSign, 'W1ABC');
    assert.equal(result.result.location, 'Phoenix, AZ');
    assert.equal(result.outcome, 'success');
    assert.equal(new URL(calls[0]).searchParams.get('password'), conf.qrz_password);
    assert.ok(!calls[0].includes(conf.qrz_password));
});

test('cache hit avoids QRZ network calls', async t => {
    const get = t.mock.method(axios, 'get', async () => { throw new Error('should not run'); });
    const records = new Map([['W1ABC', { callSign: 'W1ABC', displayName: 'Alex', location: 'Phoenix, AZ', updatedAt: new Date(), geo: { coordinates: [-112.1, 33.4] } }]]);
    const result = await qrzLookup('W1ABC', options, fakeDb(records));
    assert.equal(result.result.displayName, 'Alex');
    assert.equal(result.outcome, 'success-cache');
    assert.equal(get.mock.callCount(), 0);
});

test('expired session authenticates again and retries lookup', async t => {
    let call = 0;
    t.mock.method(axios, 'get', async () => {
        call++;
        if (call === 1) return { data: authXml('OLD') };
        if (call === 2) return { data: lookupXml('<Session><Error>Session Timeout</Error></Session>') };
        if (call === 3) return { data: authXml('NEW') };
        return { data: lookupXml() };
    });
    const result = await qrzLookup('W1ABC', options, fakeDb(new Map()));
    assert.equal(result.result.callSign, 'W1ABC');
    assert.equal(call, 4);
});

test('invalid credentials return a sanitized empty result', async t => {
    t.mock.method(axios, 'get', async () => ({ data: lookupXml('<Session><Error>Invalid username/password</Error></Session>') }));
    assert.deepEqual(await qrzLookup('W1ABC', options, fakeDb(new Map())), { result: null, atQuota: false, outcome: 'auth-session-failure' });
});

test('callsign not found returns an empty result', async t => {
    let call = 0;
    t.mock.method(axios, 'get', async () => ({ data: ++call === 1 ? authXml() : lookupXml('<Session><Key>SESSION</Key><Error>Not found: W1ABC</Error></Session>') }));
    assert.deepEqual(await qrzLookup('W1ABC', options, fakeDb(new Map())), { result: null, atQuota: false, outcome: 'not-found' });
});

test('QRZ unavailable exhausts bounded retries without throwing', async t => {
    let call = 0;
    t.mock.method(axios, 'get', async () => {
        if (++call === 1) return { data: authXml() };
        throw new Error('service unavailable');
    });
    assert.deepEqual(await qrzLookup('W1ABC', options, fakeDb(new Map())), { result: null, atQuota: false, outcome: 'network-failure' });
    assert.equal(call, 4);
});

test('missing credentials disable QRZ gracefully', async () => {
    conf.qrz_username = '';
    conf.qrz_password = '';
    assert.deepEqual(await qrzLookup('W1ABC', options, fakeDb(new Map())), { result: null, atQuota: false, outcome: 'disabled' });
});

test('quota response is distinguished from other failures', async t => {
    t.mock.method(axios, 'get', async () => ({ data: authXml() }));
    const result = await qrzLookup('W1ABC', { ...options, qrzReqQuota: 1 }, fakeDb(new Map()));
    assert.deepEqual(result, { result: null, atQuota: true, outcome: 'quota' });
});

test('request timeout is distinguished and remains retryable on a later call', async t => {
    let call = 0;
    let available = false;
    t.mock.method(axios, 'get', async () => {
        if (++call === 1) return { data: authXml() };
        if (available) return { data: lookupXml() };
        const error = new Error('timeout');
        error.code = 'ETIMEDOUT';
        throw error;
    });
    const result = await qrzLookup('W1ABC', options, fakeDb(new Map()));
    assert.equal(result.outcome, 'timeout');
    assert.equal(call, 4);
    available = true;
    const retry = await qrzLookup('W1ABC', options, fakeDb(new Map()));
    assert.equal(retry.outcome, 'success');
    assert.equal(call, 5);
});

test('malformed QRZ response is distinguished', async t => {
    t.mock.method(axios, 'get', async () => ({ data: '<not-qrz />' }));
    const result = await qrzLookup('W1ABC', options, fakeDb(new Map()));
    assert.equal(result.outcome, 'malformed-response');
});

test('successful lookup accepts current QRZ name and image fields', async t => {
    let call = 0;
    t.mock.method(axios, 'get', async () => ({
        data: call++ === 0 ? authXml() : lookupXml(
            '<Callsign><fname>Fred L</fname><name>Lloyd</name><addr2>St Louis</addr2><state>MO</state>' +
            '<country>United States</country><image>https://files.qrz.com/q/aa7bq/aa7bq.jpg</image></Callsign>' +
            '<Session><Key>SESSION</Key><Count>2</Count></Session>'
        )
    }));
    const result = await qrzLookup('AA7BQ', options, fakeDb(new Map()));
    assert.equal(result.outcome, 'success');
    assert.match(result.result.displayName, /Fred.*Lloyd/i);
    assert.equal(result.result.location, 'St Louis, MO');
    assert.equal(result.result.photo, 'https://files.qrz.com/q/aa7bq/aa7bq.jpg');
});

test('rejected credentials enter a bounded cooldown instead of repeatedly authenticating', async t => {
    const get = t.mock.method(axios, 'get', async () => ({
        data: '<QRZDatabase><Session><Error>Username/password incorrect</Error></Session></QRZDatabase>'
    }));
    const db = fakeDb(new Map());
    assert.equal((await qrzLookup('W1ABC', options, db)).outcome, 'auth-session-failure');
    assert.equal((await qrzLookup('K7XYZ', options, db)).outcome, 'auth-session-failure');
    assert.equal(get.mock.callCount(), 1);
});

test('parallel lookups for one callsign share authentication and lookup work', async t => {
    let call = 0;
    t.mock.method(axios, 'get', async () => {
        call++;
        return { data: call === 1 ? authXml() : lookupXml() };
    });
    const db = fakeDb(new Map());
    const [first, second] = await Promise.all([qrzLookup('W1ABC', options, db), qrzLookup('w1abc', options, db)]);
    assert.equal(first.result.callSign, 'W1ABC');
    assert.equal(second.result.callSign, 'W1ABC');
    assert.equal(call, 2);
});
