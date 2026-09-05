# NCO Logger 1.1.0-beta.3

This security and production-readiness beta contains the completed work merged into `main` after
the `1.1.0-beta.2` release point. It does not include ongoing mobile or other unmerged branch work.

## Highlights

- Adds fail-closed production configuration validation, canonical HTTPS/host/origin enforcement,
  explicit trusted-proxy handling, Helmet security headers, same-origin mutation protection, and
  safer public error responses.
- Replaces client-contained sessions with revocable MongoDB-backed opaque sessions. Sessions roll
  for up to 12 hours, rotate at login, are destroyed at logout, and reject subsequently locked
  accounts.
- Replaces third-party magic-login tokens with one-time, 15-minute application tokens whose HMAC
  digests are stored in MongoDB. Requests have persistent IP and identity rate limits; replacement,
  replay, expiry, and malformed-token cases fail closed.
- Adds authenticated MongoDB Compose initialization, private service networking, separate root and
  application users, a replica-set key, least-privilege application access, and hardened non-root,
  read-only application containers.
- Adds coordinated database and chat-upload backups with integrity manifests, digest verification,
  safe upload extraction, scheduled retention, S3 off-host replication support, and guarded restore
  and migration workflows. Disposable session, magic-token, and rate-limit collections are excluded
  from backup and recovery.
- Adds liveness/readiness endpoints, graceful real-time/change-stream shutdown, image revision
  metadata, bounded container resources/logs, and production recovery integration coverage in CI.
- Updates vulnerable production dependencies and the Node/npm toolchain contract; adds lint, full
  dependency audit, Compose validation, image builds, and generated-artifact checks to CI.

## Completed functionality and fixes

- Preserves the favorites integration and synchronized appearance artifacts on clean builds.
- Makes following a net transactional so user and net follower records cannot diverge.
- Keeps local chat uploads on persistent storage and includes them in coordinated recovery.
- Improves SSE keep-alives and shutdown behavior, notification-state parsing, client logging, logout
  semantics, HTTP status handling, input validation, and generic handling of unexpected server errors.
- Makes magic-login and backup tests deterministic and adds security, dependency parsing, recovery,
  and authenticated Compose integration coverage.
- Adds and updates installation, authentication, security, API, middleware, architecture, backup,
  recovery, runtime configuration, and production release-checklist documentation.

## Upgrade requirements

Review the deployment as a security migration; do not reuse example credentials or expose the Node
service or MongoDB directly to the Internet.

1. Generate or rotate `COOKIE_SESSION_KEY` and `MAGIC_LINK_SECRET`. Each must be a distinct,
   non-placeholder secret of at least 32 bytes with sufficient entropy. Existing browser sessions
   should be treated as invalid and users should expect to sign in again.
2. Set `BASE_URL` to the exact public HTTPS origin with no credentials, path, query, or fragment.
   Production startup rejects cleartext or non-canonical values.
3. Terminate TLS at a reviewed reverse proxy or load balancer. Set `TRUST_PROXY` only to the actual
   proxy hop, IP, or subnet. If `FORCE_HTTPS=true`, `TRUST_PROXY` is required. Keep the application
   bound to loopback/private networking unless the deployment design explicitly requires otherwise.
4. Supply an authenticated `MONGODB_URI`. For the bundled Compose database, set unique
   `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD`, `MONGO_APP_USERNAME`, `MONGO_APP_PASSWORD`, and a
   48-or-more-character random `MONGO_REPLICA_KEY`; alternatively provide an authenticated
   `MONGODB_COMPOSE_URI` for a managed/external replica set. Back up and migrate any old
   unauthenticated Compose volume through a separate authenticated test project before cutover.
5. Replace or review the included privacy, cookie, and terms templates, obtain organizational
   approval, and set `LEGAL_CONTENT_APPROVED=true`. Production fails closed while this gate is false.
6. Configure SMTP for production magic links. Production never displays or logs a sign-in link when
   mail is unavailable; a request fails safely instead. New links are single-use, expire after 15
   minutes, and supersede earlier outstanding links for the same email. Optional rate-limit tuning is
   available through `MAGIC_LOGIN_RATE_WINDOW_MS`, `MAGIC_LOGIN_IP_LIMIT`, and
   `MAGIC_LOGIN_IDENTITY_LIMIT`.
7. Create a private host backup directory and set `NCO_BACKUP_DIR`, `NCO_BACKUP_UID`, and
   `NCO_BACKUP_GID` appropriately. Production backups should use
   `backup --production --require-uploads`, and restores should be rehearsed against a distinct
   authenticated development/staging database without reusing production data paths.
8. Configure `NCO_BACKUP_S3_BUCKET` (and, if needed, `NCO_BACKUP_S3_PREFIX`) plus deployment-managed,
   least-privilege AWS credentials for encrypted off-host copies, or document an equivalent reviewed
   off-host destination. The scheduled profile defaults to a 900-second interval and 30-day local
   retention through `NCO_BACKUP_INTERVAL_SECONDS` and `NCO_BACKUP_RETENTION_DAYS`.

Before production promotion, complete `docs/production-release-checklist.md`, validate a full
database-plus-upload restore in isolated staging, and confirm the off-host backup monitor and alerting
path. Do not perform the first recovery test against live application data.

## Included pull requests

- #41 — GitHub Actions build and validation, deterministic tests, favorites build fix, and generated
  appearance artifacts.
- #46 — production backup and restore hardening.
- #47 — production dependency vulnerability remediation.
- #48 — remaining dependency security remediation and parsing regression coverage.
- #49 — final production-readiness and security remediation.
