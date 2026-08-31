# API Reference

## Chrome extension compatibility boundary

The logger continues to use its signed browser cookie session; extension requests must include
credentials. Live-net state remains under `/api/data/livenets`, net profiles under
`/api/data/netprofiles`, station actions under `/api/station/interactions`, and administrative
commands under `/api/admin/interactions`. Live-net updates use `/api/sse/livenets/:npid` with the
existing `EndPointResponse` event payloads.

The intentional compatibility change is chat: the hosted-provider endorsement/token route was
removed. Use `/api/chat/:npid/messages` and the local SSE path returned by history. Chat errors use
an `error` string; the established data endpoints retain `errorMessage` in their standard response
envelope. See [Local chat](chat-system.md).

> **Document Scope:** This document is the **complete endpoint reference** with request/response examples and parameter details. **Not covered:** API architectural patterns (see [Routing and API](routing-api.md)), controller implementation (see [Controllers](controllers.md)), or server architecture (see [Server Architecture](server-architecture.md)).

> **Development Server:** The local development server runs at `http://localhost:3000` via `npm run dev`.

This page collects the HTTP and SSE endpoints used by the client and server. It is intended as a concise reference for tests, MSW handlers and internal development. The examples below are based on the runtime code in `server/dist/` and the controllers used by the client.

See [api-request-response-flow.svg](api-request-response-flow.svg) for a visual overview of the API request/response patterns and EndPointResponse envelope structure.

Common response envelope: EndPointResponse

- canonical keys (summary):
    - `endpointVersion`: string (e.g. "1.0")
    - `now`: number (epoch ms)
    - `ttlMs`: number (ms) — recommended client caching TTL
    - `ssePath`?: string — when present clients can open SSE
    - `hash`?: string — response hash used for caching/validation
    - `servedFromCache`?: boolean
    - `errorMessage`?: string — human message when error
    - `message`?: any — the endpoint-specific payload

Server code uses `ResponseHandler` helpers to populate these fields. Tests and MSW handlers should include `now` and `endpointVersion`.

Example EndPointResponse (minimal):

{
"endpointVersion": "1.0",
"now": 1590000000000,
"ttlMs": 3000,
"hash": "...",
"message": { ... }
}

LiveNetDetails payload (shape used by client stores)

- top-level message for `/api/data/livenets/:id` or SSE payloads typically includes:
    - `lookupTable`: object mapping callSign -> { stationInteraction: string (ObjectId) }
    - `stations`: optional array of station payloads (callSign, role, checkedState, lastSeen, displayName, photo, etc.) — client StationIndexer often builds this from lookupTable + separate station doc map
    - `counts`: { checkedIn: number, currentCount: number, checkedInEver: number }
    - `started`: boolean
    - `closing`: boolean
    - `countdownTimer`: number (seconds)
    - `url`: string (short net URL)
    - `netProfile`: { id, title, frequency, mode, modeDetails, permanent }
    - `now`: number (optional, often present in envelope)

This is a compact, pragmatic payload shape — client-side `StationIndexer` and `LiveNetReactiveStore` expect the `lookupTable` map keys (callsigns) so they can reconcile station lists.

## Authentication levels

Two auth levels are used across endpoints:

- **REQ_LOGIN** — any logged-in user (session cookie present and valid)
- **REQ_CALLSIGN** — logged-in user who also has a confirmed callsign on their profile

Unauthenticated requests to protected endpoints receive HTTP 401/403. Browser clients must use `credentials: 'include'` in fetch calls.

## Endpoints

### GET /api/data/livenets

- **Auth:** none (public)
- **Description:** List active nets (summary view used by index pages).
- **Query parameters:** none (query params are ignored by the controller)
- **Response format:** Modified EndPointResponse — `netlist` is a **top-level property**, not nested under `message`:
  `{ endpointVersion, now, hash, servedFromCache, netlist: Array<NetSummary> }`
- **Example response:**

```json
{
    "endpointVersion": "1.0",
    "now": 1755535964763,
    "hash": "fe09...",
    "servedFromCache": true,
    "netlist": [
        { "id": "abcd1234", "title": "Evening Net", "frequency": "7.290", "mode": "SSB", "started": true },
        { "id": "efgh5678", "title": "Morning Net", "frequency": "3.860", "mode": "CW", "started": false }
    ]
}
```

### GET /api/data/livenets/:id

