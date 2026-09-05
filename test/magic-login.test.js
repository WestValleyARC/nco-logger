const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { conf } = require('../server/dist/lib/configLib');
const UserProfile = require('../server/dist/models/userProfile').getUserProfile(null);

const listen = app => new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
});

const request = (server, { method = 'GET', path, body = '', cookie = '' }) => new Promise((resolve, reject) => {
    const headers = {};
    if (body) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        headers['content-length'] = Buffer.byteLength(body);
    }
    if (cookie) headers.cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path, headers }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
});

test('magic login HEAD is inert while GET remains one-time and authenticates', async t => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalConf = { base_url: conf.base_url, mail_transport: conf.mail_transport, smtp_host: conf.smtp_host };
    const originalFindOneAndUpdate = UserProfile.findOneAndUpdate;
    const magicModule = require('../server/dist/lib/magicLoginTokens');
    const rateModule = require('../server/dist/lib/persistentRateLimit');
    const originals = { issue: magicModule.issueMagicLoginToken, consume: magicModule.consumeMagicLoginToken, revoke: magicModule.revokeMagicLoginToken, rate: rateModule.consumeRateLimit };
    let usable = true;
    let locked = false;
    let consumeCalls = 0;
    let profileUpdateCalls = 0;
    magicModule.issueMagicLoginToken = async () => 'test-one-time-token';
    magicModule.consumeMagicLoginToken = async ({ token }) => {
        consumeCalls += 1;
        if (token !== 'test-one-time-token' || !usable) return null;
        usable = false;
        return { destination: 'operator@example.com' };
    };
    magicModule.revokeMagicLoginToken = async () => { usable = false; };
    rateModule.consumeRateLimit = async () => ({ allowed: true });
    process.env.NODE_ENV = 'development';
    conf.base_url = 'http://localhost:3000';
    conf.mail_transport = 'console';
    conf.smtp_host = '';
    UserProfile.findOneAndUpdate = async () => {
        profileUpdateCalls += 1;
        return { id: 'test-user-id', _id: 'test-user-id', callSign: 'W1ABC', locked };
    };

    for (const modulePath of ['../server/dist/lib/userNotification', '../server/dist/routes/authRoutes']) delete require.cache[require.resolve(modulePath)];
    const authRoutes = require('../server/dist/routes/authRoutes');
    const headRouteIndex = authRoutes.stack.findIndex(layer => layer.route?.path === '/magiclogin/callback' && layer.route.methods.head);
    const getRouteIndex = authRoutes.stack.findIndex(layer => layer.route?.path === '/magiclogin/callback' && layer.route.methods.get);
    assert.ok(headRouteIndex >= 0, 'an explicit magic-login HEAD route must exist');
    assert.ok(headRouteIndex < getRouteIndex, 'the HEAD route must be registered before the GET route');
    passport.serializeUser((user, done) => done(null, user.id));
    passport.deserializeUser((id, done) => done(null, locked ? false : { id, callSign: 'W1ABC' }));
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'test-cookie-key-that-is-long-enough', resave: false, saveUninitialized: false }));
    app.use(passport.initialize());
    app.use(passport.session());
    app.get('/preauth', (req, res) => { req.session.marker = 'before-login'; res.json({ marker: req.session.marker }); });
    app.use('/auth', authRoutes);
    app.get('/views/dashboard', (req, res) => res.json({ authenticated: req.isAuthenticated(), marker: req.session.marker || null }));
    const server = await listen(app);

    t.after(() => new Promise(resolve => server.close(resolve)));
    t.after(() => {
        process.env.NODE_ENV = originalNodeEnv;
        Object.assign(conf, originalConf);
        UserProfile.findOneAndUpdate = originalFindOneAndUpdate;
        Object.assign(magicModule, { issueMagicLoginToken: originals.issue, consumeMagicLoginToken: originals.consume, revokeMagicLoginToken: originals.revoke });
        rateModule.consumeRateLimit = originals.rate;
    });

    const generated = await request(server, { method: 'POST', path: '/auth/magiclogin', body: 'destination=operator%40example.com' });
    assert.equal(generated.status, 200);
    const payload = JSON.parse(generated.body);
    assert.equal(payload.devMagicLink, '/auth/magiclogin/callback?token=test-one-time-token');
    const preauth = await request(server, { path: '/preauth' });
    const oldCookie = preauth.headers['set-cookie'].map(value => value.split(';', 1)[0]).join('; ');

    const validHead = await request(server, { method: 'HEAD', path: payload.devMagicLink, cookie: oldCookie });
    const invalidHead = await request(server, { method: 'HEAD', path: '/auth/magiclogin/callback?token=invalid-token', cookie: oldCookie });
    const comparableHeadResponse = response => {
        const { date: _date, ...headers } = response.headers;
        return { status: response.status, headers, body: response.body };
    };
    assert.deepEqual(comparableHeadResponse(validHead), comparableHeadResponse(invalidHead));
    assert.equal(validHead.status, 204);
    assert.equal(validHead.body, '');
    assert.equal(validHead.headers['set-cookie'], undefined);
    assert.equal(consumeCalls, 0);
    assert.equal(profileUpdateCalls, 0);
    assert.equal(usable, true);
    assert.deepEqual(JSON.parse((await request(server, { path: '/views/dashboard', cookie: oldCookie })).body), { authenticated: false, marker: 'before-login' });

    const callback = await request(server, { path: payload.devMagicLink, cookie: oldCookie });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.location, '/views/dashboard');
    assert.equal(consumeCalls, 1);
    assert.equal(profileUpdateCalls, 1);
    assert.equal(usable, false);
    const cookie = callback.headers['set-cookie'].map(value => value.split(';', 1)[0]).join('; ');
    assert.match(cookie, /^connect\.sid=/);
    assert.notEqual(cookie, oldCookie);
    assert.deepEqual(JSON.parse((await request(server, { path: '/views/dashboard', cookie })).body), { authenticated: true, marker: null });
    assert.deepEqual(JSON.parse((await request(server, { path: '/views/dashboard', cookie: oldCookie })).body), { authenticated: false, marker: null });
    assert.equal((await request(server, { path: payload.devMagicLink })).headers.location, '/views/login?error=invalid-link');
    assert.equal(consumeCalls, 2);
    assert.equal(profileUpdateCalls, 1);
    locked = true;
    assert.deepEqual(JSON.parse((await request(server, { path: '/views/dashboard', cookie })).body), { authenticated: false, marker: null });
    locked = false;
    assert.equal((await request(server, { method: 'POST', path: '/auth/logout', cookie })).status, 303);
    assert.deepEqual(JSON.parse((await request(server, { path: '/views/dashboard', cookie })).body), { authenticated: false, marker: null });
    usable = true;
    locked = true;
    assert.equal((await request(server, { path: payload.devMagicLink })).headers.location, '/views/login?error=invalid-link');
});

test('non-console magic-link rendering retains the configured absolute origin', () => {
    const originalBaseUrl = conf.base_url;
    conf.base_url = 'https://logger.example.test';
    delete require.cache[require.resolve('../server/dist/lib/userNotification')];
    const { MagicSignInEmail } = require('../server/dist/lib/userNotification');
    const email = new MagicSignInEmail({ href: '/auth/magiclogin/callback?token=test-token' });
    assert.match(email.body.text, /https:\/\/logger\.example\.test\/auth\/magiclogin\/callback\?token=test-token/);
    conf.base_url = originalBaseUrl;
});
