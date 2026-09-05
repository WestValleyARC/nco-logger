# Routing and API Architecture

> **Document Scope:** This document covers API **architectural patterns**, route organization, and design principles. **Not covered:** Specific endpoint details, request/response examples, or parameter documentation (see [API Reference](api-reference.md) for complete endpoint reference).

This document describes Ham.Live's API routing structure, architectural patterns, and request/response design.

## API Organization Philosophy

Ham.Live's API is organized into functional domains with consistent URL patterns and standardized response formats. The design prioritizes:

- **Domain separation**: Clear boundaries between functional areas
- **Consistent patterns**: Predictable URL structure and response formats
- **Route-level authorization**: `authCheck()` applied per-route, not globally
- **Real-time integration**: Seamless SSE and polling endpoint coordination

## Route Hierarchy and Patterns

### Primary API Domains

```
/api/
├── data/       # CRUD operations on core entities
├── admin/      # Net control commands
├── station/    # Station-level interaction events
├── sse/        # Server-Sent Events endpoints
├── presence/   # Presence polling endpoints
├── chat/       # local MongoDB/SSE history, send, events, and moderation
└── util/       # Utility and helper endpoints
```

### Data Domain (`/api/data/`)

**Purpose**: Standard CRUD operations on core business entities.

**Pattern**: `/api/data/{resource}[/{id}]`

**Resources**:

- `netprofiles` — Net configurations and metadata
- `userprofiles` — User account and preferences
- `follow` — Follow/unfollow relationships
- `livenets` — Active net state and station data

### Administrative Domain (`/api/admin/`)

**Purpose**: Net control commands for authorized users.

**Routes**:

- `GET  /api/admin/interactions/:id` — Returns the command list available to the requesting user based on their role in that net
- `POST /api/admin/interactions/:id` — Execute a net control command

**Body** (POST): `{ cmdLine: "<command string>" }` — a command string parsed by `CommandSet.run()` in `interactionController.js` (e.g., `"checkin W1AW"`, `"hand W1AW"`, `"close"`).

**Authorization**: `authCheck(REQ_CALLSIGN)`.

### Station Domain (`/api/station/`)

**Purpose**: Station-initiated interaction events.

**Route**: `POST /api/station/interactions/:id`

**Body**: `{ action: string, dstStation: string, actionParams: object }` — `action` is the event type (e.g., `sigReport`, `hand`, `highlight`); `dstStation` is the target callsign; `actionParams` carries event-specific data.

**Authorization**: `authCheck(REQ_CALLSIGN)`.

Note: The route is mounted at `/api/station/interactions` in `server.js`, so the full path is `/api/station/interactions/:id`.

### Real-time Domain

**Server-Sent Events** (`/api/sse/`)

- **Route**: `GET /api/sse/livenets/:id`
- **Purpose**: Real-time data streaming for live net updates
- **Content-Type**: `text/event-stream`

**Presence Polling** (`/api/presence/`)

- **Route**: `GET /api/presence/livenets/:id`
- **Purpose**: Station presence polling; fallback for clients that cannot use SSE

### Local Chat Domain (`/api/chat/`)

**Purpose**: First-party public/direct chat, authenticated images, moderation, and SSE. No external
chat credential or hosted chat provider is required at runtime.

**Routes**:

- `GET|POST /api/chat/:id/messages` — Bounded public/direct bootstrap history and public send.
- `GET|POST /api/chat/:id/direct/:userId/messages` — Exact two-party history and direct send.
- `POST /api/chat/:id/images` and `/api/chat/:id/direct/:userId/images` — Authenticated images.
- `PUT /api/chat/:id/direct/:userId/ignore` — Viewer-owned private ignore preference.
- `PATCH|DELETE /api/chat/:id/messages/:messageId` — Edit or delete the author's own message.
- `GET /api/chat/:id/messages/:messageId/image` — Authorized public/participant image retrieval.
- `PUT /api/chat/:id/messages/:messageId/reaction` — Participant reaction toggle.
- `PUT /api/chat/:id/messages/:messageId/pin` — NCO/Logger public pin mutation.
- `POST /api/chat/:id/messages/:messageId/ban` — NCO-only ban by stored public-message author.
- `DELETE /api/chat/:id/messages` — NCO-only public clear.
- `GET /api/chat/:id/events` — Authenticated local chat SSE.
- See [Chat System](chat-system.md) for the complete route, privacy, and history-window contract.

**Authorization**: Existing cookie authentication, callsign, and active-net membership on every route;
mutation permissions are derived server-side.

### Utility Domain (`/api/util/`)

- `POST /api/util/undeleteme` — Restore a soft-deleted user account (requires `REQ_LOGIN` and same-origin mutation context)
- `GET /api/util/resolvelocation?lat=&lon=` — Reverse geocode a coordinate pair (requires `REQ_LOGIN`; disabled when `GEO_KEY` is not configured; intentionally excluded from `publicEndpoints()` listing)
- `GET /api/util/notifications/pending` — Retrieve active, non-dismissed system notifications for the user (requires `REQ_LOGIN`)
- `POST /api/util/notifications/:notificationId/dismiss` — Dismiss a notification (requires `REQ_LOGIN`)

### View Routes (`/views/*`)

Server-rendered EJS pages. Selected routes:

- `GET /views/livenet/:id` — Live net view (or "net not running" when inactive); requires callsign
- `GET /views/dashboard` — Dashboard (no auth required)
- `GET /views/mynets` — User's net list; requires callsign
- `GET /views/myaccount` — Account settings; requires login
- `GET /views/favorites` — Followed nets; requires login
- `GET /views/login` — Login/auth page
- `GET /views/guide`, `/views/privacypolicy`, `/views/cookiepolicy`, `/views/termsofuse`, `/views/homepage` — Static informational pages
- `GET /views/intro` — Legacy URL that redirects to the live-net dashboard

