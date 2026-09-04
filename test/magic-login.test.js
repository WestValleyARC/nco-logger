const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const cookieSession = require('cookie-session');
const passport = require('passport');
const { conf } = require('../server/dist/lib/configLib');
const { cookieSessionStubs } = require('../server/dist/lib/serverUtils');
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
    const req = http.request({
        host: '127.0.0.1',
        port: server.address().port,
        method,
        path,
        headers
    }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
        }));
    });
    req.on('error', reject);
    req.end(body);
});

test('console magic login returns a relative link that authenticates successfully', async t => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalConf = {
        base_url: conf.base_url,
        mail_transport: conf.mail_transport,
        smtp_host: conf.smtp_host
    };
    const originalFindOneAndUpdate = UserProfile.findOneAndUpdate;

    process.env.NODE_ENV = 'development';
    conf.base_url = 'http://localhost:3000';
    conf.mail_transport = 'console';
    conf.smtp_host = '';
    UserProfile.findOneAndUpdate = async () => ({
        id: 'test-user-id',
        _id: 'test-user-id',
        callSign: 'W1ABC',
        locked: false,
        deletionReason: null,
        inactivityWarningSentAt: null
    });

    delete require.cache[require.resolve('../server/dist/lib/userNotification')];
    delete require.cache[require.resolve('../server/dist/routes/authRoutes')];
    const authRoutes = require('../server/dist/routes/authRoutes');

    passport.serializeUser((user, done) => done(null, user.id));
    passport.deserializeUser((id, done) => done(null, { id, callSign: 'W1ABC' }));

    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieSession({ keys: ['test-cookie-key'] }));
    app.use(cookieSessionStubs);
    app.use(passport.initialize());
    app.use(passport.session());
    app.use('/auth', authRoutes);
    app.get('/views/dashboard', (req, res) => res.json({ authenticated: req.isAuthenticated() }));

    const server = await listen(app);
    t.after(() => new Promise(resolve => server.close(resolve)));
    t.after(() => {
        process.env.NODE_ENV = originalNodeEnv;
        Object.assign(conf, originalConf);
        UserProfile.findOneAndUpdate = originalFindOneAndUpdate;
    });

    const generated = await request(server, {
        method: 'POST',
        path: '/auth/magiclogin',
        body: 'destination=operator%40example.com'
    });
    assert.equal(generated.status, 200);
    const payload = JSON.parse(generated.body);
    assert.match(payload.devMagicLink, /^\/auth\/magiclogin\/callback\?token=/);
    assert.doesNotMatch(payload.devMagicLink, /localhost|^[a-z][a-z\d+.-]*:\/\//i);

    const callback = await request(server, { path: payload.devMagicLink });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.location, '/views/dashboard');
    assert.ok(callback.headers['set-cookie']?.some(value => value.startsWith('session=')));

    const cookie = callback.headers['set-cookie'].map(value => value.split(';', 1)[0]).join('; ');
    const dashboard = await request(server, { path: '/views/dashboard', cookie });
    assert.equal(dashboard.status, 200);
    assert.deepEqual(JSON.parse(dashboard.body), { authenticated: true });
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
