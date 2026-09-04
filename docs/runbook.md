# Operational runbook (admin tasks)

This runbook contains actionable, admin-facing command-line tasks and playbook steps: backups, restores, scheduled backup examples, and controlled operator commands. Keep secrets out of these files and obtain database credentials from the deployment environment or secrets manager.

Operational playbook (quick actions)

- How to safely toggle a feature flag

    - Use the authenticated admin API when available. Prefer a change that is idempotent and reversible.
    - After toggling, validate the change in staging or a small canary group before rolling out globally.

- How to close a net (admin UI vs CLI)

    - Admin UI: use the built-in net control page (requires operator role).
    - CLI: use the compiled script `server/dist/bin/closeNet.js` with the appropriate environment and `-p` for production or `-q` for quiet. Document the net id and reason in the audit log.

- How to flag an account for deletion

    - Prefer the admin UI if present. CLI: `server/dist/bin/flagAccountForDeletion.js` (see script flags and confirm prompts). Record the action in the audit trail and notify downstream services.

- How to escalate a high-traffic / DoS event
    - Throttle or temporarily disable high-frequency endpoints (presence polling, interaction endpoints) via runtime flags.
    - Put the application into read-only/maintenance if needed and scale resources or blackhole offending IPs at the edge.

Database backup & restore (MongoDB) — operational runbook

This section provides copy/pasteable commands and best-practice steps to back up and restore the MongoDB database used by NCO Logger. Compose supplies the production URI to the operations container; do not put credentials in commands or committed files.

Preferred tool: the one-shot Compose `backup` service

The supported production workflow runs the source-built Node wrapper in a dedicated operations image containing pinned MongoDB Database Tools. It does not install database administration tools in the web container. The service defaults to `primaryPreferred`, which works with the bundled single-node replica set; use `--read-preference secondary` only when the deployment actually has a secondary.

Backups persist through container recreation at:

- Host: `${NCO_BACKUP_DIR:-./backups}` (relative paths are relative to the Compose project directory)
- Operations container: `/backups`

Create the host directory once with private permissions. Its owner must match
`NCO_BACKUP_UID:NCO_BACKUP_GID` (both default to `1000`):

```bash
install -d -m 0700 "${NCO_BACKUP_DIR:-./backups}"
```

```bash
# Back up production. The archive appears under ${NCO_BACKUP_DIR:-./backups}.
docker compose run --rm backup backup --production

# Validate the resulting archive without writing to a database.
docker compose run --rm --entrypoint sh backup -c \
    'mongorestore --uri="$MONGODB_PRODUCTION_URI" --archive=/backups/hamlive-YYYYMMDDTHHMMSSZ.archive.gz --gzip --dryRun'

# Safely test a restore into a separate database. A development URI is required
# explicitly; the CLI never falls back to the production URI.
MONGODB_DEVELOPMENT_URI='mongodb://mongo:27017/hamlive-restore?replicaSet=rs0&directConnection=true' \
docker compose run --rm backup restore \
    --archive /backups/hamlive-YYYYMMDDTHHMMSSZ.archive.gz \
    --archive-dbname hamlive \
    --env development \
    --drop -y

# A production restore requires the actual URI-derived database name twice: once
# in the URI and once as explicit confirmation. Stop application writes first.
docker compose run --rm backup restore \
    --production \
    --archive /backups/hamlive-YYYYMMDDTHHMMSSZ.archive.gz \
    --confirm-production hamlive \
    --drop
```

Connection profiles can live in `~/.hamlive-backup.yaml` to avoid pasting URIs:

```yaml
prod:
    uri: "mongodb+srv://user:pass@cluster.example.com/hamlive?retryWrites=true"
    dbname: hamlive
    environment: production
prod-new:
    uri: "mongodb+srv://user:pass@new-cluster.example.com/hamlive-prod?retryWrites=true"
    dbname: hamlive-prod
```

Run `docker compose run --rm backup <subcommand> --help` for the full option list. The dedicated image supplies `mongodump` and `mongorestore`. Optional legacy S3 flags still require an AWS CLI and are not included in this focused image.

Notes on the production safety guard

