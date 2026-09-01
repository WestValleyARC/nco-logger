/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const { populate, authCheck, REQ_CALLSIGN, REQ_LOGIN } = require('../lib/serverUtils');
const NetProfile = require('../models/netProfile').getNetProfile(null);
const LiveNet = require('../models/liveNet').getLiveNet(null);
const ScheduledOccurrence = require('../models/scheduledOccurrence').getScheduledOccurrence(null);
const { canAccessScheduledPreparation } = require('../lib/scheduling/lifecycle');
const { logger } = require('../lib/logger');

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

router.get('/homepage', (req, res) => {
    res.redirect('/');
});

module.exports = router;
