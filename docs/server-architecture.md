# Server Architecture

> **Document Scope:** This document covers Express.js application structure, middleware stack, and server bootstrapping. **Not covered:** Specific API endpoints (see [API Reference](api-reference.md)), configuration details (see [Runtime Configuration](runtime-config.md)), or database schemas (see [Database Models](database-models.md)).

This document describes the overall server application structure, middleware stack, and bootstrapping process for Ham.Live.

> **Source note:** The codebase is mid JS→TypeScript migration. `server/dist/` contains the authoritative running source — most files, including `localChat.js`, are hand-written JavaScript; TypeScript modules have matching sources under `server/src/`.

## System Architecture Overview

Ham.Live implements a three-tier architecture with clear separation of concerns:

### Client Browser Layer

- **EJS Views**: Server-rendered HTML pages (`/views/liveNet.ejs`, `/views/favorites.ejs`, etc.)
- **Per-View ES Modules**: TypeScript client framework (`/client/src/public/js/byView/`)
- **Client Framework**: Reactive stores, custom elements, HTTP clients, and helpers

### Express Server Layer

- **Express Routes**: Domain-organized route handlers (`/api/data/*`, `/api/sse/*`, `/api/station/*`, `/api/admin/*`)
- **Controllers**: Business logic layer (`liveNetController`, `interactionController`, `followController`)
- **Domain Logic**: Core business operations in `sharedNetOps.js`
- **Real-time Services**: SSE connection management via `realtimeClients.js` (compiled from `src/`)
- **External Services**: local MongoDB/SSE chat, Google OAuth, QRZ.com callsign lookup

### Data Layer

- **MongoDB Collections**: Core collections with Mongoose ODM (UserProfile, NetProfile, LiveNet, StationInteraction, FlexOptions, QrzCache, TaskQueues, InitialRegTracker, DayTracker, SystemNotification)
- **Background Tasks**: Forked child-process jobs for cleanup and notifications
- **Admin & Scripts**: Administrative utilities in `bin/`

## Application File Structure

```
server/
├── server.js              # Main application entry point (authoritative JS)
├── lib/                   # Core libraries and utilities
│   ├── configLib.js       # Configuration management (compiled from src/)
│   ├── serverUtils.js     # Middleware helpers, authCheck, flexOpts, publicEndpoints
│   ├── logger.js          # Logging infrastructure (compiled from src/)
│   ├── responseUtils.js   # Response envelope, ResponseHandler, handleRequest (compiled from src/)
│   ├── realtimeClients.js # SSE connection management (compiled from src/)
│   ├── secureSign.js      # generic signing helper (compiled from src/)
│   ├── localChat.js       # local MongoDB/SSE chat integration
│   ├── dailyProcessingDispatch.js # Triggers background task child process
│   └── tasksLoader.js     # Child-process task runner, reads conf.background_tasks
├── routes/                # Route handlers organized by domain
├── models/                # Mongoose data models
├── controllers/           # Business logic controllers
└── bin/                   # Administrative utilities and scripts
```

## Application Bootstrap Process

### 1. Environment Configuration

`lib/configLib.js` loads the `.env` file and merges YAML configuration files with environment variable overrides. Configuration precedence: environment variables → YAML files → defaults. See [Runtime Configuration](runtime-config.md) for full details.

### 2. Database Connection

MongoDB connection established before the HTTP server starts:

```javascript
mongoose.set('strictQuery', true);
mongoose.connect(conf.dburi, {
    maxPoolSize: conf.realtime_mongoose_poolsize
});
```

The server only begins listening after the connection resolves.

### 3. HTTPS in Development

In development, the server defaults to plain HTTP (browsers treat `localhost` as secure). Set `HTTPS=true` to serve over HTTPS using the bundled self-signed certificate (`ssl/dev-server_*.pem`, regenerated via `npm run gen-certs`).

In production, TLS is terminated at the reverse proxy or platform (nginx, Caddy, Render, Fly, etc.). An optional HTTPS redirect is available via `FORCE_HTTPS=true` — see [Middleware](middleware.md) for details.

## Middleware Stack

The middleware is applied in this order (see [Middleware](middleware.md) for full details):

