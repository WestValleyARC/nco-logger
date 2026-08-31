# Controllers & Request Processing

> **Document Scope:** This document covers **controller architecture**, request handling patterns, and business logic integration. **Not covered:** Specific API endpoints (see [API Reference](api-reference.md)) or route organization (see [Routing and API](routing-api.md)).

This document describes Ham.Live's controller architecture, route handlers, and request processing patterns.

> For complete API endpoint reference, see [API Reference](api-reference.md). For route organization patterns, see [Routing and API](routing-api.md).

## Controller Architecture

Ham.Live organizes controllers by functional domain, with each controller handling a specific set of related operations. Controllers follow consistent patterns for request processing, validation, and response formatting.

### Controller Organization

**Data Controllers** — CRUD operations on core entities

- `liveNetController` — Live net state and interactions
- `netProfileController` — Net profile management
- `userProfileController` — User profile operations
- `followController` — Follow/unfollow relationships
- `notificationController` — System notifications and user dismissals

**Administrative Controllers** — Net control and admin operations

- `interactionController` — Station interactions and admin commands

**Local chat handlers** — authenticated history, send, SSE, and moderation handlers in `localChat.js`

### Common Controller Patterns

**Request Processing Flow**

Most controllers use the `handleRequest` helper from `lib/responseUtils.js`, which wires up a `ResponseHandler` with the request's `baseTtlMs` flex option:

```javascript
// Typical pattern using the handleRequest wrapper
const controllerMethod = async (req, res) => {
    handleRequest(
        res,
        async () => {
            // Business logic — throw plain Error on failure
            const result = await performOperation(req.params.id, req.body, req.user);
            return result; // returned value becomes response message
        },
        'Optional success log message'
    );
};
```

The `interactionController` instantiates `ResponseHandler` directly for finer control:

```javascript
const handleResponse = new ResponseHandler({ ttlMs: res.locals.flexOpts.baseTtlMs });
handleResponse.sendResponse(res, 'OK', { message: data });
handleResponse.sendError(res, 'INTERNAL_SERVER_ERROR', err.message);
```

The status argument is a **string key** from the `HttpStatus` enum (e.g., `'OK'`, `'INTERNAL_SERVER_ERROR'`), not a numeric code.

## Individual Controllers

### liveNetController

**Responsibilities:**

- Provide `LiveNetDetails` payloads for client stores
- Handle presence-only responses for polling clients
- List active nets and start new net sessions

**Routes (mounted at `/api/data/livenets` and `/api/presence/livenets`):**

- `GET /api/data/livenets/:id` — Get live net state and station list
- `POST /api/data/livenets/:id` — Start a net session
- `GET /api/presence/livenets/:id` — Presence polling endpoint

**Integration Points:**

- Uses `lib/controllers/liveNetHelpers` (`genLiveNetDetails`) for payload generation
- Integrates with `lib/realtimeClients` for SSE updates
- Calls `lib/sharedNetOps` for business logic

### interactionController

**Responsibilities:**

- Handle station interaction events (sigReport, hand, highlight, checkState)
- Execute administrative commands for net control
- List available admin commands for authenticated users

**Exported functions:**

- `stationEventProcessor` — handles station interaction events
- `adminCommandProcessor` — executes admin commands
- `adminCommandList` — lists available commands for the requesting user's role

**Routes:**

- `POST /api/station/interactions/:id` — Submit station interaction event (served by `stationInteractionRoutes.js`)
- `POST /api/admin/interactions/:id` — Execute an admin command (served by `adminInteractionRoutes.js`)
- `GET /api/admin/interactions/:id` — List available commands (served by `adminInteractionRoutes.js`)

**Integration Points:**

- Heavily uses `lib/sharedNetOps` for all business logic
- Integrates with `lib/netAdminCommands/*` for command execution via the `CommandSet` singleton
- Coordinates with the SSE system for real-time updates

### followController

**Responsibilities:**

- Manage following/followers lists for users and nets
- Enforce following limits and prevent duplicate follows
- Provide follow status and statistics

**Routes:**

- `GET /api/data/follow` — Get user's followed nets
- `POST /api/data/follow/:id` — Follow a net
- `DELETE /api/data/follow/:id` — Unfollow a net

### netProfileController

**Responsibilities:**

- CRUD operations for net profiles
- Validate frequency, mode, and other net configuration
- Manage net ownership and permissions

