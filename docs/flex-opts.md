# FlexOptions (Runtime Configuration)

This document covers Ham.Live's FlexOptions system — dynamic runtime configuration stored in MongoDB that can be changed without restarting the application.

## Overview

FlexOptions (also called FlexOpts) are stored in a `FlexOption` document in MongoDB and complement the YAML configuration files by providing database-backed settings modifiable at runtime.

### How FlexOptions Work

1. **Global defaults:** A `FlexOption` document (`scope: 'global'`) in MongoDB provides system-wide defaults
2. **Per-user overrides:** Individual users may have a `flexOptions` subdocument that overrides a restricted subset of global settings
3. **Middleware loading:** The `flexOpts` middleware in `server/dist/lib/serverUtils.js` loads and merges these options on each request
4. **Runtime access:** Controllers and domain logic access options via `res.locals.flexOpts`
5. **Caching:** The global options document is cached in memory using `NodeCache` with a **10-second TTL** (`stdTTL: 10`)

### Schema Location

**Runtime schema (source of truth):** `server/dist/models/flexOptions.js`  
**TypeScript type definitions:** `server/dist/models/flexOptions.d.ts`

### Per-User Overrides

Users may have a `flexOptions` subdocument on their profile. The system prefers user-specific values when present and falls back to global defaults.

**Important:** Only `email` and `chat` options can be overridden by users.

---

## Active FlexOptions

The following keys are defined in `server/dist/models/flexOptions.js` and are actively referenced in the runtime code. Default values are taken from the schema.

- **`baseTtlMs`** — default: `15000`
    - Default TTL (ms) used by `ResponseHandler` for server responses.
    - Used in `lib/responseUtils.js`, `interactionController.js`, and when building `EndPointResponse` envelopes.

- **`awayInMs`** — default: `25000`
    - Presence/online threshold in milliseconds.
    - Used in `liveNetController.js`, `realtimeClients.js`, `netAdminCmd.js`, `liveNetHelpers.js`, and client presence logic.

- **`sigReportTypeByMode`** — default: `{ LSB: 'RS', USB: 'RS', AM: 'RS', FreeDV: 'RS', CW: 'RST', Reflector: null, FM: null }`
    - Determines which signal-report format to use per mode (e.g., RS for voice, RST for CW).
    - Used in `interactionController.js` and `liveNetController.js`.

- **`chat`** — default: `true`
    - Enables/disables chat partials and chat-related behavior.
    - Used in `lib/controllers/liveNetHelpers.js` and `views/partials/featureServerInfo.ejs`.
    - User-overridable.

- **`email`** — default: `true`
    - Toggles email/notification code paths.
    - Used in `lib/userNotification.js` and notification helpers.
    - User-overridable.

- **`requestRateFactor`** — default: `5`
    - Affects rate calculation/limits in `liveNetController.js`.

- **`httpClientTimeout`** — default: `20000`
    - Default timeout (ms) for outgoing HTTP client calls (QRZ lookups, third-party calls).
    - Used in `lib/serverUtils.js`.

- **`maxNetsPerUser`** — default: `7`
    - Limits how many nets a single user may own.
    - Used in `netProfileController.js` and `lib/sharedNetOps.js`.

- **`maxOwnersPerNet`** — default: `5`
    - Caps the number of co-owners a NetProfile can have.
    - Used in `lib/sharedNetOps.js` and `lib/netAdminCommands/owner.js`.

- **`maxFollowersPerNet`** — default: `500`
    - Guards follow operations (how many followers a net may have).
    - Used in `controllers/followController.js`.

- **`maxFollowingPerUser`** — default: `100`
    - Limits how many nets a user may follow.
    - Used in `controllers/followController.js`.

- **`qrzDataReqTimeoutMs`** — default: `1000`
    - Timeout for QRZ callsign data requests.
    - Used in `lib/serverUtils.js`.

- **`qrzSessionReqTimeoutMs`** — default: `3000`
    - Session/login timeout for QRZ service requests.
    - Used in `lib/serverUtils.js`.

- **`qrzCheckInWaitMs`** — default: `0`
    - Maximum time an unknown-station check-in waits for QRZ before completing enrichment in the background.
    - `0` keeps QRZ entirely off the synchronous check-in path; accepted range: 0–5000 ms.
    - Used in `lib/sharedNetOps.js`.

- **`qrzReqQuota`** — default: `1000000`
    - Quota enforcement for external QRZ requests.
    - Used in `lib/serverUtils.js`.

---

## Unused/Abandoned FlexOptions

The following keys appear in the **TypeScript type definitions** (`flexOptions.d.ts`) only. They are **not** present in the runtime JavaScript schema (`flexOptions.js`) and have no effect at runtime:

- **`netDetailsTtlSec`** — default: `3` (type definition only)
    - Originally intended for caching TTL of individual net details. TTL is now controlled by `baseTtlMs`.

- **`netListTtlSec`** — default: `3` (type definition only)
    - Originally intended for caching TTL of net lists. TTL is now controlled by `baseTtlMs`.

- **`globalRefreshRate`** — default: `2000` (type definition only)
    - Originally intended for global client refresh intervals. Client refresh is driven by server `ttlMs` responses and `awayInMs`.

These fields are candidates for removal from the type definitions in a future cleanup pass. Before removing them, confirm they are not referenced by any external tooling or admin scripts.

---

## Managing FlexOptions at Runtime

### Database Operations

**View current global FlexOptions:**

```bash
mongosh mongodb://localhost:27017/hamlive-dev

db.flexoptions.findOne({scope: "global"})

db.flexoptions.findOne({scope: "global"}, {"option.chat": 1, "_id": 0})
```

**Update FlexOptions:**

```bash
# Disable chat globally
db.flexoptions.updateOne({scope: "global"}, {$set: {"option.chat": false}})

# Update multiple options at once
db.flexoptions.updateOne(
  {scope: "global"},
  {$set: {"option.maxNetsPerUser": 10, "option.maxOwnersPerNet": 6}}
)
```

**Per-user overrides (email and chat only):**

```bash
db.userprofiles.findOne({callSign: "KK6BEB"}, {flexOptions: 1})

db.userprofiles.updateOne(
  {callSign: "KK6BEB"},
  {$set: {"flexOptions.option.chat": false}}
)
```

### Important Notes

- **Cache TTL:** The global options document is cached with a **10-second** in-memory TTL. Changes take effect within 10 seconds.
- **User restrictions:** Only `email` and `chat` can be overridden per-user via the API.
- **Default creation:** If the global `FlexOption` document is missing, the system creates one with schema defaults.
- **`re_gen_global_flex_ops` flag:** Setting `re_gen_global_flex_ops: true` in `commonConfig.yaml` (default: `false`) causes the server to regenerate the global FlexOptions document from schema defaults on startup, overwriting any database customizations. Do not enable this in production unless you intend to reset options.

## Code Locations

**Schema & defaults:** `server/dist/models/flexOptions.js`  
**Type definitions:** `server/dist/models/flexOptions.d.ts`  
**Loading & merge:** `server/dist/lib/serverUtils.js` (`getFlexOptionsByUser` function and `flexOpts` middleware)

**Usage examples:**

- `server/dist/controllers/liveNetController.js`
- `server/dist/lib/realtimeClients.js`
- `server/dist/lib/sharedNetOps.js`
- `server/dist/controllers/interactionController.js`
- `server/dist/controllers/netProfileController.js`
- `server/dist/controllers/followController.js`

## See Also

- [Runtime Configuration](runtime-config.md) — Overall configuration system architecture
- [Runbook](runbook.md) — Operational procedures for configuration management

(End of FlexOptions documentation.)
