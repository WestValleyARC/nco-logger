/* hamlive-oss — MIT License. See LICENSE. */

const validator = require('validator');

const SENDER_NAME = 'NCO Logger';
const DEFAULT_REPLY_TO = 'logger@westvalleyarc.com';
const issuedReplyToOverrides = new WeakSet();

const plainEmail = (value, label) => {
    if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error(`${label} must be a single email address`);
    const email = value.trim();
    if (!validator.isEmail(email)) throw new Error(`${label} must be a valid email address`);
    return email;
};

const configuredSender = ({ emailFrom, smtpEnabled }) => {
    if (!emailFrom) {
        if (smtpEnabled) throw new Error('EMAIL_FROM is required when SMTP delivery is enabled');
        return undefined;
    }
    if (typeof emailFrom !== 'string' || /[\r\n]/.test(emailFrom)) {
        throw new Error('EMAIL_FROM must be a single NCO Logger mailbox');
    }
    const match = emailFrom.trim().match(/^NCO Logger\s*<([^<>]+)>$/);
    if (!match) throw new Error('EMAIL_FROM must use the format "NCO Logger <address@example.com>"');
    return `${SENDER_NAME} <${plainEmail(match[1], 'EMAIL_FROM address')}>`;
};

const createContactReplyToOverride = email => {
    const override = Object.freeze({ email: plainEmail(email, 'Contact Reply-To') });
    issuedReplyToOverrides.add(override);
    return override;
};

const deliveryHeaders = ({ emailFrom, emailReplyTo, smtpEnabled, replyToOverride } = {}) => {
    let replyTo = plainEmail(emailReplyTo || DEFAULT_REPLY_TO, 'EMAIL_REPLY_TO');
    if (replyToOverride !== undefined) {
        if (!replyToOverride || !issuedReplyToOverrides.has(replyToOverride)) {
            throw new Error('Reply-To overrides must be created by the contact email policy');
        }
        replyTo = replyToOverride.email;
    }
    const from = configuredSender({ emailFrom, smtpEnabled });
    return from ? { from, replyTo } : { replyTo };
};

const applyDeliveryPolicy = (message, options) => {
    const {
        from: _from,
        replyTo: _replyTo,
        sender: _sender,
        envelope: _envelope,
        headers: _headers,
        ...safeMessage
    } = message || {};
    return { ...safeMessage, ...deliveryHeaders(options) };
};

module.exports = {
    DEFAULT_REPLY_TO,
    SENDER_NAME,
    applyDeliveryPolicy,
    configuredSender,
    createContactReplyToOverride,
    deliveryHeaders
};
