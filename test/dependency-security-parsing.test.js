const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const qs = require('qs');

const listen = app => new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
});

const request = async (server, path, options) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
    const text = await response.text();
    return { status: response.status, body: text && JSON.parse(text) };
};

test('Express query and body parsing retain expected behavior with patched qs', async t => {
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.get('/query', (req, res) => res.json(req.query));
    app.post('/body', (req, res) => res.json(req.body));
    app.use((err, _req, res, _next) => res.status(err.status || 400).json({ type: err.type || 'parse-error' }));

    const server = await listen(app);
    t.after(() => new Promise(resolve => server.close(resolve)));

    assert.deepEqual(await request(server, '/query?term=net&tag=vhf&tag=public&filters[band]=2m&members[]=W1ABC&members[]=K2XYZ'), {
        status: 200,
        body: {
            term: 'net',
            tag: ['vhf', 'public'],
            filters: { band: '2m' },
            members: ['W1ABC', 'K2XYZ']
        }
    });

    assert.deepEqual(await request(server, '/body', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'destination=operator%40example.com&profile[name]=Alex&roles[]=ncs&roles[]=logger'
    }), {
        status: 200,
        body: {
            destination: 'operator@example.com',
            profile: { name: 'Alex' },
            roles: ['ncs', 'logger']
        }
    });

    assert.deepEqual(await request(server, '/body', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'checkin', callSign: 'W1ABC' })
    }), {
        status: 200,
        body: { action: 'checkin', callSign: 'W1ABC' }
    });

    const malformed = await request(server, '/body', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `value${'[nested]'.repeat(40)}=blocked`
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.type, 'querystring.parse.rangeError');
});

test('patched qs rejects the comma array-limit bypass', () => {
    assert.throws(
        () => qs.parse('members[]=1,2,3,4', { comma: true, arrayLimit: 3, throwOnLimitExceeded: true }),
        RangeError
    );
});

test('patched qs safely serializes a parsed constructor.isBuffer property', () => {
    const parsed = qs.parse('value[constructor][isBuffer]=not-a-function', { allowPrototypes: true });
    assert.doesNotThrow(() => qs.stringify(parsed));
});
