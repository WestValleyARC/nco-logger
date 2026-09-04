/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const passport = require('passport');
const { conf } = require('../lib/configLib');
const { logger } = require('../lib/logger');
const UserProfile = require('../models/userProfile').getUserProfile(null);
const GoogleStrategy = require('passport-google-oauth20');
const MagicLoginStrategy = require('passport-magic-login').default;
const jwt = require('jsonwebtoken');
const gravatar = require('gravatar');
const validator = require('validator');
const { MagicSignInEmail, emailEnabled } = require('../lib/userNotification');
const { clearInactivityDeletionOnLogin } = require('../lib/accountInactivity');

//MagicLogin Auth:
const sendMagicLink = async (destination, href, _code, req) => {
    const link = `${conf.base_url}${href}`;

    // Local test drive: when email delivery is not configured, surface the
    // sign-in link directly and also print it to the server console.
    if (!emailEnabled) {
        const isDevelopment = process.env.NODE_ENV !== 'production';
        if (isDevelopment && req) req._devMagicLink = href;
        if (!isDevelopment) {
            logger.error('Magic-link email unavailable because SMTP is not configured');
            throw new Error('Email delivery is unavailable');
        }
        logger.info(
            `\n\n========== LOCAL LOGIN (email delivery disabled) ==========\n` +
                `Magic sign-in link:\n${link}\n` +
                `Open it in your browser to finish logging in.\n` +
                `==========================================================\n`
        );
        return;
    }

    try {
        const email = new MagicSignInEmail({ href });

        await email.sendMailToAddrs([destination]);
        logger.info('Auth link email accepted for delivery');
    } catch (err) {
        logger.error(`Magic-link email delivery failed: ${err.message}`);
        throw new Error('Magic-link email delivery failed');
    }
};

const magicLogin = new MagicLoginStrategy({
    secret: conf.magic_link_secret,
    callbackUrl: '/auth/magiclogin/callback',
    sendMagicLink,

    verify: (payload, done) => {
        logger.info('Processing magic-link user lookup');

        if (!payload.destination) {
            logger.error('Magic login payload is missing its destination');
            throw new Error('Magic login payload missing destination');
        }
        //check if user already exists in our db
        UserProfile.findOneAndUpdate(
            { email: payload.destination },
            {
                lastLogin: Date.now(),
                lastAuthVia: 'email',
                photo: gravatar.url(payload.destination, { protocol: 'https' })
            }
        ).then(async currentUser => {
            if (currentUser) {
                //already have the user
                    logger.debug('Magic Login returning user found');
                if (currentUser.locked) {
                    logger.error('Magic Login account is locked');

                    done(null, false);
                } else {
                    await clearInactivityDeletionOnLogin({ userProfileDoc: currentUser, UserProfile });
                    done(null, currentUser);
                }
            } else {
                // if not, create user in our db
                new UserProfile({
                    lastAuthVia: 'email',
                    displayName: '',
                    flexOptions: {
                        option: {}
                    },
                    email: payload.destination,
                    photo: gravatar.url(payload.destination),
                    newAccount: true
                })
                    .save({ validateBeforeSave: false })
                    .then(newUser => {
                        logger.info('New partial user account created by email link');
                        done(null, newUser);
                    })
                    .catch(err => {
                        logger.error(err.stack);
                        logger.error('Likely data validation error. Missing required info on user creation?');
                    });
            }
        });
    },

    jwtOptions: {
        expiresIn: '30 days'
    }
});