1. **HTTPS redirect** — inline middleware, only active when `FORCE_HTTPS=true`; inspects `x-forwarded-proto`
2. **`cookieSession`** — single key (`COOKIE_SESSION_KEY`), fixed 3.5-day TTL
3. **`cookieSessionKeepAlive`** — renews session TTL every 10 minutes of activity
4. **`cookieSessionStubs`** — adds `regenerate()`/`save()` stubs for Passport compatibility
5. **`passport.initialize()`** / **`passport.session()`** — authentication state restoration
6. **`flexOpts`** — loads per-user FlexOptions into `res.locals.flexOpts`
7. **`responseTime(httpLogger)`** — logs HTTP timing via the `response-time` package
8. **`addServerInfo`** — populates `res.locals.serverInfo` for views and API responses
9. **`dailyDispatch`** — triggers background task processing once per day
10. **EJS setup** — `view engine: ejs`
11. **Body parsers** — `express.urlencoded`, `express.json`
12. **Static files** — `client/dist/public` served with 2-hour browser cache

## Route Organization

Routes are mounted after the middleware chain. The full server.js mount list:

### View Routes (`/views/*`)

Server-rendered EJS pages. See [Views](views.md).

### Core Data API Routes

- `GET|POST|PATCH|DELETE /api/data/netprofiles[/:id]` — Net profile CRUD
- `GET|POST|PATCH|DELETE /api/data/userprofiles[/:id]` — User profile management
- `POST /api/data/follow` — Follow/unfollow operations
- `GET /api/data/livenets[/:id]` — Live net state and station data

### Interaction Routes

- `GET  /api/admin/interactions/:id` — List available commands for the user's role
- `POST /api/admin/interactions/:id` — Execute a net control command (`cmdLine` body field)
- `POST /api/station/interactions/:id` — Station event (signal report, hand, highlight; `action`/`dstStation`/`actionParams` body fields)

### Real-time Routes

- `GET /api/sse/livenets/:id` — Server-Sent Events stream for live net updates
- `GET /api/presence/livenets/:id` — Presence polling fallback

### Authentication Routes (`/auth/*`)

- `POST /auth/magiclogin` — Initiate magic-link email sign-in
- `GET  /auth/magiclogin/callback` — Complete magic-link authentication
- `GET  /auth/google` — Initiate Google OAuth2 flow (when configured)
- `GET  /auth/google/redirect` — Google OAuth2 callback
- `GET  /auth/logout` — Log out and redirect

### Other Routes

- `GET|POST /api/chat/:id/messages` — Local chat history/send
- `GET /api/chat/:id/events` — Local chat SSE
- `DELETE /api/chat/:id/messages/:messageId` — Message deletion/moderation
- `GET /api/util/undeleteme` — Restore a soft-deleted account
- `GET /api/util/resolvelocation` — Reverse geocode a lat/lon (optional; requires `GEO_KEY`)
- `GET /api/util/notifications/pending` — Fetch pending system notifications
- `POST /api/util/notifications/:notificationId/dismiss` — Dismiss a notification
- `GET /api` — Returns a JSON array of public API endpoints (via `publicEndpoints()`)

## Data Flow Architecture

### Request Processing Flow

```
Client Request → HTTPS Redirect → Session → Auth → FlexOpts → Route → Controller → Domain Logic → Response
```

### Real-time Data Flow

```
Database Change → sharedNetOps → SSE Manager → Connected Clients
```

## Request/Response Flow

### Response Envelope

All API responses use the `EndPointResponse` format from `lib/responseUtils.js`. Response data is spread at the **top level** (not nested under `message`). `errorMessage` is absent on success.

```javascript
{
    endpointVersion: "1.0",
    now: "2025-08-17T10:30:00.000Z",
    ssePath: null,          // or an SSE path string
    ttlMs: 5000,
    hash: "abc123...",      // hash of data on success; absent on error
    // ...actual data fields at top level
}
```

On error, `hash` is replaced by `errorMessage` (string) and `errorHash`.

## Controller Layer Architecture

### Core Controllers

- **`liveNetController`** — Manages LiveNetDetails and real-time net state
- **`interactionController`** — Net control commands (admin) and station events (station)
- **`followController`** — Follow/unfollow functionality with notifications
- **`netProfileController`** — Net template and configuration CRUD operations
- **`userProfileController`** — User account and preference management
- **`notificationController`** — System notification delivery and dismissal

### Domain Logic Integration

Controllers integrate with `sharedNetOps.js` for multi-collection atomic updates, permission validation, SSE push coordination, and interaction logging.

## External Service Integration

### Chat Integration (local MongoDB/SSE)

`lib/localChat.js` provides authenticated message persistence, moderation, history retrieval, and a
MongoDB change-stream-to-SSE bridge. Local chat is always enabled and uses the application session.

### Authentication Services

