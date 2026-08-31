/* hamlive-oss — MIT License. See LICENSE. */

// Environment variables are loaded from the root .env file inside lib/configLib.
const { conf } = require('./lib/configLib');
const passport = require('passport');
const responseTime = require('response-time');
const express = require('express');
const app = express();
const https = require('https');
const fs = require('fs');
const path = require('path');
const { logger, httpLogger } = require('./lib/logger');
const {
    addServerInfo,
    populate,
    flexOpts,
    publicEndpoints,
    cookieSessionKeepAlive,
    cookieSessionStubs
} = require('./lib/serverUtils');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
const dataNetProfileRoutes = require('./routes/dataNetProfileRoutes');
const dataUserProfileRoutes = require('./routes/dataUserProfileRoutes');
const dataFollowRoutes = require('./routes/dataFollowRoutes');
const dataLiveNetRoutes = require('./routes/dataLiveNetRoutes');
const chatRoutes = require('./routes/chatRoutes');
const presenceLiveNetRoutes = require('./routes/presenceLiveNetRoutes');
const sseLiveNetRoutes = require('./routes/sseLiveNetRoutes');
const adminInteractionRoutes = require('./routes/adminInteractionRoutes');
const stationInteractionRoutes = require('./routes/stationInteractionRoutes');
const ncoLoggerRoutes = require('./routes/ncoLoggerRoutes');
const utilRoutes = require('./routes/utilRoutes');
const viewRoutes = require('./routes/viewRoutes');
const cookieSession = require('cookie-session');
const dailyDispatch = require('./lib/dailyProcessingDispatch');
const UserProfile = require('./models/userProfile').getUserProfile(null);
const PORT = process.env['PORT'] ?? 3000;
const { verifyTransport } = require('./lib/userNotification');

const validateRuntimeConfig = () => {
    const production = process.env.NODE_ENV === 'production';
    const required = ['BASE_URL', 'MONGODB_URI', 'COOKIE_SESSION_KEY', 'MAGIC_LINK_SECRET'];
    const missing = production ? required.filter(name => !process.env[name]) : [];
    if (missing.length) logger.error(`Missing required production configuration: ${missing.join(', ')}`);
    const smtpEnabled = conf.mail_transport === 'smtp' && Boolean(conf.smtp_host);
    logger.info(
        `Services: SMTP ${smtpEnabled ? 'enabled' : 'disabled'}; QRZ ${
            conf.qrz_username && conf.qrz_password ? 'enabled' : 'disabled'
        }; local chat enabled; Google OAuth ${
            conf.google_client_id && conf.google_client_secret ? 'enabled' : 'disabled'
        }; ads disabled; analytics disabled`
    );
    if (missing.length) throw new Error('Required production configuration is missing');
};

validateRuntimeConfig();
void verifyTransport();

// In development we serve plain HTTP on localhost by default — browsers treat
// http://localhost as a secure context, so geolocation/crypto/etc. still work,
// and there's no self-signed-certificate warning. Set HTTPS=true to serve dev
// over HTTPS with the bundled self-signed cert (regenerate via `npm run
// gen-certs`). In production, terminate TLS at your reverse proxy / platform.
const isDev = process.env['NODE_ENV'] === 'development';
const useHttps = isDev && process.env['HTTPS'] === 'true';
const sslOptions = useHttps
    ? {
          key: fs.readFileSync(path.join(__dirname, 'ssl', 'dev-server_key.pem')),
          cert: fs.readFileSync(path.join(__dirname, 'ssl', 'dev-server_cert.pem'))
      }
    : null;

// Optional HTTPS redirect for production behind a TLS-terminating proxy/load
// balancer (Render, Fly, Railway, nginx, Caddy, a cloud LB, ...). Enable with
// FORCE_HTTPS=true. Relies on the standard x-forwarded-proto header, so it is
// platform-neutral. Leave it off if you terminate TLS in front of the app or
// run plain HTTP on a trusted network.
if (process.env['FORCE_HTTPS'] === 'true') {
    app.use((req, res, next) => {
        const proto = req.headers['x-forwarded-proto'];
        if (proto && proto !== 'https') {
            return res.redirect(301, `https://${req.headers.host}${req.url}`);
        }
        next();
    });
}

