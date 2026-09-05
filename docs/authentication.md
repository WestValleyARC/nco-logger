# Authentication Architecture

This document describes NCO Logger's authentication system, including strategy configuration, session management, and authorization patterns.

## Overview

NCO Logger uses **magic-link email sign-in as the primary and always-present authentication method**. Google OAuth2 is an optional second method that is only activated when its credentials are configured. There is no local/password authentication.

The implementation uses Passport.js and lives in `server/dist/routes/authRoutes.js`; session middleware is configured in `server/dist/server.js`.

## Authentication Stack

| Package | Role |
|---|---|
| `passport` | Core authentication framework |
| `passport-google-oauth20` | Google OAuth2 strategy (optional) |
| `express-session` | Opaque session-ID cookie and lifecycle |
| `connect-mongo` | Persistent server-side session store |
| `gravatar` | Default avatar URL for new accounts |

There is no local/password strategy.

## Magic-Link Authentication (primary)

Magic-link sign-in uses an application-owned, one-time token store. The browser receives a 32-byte
random token; MongoDB stores only an HMAC digest. Tokens expire after 15 minutes, are atomically
consumed, and a new request invalidates the previous outstanding token for that identity.

### Flow

```
1. User submits email address
   ↓
2. POST /auth/magiclogin
   ↓
3. Server stores a short-lived token digest and calls sendMagicLink()
   ↓
4. If SMTP is configured: email is sent through the configured SMTP relay
   If not (local dev): the relative link is returned to the login page and is not logged
                       AND returned in the JSON response as devMagicLink
   ↓
5. User opens the link
   ↓
6. GET /auth/magiclogin/callback — server atomically consumes the token
   ↓
7. If user exists: update lastLogin / lastAuthVia / photo
   If user is new: create UserProfile (newAccount:true, flexOptions:{option:{}})
   ↓
8. Check currentUser.locked — deny (done(null, false)) if true
   ↓
9. Passport rotates the session ID, then redirects to the dashboard/account page
```

### Local development fallback

When SMTP is absent in development, the sign-in link is:

- Printed to the server console at `info` level with a visible banner.
- Returned to the browser in the `devMagicLink` field of the `/auth/magiclogin` JSON response.

This allows full end-to-end testing with no email configuration required.

### Configuration

| Config key (via `conf`) | Env var | Required |
|---|---|---|
| `conf.magic_link_secret` | `MAGIC_LINK_SECRET` | Yes |
| `conf.mail_transport` / `conf.smtp_host` | `MAIL_TRANSPORT` / `SMTP_HOST` | No (see fallback above) |
| `conf.base_url` | `BASE_URL` | Yes (used to build the callback URL) |

The token TTL is 15 minutes. Replay, replacement, expiry, malformed tokens, and locked accounts fail closed.

## Google OAuth2 (optional)

Google OAuth2 is registered only when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set:

```javascript
const googleAuthEnabled = Boolean(conf.google_client_id && conf.google_client_secret);
if (googleAuthEnabled) {
    // register GoogleStrategy and routes
}
```

If the credentials are absent, the `/auth/google` and `/auth/google/redirect` routes still exist but redirect to `/views/login` rather than 404-ing.

### Strategy configuration

```javascript
new GoogleStrategy({
    clientID:    conf.google_client_id,
    clientSecret: conf.google_client_secret,
    callbackURL: `${conf.base_url}/auth/google/redirect`
}, callback)
```

`conf.google_client_id` and `conf.google_client_secret` come from `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — there are no `_DEV` / `_PROD` suffixes.

### Google auth flow

The Google callback mirrors the magic-link verify logic:

- Existing user: update `lastLogin`, `lastAuthVia`, `photo`; check `locked`.
- New user: create `UserProfile` with `newAccount:true` and `flexOptions:{option:{}}`.
- Redirect to `/views/dashboard` or `/views/myaccount` accordingly.

### Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/google` | Begin OAuth2 flow (scope: profile + email) |
| `GET` | `/auth/google/redirect` | OAuth2 callback from Google |

