const test = require('node:test');
const assert = require('node:assert/strict');
const { conf } = require('../server/dist/lib/configLib');

conf.base_url = 'https://logger.westvalleyarc.com';
conf.email_from = 'NCO Logger <logger@westvalleyarc.com>';
conf.email_reply_to = 'logger@westvalleyarc.com';

const {
    AccountInactivityWarning,
    ContactFormMessage,
    MagicSignInEmail
} = require('../server/dist/lib/userNotification');

const captureDelivery = async (message, recipients) => {
    let delivery;
    message.sendEmailWithRetry = async emailData => {
        delivery = emailData;
        return { accepted: emailData.to };
    };
    await message.sendMailToAddrs(recipients);
    return delivery;
};

test('magic sign-in email is branded, preserves its destination, and includes security wording', async () => {
    const href = '/auth/magiclogin/callback?token=preserved-token';
    const email = new MagicSignInEmail({ href });
    assert.match(email.body.html, /NCO_Logger_Logo_compact\.png/);
    assert.match(email.body.html, /alt="NCO Logger"/);
    assert.doesNotMatch(email.body.html, />NCO LOGGER<\/div>/);
    assert.match(email.body.html, /Sign in to NCO Logger/);
    assert.match(email.body.html, /preserved-token/);
    assert.match(email.body.text, /Sign In to NCO Logger: https:\/\/logger\.westvalleyarc\.com\/auth\/magiclogin\/callback\?token=preserved-token/);
    assert.match(email.body.text, /did not request this link, you can safely ignore this email/i);
    assert.doesNotMatch(email.body.text, /expire|minutes|hours/i);
    const delivery = await captureDelivery(email, ['operator@example.com']);
    assert.equal(delivery.from, conf.email_from);
    assert.equal(delivery.replyTo, conf.email_reply_to);
});

test('account inactivity warning is branded and directs retention through sign-in', async () => {
    const email = new AccountInactivityWarning();
    assert.match(email.body.html, /NCO_Logger_Logo_compact\.png/);
    assert.match(email.body.html, /alt="NCO Logger"/);
    assert.doesNotMatch(email.body.html, />NCO LOGGER<\/div>/);
    assert.match(email.body.text, /inactive for approximately three years/i);
    assert.match(email.body.text, /within 30 days/);
    assert.match(email.body.text, /Signing in counts as account activity/);
    assert.match(email.body.text, /will be scheduled for deletion/);
    assert.match(email.body.text, /Sign In to NCO Logger: https:\/\/logger\.westvalleyarc\.com\/views\/login/);
    assert.match(email.body.text, /Contact NCO Logger: https:\/\/logger\.westvalleyarc\.com\/views\/contact/);
    assert.doesNotMatch(email.body.html, /mailto:|logger@westvalleyarc\.com/);
    assert.doesNotMatch(email.body.text, /logger@westvalleyarc\.com/);
    const delivery = await captureDelivery(email, ['operator@example.com']);
    assert.equal(delivery.from, conf.email_from);
    assert.equal(delivery.replyTo, conf.email_reply_to);
});

test('contact delivery is branded, escaped, and uses only the validated visitor Reply-To override', async () => {
    const email = new ContactFormMessage({
        name: 'Alex <Admin>',
        callSign: 'W1ABC',
        email: 'visitor@example.com',
        subject: 'Question\r\nBcc: attacker@example.com',
        message: '<script>alert(1)</script>\nSecond line'
    });
    assert.match(email.body.html, /NCO_Logger_Logo_compact\.png/);
    assert.match(email.body.html, /alt="NCO Logger"/);
    assert.doesNotMatch(email.body.html, />NCO LOGGER<\/div>/);
    assert.match(email.body.html, /Alex &lt;Admin&gt;/);
    assert.match(email.body.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;<br>Second line/);
    assert.doesNotMatch(email.body.html, /<script>|mailto:/);
    assert.doesNotMatch(email.body.subject, /[\r\n]/);
    assert.match(email.body.text, /Email: visitor@example\.com/);
    assert.match(email.body.text, /Message:\n<script>alert\(1\)<\/script>\nSecond line/);
    const delivery = await captureDelivery(email, ['logger@westvalleyarc.com']);
    assert.equal(delivery.from, conf.email_from);
    assert.equal(delivery.replyTo, 'visitor@example.com');
    assert.deepEqual(delivery.to, ['logger@westvalleyarc.com']);
});

test('contact Reply-To rejects CR/LF header injection', () => {
    assert.throws(() => new ContactFormMessage({
        name: 'Alex',
        email: 'visitor@example.com\r\nBcc: attacker@example.com',
        subject: 'Question',
        message: 'Hello'
    }), /single email/);
});
