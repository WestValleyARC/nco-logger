/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const { populate, authCheck, REQ_CALLSIGN, REQ_LOGIN } = require('../lib/serverUtils');
const NetProfile = require('../models/netProfile').getNetProfile(null);
const LiveNet = require('../models/liveNet').getLiveNet(null);
const ScheduledOccurrence = require('../models/scheduledOccurrence').getScheduledOccurrence(null);
const { canAccessScheduledPreparation } = require('../lib/scheduling/lifecycle');
const { logger } = require('../lib/logger');
const validator = require('validator');
const { ContactFormMessage } = require('../lib/userNotification');

const CONTACT_RECIPIENT = 'logger@westvalleyarc.com';
const CONTACT_LIMITS = Object.freeze({ name: 100, callSign: 20, email: 254, subject: 150, message: 5000 });
const CONTACT_RATE_LIMIT_COUNT = 3;
const CONTACT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const contactRateLimits = new Map();

const contactFormValues = body => ({
    name: typeof body?.name === 'string' ? body.name.trim() : '',
    callSign: typeof body?.callSign === 'string' ? body.callSign.trim() : '',
    email: typeof body?.email === 'string' ? body.email.trim() : '',
    subject: typeof body?.subject === 'string' ? body.subject.trim() : '',
    message: typeof body?.message === 'string' ? body.message.trim() : ''
});

const validateContactForm = body => {
    const values = contactFormValues(body);
    const errors = {};
    for (const field of ['name', 'email', 'subject', 'message']) {
        if (!values[field]) errors[field] = 'This field is required.';
    }
    for (const [field, maximum] of Object.entries(CONTACT_LIMITS)) {
        if (values[field].length > maximum) errors[field] = `Enter no more than ${maximum} characters.`;
    }
    if (values.email && values.email.length <= CONTACT_LIMITS.email && !validator.isEmail(values.email)) {
        errors.email = 'Enter a valid email address.';
    }
    return { values, errors };
};

const contactRateLimitAllows = (key, now = Date.now()) => {
    if (contactRateLimits.size > 500) {
        for (const [storedKey, entry] of contactRateLimits) {
            if (now - entry.startedAt >= CONTACT_RATE_LIMIT_WINDOW_MS) contactRateLimits.delete(storedKey);
        }
    }
    const current = contactRateLimits.get(key);
    if (!current || now - current.startedAt >= CONTACT_RATE_LIMIT_WINDOW_MS) {
        contactRateLimits.set(key, { startedAt: now, count: 1 });
        return true;
    }
    if (current.count >= CONTACT_RATE_LIMIT_COUNT) return false;
    current.count++;
    return true;
};

router.get('/livenet/:id', authCheck(REQ_CALLSIGN), async (req, res) => {
    try {
        const npid = req.params.id;
        const netProfile = await NetProfile.findById(npid);
        if (!netProfile) return res.redirect('/views/dashboard');
        const liveNet = netProfile.liveNet ? await LiveNet.findById(netProfile.liveNet) : null;
        const occurrence = liveNet?.occurrence
            ? await ScheduledOccurrence.findById(liveNet.occurrence)
            : await ScheduledOccurrence.findOne({
                  netProfile: npid,
                  status: { $in: ['scheduled', 'preparing'] },
                  startAt: { $gt: new Date() }
              }).sort({ startAt: 1 });
        const scheduledPreparation = Boolean(liveNet?.occurrence && !liveNet.started);
        const mayPrepare = scheduledPreparation && canAccessScheduledPreparation({
            netProfile,
            liveNet,
            occurrence,
            user: req.user
        });
        const showLogger = Boolean(liveNet) && (!scheduledPreparation || mayPrepare);
        const ejsData = {
            NPID: npid,
            PERM: Boolean(netProfile.permanent),
            TITLE: netProfile.title,
            SCHEDULED_START_AT: occurrence?.startAt?.toISOString() || '',
            VIEW: showLogger ? 'liveNet' : 'netNotRunning'
        };
        return res.render(ejsData.VIEW, populate(req, res, ejsData));
    } catch (err) {
        res.redirect('/views/dashboard');
        logger.error(err.stack);
    }
});

