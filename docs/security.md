# Security

This document covers security considerations for Ham.Live REST endpoints, authentication, authorization, and transport security.

## REST endpoint security

### Authentication & authorization

- All state-changing endpoints (POST/PATCH/DELETE) enforce authentication and check user permissions/roles server-side. Client-side checks are not relied upon.
- Cookie-based sessions are used for browser sessions. Server-side code validates sessions on each request and enforces per-endpoint permission checks.

### Input validation and sanitization

- All incoming payloads and query parameters are validated. Centralized validators or schema checks are used where possible (request body, query, path params).
- Values that are rendered in views or passed to third-party services are sanitized to prevent XSS or injection.

### Transport security

- Production requires a canonical HTTPS `BASE_URL`. `FORCE_HTTPS` is supported only with explicit
  `TRUST_PROXY`, and redirects use the canonical origin rather than forwarded Host data.
- Helmet applies CSP, frame restrictions, `nosniff`, Referrer-Policy, Permissions-Policy, and
  production HSTS. The CSP temporarily permits existing inline script/style markup; removing that
  compatibility allowance remains incremental hardening work.

### Endpoint endorsements and token generation

- Local chat uses the existing signed cookie session and validates active-net membership on every
  request, including image retrieval. Image uploads are size-limited and signature-checked; SVG is
  rejected, random internal filenames are not exposed, and responses use `nosniff` plus a
  restrictive content security policy.
- See [Chat System](chat-system.md) for implementation details.

## Credentials and secrets

**Secrets are stored exclusively in environment variables (`.env` or the real environment), never in YAML.**

`commonConfig.yaml` contains only non-secret, structural configuration and explicitly states: *"Secrets below are intentionally NOT stored here."* The committed YAML files (`commonConfig.yaml`, `devConfig.yaml`, `prodConfig.yaml`) contain no credentials of any kind.

Secrets are overlaid onto the config at startup by `configLib.js` reading from environment variables. See [Runtime Configuration](runtime-config.md) and `INSTALL.md` for the full list.

### Magic-link security

Magic links contain a high-entropy random token with a 15-minute lifetime. MongoDB stores only an
HMAC digest, consumption is atomic, replay fails, and issuing a replacement invalidates the prior
token for that email identity.

### Session cookie security

Sessions use an opaque `hamlive.sid` cookie and a MongoDB-backed `express-session` store. They have
a rolling 12-hour bound, rotate after authentication, can be revoked/destroyed, and use explicit
HttpOnly/SameSite/path settings plus Secure in production.

## Error Handling and Logging

### Comprehensive error logging

- Server-side structured logging with configurable log levels (error, warn, info, debug) based on environment.
- Client-side logging system with filename context and styled console output.
- HTTP request/response logging with performance metrics and status code-based log levels.

### Error boundary patterns

- Centralized error handling in `handleRequest()` wrapper for consistent API responses.
- Try-catch blocks around critical operations with proper error propagation.
- Client-side error handlers for network failures, SSE disconnections, and widget initialization.

### Security event logging

- Failed authentication attempts and account lockouts are logged.
- Invalid input validation failures are logged with context.
- HMAC signature validation errors are logged.
- Type guard failures for incoming data are logged with detailed error messages.

## Data Protection

### Environment-based configuration

- All credentials (database URI, OAuth secrets, API keys, signing keys) are supplied via environment variables and overlaid at load time. See [INSTALL.md](../INSTALL.md) and `.env.example`.
- Never commit real secrets to version control; use your host's environment/secrets management.

### HTML sanitization

- Uses `sanitize-html` library for user-generated content with an allowlist of safe HTML tags.
- Notes field sanitization with character encoding for quotes and newlines.
- Consistent sanitization applied before rendering to views or passing to third-party services.

### Mongoose validation

- Database schema validation with custom validators for call signs, email formats, and other critical fields.
- Unique field validation with proper error handling.
- Input validation at the database layer as defense in depth.

## Session Management

### Session storage

- Uses `express-session` with `connect-mongo` for revocable server-side state and TTL cleanup.
- Locked accounts are rechecked during every Passport deserialization.

### Client state & reconciliation

- The client uses `ReactiveStore` as the canonical in-memory view state with an ingest path for `EndPointResponse` envelopes.
- Stores expect `lookupTable` keys in LiveNet payloads so `StationIndexer` can reconcile station lists.
- The client applies optimistic updates and uses `InFlightWindowManager` to reconcile server confirmations.

### SSE and concurrency

- SSE provides server-initiated updates and is used when `ssePath` is provided. Reconnect/backoff rules and how to handle out-of-order SSE messages (using envelope `now` and `hash` fields to detect stale payloads) are implemented.

### Security headers and response envelope protection

- Consistent `EndPointResponse` envelope format with hash-based payload integrity checking.
- Response time measurement and HTTP status code logging for security monitoring.
- Configurable TTL (Time To Live) values for cached responses with warnings for missing TTL.

### Type safety and runtime validation

- Comprehensive TypeScript type system with runtime type guards for all external data.
- Client and server-side validation using consistent type guard patterns.
- External QRZ responses are validated and logged without credentials or session keys.

### Transactions and consistency

- MongoDB is used for data persistence with appropriate schema validation.

## See also

- [Runtime Configuration](runtime-config.md) — FlexOps and feature flags
- [Controllers](controllers.md) — HTTP endpoints and authentication flows
- [Authentication](authentication.md) — Magic-link and OAuth integration, session management
- [Client Framework](client-framework.md) — Client-side reactive patterns and stores
- [Shared Net Operations](shared-net-ops.md) — Domain logic for atomic operations
- [API Reference](api-reference.md) — EndPointResponse envelope format

(End of security documentation.)
