# Runtime Configuration

This document describes Ham.Live's server configuration system (YAML files + environment variables) and the FlexOptions runtime feature-flag system.

## Server Configuration Files

Ham.Live uses a layered configuration system combining YAML files with environment variable overrides.

### Configuration Loading Architecture

The server loads configuration via `server/dist/lib/configLib.js` in this order:

1. `dotenv` loads the **root `.env` file** (path `../../../.env` relative to `configLib.js`) — this single file is always loaded unconditionally, regardless of `NODE_ENV`.
2. `commonConfig.yaml` is always loaded.
3. Either `devConfig.yaml` (when `NODE_ENV=development`) or `prodConfig.yaml` (otherwise) is loaded and merged over `commonConfig.yaml`.
4. Environment variable values are overlaid last, taking highest precedence.

```javascript
// Simplified from configLib.js
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

commonConfigf = fs.readFileSync('.../commonConfig.yaml', 'utf8');
baseConfigf   = fs.readFileSync(NODE_ENV === 'development'
                    ? '.../devConfig.yaml'
                    : '.../prodConfig.yaml', 'utf8');

conf = _.merge(YAML.parse(commonConfigf), YAML.parse(baseConfigf));
// then overlay env vars...
```

### The `.env-development` and `.env-production` stub files

The files `server/dist/.env-development` and `server/dist/.env-production` exist in the repository as reference stubs — they are **not loaded by the application**. Only the root `.env` (one level above the repository root) is loaded by `configLib.js`. Do not expect `NODE_ENV`-based `.env` switching; it does not happen.

### Configuration access in code

Configuration is a CommonJS module:

```javascript
const { conf } = require('../lib/configLib');
const { dburi: dbUri, dbname: dbName } = conf;
```

(Not an ES module import — there is no `import { conf } from '#@server/...'` in the server-side code.)

---

## YAML Configuration Files

### `commonConfig.yaml` — Shared settings

Contains **non-secret, structural** settings shared across all environments:

- Application constants: app name, log name, QRZ endpoint templates, reverse-geocoding endpoint
- Local chat limits and `re_gen_global_flex_ops: false`
- Help URL override placeholder

> **All secrets and per-instance values are supplied via environment variables — they are never stored in the YAML.**
> `commonConfig.yaml` explicitly states: *"Secrets below are intentionally NOT stored here."*
> See [INSTALL.md](../INSTALL.md) and `.env.example` for the complete list.

Key entries:

```yaml
applogname: 'Ham.Live-WebApp'
app_name: 'Ham.Live'
qrz_version: 1.34
re_gen_global_flex_ops: false
chat_max_message_chars: 2000
```

### `devConfig.yaml` — Local development

Development-specific overrides:

- `nodeenv: 'development'`
- `dbname: 'hamlive-dev'`; connection string comes from `MONGODB_URI`
- Mongoose pools: realtime 5, batch 1
- `base_url: 'http://localhost:3000'` (override with `BASE_URL` env var)
- `run_background_tasks_on_startup: true`
- Background task timings aggressive for testing (e.g., `abandoned_after_hours: 0.01`)

Note: `devConfig.yaml` does **not** set `loglevel`. In development, `logger.js` uses a colorized console logger unconditionally, ignoring any `LOG_LEVEL` / `loglevel` value.

### `prodConfig.yaml` — Production

Production-specific overrides:

- `nodeenv: 'production'`
- `dbname: 'hamlive-prod'`; connection string comes from `MONGODB_URI`
- Mongoose pools: realtime 20, batch 2
- `loglevel: 'info'` (YAML key; see note below on the distinction from `LOG_LEVEL`)
- `base_url: 'http://localhost:3000'` — **this is a placeholder with a comment to set `BASE_URL`**. In production you must set the `BASE_URL` environment variable to your instance's public URL (e.g., `https://www.example.com`).
- `run_background_tasks_on_startup` is not set (defaults to false / controlled separately)
- Background task timings for production (e.g., `abandoned_after_hours: 2`)

### Environment-specific differences

| Setting | Development | Production |
|---|---|---|
| `nodeenv` | `development` | `production` |
| `dbname` | `hamlive-dev` | `hamlive-prod` |
| `base_url` (YAML default) | `http://localhost:3000` | `http://localhost:3000` (set `BASE_URL` env var) |
| `loglevel` (YAML key, production logger only) | not set | `info` |
| `realtime_mongoose_poolsize` | 5 | 20 |
| `batch_mongoose_poolsize` | 1 | 2 |
| `run_background_tasks_on_startup` | `true` | not set (false) |
| `closeIdleNets.abandoned_after_hours` | 0.01 | 2 |

---

## Environment Variables

All secrets and instance-specific values are supplied via environment variables. `configLib.js` overlays them onto the merged YAML config at startup.