**Routes:**

- `GET /api/data/netprofiles` — List nets (with filtering)
- `GET /api/data/netprofiles/:id` — Get a single net profile
- `POST /api/data/netprofiles` — Create new net profile
- `POST /api/data/netprofiles/addnetowner/:id` — Add a co-owner to a net profile
- `PATCH /api/data/netprofiles/:id` — Update net configuration
- `DELETE /api/data/netprofiles/:id` — Delete net profile

### userProfileController

**Responsibilities:**

- User profile read/update operations
- Account deletion and recovery flows
- Call-sign registration management

**Routes:**

- `GET /api/data/userprofiles/` — Get the authenticated user's own profile (no `:id`; identity comes from the session)
- `PATCH /api/data/userprofiles/:id` — Update profile
- `DELETE /api/data/userprofiles/:id` — Flag account for deletion (or hard-delete if user has not consented to policy)
- `GET /api/util/undeleteme` — Account recovery (clears the deletion flag)

**Note on per-user flex option overrides:** `userProfileController` enforces that only `email` and `chat` options may be overridden by users.

### notificationController

**Responsibilities:**

- Fetch pending system notifications for authenticated users
- Track notification dismissals per user
- Validate notification response format before returning

**Routes:**

- `GET /api/util/notifications/pending` — Get active notifications user hasn't dismissed
- `POST /api/util/notifications/:notificationId/dismiss` — Mark notification as dismissed

**Integration Points:**

- Uses `notificationHelpers` for business logic
- Validates responses with `isSystemNotificationResponse` type guard
- Integrates with UserProfile and SystemNotification models

### Local chat routes

`chatRoutes.js` maps authenticated local chat handlers from `lib/localChat.js`.

**Routes:**

- `GET /api/chat/:id/messages` — Retrieve ordered history
- `POST /api/chat/:id/messages` — Send a message
- `GET /api/chat/:id/events` — Subscribe over SSE
- `DELETE /api/chat/:id/messages/:messageId` — Delete the authenticated author's own message

## Request/Response Architecture

### Standard Response Envelope

All controllers produce the `EndPointResponse` format. The standard utilities are in `lib/responseUtils.js`:

```javascript
// Most controllers use the handleRequest helper:
handleRequest(res, async () => { return data; }, 'log message');

// Controllers needing finer control instantiate ResponseHandler directly:
const handleResponse = new ResponseHandler({ ttlMs: res.locals.flexOpts.baseTtlMs });

// Success — status is a string enum key:
handleResponse.sendResponse(res, 'OK', { message: data });

// Error:
handleResponse.sendError(res, 'INTERNAL_SERVER_ERROR', err.message);
```

### Common Response Properties

Controllers include these standard properties in responses:

- `endpointVersion`: API version string
- `now`: Current timestamp (ISO string)
- `ttlMs`: Recommended client cache duration
- `hash`: Response content hash for change detection
- `ssePath`: SSE endpoint URL (when real-time updates available; `null` otherwise)

### Error Handling Patterns

Controllers throw plain `Error` instances. The only custom error class in the codebase is `NetNotFoundError` (from `types/commonTypesupport.js`), used when a LiveNet document cannot be found. There are no `PermissionError`, `ValidationError`, or `DatabaseError` classes.

```javascript
// Standard error throw
throw new Error('You must be checked-in to alter check-state');

// NetNotFoundError (only custom error class)
throw new NetNotFoundError(`livenet not found (npid: ${this.npid})`);
```

## Integration with Domain Logic

### SharedNetOps Integration

Most controllers delegate business logic to `sharedNetOps` functions. The key helper for live net payloads is `genLiveNetDetails` (in `lib/controllers/liveNetHelpers.js`), not a method on `SharedNetOps`:

```javascript
// liveNetHelpers provides the payload generator used by the SSE system
const { genLiveNetDetails } = require('../lib/controllers/liveNetHelpers');

// sharedNetOps provides station and net operations
const { checkState, hand, closeNet } = require('../lib/sharedNetOps');
```

## See also

- [API Reference](api-reference.md) — Complete endpoint documentation with examples
- [Routing and API](routing-api.md) — Route organization and architectural patterns
- [Shared Net Operations](shared-net-ops.md) — Domain logic implementation
- [Middleware](middleware.md) — Request processing pipeline and authentication

(End of controllers and request processing documentation.)
