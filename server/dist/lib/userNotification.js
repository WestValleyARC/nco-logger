/* hamlive-oss — MIT License. See LICENSE. */
const nodemailer = require('nodemailer');
const humanizeDuration = require('humanize-duration');
const slugify = require('slugify');
const mongoose = require('mongoose');
const validator = require('validator');
const { getUserProfile } = require('../models/userProfile');
const { conf } = require('./configLib');
const { getFlexOptionsByUser, fetchChatLog } = require('./serverUtils');
const { logger } = require('./logger');
const {
    applyDeliveryPolicy,
    configuredSender,
    createContactReplyToOverride
} = require('./email/deliveryPolicy');
const { renderEmail } = require('./email/renderEmail');
const { absoluteAppUrl } = require('./email/urls');

const emailEnabled = conf.mail_transport === 'smtp' && Boolean(conf.smtp_host);
const EMAIL_FROM = configuredSender({ emailFrom: conf.email_from, smtpEnabled: emailEnabled });
const bool = value => value === true || value === 'true';
let transporter;

const getTransporter = () => {
    if (!emailEnabled) return null;
    if (!transporter) {
        const auth = conf.smtp_user || conf.smtp_pass ? { user: conf.smtp_user || '', pass: conf.smtp_pass || '' } : undefined;
        let name;
        try { name = new URL(conf.base_url).hostname; }
        catch (_err) { name = undefined; }
        transporter = nodemailer.createTransport({
            host: conf.smtp_host,
            port: Number(conf.smtp_port) || 587,
            secure: bool(conf.smtp_secure),
            requireTLS: conf.smtp_require_tls === undefined ? true : bool(conf.smtp_require_tls),
            ...(name ? { name } : {}),
            auth
        });
    }
    return transporter;
};

const verifyTransport = async () => {
    if (!emailEnabled) {
        logger.info('SMTP delivery disabled; console delivery is available only in development');
        return false;
    }
    try {
        await getTransporter().verify();
        logger.info('SMTP connection verified');
        return true;
    } catch (err) {
        logger.warn(`SMTP verification failed; application will continue: ${err.message}`);
        return false;
    }
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const formatInactivityDuration = durationMs => humanizeDuration(durationMs, {
    largest: 2, round: true, delimiter: ' ', units: ['h', 'm']
});

class EmailBase {
    #subject;
    #message;
    #body;
    #replyToOverride;
    constructor({ subject, message, body, replyToOverride } = {}) {
        this.#subject = subject;
        this.#message = message;
        this.#body = body;
        this.#replyToOverride = replyToOverride;
        if (!body && !(subject && message)) throw new Error('If body is missing, subject and message are required');
    }
    get body() { return this.#body; }
    previewMailToAddrs(recipients) {
        if (!Array.isArray(recipients) || !recipients.length) throw new Error('Recipients must be a non-empty array');
        const unique = [...new Set(recipients)];
        if (!unique.every(email => validator.isEmail(email))) throw new Error('Recipients contain invalid email addresses');
        const subject = this.#subject || this.#body?.subject;
        const message = this.#body ? { ...this.#body, to: unique } : {
            from: EMAIL_FROM, to: unique, subject, html: this.#message, text: subject
        };
        return applyDeliveryPolicy(message, {
            emailFrom: conf.email_from,
            emailReplyTo: conf.email_reply_to,
            smtpEnabled: emailEnabled,
            replyToOverride: this.#replyToOverride
        });
    }
    async sendMailToAddrs(recipients) {
        const emailData = this.previewMailToAddrs(recipients);
        return this.sendEmailWithRetry(emailData, emailData.to.length);
    }
    async sendEmailWithRetry(emailData, recipientCount) {
        if (!emailEnabled) {
            logger.info(`[email disabled] Would send "${emailData.subject || '(email)'}" to ${recipientCount} recipient(s)`);
            return { console: true };
        }
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const result = await getTransporter().sendMail(emailData);
                logger.info(`Email accepted by SMTP for ${recipientCount} recipient(s)`);
                return result;
            } catch (err) {
                const permanentFailure = Number(err.responseCode) >= 500;
                if (permanentFailure || attempt === 3) {
                    logger.error(`SMTP delivery failed after ${attempt} attempt(s): ${err.message}`);
                    throw err;
                }
                logger.warn(`SMTP delivery attempt ${attempt} failed; retrying`);
                await delay(250 * 2 ** (attempt - 1));
            }
        }
    }
    async sendMailToUPIDs({ upids, db = mongoose.connection, throwOnError = false }) {
        try {
            if (!Array.isArray(upids) || !upids.length) throw new Error('UPIDs must be a non-empty array');
            const UserProfile = getUserProfile(db);
            const users = (await Promise.all(upids.map(upid => UserProfile.findById(upid)))).filter(Boolean);
            const options = await Promise.all(users.map(user => getFlexOptionsByUser({ user, cachedResponse: false, db })));
            const recipients = users.filter((_user, index) => options[index].email).map(user => user.email);
            if (recipients.length) return await this.sendMailToAddrs(recipients);
            logger.info(`All intended recipients of "${this.#subject || this.#body?.subject}" have email disabled`);
            return false;
        } catch (err) {
            logger.error(`User notification failed; application will continue: ${err.message}`);
            if (throwOnError) throw err;
            return false;
        }
    }
    async sendOperationalMailToUPIDs({ upids, db = mongoose.connection, throwOnError = false }) {
        try {
            if (!Array.isArray(upids) || !upids.length) throw new Error('UPIDs must be a non-empty array');
            const UserProfile = getUserProfile(db);
            const users = (await Promise.all(upids.map(upid => UserProfile.findById(upid)))).filter(Boolean);
            const recipients = users.map(user => user.email);
            if (recipients.length) return await this.sendMailToAddrs(recipients);
            logger.info(`No valid recipients found for mandatory operational email "${this.#subject || this.#body?.subject}"`);
            return false;
        } catch (err) {
            logger.error(`Operational user notification failed; application will continue: ${err.message}`);
            if (throwOnError) throw err;
            return false;
        }
    }
}

