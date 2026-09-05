/* hamlive-oss — MIT License. See LICENSE. */

// Environment variables are loaded from the root .env file inside lib/configLib.
const { conf } = require('./lib/configLib');
const passport = require('passport');
const responseTime = require('response-time');
const express = require('express');
const app = express();
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { logger, httpLogger } = require('./lib/logger');
const {
    addServerInfo,
    populate,
    flexOpts,
    publicEndpoints
} = require('./lib/serverUtils');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
const dataNetProfileRoutes = require('./routes/dataNetProfileRoutes');
const dataUserProfileRoutes = require('./routes/dataUserProfileRoutes');
const dataFollowRoutes = require('./routes/dataFollowRoutes');
const dataLiveNetRoutes = require('./routes/dataLiveNetRoutes');
const dataScheduledOccurrenceRoutes = require('./routes/dataScheduledOccurrenceRoutes');
const chatRoutes = require('./routes/chatRoutes');
const presenceLiveNetRoutes = require('./routes/presenceLiveNetRoutes');
const sseLiveNetRoutes = require('./routes/sseLiveNetRoutes');
const adminInteractionRoutes = require('./routes/adminInteractionRoutes');
const stationInteractionRoutes = require('./routes/stationInteractionRoutes');
const ncoLoggerRoutes = require('./routes/ncoLoggerRoutes');
const utilRoutes = require('./routes/utilRoutes');
const viewRoutes = require('./routes/viewRoutes');
const dailyDispatch = require('./lib/dailyProcessingDispatch');
const UserProfile = require('./models/userProfile').getUserProfile(null);
const { getNetProfile, removeLegacyTitleUniqueIndex } = require('./models/netProfile');
const NetProfile = getNetProfile(null);
const NetSchedule = require('./models/netSchedule').getNetSchedule(null);
const ScheduledOccurrence = require('./models/scheduledOccurrence').getScheduledOccurrence(null);
const LiveNetAutoClose = require('./models/liveNetAutoClose').getLiveNetAutoClose(null);
const { startSchedulingWorker } = require('./lib/scheduling/worker');
const { apiNotFound } = require('./lib/apiNotFound');
const PORT = process.env['PORT'] ?? 3000;
const { verifyTransport } = require('./lib/userNotification');
const { parseBoolean, trustedProxySetting, validateRuntimeConfig } = require('./lib/runtimeSecurity');
const { createRequestSecurity, errorHandler } = require('./lib/httpSecurity');
const { closeChangeStreamClient } = require('./lib/changeStreamClient');
const { realtimeClients } = require('./lib/realtimeClients');

const reportServices = () => {
    const smtpEnabled = conf.mail_transport === 'smtp' && Boolean(conf.smtp_host);
    logger.info(
        `Services: SMTP ${smtpEnabled ? 'enabled' : 'disabled'}; QRZ ${
            conf.qrz_username && conf.qrz_password ? 'enabled' : 'disabled'
        }; local chat enabled; Google OAuth ${
            conf.google_client_id && conf.google_client_secret ? 'enabled' : 'disabled'
        }; ads disabled; analytics disabled`
    );
};

validateRuntimeConfig();
reportServices();
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
const production = process.env.NODE_ENV === 'production';
app.set('trust proxy', trustedProxySetting(process.env.TRUST_PROXY));
const requestSecurity = createRequestSecurity({
    baseUrl: conf.base_url,
    production,
    forceHttpsEnabled: parseBoolean(process.env.FORCE_HTTPS)
});
app.use(requestSecurity.headers);

mongoose.set('strictQuery', true);
let httpServer;
let stopSchedulingWorker = () => {};
let shuttingDown = false;

const start = async () => {
    try {
        await mongoose.connect(conf.dburi, { maxPoolSize: conf.realtime_mongoose_poolsize });
        await Promise.all([NetProfile.init(), NetSchedule.init(), ScheduledOccurrence.init(), LiveNetAutoClose.init()]);
        await removeLegacyTitleUniqueIndex(NetProfile);
        logger.info('Connected to db (realtime pool)');
        if (useHttps) {
            httpServer = https.createServer(sslOptions, app).listen(PORT);
        } else {
            httpServer = app.listen(PORT);
        }
        stopSchedulingWorker = startSchedulingWorker();
        const scheme = useHttps ? 'https' : 'http';
        logger.info(`${conf.applogname} listening on ${scheme}://localhost:${PORT}`);
    } catch (error) {
        logger.error('Application startup failed', error);
        process.exitCode = 1;
        setImmediate(() => process.exit(1));
    }
};

const sessionStore = MongoStore.create({ mongoUrl: conf.dburi, collectionName: 'sessions', ttl: 12 * 60 * 60 });
app.use(
    session({
        name: 'hamlive.sid',
        secret: conf.cookie_session_key,
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
        maxAge: 12 * 60 * 60 * 1000,
        sameSite: 'lax',
        httpOnly: true,
        secure: production,
        path: '/'
        }
    })
);

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
    UserProfile.findById(id)
        .then(user => done(null, user && !user.locked ? user : false))
        .catch(done);
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

app.use(requestSecurity.hostGuard);
app.use(requestSecurity.forceHttps);
app.use(requestSecurity.csrfProtection);

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
app.use('/api/data/scheduled-occurrences', dataScheduledOccurrenceRoutes);
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
app.use('/api/chat', chatRoutes.chatRouteErrorHandler);
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
    res.redirect('/views/dashboard');
});

app.use('/api', apiNotFound);

app.use((req, res) => {
    if (!res.headersSent) return res.status(404).render('404', populate(req, res, { VIEW: '404' }));
});

app.use(errorHandler);

const shutdown = signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Shutdown initiated (${signal})`);
    stopSchedulingWorker();
    const deadline = setTimeout(() => {
        logger.error('Graceful shutdown deadline exceeded');
        process.exit(1);
    }, 10000);
    deadline.unref();
    const closeHttp = httpServer
        ? new Promise(resolve => httpServer.close(resolve))
        : Promise.resolve();
    Promise.allSettled([closeHttp, realtimeClients.shutdown(), closeChangeStreamClient(), sessionStore.close(), mongoose.disconnect()]).then(results => {
        clearTimeout(deadline);
        const failed = results.some(result => result.status === 'rejected');
        if (failed) logger.error('One or more shutdown operations failed');
        process.exit(failed ? 1 : 0);
    });
};

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
void start();