mongoose.set('strictQuery', true);
mongoose
    .connect(conf.dburi, {
        maxPoolSize: conf.realtime_mongoose_poolsize
    })
    .then(() => {
        logger.info('Connected to db (realtime pool)');
        if (useHttps) {
            https.createServer(sslOptions, app).listen(PORT);
        } else {
            app.listen(PORT);
        }
        const scheme = useHttps ? 'https' : 'http';
        logger.info(`${conf.applogname} listening on ${scheme}://localhost:${PORT}`);
    })
    .catch(error => {
        logger.error(error);
    });

app.use(
    cookieSession({
        maxAge: 3.5 * 24 * 60 * 60 * 1000, // 3.5 days
        keys: [conf.cookie_session_key]
    })
);

//Renew cookie session on every 10 minutes of activity
app.use(cookieSessionKeepAlive());

//Stubs for regenerate() and save() to make passport work with cookie-session
app.use(cookieSessionStubs);

//Passport Init:
app.use(passport.initialize());
app.use(passport.session());

//serializeUser() runs after we determine if the user
// is returning or new (below).The user in this fuction is
// the user we passed to done() in the prior phase (auth routes)
// user is the mongo db user instance
passport.serializeUser((user, done) => {
    done(null, user.id);
});
passport.deserializeUser((id, done) => {
    UserProfile.findById(id).then(user => {
        done(null, user);
    });
});

app.use(flexOpts);
app.use(responseTime(httpLogger));
app.use(addServerInfo);
app.use(dailyDispatch);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Liveness only proves that the Node process can answer HTTP. Readiness also
// verifies the database dependency before a proxy/orchestrator sends traffic.
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/readyz', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not-ready',
        revision: process.env.APP_REVISION || 'workspace',
        assetVersion: res.locals.serverInfo?.server?.appAssetVersion || 'unknown'
    });
});

app.use(express.static(path.join(__dirname, '../../client/dist/public'), {
    maxAge: 7200000,
    setHeaders: (res, filePath) => {
        // ES module dependencies are imported without the entry point's query
        // string. Revalidate scripts so a rebuilt container can never leave a
        // browser on a fresh-but-obsolete module for the old two-hour max-age.
        if (/\.(?:js|mjs)$/.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        }
    }
}));
app.use('/views', viewRoutes);
//API:CRUD Routes:
app.use('/api/data/netprofiles', dataNetProfileRoutes);
app.use('/api/data/userprofiles', dataUserProfileRoutes);
app.use('/api/data/follow', dataFollowRoutes);
app.use('/api/data/livenets', dataLiveNetRoutes);
//API:Interaction Routes:
app.use('/api/admin/interactions', adminInteractionRoutes);
app.use('/api/station/interactions', stationInteractionRoutes);
app.use('/api/nco-logger', ncoLoggerRoutes);
//API:Misc Routes:
app.use('/api/util', utilRoutes);
// Realtime SSE
app.use('/api/sse/livenets', sseLiveNetRoutes);
//API: LiveNet Presence
app.use('/api/presence/livenets', presenceLiveNetRoutes);
// Local chat uses the existing authenticated cookie session.
app.use('/api/chat', chatRoutes);
//API Desc
app.get('/api', (_req, res) => res.json(publicEndpoints(app)));
logger.debug(`\n\nAPI:\n${JSON.stringify(publicEndpoints(app), null, 1)}\n`);

app.use('/auth', authRoutes);
app.get('/', (_req, res) => {
    res.redirect('/views/dashboard');
});
app.get('/login', (_req, res) => {
    res.redirect('/views/login');
});
app.get('/logout', (_req, res) => {
    res.redirect('/auth/logout');
});

app.use((req, res) => {
    if (!res.headersSent) return res.status(404).render('404', populate(req, res, { VIEW: '404' }));
});
