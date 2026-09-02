/* hamlive-oss — MIT License. See LICENSE. */

const mongoose = require('mongoose');
const { fetchChatHistory } = require('./localChat');
const listEndpoints = require('express-list-endpoints');
const sanitizeHtml = require('sanitize-html');
const { nameCase } = require('@foundernest/namecase');
const { XMLParser } = require('fast-xml-parser');
const fillTemplate = require('es6-dynamic-template');
const NodeCache = require('node-cache');
const gOptsCache = new NodeCache({ stdTTL: 10, checkperiod: 600 });
const { logger } = require('../lib/logger');
const { conf } = require('../lib/configLib');
const { getFlexOption } = require('../models/flexOptions');
const { getQrzCache } = require('../models/qrzCache');
const axios = require('axios');
const { createHash } = require('crypto');
const { readFileSync } = require('fs');
const path = require('path');
const { version: appVersion } = require('../../../package.json');
const applicationAssetPaths = [
    'css/app-shell.css',
    'css/local.css',
    'css/nco-logger.css',
    'js/lib/appearance.js',
    'js/byView/liveNet/main.js',
    'js/byView/liveNet/ncoLogger.js',
    'js/lib/chat.js',
    'js/lib/chatState.js'
];
const publicAssetRoot = path.join(__dirname, '../../../client/dist/public');
const assetHash = createHash('sha256');
applicationAssetPaths.forEach(assetPath => assetHash.update(readFileSync(path.join(publicAssetRoot, assetPath))));
const appAssetRevision = assetHash.digest('hex').slice(0, 12);
const appAssetVersion = `${appVersion}-${appAssetRevision}`;
let qrzSessionKey = null;
let qrzInQuotaWait = 0;
let qrzReqPrevQuota;
let qrzAuthenticationPromise = null;
let qrzAuthenticationRejectedUntil = 0;
const qrzLookupPromises = new Map();
const QRZ_AUTH_REJECTION_COOLDOWN_MS = 5 * 60 * 1000;
const REQ_LOGIN = 0x0001;
const REQ_CALLSIGN = 0x0010;
const REQ_NETOWNER = 0x0100;
const REQ_SUPERUSER = 0x1000;

const publicEndpoints = app => {
    if ((!'listen') in app) throw new Error('publicEndpoints expected Express app instance as param');

    return listEndpoints(app)
        .filter(o => o.path.match(/^\/api\/.*/) && !o.path.includes('resolvelocation'))
        .map(o => {
            delete o.middlewares;
            return o;
        });
};

// Keep report formatting isolated from local chat persistence.
const fetchChatLog = async ({ NPID, since }) => {
    let chatLog = '';

    try {
        // fetchChatHistory() returns AsyncGenerator of message arrays - Messages are received in batches/chunks
        // Each message has: username, body, createdAt, reactions (formatted emoji string), edited (boolean)
        for await (const messages of fetchChatHistory({ npid: NPID, since })) {
            chatLog += messages
                .map(({ username, body, reactions, edited }) => {
                    const editedMarker = edited ? ' *' : '';
                    return `${username}: ${body}${reactions}${editedMarker}\n\n`;
                })
                .join('');
        }
    } catch (err) {
        // Gracefully handle if chat service unavailable (follows existing pattern in closeNet)
        logger.error(`Failed to fetch chat log: ${err.message}`);
        return ''; // Return empty string, don't fail the report
    }

    return chatLog;
};

