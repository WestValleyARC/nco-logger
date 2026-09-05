# Background Jobs and Processing

This document describes Ham.Live's background processing system, CLI tools, and asynchronous job management.

## Background Processing Overview

Ham.Live uses two mechanisms for out-of-band processing: a **once-per-day forked task runner** for maintenance jobs, and **CLI utilities** for manual administrative operations.

## Daily Task Runner

### Dispatch Middleware — `lib/dailyProcessingDispatch.js`

`dailyProcessingDispatch` is an Express middleware that runs as part of the normal request pipeline. On each incoming request it checks whether daily maintenance has already run today:

1. Queries the `DayTracker` model for the current calendar day (America/Los_Angeles timezone)
2. If maintenance has not yet run today — or if `conf.run_background_tasks_on_startup` is `true` (a dev-only flag in `devConfig.yaml`) — it marks the tracker and calls Node's `child_process.fork()` to launch `lib/tasksLoader.js` as a separate process
3. Passes the request to `next()` immediately; the forked child runs independently of the HTTP request

The middleware is re-entrant safe via an in-process `inCriticalSection` flag.

### Task Loader — `lib/tasksLoader.js`

The forked child process:

1. Waits for a `'START_TASKS'` IPC message from the parent
2. Opens a dedicated Mongoose connection using `conf.batch_mongoose_poolsize` (configured per environment in the YAML files)
3. Iterates over `conf.background_tasks` (YAML configuration) in order; for each enabled task:
   - Dynamically `require()`s `./backgroundTasks/<label>`
   - Instantiates the class: `new TaskClass({ label, options: conf.background_tasks[label].options, db })`
   - Calls `await t.run()`, then `await t.cleanUp()` in a `finally` block
   - Logs elapsed time per task
4. Closes the database connection and exits cleanly with `process.exit(0)`

The `label` key in the YAML both identifies the task file on disk and is passed as the plugin `label` to `PluginBase`.

### Task Configuration

Tasks are declared under `background_tasks` in the per-environment YAML files (e.g., `devConfig.yaml`). Each entry has `enabled` and an `options` object that is passed as-is to the task constructor:

```yaml
background_tasks:
    closeIdleNets:
        enabled: true
        options:
            abandoned_after_hours: 0.01
    flagAccounts:
        enabled: true
        options:
            ttl_days: 1
            account_create_min: 2
    deleteFlaggedAccounts:
        enabled: true
        options:
    processUnfollowJobs:
        enabled: true
        options:
```

Set `run_background_tasks_on_startup: true` in `devConfig.yaml` (or override via the config) to force daily maintenance to run on every server start — useful when debugging tasks, but note that this will re-run on every nodemon restart.

## Background Tasks

All tasks are located in `server/dist/lib/backgroundTasks/`. Each is a class that extends `PluginBase` and is exported as `module.exports = ClassName`.

### `closeIdleNets` — `closeIdleNets.js`

Closes nets that have been running for longer than `abandoned_after_hours` with no active NCS.

- Finds `LiveNet` documents older than the configured threshold
- Skips `NetProfile.permanent === true` nets
- Skips nets where at least one NCS station has been seen recently
- Calls `sharedNetOps.closeNet()` for each qualifying idle net

### `flagAccounts` — `flagAccounts.js`

Flags stale or non-consenting accounts for deletion.

- **Options:** `ttl_days` (inactivity threshold), `account_create_min` (minimum account age before flagging)
- Finds accounts with `lastLogin` older than `ttl_days` days, plus accounts with `policyConsent: false`
- Skips accounts that are within the `account_create_min` creation grace period
- Calls `sharedNetOps.flagAccountForDeletion()` for each qualifying account

### `deleteFlaggedAccounts` — `deleteFlaggedAccounts.js`

Performs hard deletion of accounts previously flagged by `flagAccounts`.

- Reads the `PendingAccountDelete` task queue
- Verifies `flaggedForDeletion` is still set (users can un-flag themselves via `POST /api/util/undeleteme`)
- Calls `sharedNetOps.delNet()` for each net the user owns, then deletes the account

### `processUnfollowJobs` — `processUnfollowJobs.js`

Processes queued unfollow operations enqueued by `createBulkUnfollowJob`.

- Reads the `PendingUnfollow` task queue
- Calls `sharedNetOps.unFollow()` for each entry using the stored `unlink` value (`'userOnly'` | `'netOnly'` | `'both'`)
- Deletes processed entries

## CLI Tools and Administrative Scripts

CLI tools are located in `server/dist/bin/` and must be run with direct database access.

```bash
# Bulk user registration operations
node server/dist/bin/bulkReg.js

# Close/terminate a specific net
node server/dist/bin/closeNet.js

# Flag user accounts for deletion
node server/dist/bin/flagAccountForDeletion.js

# Extract all email addresses from the system
node server/dist/bin/getAllEmail.js

# Manage system notifications (create/list/expire)
node server/dist/bin/manageNotifications.js --help

# Database backup, restore, migrate, verify (production Compose deployment)
docker compose run --rm backup <subcommand> --help
```

All CLI tools require proper database configuration. Run from the project root directory.

## See also

- [Server Architecture](server-architecture.md) — Application structure and process management
- [Database Models](database-models.md) — Data models used by background jobs
- [Runtime Configuration](runtime-config.md) — Configuration system for background tasks
- [Plugins](plugins.md) — PluginBase and task/command plugin architecture

(End of background jobs and processing documentation.)
