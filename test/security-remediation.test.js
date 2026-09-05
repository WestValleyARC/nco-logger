const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestSecurity } = require('../server/dist/lib/httpSecurity');
const { trustedProxySetting, validateRuntimeConfig } = require('../server/dist/lib/runtimeSecurity');
const { conf } = require('../server/dist/lib/configLib');

const strong = seed => `${seed}-A7z_Q2m!L9v#${'R4xP'.repeat(10)}`;
const productionEnv = overrides => ({
    NODE_ENV: 'production', BASE_URL: 'https://logger.example.test',
    MONGODB_URI: 'mongodb://app:secret@mongo:27017/hamlive',
    COOKIE_SESSION_KEY: strong('cookie'), MAGIC_LINK_SECRET: strong('magic'),
    LEGAL_CONTENT_APPROVED: 'true', ...overrides
});

test('production runtime configuration rejects insecure origins, credentials, and secrets', () => {
    assert.equal(validateRuntimeConfig(productionEnv()), true);
    assert.throws(() => validateRuntimeConfig(productionEnv({ COOKIE_SESSION_KEY: 'change-me' })), /placeholder/);
    assert.throws(() => validateRuntimeConfig(productionEnv({ COOKIE_SESSION_KEY: 'short' })), /32 bytes/);
    assert.throws(() => validateRuntimeConfig(productionEnv({ MAGIC_LINK_SECRET: strong('cookie'), COOKIE_SESSION_KEY: strong('cookie') })), /must be different/);
    assert.throws(() => validateRuntimeConfig(productionEnv({ BASE_URL: 'http://logger.example.test' })), /HTTPS/);
    assert.throws(() => validateRuntimeConfig(productionEnv({ BASE_URL: 'https://logger.example.test/path' })), /must be an origin/);
    assert.throws(() => validateRuntimeConfig(productionEnv({ MONGODB_URI: 'mongodb://mongo:27017/hamlive' })), /authenticated credentials/);
    assert.throws(() => validateRuntimeConfig(productionEnv({ LEGAL_CONTENT_APPROVED: 'false' })), /legal review/);
    assert.throws(() => validateRuntimeConfig(productionEnv({ FORCE_HTTPS: 'true', TRUST_PROXY: '' })), /TRUST_PROXY/);
    assert.throws(() => trustedProxySetting('999'), /between 1 and 10/);
});

const invoke = (middleware, request = {}) => new Promise((resolve, reject) => {
    const req = { method: request.method || 'GET', originalUrl: request.originalUrl || '/', secure: Boolean(request.secure), get: name => request.headers?.[name.toLowerCase()], ...request };
    const response = {
        statusCode: 200, headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ status: this.statusCode, body, headers: this.headers }); },
        redirect(code, location) { resolve({ status: code, location, headers: this.headers }); },
        setHeader(name, value) { this.headers[name] = value; },
        removeHeader(name) { delete this.headers[name]; },
        getHeader(name) { return this.headers[name]; }
    };
    try { middleware(req, response, () => resolve({ status: 204, headers: response.headers })); } catch (error) { reject(error); }
});

