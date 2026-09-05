# Middleware Architecture

This document describes Ham.Live's middleware stack and the request processing pipeline as implemented in `server/dist/server.js` and `server/dist/lib/serverUtils.js`.

## Middleware Stack (in order)

The following middleware is registered on the Express app in this exact order:

### 1. Runtime, proxy, host, and HTTPS validation

```javascript
validateRuntimeConfig(process.env);
app.set('trust proxy', trustedProxySetting(process.env.TRUST_PROXY));
app.use(canonicalHostGuard(conf.base_url));
app.use(forceHttps(conf.base_url));
```

Production startup validates the canonical HTTPS origin, secrets, authenticated Mongo URI, legal
approval gate, and explicit proxy trust. Redirects always use the configured origin, never an
untrusted Host header.

### 2. Security headers and mutation protection

```javascript
app.use(helmet(/* application CSP and production HSTS */));
app.use(mutationRequestGuard(conf.base_url));
```

Helmet applies CSP/frame/referrer/content-type/permissions controls. State-changing methods must
present a canonical same-origin Origin/Referer or valid same-origin Fetch Metadata; cross-site and
missing-context production mutations are rejected.

### 3. Server-side session

```javascript
app.use(session({ store: MongoStore.create(...), /* secure cookie options */ }));
```

The opaque `hamlive.sid` cookie maps to a MongoDB session with a rolling, bounded 12-hour lifetime.

### 4. Passport

```javascript
app.use(passport.initialize());
app.use(passport.session());
```

Initializes Passport and restores authentication state from the session. Google OAuth2 is optional;
the primary magic-link flow uses the application token store. Deserialization rejects locked users.

### 5. Application Middleware

```javascript
app.use(flexOpts);           // load per-user FlexOptions from MongoDB into res.locals.flexOpts
app.use(responseTime(httpLogger)); // logs HTTP request/response timing
app.use(addServerInfo);      // populates res.locals.serverInfo for EJS templates and API responses
app.use(dailyDispatch);      // triggers background task processing once per day
```

- **`flexOpts`** — Async middleware in `serverUtils.js`. Calls `getFlexOptionsByUser()` and stores the merged global+user FlexOptions in `res.locals.flexOpts`. Required by route handlers that use `ResponseHandler` (it reads `flexOpts.baseTtlMs`).
- **`responseTime(httpLogger)`** — Uses the `response-time` npm package. Calls `httpLogger` (from `lib/logger.js`) with the response duration.
- **`addServerInfo`** — Async middleware in `serverUtils.js`. Builds `res.locals.serverInfo` with server environment, feature flags, and per-user data; consumed by `populate()` for EJS views.
- **`dailyDispatch`** — Middleware in `lib/dailyProcessingDispatch.js`. Checks a `DayTracker` MongoDB document; when tasks are due, forks `lib/tasksLoader.js` as a child process to run background tasks. Always calls `next()`.

### 6. EJS Setup

```javascript
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
```

### 7. Request Parsing and Static Files

```javascript
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../client/dist/public'), { maxAge: 7200000 }));
```

Standard Express body parsers (no size limit is set explicitly beyond Express defaults). Static files are served with a 2-hour browser cache.

### 8. Routes and centralized errors

All route handlers are mounted after the middleware chain above. See [Routing and API](routing-api.md) for the full route map.

## Authorization

There is no global authorization middleware. Route-level authorization uses `authCheck(options)` from `serverUtils.js`, applied per-router or per-route:

```javascript
const { authCheck, REQ_LOGIN, REQ_CALLSIGN } = require('../lib/serverUtils');

router.post('/:id', authCheck(REQ_CALLSIGN), handler);
```

**Bitflags** (defined in `serverUtils.js`):

| Constant | Value | Effect |
|---|---|---|
| `REQ_LOGIN` | `0x0001` | Redirects to `/views/login` if not authenticated |
| `REQ_CALLSIGN` | `0x0010` | Redirects to `/views/myaccount?cswarn=true` if no callsign set |
| `REQ_NETOWNER` | `0x0100` | (defined; net-level ownership check) |
| `REQ_SUPERUSER` | `0x1000` | (defined; superuser check) |

## Error Handling

Async routes pass failures to a final four-argument Express error handler. It logs internal causes
and returns a stable generic response without stack traces or database messages. Existing helper
wrappers likewise sanitize 5xx output.

- **`handleRequest(res, callback, label)`** — Async wrapper from `lib/responseUtils.js`. Calls `callback()`, sends `200 OK` on success; catches exceptions and sends `500 INTERNAL_SERVER_ERROR`.
- **`ResponseHandler`** — Class from `lib/responseUtils.js`. `sendResponse(res, status, data)` and `sendError(res, status, message)` both produce `EndPointResponse`-shaped JSON.
- **404 fallback** — A catch-all `app.use()` at the bottom of `server.js` renders the `404.ejs` view for any unmatched request.

## Response Envelope

All API responses use `prepareEndPointResponse()` from `lib/responseUtils.js`. Response data fields are spread at the **top level** of the JSON object (not nested under a `message` key). On success, `errorMessage` is absent; on error, it is present and `errorHash` is included.

```json
{
    "endpointVersion": "1.0",
    "now": "2025-08-17T10:30:00.000Z",
    "ssePath": null,
    "ttlMs": 5000,
    "hash": "abc123...",
    // ...actual data fields spread here at top level on success
}
```

## Deliberately absent packages

The following packages are **not installed and not used**:

- `cors` — no CORS middleware
- `express-rate-limit` — no rate limiting
- `csurf` — the application instead enforces a global canonical-origin/Fetch-Metadata policy
- `compression` — no gzip middleware
- `morgan` — no morgan request logging
- `connect-livereload` — no hot-reload middleware
- `passport-local` — no local (username/password) strategy

## See also

- [Server Architecture](server-architecture.md) — Express application structure and bootstrapping
- [Routing and API](routing-api.md) — Route handlers and API patterns
- [Runtime Configuration](runtime-config.md) — Configuration system and environment variables

(End of middleware architecture documentation.)