- **Auth:** REQ_CALLSIGN (required)
- **Description:** Authoritative LiveNetDetails for a single net. Used by clients to populate stores; response may include `ssePath` for SSE clients. Polling clients pass `?capturePresence=true`.
- **Path parameters:**
    - `id` (string) — NetProfile id
- **Query parameters:**
    - `capturePresence=true` — instruct server to also record a presence snapshot for the calling client
- **Example request:**

```bash
curl -b cookies.txt "https://ham.live/api/data/livenets/abcd1234?capturePresence=true"
```

- **Response.message (LiveNetDetails):**

    - `lookupTable`: object mapping callSign -> { stationInteraction: string }
    - `stations`?: optional array of station docs
    - `counts`: { checkedIn, currentCount, checkedInEver }
    - `started`: boolean
    - `closing`: boolean
    - `countdownTimer`: number (seconds)
    - `url`: string
    - `netProfile`: object (id, title, frequency, mode, permanent)
    - `ssePath` is in the envelope root, not inside `message`

- **Example envelope:**

```json
{
    "endpointVersion": "1.0",
    "now": 1590000000000,
    "ttlMs": 3000,
    "ssePath": "/api/sse/livenets/abcd1234",
    "message": {
        "lookupTable": { "K1ABC": { "stationInteraction": "61e..." }, "N0XYZ": { "stationInteraction": "61f..." } },
        "counts": { "checkedIn": 2, "currentCount": 2, "checkedInEver": 2 },
        "started": true,
        "closing": false,
        "countdownTimer": 120,
        "url": "/n/abcd1234",
        "netProfile": { "id": "abcd1234", "title": "Evening Net", "frequency": "7.290", "mode": "SSB" }
    }
}
```

### POST /api/data/livenets/:id

- **Auth:** REQ_CALLSIGN
- **Description:** Owner action to start a live net instance for the given NetProfile id.
- **Path parameters:**
    - `id` (string) — NetProfile id (must be owned by the authenticated user)
- **Request body (JSON):** optional `{ "countdownTimer": "<minutes>" }`
- **Response:** LiveNet document on success

```bash
curl -X POST -b cookies.txt -H "Content-Type: application/json" \
  -d '{}' "https://ham.live/api/data/livenets/abcd1234"
```

### GET /api/presence/livenets/:id

- **Auth:** REQ_CALLSIGN
- **Description:** Presence-only snapshot used by polling clients; records presence and returns a lightweight payload.
- **Response:** EndPointResponse with presence-only payload (may be empty with client info included in envelope)

```json
{
    "endpointVersion": "1.0",
    "now": 1590000000000,
    "ttlMs": 15000,
    "message": {}
}
```

### /api/data/netprofiles (NetProfile CRUD)

- **Auth:** REQ_CALLSIGN (write operations), REQ_LOGIN (reads)
- GET /api/data/netprofiles — list net profiles
- POST /api/data/netprofiles — create new NetProfile
- PATCH /api/data/netprofiles/:id — update (body contains patch fields)
- DELETE /api/data/netprofiles/:id — delete (owner only)

Responses follow EndPointResponse envelope and return the updated/created NetProfile in `message`.

### /api/data/userprofiles

- **Auth:** REQ_LOGIN
- **Routes:**
    - `GET /api/data/userprofiles` — get own profile (authenticated user only; no `:id` variant exists)
    - `PATCH /api/data/userprofiles/:id` — update profile fields (e.g. displayName, photo url)
    - `DELETE /api/data/userprofiles/:id` — delete or soft-delete own account
- **Note:** There is no `GET /api/data/userprofiles/:id` route — the `GET /` endpoint returns the authenticated user's own profile.

Request/response envelopes follow the canonical shape. Example patch body:

```json
{ "displayName": "Alice", "photo": "https://.../a.jpg" }
```

### /api/data/follow

- **Auth:** REQ_LOGIN
- GET /api/data/follow — list follows
- GET /api/data/follow/:id — single follow record
- POST /api/data/follow/:id — follow a net/profile
- DELETE /api/data/follow/:id — unfollow

Response: EndPointResponse with `message` containing follow state or list.

### POST /api/station/interactions/:id

- **Auth:** REQ_CALLSIGN
- **Description:** Post station interactions (sigReport, hand, highlight, checkState updates) for the live net identified by `:id` (NetProfile id).
- **Note:** The `:id` path parameter is required. There is no `/api/station/interactions` route without `:id`.
- **Request body (example):**