| Env var | `conf` key | Required | Purpose |
|---|---|---|---|
| `MONGODB_URI` | `conf.dburi` | Yes | MongoDB connection string |
| `COOKIE_SESSION_KEY` | `conf.cookie_session_key` | Yes | Session cookie signing key |
| `MAGIC_LINK_SECRET` | `conf.magic_link_secret` | Yes | JWT signing key for magic-link auth |
| `BASE_URL` | `conf.base_url` | Yes (prod) | Public base URL (OAuth callbacks, email links) |
| `MAIL_TRANSPORT` | `conf.mail_transport` | No | Set to `smtp` for delivery; otherwise development console mode |
| `SMTP_HOST`, `SMTP_PORT` | `conf.smtp_host`, `conf.smtp_port` | No | Provider-neutral SMTP server |
| `SMTP_SECURE`, `SMTP_REQUIRE_TLS` | matching config | No | TLS behavior |
| `SMTP_USER`, `SMTP_PASS` | matching config | No | Optional SMTP authentication |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | matching config | No | Sender identities |
| `GOOGLE_CLIENT_ID` | `conf.google_client_id` | No | Google OAuth2 (optional) |
| `GOOGLE_CLIENT_SECRET` | `conf.google_client_secret` | No | Google OAuth2 (optional) |
| `CHAT_MAX_MESSAGE_CHARS` | `conf.chat_max_message_chars` | No | Local chat length limit |
| `CHAT_RATE_LIMIT_COUNT`, `CHAT_RATE_LIMIT_WINDOW_MS` | matching config | No | Local chat burst control |
| `CHAT_UPLOAD_DIR` | `conf.chat_upload_dir` | No | Local chat image directory; defaults to `/app/data/chat-uploads` |
| `CHAT_MAX_UPLOAD_MB` | `conf.chat_max_upload_mb` | No | Image limit in MB; defaults to 5 and is capped at 10 |
| `QRZ_USERNAME` | `conf.qrz_username` | No | QRZ.com callsign lookup (optional) |
| `QRZ_PASSWORD` | `conf.qrz_password` | No | QRZ.com callsign lookup (optional) |
| `GEO_KEY` | `conf.geo_key` | No | Azure Maps reverse geocoding (optional) |
| `CMD_HELP_URL` | `conf.cmd_help_url` | No | Override net-command help URL |
| `APP_NAME` | `conf.app_name` | No | Override display name |
| `PORT` | (read directly) | No | HTTP port; defaults to 3000 |
| `LOG_LEVEL` | (read by logger) | No | Production log level (error/warn/info/debug) |
| `FORCE_HTTPS` | (read by server.js) | No | `true` to add x-forwarded-proto HTTPS redirect |
| `HTTPS` | (read by server.js) | No | Dev only: `true` to serve over HTTPS with bundled cert |

**`loglevel` vs `LOG_LEVEL`**: `loglevel` is a YAML key used only as a reference value in the config object. The production logger (`node-json-logger`) reads `process.env.LOG_LEVEL` directly; that env var is not overlaid via `configLib.js`. In development, `logger.js` uses a colorized console logger that ignores both.

Advertising and analytics integrations are removed from the WVARC fork.

---

## Development Setup

```bash
# Local development (NODE_ENV=development, uses devConfig.yaml)
npm run dev

# Production
export NODE_ENV=production
npm start
```

---

## FlexOptions / Runtime Configuration

### Purpose

FlexOptions allow safe, low-friction changes to runtime behavior (feature flags, toggleable partials, rate limits, logging levels) without requiring a full code deploy or server restart.

### Overview

FlexOptions are dynamic configuration options stored in MongoDB that complement the YAML configuration files. These options can be changed at runtime and take effect within seconds.

**Key characteristics:**

- **Database-backed**: Stored in MongoDB with global defaults and optional per-user overrides
- **Runtime loading**: Loaded via middleware and accessible as `res.locals.flexOpts`
- **Cached**: Short TTL in-memory cache for performance
- **User overrides**: Limited user-specific preferences (chat and email)

**Examples of FlexOptions in use:**

- `chat` — Enable/disable chat features globally or per-user
- `awayInMs` — Presence/online threshold timing
- `maxNetsPerUser` — Limit number of nets per user

**Complete FlexOptions documentation**: See [Flex Options](flex-opts.md) for detailed documentation of all available options, usage patterns, and management procedures.

### Managing FlexOptions at runtime

```bash
# Connect to MongoDB
mongosh mongodb://localhost:27017/hamlive-dev

# View current global FlexOptions
db.flexoptions.findOne({scope: "global"})

# Update a specific option (example: disable chat)
db.flexoptions.updateOne(
  {scope: "global"},
  {$set: {"option.chat": false}}
)

# Update multiple options
db.flexoptions.updateOne(
  {scope: "global"},
  {$set: {
    "option.maxNetsPerUser": 10,
    "option.maxOwnersPerNet": 6
  }}
)
```

FlexOptions changes have a short in-memory cache TTL, so changes may take a few seconds to propagate.

## See also

- [Flex Options](flex-opts.md) — Detailed flex options reference
- [Security](security.md) — Authentication for admin configuration endpoints
- [Operational Runbook](runbook.md) — Deployment and operational procedures

(End of runtime configuration documentation.)
