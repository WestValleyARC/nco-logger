const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');

const viewRoutes = require('../server/dist/routes/viewRoutes');
const { ContactFormMessage } = require('../server/dist/lib/userNotification');

const pageData = {
    server: {
        appName: 'NCO Logger', appLogName: 'nco-logger', appAssetVersion: 'test', nodeEnv: 'test',
        logLevel: 'info', requestRateFactor: 1, httpClientTimeout: 1000, awayInMs: 1000,
        cmdHelpUrl: '', ts: ''
    },
    user: {
        isLoggedIn: false, newAccount: false, userId: '', callSign: '', displayName: '', chat: true
    }
};

const validForm = overrides => ({
    name: 'Alex Operator',
    callSign: 'W1ABC',
    email: 'alex@example.com',
    subject: 'Net question',
    message: 'Could you help with my net?',
    ...overrides
});

const encoded = values => new URLSearchParams(values).toString();

test('public contact page validates and delivers through the existing email service', async t => {
    const deliveries = [];
    let deliveryFailure = null;
    t.mock.method(ContactFormMessage.prototype, 'sendMailToAddrs', async function (recipients) {
        if (deliveryFailure) throw deliveryFailure;
        deliveries.push({ recipients, body: this.body });
        return { accepted: recipients };
    });

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../server/dist/views'));
    app.use(express.urlencoded({ extended: true }));
    app.use((_req, res, next) => {
        res.locals.serverInfo = pageData;
        next();
    });
    app.use('/views', viewRoutes);
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const post = (values, redirect = 'manual') => fetch(`${baseUrl}/views/contact`, {
        method: 'POST', redirect,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: encoded(values)
    });

    try {
        await t.test('GET is public and renders the complete form and updated footer link', async () => {
            const response = await fetch(`${baseUrl}/views/contact`);
            const html = await response.text();
            assert.equal(response.status, 200);
            assert.match(html, /Contact NCO Logger/);
            assert.match(html, /name="name"[^>]*maxlength="100"[^>]*required/);
            assert.match(html, /name="callSign"[^>]*maxlength="20"/);
            assert.match(html, /name="email"[^>]*maxlength="254"[^>]*required/);
            assert.match(html, /name="subject"[^>]*maxlength="150"[^>]*required/);
            assert.match(html, /name="message"[^>]*maxlength="5000"[^>]*required/);
            assert.match(html, /href="\/views\/contact"[^>]*>[\s\S]*Contact NCO Logger/);
            assert.doesNotMatch(html, /logger@westvalleyarc\.com/);
            assert.match(html, /Sign in/);
        });

        await t.test('valid submission uses the fixed recipient, visitor Reply-To, and safe body', async () => {
            viewRoutes.resetContactRateLimits();
            const response = await post(validForm({ message: '<script>alert(1)</script>' }));
            assert.equal(response.status, 303);
            assert.equal(response.headers.get('location'), '/views/contact?sent=1');
            assert.deepEqual(deliveries.at(-1).recipients, ['logger@westvalleyarc.com']);
            assert.equal(deliveries.at(-1).body.replyTo, undefined, 'Reply-To is applied only by the delivery policy');
            assert.equal(deliveries.at(-1).body.from, undefined, 'configured EmailBase From identity remains authoritative');
            assert.match(deliveries.at(-1).body.html, /NCO Logger/);
            assert.doesNotMatch(deliveries.at(-1).body.html, /<script>/);
            assert.match(deliveries.at(-1).body.html, /&lt;script&gt;/);
            const success = await fetch(`${baseUrl}/views/contact?sent=1`);
            assert.match(await success.text(), /Message sent[\s\S]*sent to the NCO Logger team/);
        });

        await t.test('required fields, email format, and maximum lengths are server enforced', async () => {
            assert.equal((await post({})).status, 400);
            assert.equal((await post(validForm({ email: 'not-an-email' }))).status, 400);
            assert.equal((await post(validForm({ name: 'x'.repeat(101) }))).status, 400);
            assert.equal((await post(validForm({ callSign: 'x'.repeat(21) }))).status, 400);
            assert.equal((await post(validForm({ subject: 'x'.repeat(151) }))).status, 400);
            assert.equal((await post(validForm({ message: 'x'.repeat(5001) }))).status, 400);
        });

        await t.test('honeypot silently succeeds without sending mail', async () => {
            const before = deliveries.length;
            const response = await post({ website: 'spam.example' });
            assert.equal(response.status, 303);
            assert.equal(deliveries.length, before);
        });

        await t.test('contact submissions are rate limited without extra dependencies', async () => {
            viewRoutes.resetContactRateLimits();
            for (let i = 0; i < viewRoutes.CONTACT_RATE_LIMIT_COUNT; i++) {
                assert.equal((await post(validForm())).status, 303);
            }
            const limited = await post(validForm());
            assert.equal(limited.status, 429);
            assert.match(await limited.text(), /Too many messages have been submitted/);
        });

        await t.test('mail failure returns a safe error and preserves submitted values', async () => {
            viewRoutes.resetContactRateLimits();
            deliveryFailure = new Error('SMTP credential detail must stay private');
            const response = await post(validForm({ subject: 'Preserve this subject' }));
            const html = await response.text();
            assert.equal(response.status, 502);
            assert.match(html, /could not be sent right now/);
            assert.match(html, /value="Preserve this subject"/);
            assert.doesNotMatch(html, /SMTP credential detail/);
            deliveryFailure = null;
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
        viewRoutes.resetContactRateLimits();
    }
});
