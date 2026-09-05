/* hamlive-oss — MIT License. See LICENSE. */

const helmet = require('helmet');
const { canonicalOrigin } = require('./runtimeSecurity');
const { logger } = require('./logger');

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const createRequestSecurity = ({ baseUrl, production, forceHttpsEnabled = false }) => {
    const origin = canonicalOrigin(baseUrl);
    const allowedHost = new URL(origin).host.toLowerCase();

    const hostGuard = (req, res, next) => {
        const host = String(req.get('host') || '').toLowerCase();
        if (!production || host === allowedHost) return next();
        return res.status(400).json({ error: 'Invalid request host' });
    };

    const forceHttps = (req, res, next) => {
        if (!production || !forceHttpsEnabled || req.secure) return next();
        return res.redirect(308, `${origin}${req.originalUrl}`);
    };

    const csrfProtection = (req, res, next) => {
        if (!mutationMethods.has(req.method)) return next();
        const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
        const requestOrigin = req.get('origin');
        if (fetchSite === 'cross-site') return res.status(403).json({ error: 'Cross-site request rejected' });
        if (requestOrigin) {
            try {
                if (new URL(requestOrigin).origin === origin) return next();
            } catch (_error) {
                // Rejected below.
            }
            return res.status(403).json({ error: 'Cross-site request rejected' });
        }
        if (fetchSite === 'same-origin') return next();
        // Production mutations fail closed when neither Origin nor trusted
        // fetch metadata is present. Development keeps CLI/test clients usable.
        return production ? res.status(403).json({ error: 'Request origin required' }) : next();
    };

    const headers = helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                baseUri: ["'self'"],
                connectSrc: ["'self'"],
                fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
                formAction: ["'self'"],
                frameAncestors: ["'none'"],
                imgSrc: ["'self'", 'data:', 'https:'],
                objectSrc: ["'none'"],
                scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
                upgradeInsecureRequests: production ? [] : null
            }
        },
        crossOriginEmbedderPolicy: false,
        hsts: production ? { maxAge: 31536000, includeSubDomains: true } : false,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    });

    return { csrfProtection, forceHttps, headers, hostGuard, origin };
};

const notFound = (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    return res.status(404).send('Not found');
};

const errorHandler = (error, req, res, _next) => {
    logger.error(`Request failed: ${req.method} ${req.path}`, error);
    if (res.headersSent) return;
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    const message = status >= 500 ? 'An internal server error occurred' : 'The request could not be completed';
    res.status(status).json({ error: message });
};

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

module.exports = { asyncHandler, createRequestSecurity, errorHandler, notFound };