class NetAnnounceStart extends EmailBase {
    constructor({ netControl, netProfileDoc: { title }, liveNetDoc: { countdownTimer, url } }) {
        const humanTime = countdownTimer <= 1 ? 'now' : `in ${humanizeDuration(countdownTimer * 60000, {
            largest: 2, round: true, delimiter: ' ', units: ['h', 'm']
        })}`;
        const subject = `${title} is going live ${humanTime}`;
        super({ body: renderEmail({
            baseUrl: conf.base_url,
            subject,
            preheader: `${title} is going live ${humanTime}.`,
            heading: `${title} is going live ${humanTime}`,
            blocks: [
                { type: 'paragraph', text: `${netControl} initiated the start of ${title}, which is going live ${humanTime}.` },
                { type: 'paragraph', text: 'You received this message because you follow this net.' }
            ],
            cta: { label: 'Open Live Net', path: url },
            secondaryLinks: [{ label: 'Manage Email Notifications', path: '/views/dataprivacy' }]
        }) });
    }
}

class NetScheduledReminder extends EmailBase {
    constructor({ netProfileDoc: { _id, title }, startAt, timezone }) {
        const scheduledTime = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short'
        }).format(startAt);
        const subject = `${title} is scheduled to begin soon`;
        super({ body: renderEmail({
            baseUrl: conf.base_url,
            subject,
            preheader: `${title} is scheduled for ${scheduledTime}.`,
            heading: `${title} begins soon`,
            blocks: [
                { type: 'paragraph', text: `${title} is scheduled to begin in approximately 10 minutes, at ${scheduledTime}.` },
                { type: 'paragraph', text: 'You received this message because you follow this net.' }
            ],
            cta: { label: 'Open Live Net', path: `/views/livenet/${_id}` },
            secondaryLinks: [{ label: 'Manage Email Notifications', path: '/views/dataprivacy' }],
            automatedNotice: "This reminder was generated automatically from the net's published schedule."
        }) });
    }
}

