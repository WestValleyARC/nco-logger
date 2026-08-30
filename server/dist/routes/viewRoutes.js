/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const { populate, authCheck, REQ_CALLSIGN, REQ_LOGIN } = require('../lib/serverUtils');
const NetProfile = require('../models/netProfile').getNetProfile(null);
const { logger } = require('../lib/logger');

router.get('/livenet/:id', authCheck(REQ_CALLSIGN), (req, res) => {
    const npid = req.params.id;
    NetProfile.findById(npid)
        .then(npresult => {
            const ejsData = {
                NPID: npid,
                PERM: Boolean(npresult?.permanent),
                TITLE: npresult?.title ?? ''
            };

            if (Boolean(npresult?.liveNet)) {
                ejsData['VIEW'] = 'liveNet';
                res.render('liveNet', populate(req, res, ejsData));
            } else {
                ejsData['VIEW'] = 'netNotRunning';
                res.render('netNotRunning', populate(req, res, ejsData));
            }
        })
        .catch(err => {
            res.redirect('/views/dashboard');
            logger.error(err.stack);
        });
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
    res.render('oAuth2Homepage', populate(req, res, { VIEW: 'oAuth2Homepage' }));
});

module.exports = router;