test('host, HTTPS, and CSRF middleware fail closed in production', async () => {
    const security = createRequestSecurity({ baseUrl: 'https://logger.example.test', production: true, forceHttpsEnabled: true });
    assert.equal((await invoke(security.hostGuard, { headers: { host: 'evil.example' } })).status, 400);
    assert.equal((await invoke(security.hostGuard, { headers: { host: 'logger.example.test' } })).status, 204);
    assert.deepEqual(await invoke(security.forceHttps, { originalUrl: '/auth', secure: false }), { status: 308, location: 'https://logger.example.test/auth', headers: {} });
    assert.equal((await invoke(security.csrfProtection, { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await invoke(security.csrfProtection, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await invoke(security.csrfProtection, { method: 'POST', headers: {} })).status, 403);
    assert.equal((await invoke(security.csrfProtection, { method: 'POST', headers: { origin: 'https://logger.example.test' } })).status, 204);
});

test('security headers include CSP, framing protection, nosniff, referrer policy, and HSTS', async () => {
    const { headers } = createRequestSecurity({ baseUrl: 'https://logger.example.test', production: true });
    const result = await invoke(headers);
    const names = Object.keys(result.headers).map(name => name.toLowerCase());
    for (const expected of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'strict-transport-security']) assert.ok(names.includes(expected), `missing ${expected}`);
});

test('magic token material is high entropy, hashed, expiring, replaceable, and atomically consumed', async t => {
    const modelModule = require('../server/dist/models/magicLoginToken');
    const originalFactory = modelModule.getMagicLoginToken;
    const originalSecret = conf.magic_link_secret;
    let stored = null;
    const model = {
        async findOneAndUpdate(query, update) {
            stored = { ...query, ...update.$set };
            return stored;
        },
        async findOneAndDelete(query) {
            if (!stored || stored.tokenDigest !== query.tokenDigest || !(stored.expiresAt > query.expiresAt.$gt)) return null;
            const found = stored;
            stored = null;
            return found;
        },
        async deleteOne(query) {
            if (stored?.tokenDigest === query.tokenDigest) stored = null;
        }
    };
    modelModule.getMagicLoginToken = () => model;
    conf.magic_link_secret = strong('token-secret');
    delete require.cache[require.resolve('../server/dist/lib/magicLoginTokens')];
    const tokens = require('../server/dist/lib/magicLoginTokens');
    t.after(() => {
        modelModule.getMagicLoginToken = originalFactory;
        conf.magic_link_secret = originalSecret;
        delete require.cache[require.resolve('../server/dist/lib/magicLoginTokens')];
    });

    const now = new Date('2026-01-01T00:00:00Z');
    const first = await tokens.issueMagicLoginToken({ destination: 'User@Example.com', now });
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(stored.tokenDigest, first);
    assert.equal(stored.destination, 'user@example.com');
    const second = await tokens.issueMagicLoginToken({ destination: 'user@example.com', now });
    assert.notEqual(first, second);
    assert.equal(await tokens.consumeMagicLoginToken({ token: first, now }), null);
    assert.equal(await tokens.consumeMagicLoginToken({ token: 'malformed', now }), null);
    assert.equal(await tokens.consumeMagicLoginToken({ token: second, now: new Date(now.getTime() + tokens.MAGIC_LINK_TTL_MS + 1) }), null);
    const third = await tokens.issueMagicLoginToken({ destination: 'user@example.com', now });
    assert.equal((await tokens.consumeMagicLoginToken({ token: third, now })).destination, 'user@example.com');
    assert.equal(await tokens.consumeMagicLoginToken({ token: third, now }), null);
});

test('persistent rate limits hash subjects and enforce configured bounds', async t => {
    const modelModule = require('../server/dist/models/rateLimit');
    const originalFactory = modelModule.getRateLimit;
    const originalSecret = conf.magic_link_secret;
    let count = 0;
    let observedKey = '';
    modelModule.getRateLimit = () => ({
        async findOneAndUpdate(query) {
            observedKey = query.key;
            count += 1;
            return { count, expiresAt: new Date(Date.now() + 60000) };
        }
    });
    conf.magic_link_secret = strong('rate-secret');
    delete require.cache[require.resolve('../server/dist/lib/persistentRateLimit')];
    const { consumeRateLimit } = require('../server/dist/lib/persistentRateLimit');
    t.after(() => {
        modelModule.getRateLimit = originalFactory;
        conf.magic_link_secret = originalSecret;
        delete require.cache[require.resolve('../server/dist/lib/persistentRateLimit')];
    });
    assert.equal((await consumeRateLimit({ bucket: 'auth', subject: 'person@example.test', limit: 2, windowMs: 60000 })).allowed, true);
    assert.equal((await consumeRateLimit({ bucket: 'auth', subject: 'person@example.test', limit: 2, windowMs: 60000 })).allowed, true);
    assert.equal((await consumeRateLimit({ bucket: 'auth', subject: 'person@example.test', limit: 2, windowMs: 60000 })).allowed, false);
    assert.doesNotMatch(observedKey, /person@example\.test/);
});
