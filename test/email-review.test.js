const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { conf } = require('../server/dist/lib/configLib');

conf.base_url = 'https://logger.westvalleyarc.com';
conf.email_from = 'NCO Logger <logger@westvalleyarc.com>';
conf.email_reply_to = 'logger@westvalleyarc.com';

const { buildEmailReviewFixtures } = require('./fixtures/email-review-fixtures');

test('all seven deterministic review fixtures have consistent branding, text, links, and headers', async () => {
    const fixtures = await buildEmailReviewFixtures();
    assert.equal(fixtures.length, 7);
    assert.equal(new Set(fixtures.map(fixture => fixture.id)).size, 7);
    for (const fixture of fixtures) {
        assert.ok(fixture.subject);
        assert.match(fixture.html, /NCO LOGGER/);
        assert.match(fixture.html, /West Valley Amateur Radio Club \(WVARC\)/);
        assert.match(fixture.html, /© 2026 West Valley Amateur Radio Club \(WVARC\)\. All rights reserved\./);
        assert.match(fixture.text, /NCO Logger is operated by West Valley Amateur Radio Club \(WVARC\)/);
        assert.match(fixture.text, /Contact NCO Logger: https:\/\/logger\.westvalleyarc\.com\/views\/contact/);
        assert.ok(fixture.html.trim());
        assert.ok(fixture.text.trim());
        assert.equal(fixture.from, conf.email_from);
        assert.ok(fixture.links.every(link => link.startsWith('https://logger.westvalleyarc.com/')));
    }
    assert.equal(fixtures.find(fixture => fixture.id === 'contact-form-delivery').replyTo, 'visitor@example.com');
    for (const fixture of fixtures.filter(fixture => fixture.id !== 'contact-form-delivery')) {
        assert.equal(fixture.replyTo, conf.email_reply_to);
    }
    assert.deepEqual(fixtures.find(fixture => fixture.id === 'net-close-report').attachments.map(item => item.contentType), [
        'text/csv', 'text/plain'
    ]);
    assert.deepEqual(fixtures.find(fixture => fixture.id === 'inactivity-auto-close').attachments.map(item => item.contentType), [
        'text/csv', 'text/plain'
    ]);
});

test('legacy runtime net-close template and obsolete documentation template are removed', () => {
    assert.equal(fs.existsSync(path.join(__dirname, '../server/dist/views/email/net-close-report.ejs')), false);
    assert.equal(fs.existsSync(path.join(__dirname, '../docs/email-templates/net-close-report.html')), false);
});

test('email documentation records the canonical sender and contact Reply-To exception', () => {
    const documentation = fs.readFileSync(path.join(__dirname, '../docs/email-templates/README.md'), 'utf8');
    assert.match(documentation, /NCO Logger <address@example\.com>/);
    assert.match(documentation, /validated visitor[\s\S]*Reply-To exception/);
    assert.match(documentation, /mandatory operational notice that bypasses Email Notifications/);
    assert.match(documentation, /approximately ten-minute reminder window/);
});