### API Discovery

`GET /api` returns a raw JSON **array** produced by `publicEndpoints()` in `serverUtils.js`, which uses `express-list-endpoints` to enumerate mounted routes. Each element is:

```json
{
    "path": "/api/data/netprofiles",
    "methods": ["GET", "POST"]
}
```

There is no envelope, no `description` field, and no `authentication` field. The `/api/util/resolvelocation` route is excluded from this listing.

## Authentication and Authorization

### Authentication Requirements

- **Unauthenticated endpoints**: API discovery (`GET /api`), some data reads, and view pages such as `/views/dashboard` and `/views/guide`
- **Login required**: All state-changing operations; account and privacy pages
- **Callsign required**: Live net access, net control commands, station events, and local chat

### Authorization Implementation

Authorization is handled entirely at the route level by `authCheck(options)` from `serverUtils.js`. There are no global `requireAuth` or `requireAdmin` middleware functions in the codebase.

```javascript
const { authCheck, REQ_LOGIN, REQ_CALLSIGN } = require('../lib/serverUtils');

router.get('/myaccount', authCheck(REQ_LOGIN), handler);
router.post('/:id', authCheck(REQ_CALLSIGN), handler);
```

**Bitflags**:

| Constant | Hex | Behavior |
|---|---|---|
| `REQ_LOGIN` | `0x0001` | Redirect to `/views/login` if `req.user` is absent |
| `REQ_CALLSIGN` | `0x0010` | Redirect to `/views/myaccount?cswarn=true` if `req.user.callSign` is absent |
| `REQ_NETOWNER` | `0x0100` | Defined; net ownership check |
| `REQ_SUPERUSER` | `0x1000` | Defined; superuser check |

### Session-Based Authentication

The user object available in route handlers after Passport deserializes the session:

```javascript
req.user = {
    _id: ObjectId,
    callSign: string,
    displayName: string,
    email: string,
    // ... other UserProfile fields
};
```

## Request/Response Patterns

### Standardized Response Envelope

All API endpoints produce `EndPointResponse`-shaped JSON via `ResponseHandler` from `lib/responseUtils.js`. Data fields are spread at the **top level** of the response object. `errorMessage` is absent on success.

**Success response:**
```json
{
    "endpointVersion": "1.0",
    "now": "2025-08-17T10:30:00.000Z",
    "ssePath": null,
    "ttlMs": 5000,
    "hash": "sha256-hash-of-data",
    // ...actual response data at top level
}
```

**Error response:**
```json
{
    "endpointVersion": "1.0",
    "now": "2025-08-17T10:30:00.000Z",
    "ssePath": null,
    "ttlMs": 5000,
    "hash": "",
    "errorMessage": "Descriptive error message",
    "errorHash": "hash-of-error-content"
}
```

### Common HTTP Status Codes

- `200 OK` — Successful operation
- `301 Moved Permanently` — HTTPS redirect (when `FORCE_HTTPS=true`)
- `400 Bad Request` — Invalid input
- `401 Unauthorized` — Authentication required
- `403 Forbidden` — Insufficient permissions
- `404 Not Found` — Unmatched route renders `404.ejs`
- `500 Internal Server Error` — Unhandled exception in a route handler

## Route Handler Patterns

### Standard Pattern (`handleRequest`)

Most route handlers use `handleRequest()` from `lib/responseUtils.js`:

```javascript
const { handleRequest } = require('../lib/responseUtils');

router.get('/', async (req, res) => {
    await handleRequest(
        res,
        async () => {
            const data = await ResourceModel.find(query);
            return { resources: data }; // spread at top level of response
        },
        'GET /api/data/resource'
    );
});
```

The callback's return value is spread directly into the response envelope. There is no `message:` wrapper in the standard pattern (though some older handlers still use `{ message: result }`).

### Interaction Pattern

`ResponseHandler` is used directly in controllers where finer-grained control is needed:

```javascript
const { ResponseHandler } = require('../lib/responseUtils');

async function adminCommandProcessor(req, res) {
    const handleResponse = new ResponseHandler({ ttlMs: res.locals.flexOpts.baseTtlMs });
    try {
        handleResponse.sendResponse(res, 'OK', { message: await CommandSet.run(req, res) });
    } catch (err) {
        handleResponse.sendError(res, 'INTERNAL_SERVER_ERROR', err.message);
    }
}
```

## Error Handling Strategy

Route handlers use `handleRequest()` or `ResponseHandler` for consistent error formatting, and a
final four-argument Express handler sanitizes uncaught async/controller failures. Unmatched routes
fall through to a catch-all that renders the 404 view:

```javascript
app.use((req, res) => {
    if (!res.headersSent) return res.status(404).render('404', populate(req, res, { VIEW: '404' }));
});
```

## Performance Considerations

### Response Caching

TTL values (`ttlMs`) are specified per endpoint via `flexOpts.baseTtlMs`. The hash field enables client-side cache invalidation.

### Database Query Optimization

- Projection of only needed fields
- Proper indexing for common queries
- Connection pooling (separate pools for realtime and batch)

## See also

- [API Reference](api-reference.md) — Complete endpoint listing with request/response examples
- [Server Architecture](server-architecture.md) — Express.js application structure
- [Middleware](middleware.md) — Authentication and request processing middleware
- [Controllers](controllers.md) — Route handler implementation details

(End of routing and API architecture documentation.)