- Production/development classification comes from the selected environment, not a substring in the database name. Production writes require `--confirm-production <actual-uri-database>`.
- Raw/profile target URIs without an environment classification fail closed unless `--confirm-target <actual-uri-database>` is supplied.
- A configured profile `dbname` must exactly match the database encoded in its URI.
- `--env development` requires `MONGODB_DEVELOPMENT_URI`; it never inherits the production URI.
- `migrate` additionally refuses a non-empty target unless `--allow-non-empty` is passed, and prints a "same cluster" notice when source and target share hosts (e.g. prod ↔ dev on the same MongoDB Atlas cluster).

Recommended verification after any restore or migration

```bash
# Doc-count + index parity between source and the restored target.
docker compose run --rm backup verify --source-env production --target-env development
```



Important safety notes

- Always run backups from a machine/role that has secure access to the DB and to an offsite backup target (S3, vault, NFS). Do not leave unencrypted backups on shared disks.
- Prefer creating backups during low-traffic windows and, when possible, coordinate a maintenance window (place app instances into maintenance/read-only or stop writes) for the most consistent snapshot.
- `--oplog` is valid only for full-instance dumps. Normal database-scoped archives omit it, and restore therefore does not add `--oplogReplay`. Use `--oplog-replay` only for an archive known to contain an oplog.

Emergency raw backup through the Mongo container

If the operations image is unavailable, the bundled `mongo:7` container includes Database Tools. From the Compose project directory, stream an emergency archive directly to the host backup directory:

```bash
mkdir -p "${NCO_BACKUP_DIR:-./backups}"
docker compose exec -T mongo mongodump \
    --uri='mongodb://localhost:27017/hamlive?replicaSet=rs0&directConnection=true' \
    --archive --gzip --readPreference=primaryPreferred \
    > "${NCO_BACKUP_DIR:-./backups}/hamlive-emergency-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"
```

Set MONGO_URI (example – DO NOT hard-code credentials)

```bash
# export the uri from your environment or secrets manager
export MONGO_URI="$(cat /etc/hamlive/mongo_uri)"
# or
export MONGO_URI="mongodb+srv://user:pass@cluster.example.com/hamlive-prod?retryWrites=true&w=majority"
```

Full DB backup (replica-set safe)

```bash
# create an archival gzip'd dump
# NOTE: --oplog is omitted because hosted-provider URIs scope to a single DB.
# For self-hosted full-instance access, append --oplog for replica-set point-in-time consistency.
BACKUP_DIR=/var/backups/hamlive
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/hamlive-$(date -u +%Y%m%dT%H%M%SZ).gz"

mongodump --uri="$MONGO_URI" --archive="$BACKUP_FILE" --gzip --readPreference=primaryPreferred

# ensure the file was created
ls -lh "$BACKUP_FILE"
```

Selective collection export (JSON) — useful for small config collections

```bash
# Export FlexOptions (global runtime config) as JSON array
mongoexport --uri="$MONGO_URI" --db=hamlive-prod --collection=FlexOptions --out="$BACKUP_DIR/flexOptions-$(date -u +%Y%m%dT%H%M%SZ).json" --jsonArray

# Export users (example)
mongoexport --uri="$MONGO_URI" --db=hamlive-prod --collection=UserProfiles --out="$BACKUP_DIR/userProfiles-$(date -u +%Y%m%dT%H%M%SZ).json" --jsonArray
```

Restore full DB (WARNING: this can overwrite data)

```bash
# Restore the archive back into the same cluster (drop existing data first)
# NOTE: Use --drop to remove existing collections before restore. Be careful in production.
BACKUP_FILE=/path/to/hamlive-20250816T120000Z.gz
# --oplogReplay only applies if the archive was dumped with --oplog (full-instance only)
mongorestore --uri="$MONGO_URI" --archive="$BACKUP_FILE" --gzip --drop

# To restore to a different (staging) DB name, use namespace mapping
# Example: restore production dump into a staging database named hamlive-staging
mongorestore --uri="$MONGO_URI" --archive="$BACKUP_FILE" --gzip --nsFrom='hamlive-prod.*' --nsTo='hamlive-staging.*' --drop
```

Restore single collection from JSON export

