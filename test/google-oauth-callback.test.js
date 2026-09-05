const test = require('node:test');
const assert = require('node:assert/strict');
const passport = require('passport');
const { logger } = require('../server/dist/lib/logger');
const { handleGoogleCallback } = require('../server/dist/routes/authRoutes');

const invokeCallback = ({ error = null, user = null, loginError = null } = {}) => {
    const originalAuthenticate = passport.authenticate;
    const calls = { login: [], next: [], redirects: [] };
    passport.authenticate = (strategy, callback) => {
        assert.equal(strategy, 'google');
        return () => callback(error, user);
    };
    const req = {
        logIn(candidate, callback) {
            calls.login.push(candidate);
            callback(loginError);
        }
    };
    const res = {
        redirect(location) {
            calls.redirects.push(location);
            return location;
        }
    };
    const next = nextError => calls.next.push(nextError);
    try {
        handleGoogleCallback(req, res, next);
        return calls;
    } finally {
        passport.authenticate = originalAuthenticate;
    }
};

test('Google OAuth provider errors are logged and redirected safely', () => {
    const providerError = new Error('provider rejected callback');
    const originalError = logger.error;
    const logged = [];
    logger.error = (...args) => logged.push(args);
    try {
        const calls = invokeCallback({ error: providerError });
        assert.deepEqual(logged, [['Google OAuth callback failed', providerError]]);
        assert.deepEqual(calls.redirects, ['/views/login?error=google-auth']);
        assert.deepEqual(calls.login, []);
        assert.deepEqual(calls.next, []);
    } finally {
        logger.error = originalError;
    }
});

test('Google OAuth callbacks without a user redirect with a stable error', () => {
    const calls = invokeCallback();
    assert.deepEqual(calls.redirects, ['/views/login?error=google-auth']);
    assert.deepEqual(calls.login, []);
    assert.deepEqual(calls.next, []);
});

test('Google OAuth success explicitly establishes the session before redirecting', () => {
    const dashboardUser = { id: 'dashboard-user', callSign: 'W1ABC' };
    const dashboard = invokeCallback({ user: dashboardUser });
    assert.deepEqual(dashboard.login, [dashboardUser]);
    assert.deepEqual(dashboard.redirects, ['/views/dashboard']);
    assert.deepEqual(dashboard.next, []);

    const accountUser = { id: 'new-user' };
    const account = invokeCallback({ user: accountUser });
    assert.deepEqual(account.login, [accountUser]);
    assert.deepEqual(account.redirects, ['/views/myaccount']);
    assert.deepEqual(account.next, []);
});

test('Google OAuth session establishment errors are passed to error handling', () => {
    const user = { id: 'session-user', callSign: 'W1ABC' };
    const sessionError = new Error('session write failed');
    const calls = invokeCallback({ user, loginError: sessionError });
    assert.deepEqual(calls.login, [user]);
    assert.deepEqual(calls.redirects, []);
    assert.deepEqual(calls.next, [sessionError]);
});
