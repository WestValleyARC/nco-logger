const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { conf } = require('../server/dist/lib/configLib');

test('SMTP delivery retries with bounded attempts', async t => {
    conf.mail_transport = 'smtp';
    conf.smtp_host = 'smtp.example.test';
    conf.smtp_port = '587';
    conf.base_url = 'https://logger.westvalleyarc.com';
    conf.email_from = 'NCO Logger <logger@westvalleyarc.com>';
    let attempts = 0;
    let transportOptions;
    t.mock.method(nodemailer, 'createTransport', options => {
        transportOptions = options;
        return ({
        sendMail: async () => {
            attempts++;
            if (attempts < 3) throw new Error('temporary SMTP failure');
            return { accepted: ['test@example.com'] };
        },
        verify: async () => true
        });
    });
    delete require.cache[require.resolve('../server/dist/lib/userNotification')];
    const { EmailBase } = require('../server/dist/lib/userNotification');
    const email = new EmailBase({ subject: 'Retry', message: '<p>Retry</p>' });
    const result = await email.sendMailToAddrs(['test@example.com']);
    assert.equal(attempts, 3);
    assert.equal(transportOptions.name, 'logger.westvalleyarc.com');
    assert.deepEqual(result.accepted, ['test@example.com']);
});

test('SMTP does not retry a permanent rejection', async t => {
    conf.mail_transport = 'smtp';
    conf.smtp_host = 'smtp.example.test';
    conf.email_from = 'NCO Logger <logger@westvalleyarc.com>';
    let attempts = 0;
    t.mock.method(nodemailer, 'createTransport', () => ({
        sendMail: async () => {
            attempts++;
            const error = new Error('permanent SMTP rejection');
            error.responseCode = 550;
            throw error;
        },
        verify: async () => true
    }));
    delete require.cache[require.resolve('../server/dist/lib/userNotification')];
    const { EmailBase } = require('../server/dist/lib/userNotification');
    const email = new EmailBase({ subject: 'Rejected', message: '<p>Rejected</p>' });
    await assert.rejects(email.sendMailToAddrs(['test@example.com']), /permanent SMTP rejection/);
    assert.equal(attempts, 1);
});