```bash
# Upsert FlexOptions into DB (use --jsonArray because we exported with jsonArray)
mongoimport --uri="$MONGO_URI" --db=hamlive-prod --collection=FlexOptions --file="$BACKUP_DIR/flexOptions-20250816T120000Z.json" --jsonArray --mode=upsert --upsertFields=scope

# Import userProfiles (careful not to overwrite credentials/hashed passwords unexpectedly)
mongoimport --uri="$MONGO_URI" --db=hamlive-prod --collection=UserProfiles --file="$BACKUP_DIR/userProfiles-20250816T120000Z.json" --jsonArray --mode=upsert --upsertFields=callSign
```

Verify a backup (quick checks)

```bash
# list archive contents (lightweight check) - use mongorestore --list when available
mongorestore --archive="$BACKUP_FILE" --gzip --nsInclude='hamlive-prod.*' --dryRun 2>/dev/null || echo "Manual inspection recommended"

# test a restore into a staging DB (recommended):
# 1) restore to hamlive-staging (see nsFrom/nsTo above)
# 2) connect with mongo shell/mongosh and run sanity checks
mongosh "$MONGO_URI/hamlive-staging" --eval 'db.getCollection("LiveNets").count(); db.getCollection("FlexOptions").find().limit(1).pretty()'
```

Automated scheduled backup (cron example)

```bash
# Schedule the supported Compose command from the host (root or a dedicated
# operator permitted to run this Compose project):
# 0 2 * * * cd /opt/nco-logger && docker compose run --rm backup backup --production >> /var/log/nco-backup.log 2>&1
# 30 2 * * * cd /opt/nco-logger && docker compose run --rm backup prune --keep-days 30 -y >> /var/log/nco-backup.log 2>&1

# Raw equivalent (no wrapper) — kept for reference:
# See "Emergency raw backup through the Mongo container" above for the raw fallback.
```

Retention & security

- Keep backups encrypted at rest and in transit (use server-side encryption on S3 and HTTPS for transfers). Use KMS-managed keys if available.
- Rotate retention policy (e.g., keep daily for 30 days, weekly for 12 weeks, monthly for 12 months).
- Limit access to backup storage with strict IAM roles and audit access logs.

Restore testing & verification

- Always perform a test restore into a staging environment before performing a production restore. The recommended sequence:
    1. Restore archive into `hamlive-staging` (use namespace mapping).
    2. Run basic sanity queries (counts for `LiveNets`, `UserProfiles`, `NetProfiles`) and manual spot checks (FlexOptions values, admin users present).
    3. Run a smoke test of the application against the staging DB (boot with environment pointing at staging DB) and validate routes used by controllers.

Emergency partial restore (liveNets caution)

- `LiveNets` and other runtime collections are time-sensitive. When restoring only a subset (for example, NetProfiles or UserProfiles), avoid re-introducing stale `LiveNets` documents into a running production cluster. Prefer restoring to staging and then copying safe documents or migrating via scripts that validate timestamps.

Recovery verification, RTO/RPO & test-restore schedule

This section defines recommended recovery goals, an explicit verification checklist to run after any restore, and a pragmatic cadence for test restores.

Recommended targets (example guidance)

- RPO (Recovery Point Objective): target 15 minutes for critical operational data (LiveNets, StationInteraction), 24 hours for lower-priority analytics or logs. Adjust based on cost and infrastructure.
- RTO (Recovery Time Objective): target 1 hour for a full service restore to staging for verification; target 4 hours for production failover depending on team & runbook readiness.

Test-restore cadence

- Weekly: automated full backup restore into a staging DB (hamlive-staging) and run automated verification script (see below). Verify basic app smoke tests against staging.
- Monthly: full disaster recovery drill that involves restoring backups into staging, running a full smoke/integration test suite, and validating operator procedures.
- After every major schema change or migration: perform an immediate test-restore to validate migration scripts and restore compatibility.

Verification checklist (run after restore)

1. Confirm the archive restored successfully and collections were created
    - mongosh "$MONGO_URI/<db>" --eval 'db.getCollectionNames()'
2. Run collection counts and compare to expected baselines (LiveNets, NetProfile, UserProfile, StationInteraction)
    - Example: db.LiveNets.count(), db.StationInteraction.count()