```json
{
    "type": "sigReport",
    "from": "K1ABC",
    "to": "N0XYZ",
    "payload": { "report": "59" }
}
```

- Server may return acknowledgement `{ message: { ok: true } }` or full LiveNetDetails envelope.

### GET /api/admin/interactions/:id

- **Auth:** REQ_CALLSIGN
- **Description:** List available net admin commands for the given net (NetProfile id). Returns the command registry for the authenticated user's permission level.
- **Path parameters:**
    - `id` (string) — NetProfile id

### POST /api/admin/interactions/:id

- **Auth:** REQ_CALLSIGN
- **Description:** Execute a net admin command for the given net.
- **Path parameters:**
    - `id` (string) — NetProfile id
- **Request body:** `{ "cmdLine": "<command string>" }`
- **Response:** EndPointResponse with command output in `message`

### Local chat

All chat routes require the authenticated cookie session, a callsign, and membership in the active
net. See [chat-system.md](chat-system.md) for response and SSE event formats.

- `GET /api/chat/:id/messages` — newest 1,000 public messages, newest 1,000 participant-only direct
  messages for inbox reconciliation, configured limits, recipients, and the SSE path
- `POST /api/chat/:id/messages` — send public `{ "text": "...", "replyTo": "optional-message-id" }`
- `GET /api/chat/:id/direct/:userId/messages` — newest 500 messages in the exact two-party conversation
- `POST /api/chat/:id/direct/:userId/messages` — send a participant-only direct text message
- `POST /api/chat/:id/direct/:userId/images` — send a participant-only direct image
- `PUT /api/chat/:id/direct/:userId/ignore` — persist the viewer's ignore/unignore preference
- `PATCH /api/chat/:id/messages/:messageId` — edit your own text or image caption while preserving
  the original message ID and creation timestamp
- `POST /api/chat/:id/images` — upload raw image bytes using the matching image `Content-Type`;
  accepts PNG, JPEG, GIF, and WebP up to the configured limit and returns `201`
- `GET /api/chat/:id/messages/:messageId/image` — retrieve an attachment; access is private to
  authenticated active-net members for public images and exact participants for direct images
- `DELETE /api/chat/:id/messages/:messageId` — delete your own message
- `PUT /api/chat/:id/messages/:messageId/reaction` — toggle a supported reaction
- `PUT /api/chat/:id/messages/:messageId/pin` — set public pin state as NCO or Logger
- `POST /api/chat/:id/messages/:messageId/ban` — ban the public message author as NCO
- `DELETE /api/chat/:id/messages` — clear the current net's public chat as NCO
- `GET /api/chat/:id/events` — local chat SSE stream

History and SSE messages may include `attachment: { kind: "image", mimeType, size, url }`. Internal
storage names are not exposed. Image uploads return `413` when too large and `415` for an unsupported
or mismatched file signature. Chat mutations share one per-user burst window. A limited request
returns `429`, a safe JSON error, and `Retry-After`.

### GET /api/util/resolvelocation

- **Auth:** REQ_LOGIN
- **Description:** Resolve a lat/lon coordinate to a human-readable location string.
- **Query parameters:** `lat`, `lon`
- **Response:** `{ endpointVersion: "1.0", ...locationData }`

### GET /api/util/undeleteme

- **Auth:** REQ_LOGIN
- **Description:** Recover (un-delete) the authenticated user's account if it was flagged for deletion.

### GET /api/util/notifications/pending

- **Auth:** REQ_LOGIN
- **Description:** Fetch active system notifications the user has not yet dismissed.
- **Response.message:** `{ notifications: SystemNotification[], count: number }`
- **ttlMs:** baseTtlMs from flexOpts (typically ~15000 ms)

### POST /api/util/notifications/:notificationId/dismiss

- **Auth:** REQ_LOGIN
- **Description:** Mark a notification as dismissed for the current user.
- **Path parameter:** `notificationId` (string, 1–100 chars)
- **Response.message:** `{ success: boolean, notificationId: string }`
- **ttlMs:** 1 ms (no cache)

### SSE path (EventSource): /api/sse/livenets/:id

