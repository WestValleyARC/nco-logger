const {
    AccountInactivityWarning,
    ContactFormMessage,
    MagicSignInEmail,
    NetAnnounceStart,
    NetCloseReport,
    NetInactivityAutoClose,
    NetScheduledReminder
} = require('../../server/dist/lib/userNotification');

const reviewFixture = (id, email, recipients) => {
    const delivery = email.previewMailToAddrs(recipients);
    return {
        id,
        subject: delivery.subject,
        html: delivery.html,
        text: delivery.text,
        from: delivery.from,
        replyTo: delivery.replyTo,
        to: delivery.to,
        links: [...delivery.html.matchAll(/href="([^"]+)"/g)].map(match => match[1]),
        attachments: (delivery.attachments || []).map(attachment => ({
            filename: attachment.filename,
            contentType: attachment.contentType
        }))
    };
};

const buildEmailReviewFixtures = async () => {
    const autoCloseSnapshot = {
        title: 'WVARC Tuesday Net', NPID: '507f1f77bcf86cd799439011', started: true,
        startedAt: new Date('2030-01-01T19:00:00.000Z'),
        closedAt: new Date('2030-01-01T20:00:00.000Z'), timezone: 'America/Phoenix',
        formattedAttendees: [{
            callSign: 'W1ABC', role: 'NCS', checkInIsoDate: '2030-01-01T19:00:00.000Z',
            checkInTime: '12:00:00 PM MST', displayName: 'Alex', location: 'Phoenix, AZ',
            sigReport: '59', highlight: true
        }],
        chatLog: 'W1ABC: Sample review chat entry\n'
    };
    const report = await NetCloseReport.init({
        netProfileDoc: { id: '507f1f77bcf86cd799439011', title: 'WVARC Tuesday Net' },
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
        }],
        fetchChat: async () => 'W1ABC: Sample review chat entry\n'
    });
    return [
        reviewFixture('magic-sign-in', new MagicSignInEmail({
            href: '/auth/magiclogin/callback?token=review-token'
        }), ['operator@example.com']),
        reviewFixture('account-inactivity-warning', new AccountInactivityWarning(), ['operator@example.com']),
        reviewFixture('contact-form-delivery', new ContactFormMessage({
            name: 'Alex Operator', callSign: 'W1ABC', email: 'visitor@example.com',
            subject: 'Review question', message: 'This is a representative contact message.'
        }), ['logger@westvalleyarc.com']),
        reviewFixture('manual-net-start', new NetAnnounceStart({
            netControl: 'N0CALL', netProfileDoc: { title: 'WVARC Tuesday Net' },
            liveNetDoc: { countdownTimer: 15, url: '/views/livenet/507f1f77bcf86cd799439011' }
        }), ['follower@example.com']),
        reviewFixture('scheduled-reminder', new NetScheduledReminder({
            netProfileDoc: { _id: '507f1f77bcf86cd799439011', title: 'WVARC Tuesday Net' },
            startAt: new Date('2030-01-01T19:00:00.000Z'), timezone: 'America/Phoenix'
        }), ['follower@example.com']),
        reviewFixture('inactivity-auto-close', new NetInactivityAutoClose({
            title: 'WVARC Tuesday Net', abandonmentMinutes: 30,
            reportSnapshot: autoCloseSnapshot
        }), ['owner@example.com', 'co-owner@example.com']),
        reviewFixture('net-close-report', report, ['owner@example.com', 'superuser@example.com'])
    ];
};

module.exports = { buildEmailReviewFixtures };