3. Validate critical configuration objects exist
    - Confirm `FlexOptions` document(s) are present and contain expected keys
4. Sanity-check business flows
    - Start the server pointing at the restored DB (in staging), load a LiveNet page, confirm the initial LiveNetDetails envelope is served and contains `lookupTable` keys.
5. Run smoke tests against staging (auth, API list endpoints, a few interaction flows)
6. Validate that backups are restorable and accessible in offsite storage (S3) and that permissions are correct

Automated verification script

- A small example script is included at `docs/examples/validate_restore.sh`. It accepts `MONGO_URI` and `DB` and performs simple sanity checks (collection counts and FlexOptions presence). Use it as the first-line automated check after a restore.

Example: run a weekly test-restore and verification

```bash
# This example assumes you have created a staging DB and uploaded a recent archive
export MONGO_URI="$(cat /etc/hamlive/mongo_uri)"
BACKUP_FILE=/var/backups/hamlive/hamlive-20250816T120000Z.gz
# restore into staging (namespace mapping)
mongorestore --uri="$MONGO_URI" --archive="$BACKUP_FILE" --gzip --nsFrom='hamlive-prod.*' --nsTo='hamlive-staging.*' --drop
# run verification script
bash docs/examples/validate_restore.sh "$MONGO_URI" hamlive-staging
```

Post-restore reporting

- After verification, record results in your ops runbook or incident tracking system. Include elapsed times, any anomalies found, and corrective actions.
- If verification fails, do not promote the restored DB to production until the root cause is resolved and a second successful test-restore has passed.

## Observability & auditing

### Logging

#### Server-side logging (Node.js)

The server uses a dual-mode logging system based on `NODE_ENV`:

**Development mode** (`NODE_ENV=development`):

- Colorized console output with timestamps and filenames
- Log levels: `error` (red), `warn` (yellow), `info` (white), `debug` (cyan)
- HTTP request logging with color-coded response times:
    - `error` (red): HTTP 5xx responses
    - `warn` (yellow): Responses taking >1000ms
    - `debug` (magenta): Normal responses

**Production mode** (`NODE_ENV=production`):

- Structured JSON logging via `node-json-logger`
- Log level controlled by `LOG_LEVEL` environment variable
- HTTP request logging includes: method, URL, status code, response time
- Format: `{"level":"info","message":"GET /api/data/livenets/xyz 200 45.67 ms","timestamp":"..."}`

**Operational commands:**

```bash
# Change log level in production (requires app restart)
export LOG_LEVEL=debug  # debug|info|warn|error
npm start

# View recent logs with filtering
journalctl -u hamlive-web --since "1 hour ago" | grep ERROR
tail -f /var/log/hamlive/app.log | jq '. | select(.level=="error")'
```

#### Client-side logging (Browser)

The client logger respects server-configured log levels passed via `serverInfo.logLevel`:

**Log level behavior:**

- `logLevel: 'debug'` - Shows all logs (debug, info, warn, error)
- `logLevel: 'info'` - Shows info, warn, error (suppresses debug)
- Default styling: filename with black background, color-coded messages

**Browser console output:**

```
[filename.ts] Calculated In-flight Window: 1.2s (cyan - debug)
[stores.ts] SSE Connection to server opened. (white - info)
[widgets.ts] Cannot check out self (orange - warn)
[clientUtils.ts] Looper error: network timeout (red - error)
```

**Debugging client issues:**

1. Open browser DevTools → Console
2. Filter by log level using browser's console filters
3. Check `serverInfo.logLevel` in console to verify current setting
4. For verbose debugging, temporarily set server to `logLevel: 'debug'`

#### Log level management via FlexOps

Runtime log level changes (without restart):

- Server log levels can be changed via FlexOps configuration
- Client log levels automatically update when `serverInfo` is refreshed
- Use admin API or database updates to FlexOptions collection

#### Key operational logs to monitor

**Server logs:**

- `RTC(<instance>): Cleaning up SSE items for net <npid>` - SSE connection management (instance is `INSTANCE_ID` env var, `DYNO` if set, or `node`)
- `HTTP request logs with >1000ms response times` - Performance issues
- `NetAdminCommands execution logs` - Administrative actions
- `Database connection errors` - Infrastructure issues

