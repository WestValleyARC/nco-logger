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

- HTTPS/TLS is enforced in production via the optional `FORCE_HTTPS=true` environment variable, which adds an `x-forwarded-proto` redirect middleware. This is appropriate when deploying behind a TLS-terminating reverse proxy or platform (Render, Fly, Railway, nginx, Caddy, etc.). Leave it off if TLS is terminated upstream before the Node process.
- No `helmet` middleware is currently installed. Operators should evaluate adding security headers (CSP, HSTS, etc.) at the reverse proxy or application layer.

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

### Magic-link JWT security

Magic-link sign-in tokens are JWTs signed with `MAGIC_LINK_SECRET`. This key must be a strong random value (32+ bytes). Without it the application will not be able to generate or validate sign-in links. The JWT TTL is 30 days.

### Session cookie security

Sessions use `cookie-session` with a single signing key (`COOKIE_SESSION_KEY`). The cookie lifetime is 3.5 days and is renewed on activity. There is no key rotation mechanism; rotating the key invalidates all active sessions. See [Authentication](authentication.md) for details.

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

- Uses `cookie-session` for session management (stateless encrypted cookies — no server-side session store).
- Session cookie is renewed every 10 minutes of activity via `cookieSessionKeepAlive()` middleware.

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
