const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_REPLY_TO,
    applyDeliveryPolicy,
    configuredSender,
    createContactReplyToOverride
} = require('../server/dist/lib/email/deliveryPolicy');
const { absoluteAppUrl, appEmailUrls } = require('../server/dist/lib/email/urls');
const { COPYRIGHT, renderEmail } = require('../server/dist/lib/email/renderEmail');

const BASE_URL = 'https://logger.westvalleyarc.com';
const EMAIL_FROM = 'NCO Logger <logger@westvalleyarc.com>';

test('delivery policy owns From and supplies the normal Reply-To', () => {
    const message = applyDeliveryPolicy(
        {
            from: 'Attacker <attacker@example.test>',
            replyTo: 'attacker@example.test',
            sender: 'attacker@example.test',
            envelope: { from: 'attacker@example.test' },
            headers: { From: 'attacker@example.test' },
            subject: 'Test'
        },
        { emailFrom: EMAIL_FROM, smtpEnabled: true }
    );
    assert.equal(message.from, EMAIL_FROM);
    assert.equal(message.replyTo, DEFAULT_REPLY_TO);
    assert.equal(message.sender, undefined);
    assert.equal(message.envelope, undefined);
    assert.equal(message.headers, undefined);
});

test('SMTP requires a valid canonical NCO Logger sender while non-SMTP mode needs no fake fallback', () => {
    assert.throws(() => configuredSender({ smtpEnabled: true }), /EMAIL_FROM is required/);
    assert.throws(
        () => configuredSender({ emailFrom: 'Other Name <logger@westvalleyarc.com>', smtpEnabled: true }),
        /NCO Logger/
    );
    assert.equal(configuredSender({ smtpEnabled: false }), undefined);
});

test('only an issued, validated contact override can replace Reply-To', () => {
    const override = createContactReplyToOverride('visitor@example.com');
    const message = applyDeliveryPolicy(
        { subject: 'Contact' },
        { emailFrom: EMAIL_FROM, smtpEnabled: true, replyToOverride: override }
    );
    assert.equal(message.replyTo, 'visitor@example.com');
    assert.throws(
        () => applyDeliveryPolicy(
            { subject: 'Contact' },
            { emailFrom: EMAIL_FROM, smtpEnabled: true, replyToOverride: { email: 'visitor@example.com' } }
        ),
        /contact email policy/
    );
    assert.throws(() => createContactReplyToOverride('visitor@example.com\r\nBcc:bad@example.com'), /single email/);
});

test('absolute application URLs use the configured origin and cover future email destinations', () => {
    assert.equal(absoluteAppUrl('/views/contact', `${BASE_URL}/nested/`), `${BASE_URL}/views/contact`);
    assert.throws(() => absoluteAppUrl('https://evil.example/contact', BASE_URL), /configured origin/);
    const urls = appEmailUrls(BASE_URL);
    assert.equal(urls.contact, `${BASE_URL}/views/contact`);
    assert.equal(urls.signIn, `${BASE_URL}/views/login`);
    assert.equal(urls.accountSettings, `${BASE_URL}/views/myaccount`);
    assert.equal(urls.notificationPreferences, `${BASE_URL}/views/dataprivacy`);
    assert.equal(urls.liveNet('net id'), `${BASE_URL}/views/livenet/net%20id`);
});

test('renderer produces a branded HTML shell and a first-class text equivalent', () => {
    const rendered = renderEmail({
        baseUrl: BASE_URL,
        subject: 'Foundation test',
        preheader: 'Preview text',
        heading: 'A clear heading',
        blocks: [
            { type: 'paragraph', text: 'Readable message content.' },
            { type: 'details', items: [{ label: 'Scheduled time', value: '7:00 PM MST' }] }
        ],
        cta: { label: 'Open NCO Logger', path: '/views/login' },
        automatedNotice: 'This message was generated automatically.'
    });
    assert.equal(rendered.subject, 'Foundation test');
    assert.match(rendered.html, /NCO_Logger_Logo_compact\.png/);
    assert.match(rendered.html, /width="240" height="74" alt="NCO Logger"/);
    assert.doesNotMatch(rendered.html, />NCO LOGGER<\/div>/);
    assert.match(rendered.html, /West Valley Amateur Radio Club \(WVARC\)/);
    assert.match(rendered.html, new RegExp(COPYRIGHT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(rendered.html, new RegExp(`${BASE_URL}/views/contact`));
    assert.doesNotMatch(rendered.html, /mailto:|logger@westvalleyarc\.com/);
    assert.match(rendered.text, /Readable message content\./);
    assert.match(rendered.text, /Scheduled time: 7:00 PM MST/);
    assert.match(rendered.text, new RegExp(`Open NCO Logger: ${BASE_URL}/views/login`));
    assert.match(rendered.text, new RegExp(`Contact NCO Logger: ${BASE_URL}/views/contact`));
    assert.match(rendered.text, new RegExp(COPYRIGHT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(rendered.text, /logger@westvalleyarc\.com/);
});

test('renderer escapes structured content and rejects off-origin CTA URLs', () => {
    const rendered = renderEmail({
        baseUrl: BASE_URL,
        subject: 'Safety test',
        heading: '<script>alert(1)</script>',
        blocks: [{ type: 'paragraph', text: '<img src=x onerror=alert(1)>' }]
    });
    assert.doesNotMatch(rendered.html, /<script>|<img src=x/);
    assert.match(rendered.html, /&lt;script&gt;/);
    assert.throws(() => renderEmail({
        baseUrl: BASE_URL,
        subject: 'Bad CTA',
        heading: 'Bad CTA',
        cta: { label: 'Leave', path: 'https://evil.example/' }
    }), /configured origin/);
});
