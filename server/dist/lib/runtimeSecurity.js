/* hamlive-oss — MIT License. See LICENSE. */

const EXAMPLE_SECRETS = new Set([
    'dev-cookie-key-change-me',
    'dev-magic-link-secret-change-me',
    'change-me',
    'changeme'
]);

const parseBoolean = value => String(value || '').toLowerCase() === 'true';

const validateSecret = (name, value) => {
    if (!value) throw new Error(`${name} is required in production`);
    if (EXAMPLE_SECRETS.has(String(value).toLowerCase()) || /(?:example|change[-_ ]?me|placeholder)/i.test(value)) {
        throw new Error(`${name} must not use an example or placeholder value`);
    }
    if (Buffer.byteLength(value, 'utf8') < 32) {
        throw new Error(`${name} must contain at least 32 bytes`);
    }
    if (new Set(value).size < 12) throw new Error(`${name} does not contain enough distinct characters`);
};

const canonicalOrigin = baseUrl => {
    const parsed = new URL(baseUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
        throw new Error('BASE_URL must be an origin without credentials, path, query, or fragment');
    }
    return parsed.origin;
};

const validateRuntimeConfig = (env = process.env) => {
    const production = env.NODE_ENV === 'production';
    const required = ['BASE_URL', 'MONGODB_URI', 'COOKIE_SESSION_KEY', 'MAGIC_LINK_SECRET'];
    const missing = production ? required.filter(name => !env[name]) : [];
    if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(', ')}`);

    if (production) {
        validateSecret('COOKIE_SESSION_KEY', env.COOKIE_SESSION_KEY);
        validateSecret('MAGIC_LINK_SECRET', env.MAGIC_LINK_SECRET);
        if (env.COOKIE_SESSION_KEY === env.MAGIC_LINK_SECRET) {
            throw new Error('COOKIE_SESSION_KEY and MAGIC_LINK_SECRET must be different');
        }
        const origin = canonicalOrigin(env.BASE_URL);
        if (!origin.startsWith('https://')) throw new Error('BASE_URL must use HTTPS in production');
        if (!/^mongodb(?:\+srv)?:\/\/[^/@:]+:[^/@]+@/i.test(env.MONGODB_URI)) {
            throw new Error('MONGODB_URI must include authenticated credentials in production');
        }
        if (!parseBoolean(env.LEGAL_CONTENT_APPROVED)) {
            throw new Error('LEGAL_CONTENT_APPROVED=true is required after organization-approved legal review');
        }
        if (parseBoolean(env.FORCE_HTTPS) && !env.TRUST_PROXY) {
            throw new Error('FORCE_HTTPS requires an explicit TRUST_PROXY setting');
        }
    } else if (env.BASE_URL) {
        canonicalOrigin(env.BASE_URL);
    }
    return true;
};

const trustedProxySetting = value => {
    if (!value) return false;
    if (/^\d+$/.test(value)) {
        const hops = Number(value);
        if (hops < 1 || hops > 10) throw new Error('TRUST_PROXY hop count must be between 1 and 10');
        return hops;
    }
    const allowed = new Set(['loopback', 'linklocal', 'uniquelocal']);
    const entries = value.split(',').map(item => item.trim()).filter(Boolean);
    if (!entries.length || entries.some(item => !allowed.has(item) && !/^[a-f\d:.]+(?:\/\d+)?$/i.test(item))) {
        throw new Error('TRUST_PROXY must be a hop count, trusted subnet/IP, or Express named subnet');
    }
    return entries.length === 1 ? entries[0] : entries;
};

module.exports = { EXAMPLE_SECRETS, canonicalOrigin, parseBoolean, trustedProxySetting, validateRuntimeConfig };
