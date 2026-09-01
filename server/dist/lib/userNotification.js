/* hamlive-oss — MIT License. See LICENSE. */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const nodemailer = require('nodemailer');
const humanizeDuration = require('humanize-duration');
const slugify = require('slugify');
const mongoose = require('mongoose');
const validator = require('validator');
const { getUserProfile } = require('../models/userProfile');
const { conf } = require('./configLib');
const { getFlexOptionsByUser, fetchChatLog } = require('./serverUtils');
const { logger } = require('./logger');

const EMAIL_FROM = conf.email_from || `${conf.app_name || 'Ham.Live'} <no-reply@example.com>`;
const emailEnabled = conf.mail_transport === 'smtp' && Boolean(conf.smtp_host);
const template = fs.readFileSync(path.join(__dirname, '../views/email/net-close-report.ejs'), 'utf8');
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

class EmailBase {
    #subject;
    #message;
    #body;
    constructor({ subject, message, body } = {}) {
        this.#subject = subject;
        this.#message = message;
        this.#body = body;
        if (!body && !(subject && message)) throw new Error('If body is missing, subject and message are required');
    }
    get body() { return this.#body; }
    async sendMailToAddrs(recipients) {
        if (!Array.isArray(recipients) || !recipients.length) throw new Error('Recipients must be a non-empty array');
        const unique = [...new Set(recipients)];
        if (!unique.every(email => validator.isEmail(email))) throw new Error('Recipients contain invalid email addresses');
        const subject = this.#subject || this.#body?.subject;
        const emailData = this.#body ? { ...this.#body, to: unique } : {
            from: EMAIL_FROM, to: unique, subject, html: this.#message, text: subject
        };
        if (!emailData.from) emailData.from = EMAIL_FROM;
        if (conf.email_reply_to && !emailData.replyTo) emailData.replyTo = conf.email_reply_to;
        return this.sendEmailWithRetry(emailData, unique.length);
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
    async sendMailToUPIDs({ upids, db = mongoose.connection }) {
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
            return false;
        }
    }
}

class NetAnnounceStart extends EmailBase {
    constructor({ netControl, netProfileDoc: { title }, liveNetDoc: { countdownTimer, url } }) {
        const humanTime = countdownTimer <= 1 ? 'now' : `in ${humanizeDuration(countdownTimer * 60000, {
            largest: 2, round: true, delimiter: ' ', units: ['h', 'm']
        })}`;
        const fullUrl = `${conf.base_url}${url}`;
        const subject = `${title} is going live ${humanTime}`;
        super({ body: {
            from: EMAIL_FROM, subject,
            text: `${netControl} is starting ${title} ${humanTime}. Join at ${fullUrl}.`,
            html: `<p>${ejs.escapeXML(netControl)} is starting <a href="${ejs.escapeXML(fullUrl)}">${ejs.escapeXML(title)}</a> ${ejs.escapeXML(humanTime)}.</p>`
        } });
    }
}

class AccountInactivityWarning extends EmailBase {
    constructor() {
        const subject = 'NCO Logger account inactivity warning';
        const text = [
            'Your NCO Logger account has not been used for 3 years.',
            'It is scheduled for deletion in 30 days due to inactivity.',
            'Sign in to NCO Logger within those 30 days to keep your account active.',
            'Questions? Contact logger@westvalleyarc.com.'
        ].join('\n\n');
        const html = [
            '<p>Your NCO Logger account has not been used for 3 years.</p>',
            '<p>It is scheduled for deletion in 30 days due to inactivity.</p>',
            '<p>Sign in to NCO Logger within those 30 days to keep your account active.</p>',
            '<p>Questions? Contact <a href="mailto:logger@westvalleyarc.com">logger@westvalleyarc.com</a>.</p>'
        ].join('');
        super({ body: { from: EMAIL_FROM, subject, text, html } });
    }
}

class NetCloseReport extends EmailBase {
    static async init({ netProfileDoc: { id: NPID, title }, liveNetDoc: { url, started, startedAt }, attendees }) {
        let chatLog = '';
        try { chatLog = await fetchChatLog({ NPID, since: attendees[0]?.checkedInAt }); }
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
        const fullUrl = `${conf.base_url}${url}`;
        const startedAtString = started ? new Date(startedAt).toUTCString() : '';
        const html = ejs.render(template, { subject, title, url: fullUrl, startedAtString, formattedAttendees });
        const text = [subject, fullUrl, startedAtString && `Net start: ${startedAtString}`, '', ...formattedAttendees.map(a => `${a.role ? `[${a.role}] ` : ''}${a.callSign}${a.sigReport ? ` (${a.sigReport})` : ''} - ${a.checkInTime}`)].filter(Boolean).join('\n');
        const attachments = NetCloseReport.createAttachments({ title, NPID, url, started, startedAt, formattedAttendees, chatLog });
        logger.info(`Generated report for ${title} with ${formattedAttendees.length} attendee(s)`);
        return new NetCloseReport({ body: { from: EMAIL_FROM, subject, html, text, attachments } });
    }
    static createAttachments({ title, NPID, url, started, startedAt, formattedAttendees, chatLog }) {
        const csvEscape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const csv = [['Net', 'Callsign', 'Role', 'Highlighted', 'Check-In Date', 'Name', 'Location', 'SigReport', 'URL', 'Net ID', 'Net Start Date'], ...formattedAttendees.map(a => [title, a.callSign, a.role, a.highlight ? 'True' : '', a.checkInIsoDate, a.displayName, a.location, a.sigReport, `${conf.base_url}${url}`, NPID, started ? new Date(startedAt).toISOString() : ''])].map(row => row.map(csvEscape).join(',')).join('\n');
        const chat = `${title} (ID: ${NPID})\n\n${chatLog || '[ Empty Chat Log ]'}`;
        const slug = slugify(title, { replacement: '_', lower: true, strict: true, trim: true });
        const timestamp = startedAt ? new Date(startedAt).toISOString().replace(/[:.]/g, '-') : 'pre-start';
        return [
            { content: Buffer.from(csv), filename: `${slug}_${timestamp}_report.csv`, contentType: 'text/csv' },
            { content: Buffer.from(chat), filename: `${slug}_${timestamp}_chat.txt`, contentType: 'text/plain' }
        ];
    }
}

module.exports = {
    EmailBase,
    AccountInactivityWarning,
    NetAnnounceStart,
    NetCloseReport,
    emailEnabled,
    verifyTransport,
    getTransporter
};