Note: the callback path is `/auth/google/redirect`, not `/auth/google/callback`.

## Routes summary

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/magiclogin` | Send magic-link email |
| `GET` | `/auth/magiclogin/callback` | Consume one-time token, establish session |
| `GET` | `/auth/google` | Begin Google OAuth2 (optional) |
| `GET` | `/auth/google/redirect` | Google OAuth2 callback (optional) |
| `POST` | `/auth/logout` | Destroy the server-side session and clear its cookie |

`GET /auth/logout` is non-mutating and only redirects to the dashboard.

## Session Management

Sessions use `express-session` with `connect-mongo`. The cookie contains only an opaque identifier;
session state and revocation live in MongoDB.

```javascript
app.use(session({
    name: 'hamlive.sid',
    store: MongoStore.create({ client: mongoose.connection.getClient() }),
    secret: conf.cookie_session_key,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: production, path: '/', maxAge: 12 * 60 * 60 * 1000 }
}));
```

Key details:

- Session lifetime: 12 hours, rolling while authenticated and active, with server-side TTL cleanup.
- Cookies are `HttpOnly`, `SameSite=Lax`, path `/`, and `Secure` in production.
- Passport regenerates the session on login. Logout destroys it, so copied old IDs stop working.
- Deserialization reloads the user and rejects accounts locked after the session was issued.

### Logout

Logout uses Passport 0.6's async `req.logout(callback)` signature:

```javascript
router.post('/logout', function (req, res, next) {
    req.logout(function (err) {
        if (err) return next(err);
        req.session.destroy(destroyError => { /* clear hamlive.sid and redirect */ });
    });
});
```

## New-User Creation

Both strategies create new users with the same minimal shape:

```javascript
{
    email:        payload.destination,  // or profile.emails[0].value
    displayName:  '',                   // or profile.displayName for Google
    photo:        gravatar.url(...),    // or profile.photos[0].value for Google
    lastAuthVia:  'email',              // or 'google'
    newAccount:   true,
    flexOptions:  { option: {} }
}
```

There is no `level` or `callSign` set at creation time. The `validateBeforeSave: false` flag is used on magic-link user creation.

## Authorization System

### Permission levels

NCO Logger uses a numeric level stored on `UserProfile`:

| Level | Role |
|---|---|
| 0 | System administrator |
| 1 | Advanced user / net control |
| 2+ | Regular user |

### Authorization middleware

Route files guard endpoints with `authCheck(...)` from `serverUtils.js`, composing the bit-flag constants `REQ_LOGIN`, `REQ_CALLSIGN`, `REQ_NETOWNER`, and `REQ_SUPERUSER`. The middleware verifies the authenticated `req.user` against the requested flags and redirects (or rejects) when they aren't met. Route handlers read the user's permission level directly from `req.user`; there is no separate `audience` middleware.

### Route protection example

```javascript
// Unauthenticated
app.get('/api/util/server-info', serverInfoHandler);

// Requires login
app.get('/api/data/userprofiles', authCheck(REQ_LOGIN), getUserProfileHandler);

// Requires net ownership or admin
app.post('/api/admin/interactions', authCheck(REQ_LOGIN | REQ_NETOWNER), interactionHandler);
```

## Security notes

- `MAGIC_LINK_SECRET` HMACs stored token/identity digests; it must be a unique strong random value.
- `COOKIE_SESSION_KEY` authenticates the opaque session-ID cookie; it must be separate and strong.
- `currentUser.locked` is checked in both strategy verify callbacks; locked accounts are denied without explanation.
- Global same-origin/Fetch-Metadata mutation checks protect cookie-authenticated POST/PUT/PATCH/DELETE requests.
- Mongo-backed IP and identity rate limits protect magic-login requests across restarts/instances.
- Helmet supplies global browser security headers.

## See also

- [Server Architecture](server-architecture.md) — Express application setup
- [Middleware](middleware.md) — Authentication middleware implementation
- [Security](security.md) — Security policies and considerations
- [Runtime Configuration](runtime-config.md) — Configuration options

(End of authentication architecture documentation.)