- **Auth:** session cookie (must be same origin or SSE polyfill that sends cookies)
- **Description:** EventSource endpoint where the server pushes LiveNetDetails payloads.
- **Protocol:** EndPointResponse-shaped JSON per SSE message event
- **Client behavior:** open EventSource to the `ssePath` returned by the initial HTTP envelope; handle `open`, `message`, `error` events and implement reconnect/backoff.

SSE message example (server push body):

```json
{
    "endpointVersion": "1.0",
    "now": 1590000000000,
    "ttlMs": 3000,
    "message": {
        /* LiveNetDetails */
    }
}
```

---

## Integration checklist — common pitfalls (quick)

Before you start coding, verify the following items to avoid common integration problems:

- Cookies & CORS: If your client runs on a different origin, the server must enable CORS for your origin and allow credentials (Access-Control-Allow-Credentials: true). Use `fetch(..., { credentials: 'include' })` in browsers.
- SSE credentials: Native EventSource does not send cookies across origins. Use same-origin SSE, a polyfill that supports credentials, or provide an SSE token via the initial HTTP envelope (`ssePath`).
- CSRF & state-changing requests: Because auth is cookie-based, the server may require CSRF protection or SameSite cookie settings. Plan for token-based or same-origin flows for POST/PATCH/DELETE from browsers.
- Session cookie domain/path: If you expect cookies to be set for subdomains or via redirects, confirm the cookie domain/path and secure/sameSite settings with operators.
- TTL/hash handling: Honor `ttlMs` and use `hash` (when present) to avoid unnecessary UI updates.
- Time skew: Use `now` in envelopes to reconcile client/server clocks for timers and staleness checks.
- Rate limits & retry: Implement backoff for 429 and 5xx responses and respect `Retry-After` headers.
- Endorsements: Never put third-party secret keys in client code — use server endorse endpoints.
- Testing: MSW handlers must return the EndPointResponse envelope (include `endpointVersion` and `now`) and `message.lookupTable` for LiveNet fixtures.

## Developer integration guide (how to build a client against Ham.Live)

This section collects the practical steps, examples and implementation notes you will need to build a resilient client (browser, Electron, mobile or server script) that talks to Ham.Live HTTP and SSE endpoints.

Core principles

- Always treat server responses as the authoritative source of truth: parse the EndPointResponse envelope and validate `endpointVersion` and `now` before using `message`.
- Respect caching hints: `ttlMs` indicates how long clients may consider data fresh; `hash` (when present) lets you detect unchanged payloads cheaply.
- Authentication in production is cookie-based. Browser clients should use `credentials: 'include'`. Non-browser clients may prefer a server-to-server exchange to obtain a session cookie or a short-lived bearer token (coordinate with maintainers).
- Prefer server-side calls for any operation that requires secrets (upload signatures, third-party API keys). Use endorse endpoints for client widgets.

Authentication flows (summary)

Ham.Live uses session-cookie based authentication with two primary flows:

- **Magic link (email)**: POST email to `/auth/magiclogin`, user clicks link, server sets session cookie
- **OAuth (Google)**: Standard OAuth redirect/callback flow via `/auth/google` and `/auth/google/redirect`

For complete authentication implementation details, see [Authentication](authentication.md).

**Key authentication endpoints:**

- `POST /auth/magiclogin` - Request magic link email
- `GET /auth/magiclogin/callback?token=...` - Verify magic link token
- `GET /auth/google` - Initiate Google OAuth flow
- `GET /auth/google/redirect?code=...` - Handle Google OAuth callback

**Session management:**

- Session cookies are HTTP-only and Secure
- Browser clients: use `credentials: 'include'` in fetch requests
- Same-origin requests: cookies included automatically
- Cross-origin: server must allow credentials, client must include them

### Client Integration Reference

**Quick authentication patterns:**

- **Browser**: Use `credentials: 'include'` in fetch requests for session cookies
- **Mobile/Native**: Use system browser for auth flows, extract session cookies for API calls
- **Scripts/CI**: Use cookie jars (`curl -c/-b` or `requests.Session`) to maintain sessions
- **Session verification**: GET any authenticated endpoint; 200 = valid, 401/403 = expired

**Example authenticated request:**

```javascript
const resp = await fetch('/api/data/livenets/abcd1234', {
    credentials: 'include',
    headers: { Accept: 'application/json' }
});
```

### Quick API Examples

**Browser (authenticated):**

```javascript
const resp = await fetch('/api/data/livenets/abcd1234', {
    credentials: 'include',
    headers: { Accept: 'application/json' }
});
const envelope = await resp.json();
if (envelope.endpointVersion === '1.0') {
    const liveNetDetails = envelope.message;
}
```

