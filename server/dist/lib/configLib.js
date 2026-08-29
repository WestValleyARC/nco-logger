/* hamlive-oss — MIT License. See LICENSE. */
const path = require('path');
const fs = require('fs');
const YAML = require('yaml');
const _ = require('lodash');

// Load environment variables from a root .env file if present.
// Secrets and instance-specific values live in .env (or the real environment),
// never in the committed YAML. See .env.example and INSTALL.md.
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

let baseConfigf;
let commonConfigf;
let conf = {};

try {
    commonConfigf = fs.readFileSync(path.resolve(__dirname, '../commonConfig.yaml'), 'utf8');

    if (process.env.NODE_ENV === 'development') {
        baseConfigf = fs.readFileSync(path.resolve(__dirname, '../devConfig.yaml'), 'utf8');
    } else {
        baseConfigf = fs.readFileSync(path.resolve(__dirname, '../prodConfig.yaml'), 'utf8');
    }

    conf = _.merge(YAML.parse(commonConfigf), YAML.parse(baseConfigf));
} catch (err) {
    console.error(err.stack);
}

// Overlay secrets / instance config from environment variables.
// Every integration is optional: when its variables are absent the related
// feature degrades gracefully (see INSTALL.md, "Local test drive").
const fromEnv = {
    dburi: process.env.MONGODB_URI,
    base_url: process.env.BASE_URL,
    cookie_session_key: process.env.COOKIE_SESSION_KEY,
    magic_link_secret: process.env.MAGIC_LINK_SECRET,
    mail_transport: process.env.MAIL_TRANSPORT,
    smtp_host: process.env.SMTP_HOST,
    smtp_port: process.env.SMTP_PORT,
    smtp_secure: process.env.SMTP_SECURE,
    smtp_require_tls: process.env.SMTP_REQUIRE_TLS,
    smtp_user: process.env.SMTP_USER,
    smtp_pass: process.env.SMTP_PASS,
    email_from: process.env.EMAIL_FROM,
    email_reply_to: process.env.EMAIL_REPLY_TO,
    google_client_id: process.env.GOOGLE_CLIENT_ID,
    google_client_secret: process.env.GOOGLE_CLIENT_SECRET,
    qrz_username: process.env.QRZ_USERNAME,
    qrz_password: process.env.QRZ_PASSWORD,
    geo_key: process.env.GEO_KEY,
    cmd_help_url: process.env.CMD_HELP_URL,
    app_name: process.env.APP_NAME,
    chat_max_message_chars: process.env.CHAT_MAX_MESSAGE_CHARS,
    chat_rate_limit_count: process.env.CHAT_RATE_LIMIT_COUNT,
    chat_rate_limit_window_ms: process.env.CHAT_RATE_LIMIT_WINDOW_MS,
    chat_upload_dir: process.env.CHAT_UPLOAD_DIR,
    chat_max_upload_mb: process.env.CHAT_MAX_UPLOAD_MB,
    qrz_cache_ttl_hours: process.env.QRZ_CACHE_TTL_HOURS
};

for (const [key, value] of Object.entries(fromEnv)) {
    if (value !== undefined && value !== '') {
        conf[key] = value;
    }
}

module.exports.conf = conf;
