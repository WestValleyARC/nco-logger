const test = require('node:test');
const assert = require('node:assert/strict');
const { conf } = require('../server/dist/lib/configLib');

conf.base_url = 'https://logger.westvalleyarc.com';
conf.email_from = 'NCO Logger <logger@westvalleyarc.com>';
conf.email_reply_to = 'logger@westvalleyarc.com';

const serverUtils = require('../server/dist/lib/serverUtils');
serverUtils.fetchChatLog = async () => 'W1ABC: Test chat entry\n';

const {
    EmailBase,
    NetAnnounceStart,
    NetInactivityAutoClose,
    NetScheduledReminder,
    NetCloseReport,
    netCloseReportRecipientIds
} = require('../server/dist/lib/userNotification');
const {
    DEFAULT_REPLY_TO,
    applyDeliveryPolicy
} = require('../server/dist/lib/email/deliveryPolicy');
const { defaultSendInactivityEmail } = require('../server/dist/lib/scheduling/hardening');

const reportSnapshot = {
    title: 'Idle Test Net', NPID: '507f1f77bcf86cd799439011', started: true,
    startedAt: new Date('2030-01-01T19:00:00.000Z'),
    closedAt: new Date('2030-01-01T20:00:00.000Z'), timezone: 'UTC',
    formattedAttendees: [{
        callSign: 'W1ABC', role: 'NCS', highlight: false,
        checkInIsoDate: '2030-01-01T19:00:00.000Z', checkInTime: '7:00:00 PM UTC',
        displayName: 'Alex', location: 'Phoenix, AZ', sigReport: '59'
    }],
    chatLog: 'W1ABC: Captured auto-close chat\n'
};

test('manual start email is branded and retains countdown, follower reason, preference link, and Live Net URL', () => {
    const email = new NetAnnounceStart({
        netControl: 'N0CALL',
        netProfileDoc: { title: 'Manual Test Net' },
        liveNetDoc: { countdownTimer: 15, url: '/views/livenet/manual-id' }
    });
    assert.match(email.body.html, /NCO_Logger_Logo_compact\.png/);
    assert.match(email.body.text, /going live in 15 minutes/);
    assert.match(email.body.text, /N0CALL initiated the start/);
    assert.match(email.body.text, /because you follow this net/);
    assert.match(email.body.text, /Open Live Net: https:\/\/logger\.westvalleyarc\.com\/views\/livenet\/manual-id/);
    assert.match(email.body.text, /Manage Email Notifications: https:\/\/logger\.westvalleyarc\.com\/views\/dataprivacy/);
});

test('scheduled reminder is branded and includes actual time, policy wording, preference link, and Live Net URL', () => {
    const email = new NetScheduledReminder({
        netProfileDoc: { _id: 'scheduled-id', title: 'Scheduled Test Net' },
        startAt: new Date('2030-01-01T19:00:00.000Z'),
        timezone: 'UTC'
    });
    assert.match(email.body.html, /NCO_Logger_Logo_compact\.png/);
    assert.match(email.body.text, /approximately 10 minutes/);
    assert.match(email.body.text, /Tuesday, January 1, 2030 at 7:00 PM UTC/);
    assert.match(email.body.text, /published schedule/);
    assert.match(email.body.text, /because you follow this net/);
    assert.match(email.body.text, /https:\/\/logger\.westvalleyarc\.com\/views\/livenet\/scheduled-id/);
    assert.match(email.body.text, /https:\/\/logger\.westvalleyarc\.com\/views\/dataprivacy/);
});

test('preference-filtered and mandatory operational UPID delivery remain distinct', async () => {
    const users = {
        enabled: { id: 'enabled', email: 'enabled@example.com', flexOptions: { option: { email: true } } },
        disabled: { id: 'disabled', email: 'disabled@example.com', flexOptions: { option: { email: false } } }
    };
    const db = {
        model(name) {
            if (name === 'UserProfile') return { findById: async id => users[id] };
            if (name === 'FlexOption') return {
                findOne: async () => ({ option: { email: true }, toObject: () => ({ option: { email: true } }) })
            };
            throw new Error(`Unexpected model: ${name}`);
        }
    };
    const email = new EmailBase({ body: { subject: 'Policy test', html: '<p>Test</p>', text: 'Test' } });
    const deliveries = [];
    email.sendMailToAddrs = async recipients => deliveries.push(recipients);
    await email.sendMailToUPIDs({ upids: ['enabled', 'disabled'], db, throwOnError: true });
    await email.sendOperationalMailToUPIDs({ upids: ['enabled', 'disabled'], db, throwOnError: true });
    assert.deepEqual(deliveries, [
        ['enabled@example.com'],
        ['enabled@example.com', 'disabled@example.com']
    ]);
});

