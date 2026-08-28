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
    assert.equal(new URL(calls[0]).searchParams.get('password'), conf.qrz_password);
    assert.ok(!calls[0].includes(conf.qrz_password));
});

test('cache hit avoids QRZ network calls', async t => {
    const get = t.mock.method(axios, 'get', async () => { throw new Error('should not run'); });
    const records = new Map([['W1ABC', { callSign: 'W1ABC', displayName: 'Alex', location: 'Phoenix, AZ', updatedAt: new Date(), geo: { coordinates: [-112.1, 33.4] } }]]);
    const result = await qrzLookup('W1ABC', options, fakeDb(records));
    assert.equal(result.result.displayName, 'Alex');
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
    assert.deepEqual(await qrzLookup('W1ABC', options, fakeDb(new Map())), { result: null, atQuota: false });
});

test('callsign not found returns an empty result', async t => {
    let call = 0;
    t.mock.method(axios, 'get', async () => ({ data: ++call === 1 ? authXml() : lookupXml('<Session><Key>SESSION</Key><Error>Not found: W1ABC</Error></Session>') }));
    assert.deepEqual(await qrzLookup('W1ABC', options, fakeDb(new Map())), { result: null, atQuota: false });
});

test('QRZ unavailable exhausts bounded retries without throwing', async t => {
    let call = 0;
    t.mock.method(axios, 'get', async () => {
        if (++call === 1) return { data: authXml() };
        throw new Error('service unavailable');
    });
    assert.deepEqual(await qrzLookup('W1ABC', options, fakeDb(new Map())), { result: null, atQuota: false });
    assert.equal(call, 4);
});

test('missing credentials disable QRZ gracefully', async () => {
    conf.qrz_username = '';
    conf.qrz_password = '';
    assert.deepEqual(await qrzLookup('W1ABC', options, fakeDb(new Map())), { result: null, atQuota: false });
});