**Client logs:**

- `SSE Connection to server opened/failed` - Real-time connectivity
- `Looper behind schedule` warnings - Client performance issues
- `Measured RTT` debug logs - Network latency analysis
- `Client callSign not yet known` warnings - Authentication issues

### Metrics & alerts

- Collect metrics for API latency, error rates, presence churn, and SSE drop rates. Alert on elevated error rates and sustained reconnection storms.
- Monitor HTTP response time percentiles from server logs
- Track SSE connection/disconnection rates from client and server logs
- Alert on excessive `Looper behind schedule` warnings indicating client performance issues

### Auditing

- Record operator/admin changes to config or runtime flags; maintain an audit trail for `server/dist/bin` scripts that modify database state.
- All net admin commands are logged with callsign and net context
- FlexOps configuration changes should be logged with operator identification
- Monitor for unauthorized access attempts via authentication error logs

## Backups & recovery

- Back up MongoDB regularly and document restore steps. For stateful operational flows (closing nets, account deletions) provide clear rollback or recovery steps in this runbook.

## Configuration Management

### Environment Variables

The server requires these critical environment variables and uses environment-specific `.env` files:

```bash
NODE_ENV=development|production    # Controls config file selection
PORT=3000                         # HTTP server port (development only)
LOG_LEVEL=debug|info|warn|error   # Controls logging verbosity
```

**Environment file loading:**

- Development: `server/dist/.env-development` is loaded when `NODE_ENV=development`
- Production: `server/dist/.env-production` is loaded when `NODE_ENV=production`

**Environment file contents:**

`.env-development`:

```bash
PORT=3000          # Local development server port
LOG_LEVEL=debug    # Verbose logging for development
```

`.env-production`:

```bash
#PORT set by cloud provider    # Cloud platforms set PORT automatically
LOG_LEVEL=info                 # Production-appropriate log level
```

**Environment variable debugging:**

```bash
# Check current environment variables
echo "NODE_ENV: $NODE_ENV"
echo "PORT: $PORT"
echo "LOG_LEVEL: $LOG_LEVEL"

# Verify .env file loading
ls -la server/dist/.env-*

# Test environment variable precedence
NODE_ENV=development node -e "console.log('PORT:', process.env.PORT); console.log('LOG_LEVEL:', process.env.LOG_LEVEL);"
```

### Configuration File Loading

The application uses a layered YAML configuration system:

1. **Base configuration**: Always loads `commonConfig.yaml`
2. **Environment override**: Loads environment-specific config based on `NODE_ENV`
3. **Final merge**: Environment config overrides common config

**Configuration loading debug:**

```bash
# Check which config files are being loaded
grep -r "Loading config" server/dist/lib/configLib.js

# Verify NODE_ENV is set correctly
echo $NODE_ENV

# Test configuration loading locally
node -e "const { conf } = require('./server/dist/lib/configLib.js'); console.log(JSON.stringify(conf, null, 2));"
```

**Configuration file locations:**

- `server/dist/commonConfig.yaml` - Shared settings
- `server/dist/devConfig.yaml` - Local development
- `server/dist/prodConfig.yaml` - Production

**Configuration troubleshooting:**

```bash
# Check if required config files exist
ls -la server/dist/*Config.yaml
ls -la server/dist/.env-*

# Validate YAML syntax
node -e "require('yaml').parse(require('fs').readFileSync('server/dist/commonConfig.yaml', 'utf8'))"

# Validate .env file syntax (should not error)
node -e "require('dotenv').config({path: 'server/dist/.env-development'}); console.log('✓ .env-development loaded');"
node -e "require('dotenv').config({path: 'server/dist/.env-production'}); console.log('✓ .env-production loaded');"

# Compare environment differences
diff server/dist/devConfig.yaml server/dist/prodConfig.yaml
diff server/dist/.env-development server/dist/.env-production

# Test complete configuration loading
NODE_ENV=development node -e "
  require('dotenv').config({path: 'server/dist/.env-development'});
  const { conf } = require('./server/dist/lib/configLib.js');
  console.log('PORT:', process.env.PORT);
  console.log('LOG_LEVEL:', process.env.LOG_LEVEL);
  console.log('Config loaded successfully');
"
```