router.get('/myaccount', authCheck(REQ_LOGIN), (req, res) => {
    res.render('myAccount', populate(req, res, { VIEW: 'myAccount' }));
});

router.get('/dataprivacy', authCheck(REQ_LOGIN), (req, res) => {
    res.render('dataPrivacy', populate(req, res, { VIEW: 'dataPrivacy' }));
});

router.get('/favorites', authCheck(REQ_LOGIN), (req, res) => {
    res.render('favorites', populate(req, res, { VIEW: 'favorites' }));
});

router.get('/dashboard', (req, res) => {
    res.render('dashboard', populate(req, res, { VIEW: 'dashboard' }));
});

router.get('/livenets', (req, res) => {
    res.render('liveNets', populate(req, res, { VIEW: 'liveNets' }));
});

router.get('/schedule', (req, res) => {
    res.render('netSchedule', populate(req, res, { VIEW: 'netSchedule' }));
});

router.get('/intro', (_req, res) => {
    res.redirect('/views/dashboard');
});

router.get('/guide', (req, res) => {
    res.render('guide', populate(req, res, { VIEW: 'guide' }));
});

router.get('/login', (req, res) => {
    res.render('login', populate(req, res, { VIEW: 'login' }));
});

router.get('/mynets', authCheck(REQ_CALLSIGN), (req, res) => {
    res.render('myNets', populate(req, res, { VIEW: 'myNets' }));
});

router.get('/privacypolicy', (req, res) => {
    res.render('privacyPolicy', populate(req, res, { VIEW: 'privacyPolicy' }));
});

router.get('/cookiepolicy', (req, res) => {
    res.render('cookiePolicy', populate(req, res, { VIEW: 'cookiePolicy' }));
});

router.get('/termsofuse', (req, res) => {
    res.render('termsOfUse', populate(req, res, { VIEW: 'termsOfUse' }));
});

router.get('/contact', (req, res) => {
    res.render('contact', populate(req, res, {
        VIEW: 'contact', sent: req.query.sent === '1', errors: {}, form: contactFormValues()
    }));
});

router.post('/contact', async (req, res) => {
    if (String(req.body?.website ?? '').trim()) {
        return res.redirect(303, '/views/contact?sent=1');
    }
    const { values, errors } = validateContactForm(req.body);
    const renderForm = (status, deliveryError = '') => res.status(status).render('contact', populate(req, res, {
        VIEW: 'contact', sent: false, errors, form: values, deliveryError
    }));
    if (Object.keys(errors).length) return renderForm(400);
    const rateLimitKey = `${req.ip || 'unknown'}:${values.email.toLowerCase()}`;
    if (!contactRateLimitAllows(rateLimitKey)) {
        return renderForm(429, 'Too many messages have been submitted. Please try again later.');
    }
    try {
        const contactEmail = new ContactFormMessage(values);
        await contactEmail.sendMailToAddrs([CONTACT_RECIPIENT]);
        return res.redirect(303, '/views/contact?sent=1');
    } catch (err) {
        logger.error(`Contact form delivery failed: ${err.message}`);
        return renderForm(502, 'Your message could not be sent right now. Please try again later.');
    }
});

router.get('/homepage', (req, res) => {
    res.redirect('/');
});

module.exports = router;
module.exports.CONTACT_LIMITS = CONTACT_LIMITS;
module.exports.CONTACT_RATE_LIMIT_COUNT = CONTACT_RATE_LIMIT_COUNT;
module.exports.CONTACT_RATE_LIMIT_WINDOW_MS = CONTACT_RATE_LIMIT_WINDOW_MS;
module.exports.contactRateLimitAllows = contactRateLimitAllows;
module.exports.resetContactRateLimits = () => contactRateLimits.clear();
module.exports.validateContactForm = validateContactForm;