**cURL (public endpoints):**

```bash
curl -s "https://ham.live/api/data/livenets"
```

**cURL (authenticated):**

```bash
curl -b cookies.txt -H "Accept: application/json" "https://ham.live/api/data/livenets/abcd1234"
```

SSE (EventSource) integration

- The server exposes SSE at `/api/sse/livenets/:id`. Messages are EndPointResponse-shaped JSON containing `message` with LiveNetDetails.
- Browsers: the native EventSource does not send credentials by default. Options:
    - Open SSE from the same origin as the server so the session cookie is included.
    - Use an SSE polyfill that supports credentials (e.g., `eventsource-polyfill` in some builds) or provide a short-lived SSE token in the initial HTTP response (`ssePath` may embed a token or be on the same origin).
    - If SSE with cookies is impractical, use polling (`GET /api/data/livenets/:id?capturePresence=true`) at an interval derived from `ttlMs`.
- Node.js: use an EventSource client library that allows setting headers and cookies (e.g., `eventsource` or `node-fetch` streaming). Provide the session cookie in `Cookie` header.

SSE client pattern (browser same-origin)

```js
const es = new EventSource('/api/sse/livenets/abcd1234');
es.addEventListener('message', ev => {
    const envelope = JSON.parse(ev.data);
    // process envelope.message
});
es.addEventListener('error', e => {
    // implement exponential backoff reconnect if needed
});
```

SSE reconnection & health

- Reconnect strategy: retry delays doubling from 1s -> 2s -> 4s up to ~30s with small random jitter.
- Heartbeat & staleness: use `now` and `ttlMs` from the last envelope to detect stale state. If no envelope arrives within `ttlMs * 2` (plus jitter), fetch via HTTP GET to recover.

Polling fallback

- If SSE is unavailable, poll `GET /api/data/livenets/:id?capturePresence=true` at a sensible rate: use `ttlMs` from the last response to set interval (e.g., poll at `Math.max(1000, ttlMs / 2)`).
- When `message.hash` is present, avoid full UI updates if hash unchanged.

Posting station interactions (client -> server)

- Endpoint: `POST /api/station/interactions/:id` — the `:id` (NetProfile id) is required.
- Content-Type: `application/json`.
- Example payloads:

```json
{ "type": "sigReport", "from": "K1ABC", "to": "N0XYZ", "payload": { "report": "59" } }
```

- On success server may return a simple acknowledgement or the canonical LiveNetDetails envelope. Handle both cases.

Error handling & HTTP codes

- 200: success — read envelope.message
- 401 / 403: authentication/authorization failure — prompt user to re-authenticate or open auth flow
- 404: resource not found — show appropriate UI state
- 429: rate limited — respect `Retry-After` header and backoff
- 5xx: server error — retry with exponential backoff and surface friendly message to user

Caching & payload diffs

- Use `ttlMs` to guide caching. If the server returns `hash`, prefer comparing `hash` before replacing large data structures.
- For list endpoints (e.g., `netlist`) consider shallow merging by id to preserve local UI state and reduce churn.

Testing & MSW guidance (brief)

- MSW handlers should return valid EndPointResponse envelopes including `endpointVersion` and `now`.
- Provide `message.lookupTable` keys for LiveNetDetails so client `StationIndexer` logic can build station lists correctly.

Integration scenarios

- Single Page App (browser): perform auth via magic link or Google OAuth, ensure `credentials: 'include'` on fetch requests, open SSE same origin or fall back to polling.
- Electron: complete auth in a BrowserWindow/webview so session cookie is set; reuse same cookie store for in-app API calls.
- Mobile (native): complete OAuth/magic link in system browser/webview and exchange for a session using a short-lived backend token; otherwise, prefer server-mediated API calls.
- Server-to-server (Python, Node): prefer a backend integration where your server holds secrets and uses internal API calls; if you need direct session emulation, use cookie jars and a controlled auth flow.

Operational notes for integrators

- Use the `ssePath` provided in the initial LiveNetDetails envelope to open SSE when available.
- When restoring state after a reconnect, fetch a fresh `GET /api/data/livenets/:id` to obtain authoritative LiveNetDetails rather than relying solely on last cached envelope.

Where to find examples in this repo

(End of API reference)