- **Google OAuth2** — Optional. Enabled only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. Strategy registered via `passport-google-oauth20`.
- **Magic Link Email** — Primary passwordless auth via `passport-magic-login` and SMTP (`MAIL_TRANSPORT`). When `MAIL_TRANSPORT` is not configured, the sign-in link is logged to the console and returned in the JSON response for local development.
- **QRZ.com API** — Optional callsign lookup and data caching. Disabled when `QRZ_USERNAME`/`QRZ_PASSWORD` are absent.

### `secureSign.js`

`lib/secureSign.js` (compiled from `src/lib/secureSign.ts`) currently implements a minimal stub. The `sign()` function reads a `service` query parameter and returns it in the response; the former Roomlio HMAC signing logic has been removed. This module exists as a named entry point for future signing needs.

## Server-Side Rendering

EJS templates are in `server/dist/views/`. The `populate(req, res, additions)` helper merges `res.locals.serverInfo` with per-view data to produce the template context.

## Database Architecture Integration

### Core Collections

- **LiveNet** — Active/upcoming nets with real-time state
- **NetProfile** — Net templates, settings, and configurations
- **StationInteraction** — Check-ins, hand up/down, highlight, signal reports, and participation records
- **UserProfile** — User accounts, preferences, and authentication data

### Supporting Collections

- **QrzCache** — Cached callsign lookup data with TTL expiration
- **FlexOptions** — Runtime configuration overrides and feature flags
- **TaskQueues** — Background processing queues (`PendingUnfollow`, `PendingAccountDelete`)
- **InitialRegTracker** — Callsign registration tracking (for ad grace periods)
- **DayTracker** — Daily background task run state
- **SystemNotification** — Site-wide notices delivered to users (`notificationId`, `title`, `message`, `severity`, `active`, `expiresAt`)

### Collection Relationships

- LiveNet → NetProfile (template relationship)
- StationInteraction → LiveNet, UserProfile, NetProfile
- UserProfile ↔ NetProfile (`following`/`followers` arrays for net subscriptions — no separate Favorites collection)

## Background Task Architecture

### Daily Processing Dispatch

`lib/dailyProcessingDispatch.js` is Express middleware that runs once per day. It checks the `DayTracker` MongoDB document; when tasks are due, it forks `lib/tasksLoader.js` as a child process and always calls `next()` immediately — it does not block requests.

### Task Loader

`lib/tasksLoader.js` reads the `conf.background_tasks` key from the YAML configuration. Each entry under that key is a `{ enabled, options }` object whose key is the class name in `lib/backgroundTasks/`. The available task modules are:

- `closeIdleNets` — Closes nets that have been idle past their configured threshold
- `flagAccounts` — Flags accounts meeting deletion criteria
- `deleteFlaggedAccounts` — Permanently removes previously flagged accounts
- `processUnfollowJobs` — Processes the `PendingUnfollow` queue

Tasks are enabled/disabled and parameterized through the YAML config (`conf.background_tasks`), not hardcoded in the dispatch code.

## Performance and Scalability

### Connection Pool Management

MongoDB uses separate pools for realtime (web requests) and batch (background tasks), sized via `realtime_mongoose_poolsize` and `batch_mongoose_poolsize` in the YAML config.

### Caching Strategy

- **Static Assets**: 2-hour browser cache (`maxAge: 7200000`)
- **QRZ Data**: Database-level document caching with automatic refresh
- **FlexOpts**: Per-request in-memory cache with 10-second TTL (`node-cache`)
- **Session Data**: Cookie-based with 3.5-day expiration

### Real-time Scalability

- SSE connections managed via `realtimeClients.js`
- Targeted broadcasts to subscribed clients only
- Automatic cleanup on client disconnect

## Administrative Tools

Administrative scripts in `server/dist/bin/`:

- `closeNet.js` — Manually close a specific net
- `bulkReg.js` — Bulk user registration
- `flagAccountForDeletion.js` — Trigger account deletion workflow
- `getAllEmail.js` — Extract emails for notifications
- `manageNotifications.js` — SystemNotification CRUD and scheduling
- `dbBackup.js` — MongoDB backup, restore, migrate, and verify (see [Runbook](runbook.md))

These scripts use the same controller and domain logic layers as the web application.

## See also

- [Runtime Configuration](runtime-config.md) — Configuration documentation
- [Middleware](middleware.md) — Middleware architecture and components
- [Routing and API](routing-api.md) — Route organization and API patterns
- [Database Models](database-models.md) — Data model details
- [Security](security.md) — Security implementation details

(End of server architecture documentation.)
