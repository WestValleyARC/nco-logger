/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const passport = require('passport');
const { conf } = require('../lib/configLib');
const { logger } = require('../lib/logger');
const UserProfile = require('../models/userProfile').getUserProfile(null);
const GoogleStrategy = require('passport-google-oauth20');
const gravatar = require('gravatar');
const validator = require('validator');
const { MagicSignInEmail, emailEnabled } = require('../lib/userNotification');
const { clearInactivityDeletionOnLogin } = require('../lib/accountInactivity');
const { consumeMagicLoginToken, issueMagicLoginToken, revokeMagicLoginToken } = require('../lib/magicLoginTokens');
const { consumeRateLimit } = require('../lib/persistentRateLimit');

const MAGIC_REQUEST_WINDOW_MS = Number(process.env.MAGIC_LOGIN_RATE_WINDOW_MS) || 15 * 60 * 1000;
const MAGIC_REQUEST_IP_LIMIT = Number(process.env.MAGIC_LOGIN_IP_LIMIT) || 10;
const MAGIC_REQUEST_IDENTITY_LIMIT = Number(process.env.MAGIC_LOGIN_IDENTITY_LIMIT) || 3;

const sendMagicLink = async (destination, href, req) => {
    if (!emailEnabled) {
        if (process.env.NODE_ENV !== 'production' && req) {
            req._devMagicLink = href;
            return;
        }
        logger.error('Magic-link email unavailable because SMTP is not configured');
        throw new Error('Email delivery is unavailable');
    }
    const email = new MagicSignInEmail({ href });
    await email.sendMailToAddrs([destination]);
    logger.info('Auth link email accepted for delivery');
};

const userForMagicLogin = async destination => {
    let currentUser = await UserProfile.findOneAndUpdate(
        { email: destination },
        { lastLogin: Date.now(), lastAuthVia: 'email', photo: gravatar.url(destination, { protocol: 'https' }) },
        { new: true }
    );
    if (currentUser?.locked) return null;
    if (currentUser) {
        await clearInactivityDeletionOnLogin({ userProfileDoc: currentUser, UserProfile });
        return currentUser;
    }
    try {
        currentUser = await new UserProfile({
            lastAuthVia: 'email', displayName: '', flexOptions: { option: {} }, destination,
            email: destination, photo: gravatar.url(destination, { protocol: 'https' }), newAccount: true
        }).save({ validateBeforeSave: false });
        logger.info('New partial user account created by email link');
        return currentUser;
    } catch (error) {
        if (error?.code === 11000) return UserProfile.findOne({ email: destination, locked: { $ne: true } });
        throw error;
    }
};

router.post('/magiclogin', async (req, res, next) => {
    const destination = typeof req.body?.destination === 'string' ? req.body.destination.trim().toLowerCase() : '';
    if (!validator.isEmail(destination)) return res.status(400).json({ success: false, error: 'Enter a valid email address' });
    try {
        const [source, identity] = await Promise.all([
            consumeRateLimit({ bucket: 'magic-ip', subject: req.ip || 'unknown', limit: MAGIC_REQUEST_IP_LIMIT, windowMs: MAGIC_REQUEST_WINDOW_MS }),
            consumeRateLimit({ bucket: 'magic-identity', subject: destination, limit: MAGIC_REQUEST_IDENTITY_LIMIT, windowMs: MAGIC_REQUEST_WINDOW_MS })
        ]);
        const response = { success: true, message: 'If delivery is available, a sign-in email will arrive shortly' };
        if (!source.allowed || !identity.allowed) return res.status(202).json(response);

        const token = await issueMagicLoginToken({ destination });
        const href = `/auth/magiclogin/callback?token=${encodeURIComponent(token)}`;
        try {
            await sendMagicLink(destination, href, req);
        } catch (error) {
            await revokeMagicLoginToken({ token });
            throw error;
        }
        if (!emailEnabled && process.env.NODE_ENV !== 'production') response.devMagicLink = req._devMagicLink || null;
        return res.status(emailEnabled ? 202 : 200).json(response);
    } catch (error) {
        if (error.message === 'Email delivery is unavailable') {
            return res.status(502).json({ success: false, error: 'The sign-in email could not be sent. Please try again or use Google sign-in.' });
        }
        return next(error);
    }
});

router.get('/magiclogin/callback', async (req, res, next) => {
    try {
        const record = await consumeMagicLoginToken({ token: req.query.token });
        if (!record) return res.redirect('/views/login?error=invalid-link');
        const user = await userForMagicLogin(record.destination);
        if (!user) return res.redirect('/views/login?error=invalid-link');
        return req.logIn(user, error => {
            if (error) return next(error);
            return res.redirect(user.callSign ? '/views/dashboard' : '/views/myaccount');
        });
    } catch (error) {
        return next(error);
    }
});

const googleAuthEnabled = Boolean(conf.google_client_id && conf.google_client_secret);
if (googleAuthEnabled) {
    passport.use(new GoogleStrategy({
        callbackURL: `${conf.base_url}/auth/google/redirect`, clientID: conf.google_client_id,
        clientSecret: conf.google_client_secret
    }, async (_accessToken, _refreshToken, profile, done) => {
        try {
            const email = profile.emails?.[0]?.value?.toLowerCase();
            if (!email) return done(null, false);
            let user = await UserProfile.findOneAndUpdate(
                { email }, { lastLogin: Date.now(), lastAuthVia: 'google', photo: profile.photos?.[0]?.value }, { new: true }
            );
            if (user?.locked) return done(null, false);
            if (user) await clearInactivityDeletionOnLogin({ userProfileDoc: user, UserProfile });
            else user = await new UserProfile({
                lastAuthVia: 'google', displayName: profile.displayName, googleId: profile.id,
                flexOptions: { option: {} }, email, photo: profile.photos?.[0]?.value, newAccount: true
            }).save();
            return done(null, user);
        } catch (error) {
            return done(error);
        }
    }));
    router.get('/google/redirect', passport.authenticate('google', { failureRedirect: '/views/login' }), (req, res) => {
        res.redirect(req.user?.callSign ? '/views/dashboard' : '/views/myaccount');
    });
    router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
} else {
    logger.warn('Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) — email sign-in only.');
    router.get(['/google', '/google/redirect'], (_req, res) => res.redirect('/views/login'));
}

router.post('/logout', (req, res, next) => {
    req.logout(error => {
        if (error) return next(error);
        if (!req.session) return res.redirect(303, '/views/dashboard');
        return req.session.destroy(destroyError => {
            if (destroyError) return next(destroyError);
            res.clearCookie('hamlive.sid', { path: '/' });
            return res.redirect(303, '/views/dashboard');
        });
    });
});
router.get('/logout', (_req, res) => res.redirect(303, '/views/dashboard'));
router.get('/login', (_req, res) => res.redirect('/views/login'));

module.exports = router;
module.exports.userForMagicLogin = userForMagicLogin;
