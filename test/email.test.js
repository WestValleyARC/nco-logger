const test = require('node:test');
const assert = require('node:assert/strict');
const { conf } = require('../server/dist/lib/configLib');

test('console email mode does not invoke SMTP and accepts multiple recipients', async () => {
    conf.mail_transport = 'console';
    conf.smtp_host = '';
    delete require.cache[require.resolve('../server/dist/lib/userNotification')];
    const { EmailBase } = require('../server/dist/lib/userNotification');
    const email = new EmailBase({ subject: 'Test', message: '<p>Test</p>' });
    assert.deepEqual(await email.sendMailToAddrs(['one@example.com', 'two@example.com']), { console: true });
});

test('net-close attachments include CSV and local chat text', () => {
    const { NetCloseReport } = require('../server/dist/lib/userNotification');
    const attachments = NetCloseReport.createAttachments({
        title: 'Test Net', NPID: '507f1f77bcf86cd799439011',
        started: true, startedAt: new Date('2026-08-28T12:00:00Z'),
        closedAt: new Date('2026-08-28T13:00:00Z'),
        formattedAttendees: [{ callSign: 'W1ABC', role: 'NCS', highlight: false, checkInIsoDate: '2026-08-28T12:00:00.000Z', displayName: 'Alex', location: 'Phoenix, AZ', sigReport: '59' }],
        chatLog: 'W1ABC: Local message\n\n'
    });
    assert.equal(attachments.length, 2);
    const csv = attachments[0].content.toString();
    assert.match(csv, /W1ABC/);
    assert.match(csv, /Net Close Date/);
    assert.match(csv, /2026-08-28T13:00:00.000Z/);
    assert.doesNotMatch(csv, /URL/);
    assert.match(attachments[1].content.toString(), /Local message/);
});

test('net-close report still renders when chat history retrieval fails', async () => {
    const localChat = require('../server/dist/lib/localChat');
    localChat.fetchChatHistory = async function* () { throw new Error('chat unavailable'); };
    delete require.cache[require.resolve('../server/dist/lib/serverUtils')];
    delete require.cache[require.resolve('../server/dist/lib/userNotification')];
    const { NetCloseReport } = require('../server/dist/lib/userNotification');
    const report = await NetCloseReport.init({
        netProfileDoc: { id: '507f1f77bcf86cd799439011', title: 'Fallback Net' },
        liveNetDoc: { url: '/views/livenet/test', started: true, startedAt: new Date('2026-08-28T12:00:00Z') },
        attendees: [{ callSign: 'W1ABC', role: 'netcontrol', checkedInAt: new Date('2026-08-28T12:00:00Z'), sigReports: { calculated: '59' } }]
    });
    assert.match(report.body.html, /NCO_Logger_Logo_compact\.png/);
    assert.match(report.body.text, /Close report for|net-close report/i);
    assert.match(report.body.attachments[1].content.toString(), /Empty Chat Log/);
});