const sanitizeNotes = notes =>
    sanitizeHtml(
        notes
            .replace(/\r?\n|\r/g, '')
            .replace(/"/g, '&#34;')
            .replace(/'/g, '&#39;'),
        {
            allowedTags: ['li', 'p', 'ul', 'b', 'br', 'em', 'i']
        }
    ) || '';

const getFlexOptionsByUser = async ({ user, cachedResponse = false, db = mongoose.connection }) => {
    let gOpts;
    let resp = {};

    if (!user?.flexOptions) return resp;

    if (cachedResponse) gOpts = gOptsCache.get(user.id);

    const FlexOption = getFlexOption(db);

    if (!gOpts) {
        if ((gOpts = await FlexOption.findOne({ scope: 'global' }))) {
        } else {
            logger.warn('getFlexOptionsByUser(): missing global options, creating default global options');
            gOpts = await FlexOption.create({
                scope: 'global',
                option: {}
            });
        }
        gOptsCache.set(user.id, gOpts.toObject());
    }

    if (!gOpts) return resp;

    for (let property in gOpts.option) {
        resp[property] = user.flexOptions?.option[property] ?? gOpts.option[property];
    }

    return resp;
};

const flexOpts = async (req, res, next) => {
    res.locals.flexOpts = await getFlexOptionsByUser({ user: req.user, cachedResponse: true });
    next();
};

const addServerInfo = async (req, res, next) => {
    try {
        const isLoggedIn = Boolean(req.user);

        const { NODE_ENV: nodeEnv, LOG_LEVEL: logLevel } = process.env;
        const { callSign = null, displayName = null, id: userId = null, newAccount = false } = req.user || {};
        const { requestRateFactor, httpClientTimeout, chat, awayInMs } =
            res.locals.flexOpts || {};
        const { applogname: appLogName, cmd_help_url: cmdHelpUrl = '', app_name: appName = 'Ham.Live' } =
            conf || {};
        const googleAuth = Boolean(conf.google_client_id && conf.google_client_secret);
        const chatEnabled = true;
        const emailEnabled = conf.mail_transport === 'smtp' && Boolean(conf.smtp_host);

        res.locals.serverInfo = {
            server: {
                nodeEnv,
                logLevel,
                appLogName,
                appName,
                appVersion,
                appAssetVersion,
                cmdHelpUrl,
                googleAuth,
                chatEnabled,
                emailEnabled,
                ts: Date.now(),
                requestRateFactor,
                httpClientTimeout,
                awayInMs
            },
            user: {
                isLoggedIn,
                callSign,
                displayName,
                userId,
                newAccount,
                chat
            }
        };

        res.set('X-App-Revision', process.env.APP_REVISION || 'workspace');
        res.set('X-App-Asset-Version', appAssetVersion);

        next();
    } catch (err) {
        logger.error(`addServerInfo() error: ${err}`);
        next(err); // Pass the error to the next middleware (error handler)
    }
};

const populate = (req, res, additions) => {
    return {
        ...res.locals.serverInfo,
        ...additions
    };
};

const cookieSessionKeepAlive = (intervalMinutes = 10) => {
    return (req, res, next) => {
        if (!req.session) {
            return next(new Error('Session is not initialized'));
        }

        const now = Date.now();

        if (!req.session.lastRenewal) {
            req.session.lastRenewal = now;
        }

        const intervalMs = intervalMinutes * 60 * 1000;
        const timeSinceLastRenewal = now - req.session.lastRenewal;

        if (timeSinceLastRenewal > intervalMs) {
            logger.debug(`Renewing session +${intervalMinutes}min`);
            req.session.lastRenewal = now;
        }

        next();
    };
};

const cookieSessionStubs = (req, _res, next) => {
    if (req.session && !req.session.regenerate) {
        req.session.regenerate = callback => {
            logger.debug('session.regenerate() placeholder was called');
            callback(undefined);
        };
    }
    if (req.session && !req.session.save) {
        req.session.save = callback => {
            logger.debug('session.save() placeholder was called');
            callback(undefined);
        };
    }
    next();
};

const wellFormedCall = station => {
    return /^(\d?[a-zA-Z]{1,3}|[a-zA-Z]\d[a-zA-Z]?)\d[a-zA-Z]{1,4}$/.test(station);
};

const toTitleCase = str => {
    return str.replace(/\w\S*/g, function (txt) {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
};

const resolveLocation = async ({ lat, lon }) => {
    const key = conf.geo_key;

    logger.debug(`resolving: ${lat}, ${lon}`);

    // Reverse geocoding is optional; skip cleanly when no GEO_KEY is configured.
    if (!key) {
        logger.debug('resolveLocation() disabled (no GEO_KEY configured)');
        return { location: '' };
    }

    if (!lat || !lon) {
        throw new Error('resolveLocation() missing coordinates params');
    }

    const rawResponse = await axios.get(fillTemplate(conf.geo_endpoint, { lat, lon, key }));

    const { municipality, countrySubdivision, country, countryCode } = rawResponse.data.addresses[0].address;

    if (countryCode === 'US') {
        return { location: `${municipality}, ${countrySubdivision}` };
    } else {
        return { location: `${municipality} (${country})` };
    }
};

const qrzResponse = (result, outcome, atQuota = false) => ({ result, atQuota, outcome });
const QRZ_NAME_FORMAT_VERSION = 2;
const qrzDisplayName = station => {
    const preferredFirst = String(station?.nickname || station?.fname || '').trim().split(/\s+/)[0] || '';
    const lastName = String(station?.name || '').trim();
    return nameCase([preferredFirst, lastName].filter(Boolean).join(' '));
};
const qrzImageUrl = value => {
    try {
        const url = new URL(String(value || ''));
        return url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
};
const qrzFailureOutcome = err => {
    if (err?.code === 'QRZ_MALFORMED') return 'malformed-response';
    if (['ECONNABORTED', 'ETIMEDOUT'].includes(err?.code) || /timeout/i.test(String(err?.message || ''))) return 'timeout';
    return 'network-failure';
};

const qrzLookupInternal = async (callSign, flexOpts, db) => {
    callSign = String(callSign || '').toUpperCase();
    if (!conf.qrz_username || !conf.qrz_password) {
        logger.debug(`qrzLookup(${callSign}): disabled (credentials not configured)`);
        return qrzResponse(null, 'disabled');
    }
    if (!wellFormedCall(callSign)) return qrzResponse(null, 'invalid-callsign');

    const { qrzSessionReqTimeoutMs = 5000, qrzDataReqTimeoutMs = 5000, qrzReqQuota = 100 } = flexOpts || {};
    if (qrzReqPrevQuota && qrzReqPrevQuota !== qrzReqQuota) qrzInQuotaWait = 0;
    qrzReqPrevQuota = qrzReqQuota;
    const QrzCache = getQrzCache(db);
    const ttlMs = (Number(conf.qrz_cache_ttl_hours) || 168) * 60 * 60 * 1000;
    try {
        const cached = await QrzCache.findOne({ callSign });
        if (cached && cached.nameFormatVersion === QRZ_NAME_FORMAT_VERSION &&
            Date.now() - new Date(cached.updatedAt).getTime() < ttlMs) {
            logger.info(`qrzLookup(${callSign}): cache hit`);
            const result = cached.toObject();
            return qrzResponse({ callSign: result.callSign, displayName: result.displayName, location: result.location,
                photo: qrzImageUrl(result.photo), lat: result.geo?.coordinates?.[1], lon: result.geo?.coordinates?.[0] }, 'success-cache');
        }
        if (cached) await cached.deleteOne();
    } catch (err) {
        logger.warn(`qrzLookup(${callSign}): cache unavailable: ${err.message}`);
    }
    if (qrzInQuotaWait) {
        qrzInQuotaWait--;
        return qrzResponse(null, 'quota', true);
    }

    const parser = new XMLParser();
    const endpoint = new URL(String(conf.qrz_endpoint || 'https://xmldata.qrz.com/xml/'));
    if (endpoint.protocol !== 'https:') throw new Error('QRZ endpoint must use HTTPS');
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/${encodeURIComponent(String(conf.qrz_version))}/`;
    const request = async (params, timeout) => {
        const url = new URL(endpoint);
        url.search = new URLSearchParams(params).toString();
        const parsed = parser.parse((await axios.get(url.toString(), { timeout })).data)?.QRZDatabase;
        if (!parsed || typeof parsed !== 'object') {
            const error = new Error('Malformed QRZ response');
            error.code = 'QRZ_MALFORMED';
            throw error;
        }
        return parsed;
    };
    const authenticate = async refresh => {
        if (qrzSessionKey && !refresh) return qrzSessionKey;
        if (Date.now() < qrzAuthenticationRejectedUntil) {
            return { key: null, outcome: 'auth-session-failure' };
        }
        if (!qrzAuthenticationPromise) {
            qrzAuthenticationPromise = (async () => {
                try {
                    const { Session: session = {} } = await request({
                        username: conf.qrz_username,
                        password: conf.qrz_password,
                        agent: conf.applogname
                    }, qrzSessionReqTimeoutMs);
                    if (session.Error || !session.Key) {
                        qrzSessionKey = null;
                        qrzAuthenticationRejectedUntil = Date.now() + QRZ_AUTH_REJECTION_COOLDOWN_MS;
                        logger.warn('QRZ authentication rejected');
                        return { key: null, outcome: 'auth-session-failure' };
                    }
                    const count = Number(session.Count);
                    if (Number.isFinite(count) && count >= qrzReqQuota) {
                        qrzInQuotaWait = 5;
                        qrzSessionKey = null;
                        logger.warn('QRZ request quota reached');
                        return { key: null, outcome: 'quota' };
                    }
                    qrzSessionKey = String(session.Key);
                    qrzAuthenticationRejectedUntil = 0;
                    logger.info('QRZ session established');
                    return { key: qrzSessionKey, outcome: 'success' };
                } catch (err) {
                    qrzSessionKey = null;
                    const outcome = qrzFailureOutcome(err);
                    logger.warn(`QRZ authentication unavailable: ${err.message}`);
                    return { key: null, outcome };
                }
            })().finally(() => { qrzAuthenticationPromise = null; });
        }
        const authenticated = await qrzAuthenticationPromise;
        if (!authenticated.key) {
            if (authenticated.outcome === 'quota') qrzInQuotaWait = Math.max(qrzInQuotaWait, 5);
            return authenticated;
        }
        return authenticated;
    };

    let lastOutcome = 'network-failure';
    let sessionRefreshSeen = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        const authenticated = await authenticate(attempt > 0 && qrzSessionKey === null);
        const key = typeof authenticated === 'string' ? authenticated : authenticated.key;
        if (!key) return qrzResponse(null, authenticated.outcome, authenticated.outcome === 'quota');
        try {
            const { Callsign: station = {}, Session: session = {} } = await request({ s: key, callsign: callSign }, qrzDataReqTimeoutMs);
            const error = String(session.Error || '');
            const count = Number(session.Count);
            if (Number.isFinite(count) && count + 1 >= qrzReqQuota) {
                qrzSessionKey = null;
                qrzInQuotaWait = 5;
                logger.warn('QRZ request quota reached');
                return qrzResponse(null, 'quota', true);
            }
            if (/session|invalid key/i.test(error) || !session.Key) {
                qrzSessionKey = null;
                sessionRefreshSeen = true;
                lastOutcome = 'auth-session-failure';
                logger.warn(`qrzLookup(${callSign}): session refresh required`);
                continue;
            }
            if (/not found/i.test(error)) {
                logger.info(`qrzLookup(${callSign}): station not found`);
                return qrzResponse(null, 'not-found');
            }
            if (error) {
                logger.warn(`qrzLookup(${callSign}): QRZ returned an error`);
                return qrzResponse(null, 'service-error');
            }
            const displayName = qrzDisplayName(station);
            const country = String(station.country || '');
            const city = String(station.addr2 || '');
            const state = String(station.state || '');
            const location = country.includes('United States')
                ? [city && toTitleCase(city), state && state.toUpperCase()].filter(Boolean).join(', ')
                : [city && toTitleCase(city), country && `(${country})`].filter(Boolean).join(' ');
            const photo = qrzImageUrl(station.image);
            if (!displayName && !location && !photo) return qrzResponse(null, 'no-data');
            const lat = Number(station.lat);
            const lon = Number(station.lon);
            const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);
            const cacheRecord = { callSign, displayName, location, photo, nameFormatVersion: QRZ_NAME_FORMAT_VERSION };
            if (hasCoordinates) cacheRecord.geo = { type: 'Point', coordinates: [lon, lat] };
            await QrzCache.findOneAndUpdate({ callSign }, cacheRecord, { upsert: true, new: true, setDefaultsOnInsert: true });
            return qrzResponse({ callSign, displayName, location, photo,
                lat: hasCoordinates ? lat : undefined, lon: hasCoordinates ? lon : undefined }, 'success');
        } catch (err) {
            lastOutcome = qrzFailureOutcome(err);
            logger.warn(`qrzLookup(${callSign}): request unavailable (attempt ${attempt + 1})`);
        }
    }
    return qrzResponse(null, sessionRefreshSeen ? 'auth-session-failure' : lastOutcome);
};

const qrzLookup = (callSign, flexOpts, db = mongoose.connection) => {
    const normalizedCall = String(callSign || '').toUpperCase();
    if (qrzLookupPromises.has(normalizedCall)) return qrzLookupPromises.get(normalizedCall);
    const lookup = qrzLookupInternal(normalizedCall, flexOpts, db)
        .finally(() => qrzLookupPromises.delete(normalizedCall));
    qrzLookupPromises.set(normalizedCall, lookup);
    return lookup;
};

const authCheck = options => {
    return (req, res, next) => {
        if (options & REQ_LOGIN) {
            if (req.user) {
                next();
            } else {
                logger.debug('authCheck() login missing!');
                res.redirect('/views/login');
            }
        }

        if (options & REQ_CALLSIGN) {
            if (req.user && req.user.callSign) {
                next();
            } else {
                logger.debug('authCheck() callsign missing!');
                res.redirect('/views/myaccount?cswarn=true');
            }
        }
    };
};

const hoursToMilliseconds = hours => hours * 60 * 60 * 1000;
const resetQrzSessionForTests = () => {
    qrzSessionKey = null;
    qrzInQuotaWait = 0;
    qrzReqPrevQuota = undefined;
    qrzAuthenticationPromise = null;
    qrzAuthenticationRejectedUntil = 0;
    qrzLookupPromises.clear();
};

module.exports = {
    addServerInfo,
    populate,
    cookieSessionKeepAlive,
    cookieSessionStubs,
    authCheck,
    flexOpts,
    getFlexOptionsByUser,
    wellFormedCall,
    resolveLocation,
    qrzLookup,
    qrzDisplayName,
    sanitizeNotes,
    publicEndpoints,
    hoursToMilliseconds,
    fetchChatLog,
    resetQrzSessionForTests,
    REQ_LOGIN,
    REQ_CALLSIGN,
    REQ_NETOWNER,
    REQ_SUPERUSER
};