**See also:** [Runtime Configuration](runtime-config.md) for detailed configuration file documentation.

## FlexOptions Management

### Overview

FlexOptions are runtime configuration options stored in MongoDB that allow behavior changes without application restarts. For complete documentation including all available options, usage patterns, and integration details, see [Flex Options](flex-opts.md).

### Essential Operations

**View current global FlexOptions:**

```bash
# Connect to MongoDB (use mongosh, not the legacy mongo shell)
mongosh "mongodb://localhost:27017/hamlive-dev"  # or hamlive-prod

# View all global FlexOptions
db.flexoptions.findOne({scope: "global"})

# View specific option
db.flexoptions.findOne({scope: "global"}, {"option.chat": 1, "_id": 0})
```

**Update common FlexOptions:**

```bash
# Feature toggles
db.flexoptions.updateOne({scope: "global"}, {$set: {"option.chat": false}})

# System limits
db.flexoptions.updateOne({scope: "global"}, {$set: {"option.maxNetsPerUser": 10}})

# Timing controls
db.flexoptions.updateOne({scope: "global"}, {$set: {"option.awayInMs": 30000}})
db.flexoptions.updateOne({scope: "global"}, {$set: {"option.baseTtlMs": 20000}})
```

**User-specific overrides (limited to chat and email):**

```bash
# View user's FlexOptions overrides
db.userprofiles.findOne({callSign: "KK6BEB"}, {flexOptions: 1})

# Set user preference
db.userprofiles.updateOne(
  {callSign: "KK6BEB"},
  {$set: {"flexOptions.option.chat": false}}
)
```

### Troubleshooting

**Verify FlexOptions loading:**

```bash
# Check server logs for FlexOptions activity
grep -i "flexopts\|flexoptions" /var/log/hamlive/app.log

# Test FlexOptions loading in development
NODE_ENV=development node -e "
  const { getFlexOptionsByUser } = require('./server/dist/lib/serverUtils.js');
  getFlexOptionsByUser().then(opts => console.log(JSON.stringify(opts, null, 2)));
"
```

**Common operational issues:**

- **Changes not appearing**: FlexOptions have in-memory caching (TTL ~60s) - wait for cache refresh
- **Invalid values**: Check schema constraints in `server/dist/models/flexOptions.js`
- **User overrides failing**: Verify user document has proper `flexOptions` subdocument structure

**Complete FlexOptions documentation**: See [Flex Options](flex-opts.md) for detailed documentation of all options, including unused/legacy options.

---

## Admin bin tools

The following Node.js scripts live in `server/dist/bin/` and are the authoritative CLI tools for common operator tasks. Run them with `node server/dist/bin/<script>.js`.

### closeNet.js

Interactively select and close a running live net.

```bash
node server/dist/bin/closeNet.js [-p] [-q]
```

- `-p` / `--production` — connect to the production database
- `-q` / `--quiet` — suppress the end-of-net email report

Displays a table of running nets and prompts for an index to close.

### flagAccountForDeletion.js

Flag a callsign's account for deletion (soft-delete with follow-up processing).

```bash
node server/dist/bin/flagAccountForDeletion.js [-p] <callSign>
```

- `-p` / `--production` — operate on the production database
- `<callSign>` — the callsign to flag (required positional argument)

Displays the account record and prompts `yes/no` before making any changes.

### manageNotifications.js

Interactive TUI for creating and managing system notifications shown to users in the app. See [Notification Management Utility](notification-management-utility.md) for full documentation.

```bash
node server/dist/bin/manageNotifications.js [-p] [-f <file>] [-y]
```

- `-p` / `--production` — connect to the production database
- `-f` / `--file <path>` — load a notification from a JSON file (non-interactive)
- `-y` / `--yes` — skip confirmation prompts (use with `--file` for CI/CD)

### getAllEmail.js

Export user email addresses from the database (useful for bulk communications).

```bash
node server/dist/bin/getAllEmail.js [-p]
```

### bulkReg.js

Bulk-register callsigns (e.g. for pre-seeding nets). See the script's `--help` for options.

```bash
node server/dist/bin/bulkReg.js --help
```

(End of runbook.)