class MagicSignInEmail extends EmailBase {
    constructor({ href }) {
        super({ body: renderEmail({
            baseUrl: conf.base_url,
            subject: 'Sign in to NCO Logger',
            preheader: 'Use your secure link to sign in to NCO Logger.',
            heading: 'Sign in to NCO Logger',
            blocks: [
                { type: 'paragraph', text: 'A sign-in link was requested for your email address.' },
                { type: 'paragraph', text: 'If you did not request this link, you can safely ignore this email.' }
            ],
            cta: { label: 'Sign In to NCO Logger', path: href }
        }) });
    }
}

class AccountInactivityWarning extends EmailBase {
    constructor() {
        super({ body: renderEmail({
            baseUrl: conf.base_url,
            subject: 'NCO Logger account inactivity warning',
            preheader: 'Sign in within 30 days to keep your NCO Logger account.',
            heading: 'Your NCO Logger account needs attention',
            blocks: [
                { type: 'paragraph', text: 'Your NCO Logger account has been inactive for approximately three years.' },
                { type: 'paragraph', text: 'To keep your account, sign in to NCO Logger within 30 days of this warning. Signing in counts as account activity.' },
                { type: 'paragraph', text: 'If you do not sign in during that period, your account will be scheduled for deletion due to inactivity.' }
            ],
            cta: { label: 'Sign In to NCO Logger', path: '/views/login' },
            automatedNotice: 'This account notice was generated automatically by NCO Logger.'
        }) });
    }
}

class ContactFormMessage extends EmailBase {
    constructor({ name, callSign, email, subject, message }) {
        const safeSubject = subject.replace(/[\r\n]+/g, ' ').trim();
        const details = [
            { label: 'Name', value: name },
            ...(callSign ? [{ label: 'Callsign', value: callSign }] : []),
            { label: 'Email', value: email },
            { label: 'Subject', value: safeSubject }
        ];
        super({
            replyToOverride: createContactReplyToOverride(email),
            body: renderEmail({
                baseUrl: conf.base_url,
                subject: `NCO Logger contact: ${safeSubject}`,
                preheader: `New Contact NCO Logger submission from ${name}.`,
                heading: 'New Contact NCO Logger submission',
                blocks: [
                    { type: 'details', items: details },
                    { type: 'message', label: 'Message', text: message }
                ]
            })
        });
    }
}

class NetInactivityAutoClose extends EmailBase {
    constructor({ title, abandonmentMinutes, inactivityDurationMs }) {
        // Main Development owns the configuration and passes abandonmentMinutes. The millisecond
        // input keeps this worktree compatible until its hardening changes are merged.
        const resolvedMinutes = abandonmentMinutes ?? inactivityDurationMs / 60000;
        if (!Number.isFinite(resolvedMinutes) || resolvedMinutes <= 0) {
            throw new Error('Auto-close abandonmentMinutes is required for email wording');
        }
        const inactivityDuration = formatInactivityDuration(resolvedMinutes * 60000);
        super({ body: renderEmail({
            baseUrl: conf.base_url,
            subject: `NCO Logger automatically closed ${title}`,
            preheader: `${title} was automatically closed after prolonged operator inactivity.`,
            heading: `${title} was automatically closed`,
            blocks: [
                { type: 'paragraph', text: `NCO Logger did not detect an active NCO or a present owner/co-owner for approximately ${inactivityDuration}, so it automatically closed the net.` },
                { type: 'paragraph', text: 'This prevents an abandoned net from remaining ON AIR. You can start the net again if needed.' },
                { type: 'paragraph', text: 'You received this mandatory operational notice because you are an owner or co-owner of the net.' }
            ],
            automatedNotice: 'This operational notice was generated automatically by NCO Logger.'
        }) });
    }
}

