/* hamlive-oss — MIT License. See LICENSE.
 *
 * One-time local setup: create a .env from .env.example if one does not exist.
 * Cross-platform (Windows / macOS / Linux). Run with: npm run setup
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const example = path.join(root, '.env.example');
const target = path.join(root, '.env');

const secureSecret = () => crypto.randomBytes(48).toString('base64url');
const ensureValue = (contents, name, value) => {
    const pattern = new RegExp(`^${name}=$`, 'm');
    if (pattern.test(contents)) return contents.replace(pattern, `${name}=${value}`);
    if (new RegExp(`^${name}=.+$`, 'm').test(contents)) return contents;
    return `${contents.trimEnd()}\n${name}=${value}\n`;
};
const replaceExampleSecrets = input => {
    let contents = input
        .replace(/^COOKIE_SESSION_KEY=dev-cookie-key-change-me$/m, 'COOKIE_SESSION_KEY=')
        .replace(/^MAGIC_LINK_SECRET=dev-magic-link-secret-change-me$/m, 'MAGIC_LINK_SECRET=');
    contents = ensureValue(contents, 'COOKIE_SESSION_KEY', secureSecret());
    contents = ensureValue(contents, 'MAGIC_LINK_SECRET', secureSecret());
    contents = ensureValue(contents, 'MONGO_ROOT_USERNAME', 'hamlive_root');
    contents = ensureValue(contents, 'MONGO_ROOT_PASSWORD', secureSecret());
    contents = ensureValue(contents, 'MONGO_APP_USERNAME', 'hamlive_app');
    contents = ensureValue(contents, 'MONGO_APP_PASSWORD', secureSecret());
    return ensureValue(contents, 'MONGO_REPLICA_KEY', `${secureSecret()}${secureSecret()}`);
};

if (process.argv.includes('--rotate-local-secrets')) {
    if (!fs.existsSync(target)) throw new Error('.env does not exist');
    const original = fs.readFileSync(target, 'utf8');
    const updated = replaceExampleSecrets(original);
    if (updated === original) console.log('Local secrets were already non-example values; no secret was changed.');
    else {
        fs.writeFileSync(target, updated, { mode: 0o600 });
        console.log('Replaced example local secrets without displaying them.');
    }
    fs.chmodSync(target, 0o600);
    console.log('Restricted .env permissions to 0600.');
    process.exit(0);
}

if (fs.existsSync(target)) {
    console.log('.env already exists — leaving it untouched.');
} else {
    fs.writeFileSync(target, replaceExampleSecrets(fs.readFileSync(example, 'utf8')), { mode: 0o600 });
    console.log('Created .env with unique local-only secrets (not displayed).');
    console.log('Defaults are set up for a zero-account local test drive.');
}

const certKey = path.join(root, 'server', 'dist', 'ssl', 'dev-server_key.pem');
if (!fs.existsSync(certKey)) {
    console.log('\nNo local dev TLS certificate found.');
    console.log('Generate one with:  npm run gen-certs   (requires openssl)');
}

console.log('\nNext steps:');
console.log('  1. npm run dev              # start an ephemeral local MongoDB and the app');
console.log('  2. open http://localhost:3000 and sign in with an email link');
console.log('     (with no email provider configured, the sign-in link appears right on the page)');
console.log('  For persistent Docker development, see the compose.dev.yml instructions in INSTALL.md.');