passport.use(magicLogin);
router.post('/magiclogin', async (req, res) => {
    const destination = typeof req.body?.destination === 'string' ? req.body.destination.trim() : '';
    if (!validator.isEmail(destination)) {
        return res.status(400).json({ success: false, error: 'Enter a valid email address' });
    }

    const code = String(Math.floor(Math.random() * 90000) + 10000);
    const token = jwt.sign({ destination, code }, conf.magic_link_secret, { expiresIn: '30 days' });
    const href = `/auth/magiclogin/callback?token=${encodeURIComponent(token)}`;

    try {
        await sendMagicLink(destination, href, code, req);
        const response = { success: true, message: 'Sign-in email accepted for delivery' };
        if (!emailEnabled && process.env.NODE_ENV !== 'production') {
            response.devMagicLink = req._devMagicLink || null;
        }
        return res.status(emailEnabled ? 202 : 200).json(response);
    } catch (_err) {
        return res.status(502).json({
            success: false,
            error: 'The sign-in email could not be sent. Please try again or use Google sign-in.'
        });
    }
});
// router.get('/magiclogin/callback', passport.authenticate('magiclogin'));
router.get('/magiclogin/callback', passport.authenticate('magiclogin'), (req, res) => {
    if (req.user) {
        if (req.user.callSign) {
            res.redirect('/views/dashboard');
        } else {
            res.redirect('/views/myaccount');
        }
    } else {
        res.redirect('/views/login');
    }
});

//Google Auth (optional):
// Only register the Google strategy and routes when credentials are configured.
// Without them, the login page shows email magic-link sign-in only.
const googleAuthEnabled = Boolean(conf.google_client_id && conf.google_client_secret);

if (googleAuthEnabled) {
    passport.use(
        new GoogleStrategy(
            {
                //options for google strat
                callbackURL: `${conf.base_url}/auth/google/redirect`,
                clientID: conf.google_client_id,
                clientSecret: conf.google_client_secret
            },
            (accessToken, refreshToken, profile, done) => {
            //passport callback function

            logger.debug('Google authenticated: ' + profile.displayName);

            //check if user already exists in our db
            UserProfile.findOneAndUpdate(
                { email: profile.emails[0].value },
                {
                    lastLogin: Date.now(),
                    lastAuthVia: 'google',
                    photo: profile.photos[0].value
                }
            ).then(async currentUser => {
                if (currentUser) {
                    //already have the user
                    logger.debug('Google Auth returning user found');

                    if (currentUser.locked) {
                        logger.error('Google Auth account is locked');

                        done(null, false);
                    } else {
                        await clearInactivityDeletionOnLogin({ userProfileDoc: currentUser, UserProfile });
                        done(null, currentUser);
                    }
                } else {
                    // if not, create user in our db
                    new UserProfile({
                        lastAuthVia: 'google',
                        displayName: profile.displayName,
                        googleId: profile.id,
                        flexOptions: {
                            option: {}
                        },
                        email: profile.emails[0].value,
                        photo: profile.photos[0].value,
                        newAccount: true
                    })
                        .save()
                        .then(newUser => {
                            logger.debug('New partial user account created by Google Auth');
                            done(null, newUser);
                        })
                        .catch(err => {
                            logger.error(err.stack);
                            logger.error('Likely data validation error. Missing required info on user creation?');
                        });
                }
            });
        }
    )
);

//callback for google to redirect to
router.get('/google/redirect', passport.authenticate('google'), (req, res) => {
    // this time around, we have a "code" on the uri from google. Passport will exchange the code
    // for profile info

    if (req.user) {
        if (req.user.callSign) {
            res.redirect('/views/dashboard');
        } else {
            res.redirect('/views/myaccount');
        }
    } else {
        res.redirect('/views/login');
    }
});

// google specific auth, specify what we want from google (scope)
router.get(
    '/google',
    passport.authenticate('google', {
        scope: ['profile', 'email']
    })
);
} else {
    logger.warn('Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) — email sign-in only.');
    // Fallback so a stray link does not 404; send users to the login page.
    router.get(['/google', '/google/redirect'], (req, res) => res.redirect('/views/login'));
}

//logout is now async
router.get('/logout', function (req, res, next) {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        res.redirect('/views/dashboard');
    });
});

//old sync version
// router.get('/logout', (req, res) => {
//     req.logout();
//     res.redirect('/views/dashboard');
// });

router.get('/login', (req, res) => {
    res.redirect('/views/login');
});

module.exports = router;
