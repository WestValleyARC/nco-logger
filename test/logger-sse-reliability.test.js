/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const SSE = require('express-sse-ts').default;
const { apiNotFound } = require('../server/dist/lib/apiNotFound');

const listen = app => new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
});

test('an established SSE response does not fall through into the API 404 response', async t => {
    const app = express();
    const sse = new SSE(5000);
    let errors = 0;
    app.use('/api/sse/test', sse.init);
    app.use('/api', apiNotFound);
    app.use((err, _req, _res, _next) => {
        errors++;
        assert.fail(err);
    });
    const server = await listen(app);
    t.after(() => new Promise(resolve => server.close(resolve)));

    const stream = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${server.address().port}/api/sse/test`, resolve);
        req.once('error', reject);
    });
    assert.equal(stream.statusCode, 200);
    assert.match(stream.headers['content-type'], /^text\/event-stream/);

    const firstChunk = await new Promise((resolve, reject) => {
        stream.once('data', chunk => resolve(chunk.toString()));
        stream.once('error', reject);
    });
    assert.match(firstChunk, /retry: 5000/);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(stream.complete, false);
    assert.equal(stream.destroyed, false);
    assert.equal(errors, 0);
    stream.destroy();
});

test('an unmatched API request still returns the JSON 404 response', async t => {
    const app = express();
    app.use('/api', apiNotFound);
    const server = await listen(app);
    t.after(() => new Promise(resolve => server.close(resolve)));

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/missing`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Not Found' });
});