class NetCloseReport extends EmailBase {
    static async init({
        netProfileDoc: { id: NPID, title },
        liveNetDoc: { url, started, startedAt },
        attendees,
        fetchChat = fetchChatLog
    }) {
        let chatLog = '';
        try { chatLog = await fetchChat({ NPID, since: attendees[0]?.checkedInAt }); }
        catch (err) { logger.warn(`Chat history unavailable during net-close report: ${err.message}`); }
        const priority = { netcontrol: 1, netlogger: 2, netrelay: 3 };
        const sorted = [...attendees].sort((a, b) => (priority[a.role] || 4) - (priority[b.role] || 4) || new Date(a.checkedInAt) - new Date(b.checkedInAt));
        const formattedAttendees = sorted.map(a => ({
            callSign: a.callSign,
            role: a.role === 'netcontrol' ? 'NCS' : a.role === 'netrelay' ? 'Relay' : a.role === 'netlogger' ? 'Logger' : '',
            checkInIsoDate: new Date(a.checkedInAt).toISOString(),
            checkInTime: new Date(a.checkedInAt).toUTCString().split(' ').slice(4).join(' '),
            displayName: a.displayName || '', location: a.location || '', sigReport: a.rst || '', highlight: Boolean(a.highlight)
        }));
        const subject = `${title} - Net Close Report`;
        const startedAtString = started ? new Date(startedAt).toUTCString() : '';
        const rendered = renderEmail({
            baseUrl: conf.base_url,
            subject,
            preheader: `Close report for ${title}.`,
            heading: `${title} net-close report`,
            blocks: [
                ...(startedAtString ? [{ type: 'details', items: [{ label: 'Net start', value: startedAtString }] }] : []),
                {
                    type: 'table',
                    caption: 'Station information',
                    columns: ['Role', 'Callsign', 'Check-in time'],
                    rows: formattedAttendees.map(attendee => ({
                        values: [
                            attendee.role,
                            `${attendee.callSign}${attendee.sigReport ? ` (${attendee.sigReport})` : ''}`,
                            attendee.checkInTime
                        ],
                        highlight: attendee.highlight
                    }))
                }
            ],
            cta: { label: 'Open Net', path: url },
            secondaryLinks: [{ label: 'Manage Email Notifications', path: '/views/dataprivacy' }],
            automatedNotice: 'This report was generated automatically when the net closed.'
        });
        const attachments = NetCloseReport.createAttachments({ title, NPID, url, started, startedAt, formattedAttendees, chatLog });
        logger.info(`Generated report for ${title} with ${formattedAttendees.length} attendee(s)`);
        return new NetCloseReport({ body: { ...rendered, attachments } });
    }
    static createAttachments({ title, NPID, url, started, startedAt, formattedAttendees, chatLog }) {
        const csvEscape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const reportUrl = absoluteAppUrl(url, conf.base_url);
        const csv = [['Net', 'Callsign', 'Role', 'Highlighted', 'Check-In Date', 'Name', 'Location', 'SigReport', 'URL', 'Net ID', 'Net Start Date'], ...formattedAttendees.map(a => [title, a.callSign, a.role, a.highlight ? 'True' : '', a.checkInIsoDate, a.displayName, a.location, a.sigReport, reportUrl, NPID, started ? new Date(startedAt).toISOString() : ''])].map(row => row.map(csvEscape).join(',')).join('\n');
        const chat = `${title} (ID: ${NPID})\n\n${chatLog || '[ Empty Chat Log ]'}`;
        const slug = slugify(title, { replacement: '_', lower: true, strict: true, trim: true });
        const timestamp = startedAt ? new Date(startedAt).toISOString().replace(/[:.]/g, '-') : 'pre-start';
        return [
            { content: Buffer.from(csv), filename: `${slug}_${timestamp}_report.csv`, contentType: 'text/csv' },
            { content: Buffer.from(chat), filename: `${slug}_${timestamp}_chat.txt`, contentType: 'text/plain' }
        ];
    }
}

const netCloseReportRecipientIds = ({ ownerIds, superUserIds }) => [...ownerIds, ...superUserIds];

module.exports = {
    EmailBase,
    ContactFormMessage,
    MagicSignInEmail,
    AccountInactivityWarning,
    NetInactivityAutoClose,
    NetAnnounceStart,
    NetScheduledReminder,
    NetCloseReport,
    netCloseReportRecipientIds,
    formatInactivityDuration,
    emailEnabled,
    verifyTransport,
    getTransporter
};
