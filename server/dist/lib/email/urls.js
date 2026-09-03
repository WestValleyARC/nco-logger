/* hamlive-oss — MIT License. See LICENSE. */

const { conf } = require('../configLib');

const getBaseUrl = baseUrl => {
    const value = baseUrl || conf.base_url;
    if (!value) throw new Error('BASE_URL is required to build application email links');
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('BASE_URL must be an HTTP(S) URL without credentials');
    }
    return parsed;
};

const absoluteAppUrl = (pathname, baseUrl) => {
    if (typeof pathname !== 'string' || !pathname.trim()) throw new Error('Application URL path is required');
    const base = getBaseUrl(baseUrl);
    const resolved = new URL(pathname, base);
    if (resolved.origin !== base.origin) throw new Error('Application URL must remain on the configured origin');
    return resolved.toString();
};

const appEmailUrls = baseUrl => Object.freeze({
    contact: absoluteAppUrl('/views/contact', baseUrl),
    signIn: absoluteAppUrl('/views/login', baseUrl),
    accountSettings: absoluteAppUrl('/views/myaccount', baseUrl),
    notificationPreferences: absoluteAppUrl('/views/dataprivacy', baseUrl),
    liveNet: netProfileId => absoluteAppUrl(`/views/livenet/${encodeURIComponent(String(netProfileId))}`, baseUrl)
});

module.exports = { absoluteAppUrl, appEmailUrls };