test('auto-close notice is branded, owner-specific, and uses mandatory operational delivery', async t => {
    const email = new NetInactivityAutoClose({
        title: 'Idle Test Net', abandonmentMinutes: 30, reportSnapshot
    });
    assert.match(email.body.html, /NCO_Logger_Logo_compact\.png/);
    assert.match(email.body.text, /approximately 30 minutes/);
    assert.match(email.body.text, /active NCO or a present owner\/co-owner/);
    assert.match(email.body.text, /automatically closed/);
    assert.match(email.body.text, /Closing a net when finished/);
    assert.match(email.body.text, /red Close Net button in Station Controls/);
    assert.match(email.body.html, /https:\/\/logger\.westvalleyarc\.com\/img\/email\/station-controls-close-net\.png/);
    assert.match(email.body.html, /alt="Station Controls showing the red Close Net button"/);
    assert.match(email.body.html, /width="542" height="380"/);
    assert.doesNotMatch(email.body.text, /\[Image:/);
    assert.match(email.body.text, /mandatory operational notice/);
    assert.equal(email.body.attachments.length, 2);
    const csv = email.body.attachments[0].content.toString();
    assert.match(csv, /Net Close Date/);
    assert.doesNotMatch(csv, /URL/);
    assert.match(email.body.attachments[1].content.toString(), /Captured auto-close chat/);
    let sent;
    t.mock.method(NetInactivityAutoClose.prototype, 'sendOperationalMailToUPIDs', async options => {
        sent = options;
        return true;
    });
    const ownerIds = ['owner-id', 'co-owner-id'];
    await defaultSendInactivityEmail({
        event: { netTitle: 'Idle Test Net', ownerIds, reportSnapshot }, db: { marker: true }
    });
    assert.deepEqual(sent.upids, ownerIds);
    assert.equal(sent.throwOnError, true);
});

test('auto-close retry construction reuses its saved report snapshot', () => {
    const firstAttempt = new NetInactivityAutoClose({
        title: 'Idle Test Net', abandonmentMinutes: 45, reportSnapshot
    });
    const retryAttempt = new NetInactivityAutoClose({
        title: 'Idle Test Net', abandonmentMinutes: 45, reportSnapshot
    });
    assert.equal(firstAttempt.body.attachments.length, 2);
    assert.deepEqual(
        retryAttempt.body.attachments.map(item => item.content.toString()),
        firstAttempt.body.attachments.map(item => item.content.toString())
    );
    assert.match(retryAttempt.body.text, /approximately 45 minutes/);
});

test('auto-close duration wording consumes abandonmentMinutes without a fixed timeout', () => {
    const thirty = new NetInactivityAutoClose({ title: 'Thirty Minute Net', abandonmentMinutes: 30 });
    const fortyFive = new NetInactivityAutoClose({ title: 'Forty-Five Minute Net', abandonmentMinutes: 45 });
    for (const email of [thirty, fortyFive]) {
        assert.match(email.body.html, /NCO_Logger_Logo_compact\.png/);
        assert.ok(email.body.text);
        assert.doesNotMatch(email.body.text, /approximately (?:1|one) hour|approximately 60 minutes/i);
    }
    assert.match(thirty.body.html, /approximately 30 minutes/);
    assert.match(thirty.body.text, /approximately 30 minutes/);
    assert.match(fortyFive.body.html, /approximately 45 minutes/);
    assert.match(fortyFive.body.text, /approximately 45 minutes/);
});

test('net-close report includes close details, timezone, and updated attachments', async () => {
    const report = await NetCloseReport.init({
        netProfileDoc: { id: '507f1f77bcf86cd799439011', title: 'Close Test Net' },
        liveNetDoc: {
            url: '/views/livenet/507f1f77bcf86cd799439011',
            started: true,
            startedAt: new Date('2030-01-01T19:00:00.000Z')
        },
        closedAt: new Date('2030-01-01T20:00:00.000Z'),
        timezone: 'America/Phoenix',
        attendees: [{
            callSign: 'W1ABC', role: 'netcontrol', checkedInAt: new Date('2030-01-01T19:00:00.000Z'),
            displayName: 'Alex', location: 'Phoenix, AZ', rst: '59', highlight: true
        }]
    });

    assert.match(report.body.html, /NCO_Logger_Logo_compact\.png/);
    assert.match(report.body.html, /Station information/);
    assert.match(report.body.text, /W1ABC \(59\)/);
    assert.match(report.body.text, /Net closed/);
    assert.match(report.body.text, /Total check-ins: 1/);
    assert.match(report.body.text, /MST/);
    assert.doesNotMatch(report.body.text, /Manage Email Notifications/);

    assert.equal(report.body.attachments.length, 2);
    assert.equal(report.body.attachments[0].contentType, 'text/csv');
    assert.equal(report.body.attachments[1].contentType, 'text/plain');

    const csv = report.body.attachments[0].content.toString();
    assert.match(csv, /Net Close Date/);
    assert.match(csv, /2030-01-01T20:00:00\.000Z/);
    assert.doesNotMatch(csv, /URL/);
    assert.doesNotMatch(csv, /https:\/\//);
    assert.match(report.body.attachments[1].content.toString(), /Test chat entry/);
});

test('normal delivery headers remain canonical for all net email types', () => {
    const headers = applyDeliveryPolicy(
        { subject: 'Net message' },
        { emailFrom: conf.email_from, emailReplyTo: conf.email_reply_to, smtpEnabled: true }
    );
    assert.equal(headers.from, conf.email_from);
    assert.equal(headers.replyTo, DEFAULT_REPLY_TO);
});

test('net-close recipient policy remains owners, co-owners, and superusers', () => {
    assert.deepEqual(netCloseReportRecipientIds({
        ownerIds: ['owner', 'co-owner'],
        superUserIds: ['superuser']
    }), ['owner', 'co-owner', 'superuser']);
});
