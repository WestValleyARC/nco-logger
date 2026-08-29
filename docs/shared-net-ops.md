# SharedNetOps Domain Logic

This document covers the core domain logic in `server/dist/lib/sharedNetOps.js`. This module is the single source of truth for multi-document net operations used by controllers, admin commands, and background tasks.

## Overview

SharedNetOps centralizes complex workflows that touch multiple collections (LiveNet, StationInteraction, NetProfile, UserProfile) and coordinates real-time SSE notifications after state changes.

**Key Principles:**

- Centralized permission checking and role validation
- Atomic multi-document updates where possible
- Real-time SSE notifications after state changes via `realtimeClients`
- Consistent plain-`Error` throws for validation and permission failures

## Role System

```javascript
const roleLevels = new Map([
    ['netcontrol', 0], // Highest privilege (Net Control Station)
    ['netlogger', 1],  // Logger privileges
    ['netrelay', 2],   // Relay station
    ['netuser', 3]     // Basic participant (lowest privilege)
]);
```

Lower numeric values have higher privileges. Users can only modify stations with a higher numeric role level than their own.

## Core Functions Reference

### Station State Management

#### `checkState(params)`

**Purpose:** Check stations in/out or set their checked state to default (null/lurker).

**Parameters:**

```javascript
{
    liveNet,        // LiveNet document
    srcStation,     // Call sign of the user making the change
    state,          // true (in), false (out), or null (default/lurker)
    dstStations,    // Array of target call sign strings
    highlight,      // Optional: set highlight state on new stations
    hand,           // Optional: set hand state on new stations
    flexOpts,       // Flex options (used for QRZ lookups on new stations)
    db              // Database connection
}
```

**Workflow:**

1. Validates `state` (must be `true`, `false`, or `null`) and call sign formats
2. Checks that `srcStation` is checked-in and has NCS or logger role (level ≤ 1)
3. Prevents `srcStation` from altering their own check-state via this function
4. Separates known vs. new stations; throws if trying to check out an unknown station
5. Validates role-level permissions for each known target station
6. Updates existing `StationInteraction` documents
7. Creates new documents for new stations (with QRZ lookup if no account exists)
8. Saves updated `LiveNet` lookup table if new stations were added

#### `hand(params)`

**Purpose:** Set or clear the hand-raised state for a station.

**Parameters:**

```javascript
{
    liveNet,      // LiveNet document
    srcStation,   // Source call sign
    dstStation,   // Target call sign
    state,        // true (raise) or false (lower); must be boolean
    db            // Database connection
}
```

**Business Rules:**

- When `srcStation !== dstStation`, source must be checked-in and have NCS or logger role
- Self-modification of hand state is allowed

#### `highlight(params)`

**Purpose:** Highlight or un-highlight a station in the UI.

**Parameters:**

```javascript
{
    liveNet,      // LiveNet document
    srcStation,   // Source call sign
    dstStation,   // Target call sign
    state,        // true (highlight) or false (un-highlight); must be boolean
    db            // Database connection
}
```

**Business Rules:**

- Only NCS or logger (level ≤ 1) may alter highlight state
- Can only highlight checked-in stations

### Role Management

#### `setNetRole(params)`

**Purpose:** Change a station's role within a net.

**Parameters:**

```javascript
{
    lnid,       // LiveNet ID
    station,    // Target call sign
    newRole,    // 'netuser' | 'netrelay' | 'netlogger' | 'netcontrol'
    db,         // Database connection
    session     // Optional MongoDB session for transactions
}
```

**Validation:**

- `newRole` must be one of the four valid roles
- Promoting to `netcontrol` or `netlogger` requires the station to have an account
- Promoting to `netcontrol` additionally requires the station to be a net owner

### Network Management

#### `netOwnerCheck(params)`

**Purpose:** Verify if a user has owner privileges for a NetProfile.

**Parameters:**

```javascript
{
    req,      // Express request object (provides npid and upid from req.params.id / req.user.id)
    npid,     // NetProfile ID (used when req is not provided)
    upid,     // UserProfile ID (used when req is not provided)
    db,       // Database connection
    session   // Optional MongoDB session
}
```

**Returns:** An object `{ confirmed, count, npresult }` — `confirmed` is a boolean, `count` is the current owner count, and `npresult` is the NetProfile document. Does **not** return a plain boolean.

#### `addNetOwner(params)`

**Purpose:** Add a new co-owner to a NetProfile by email address.

**Parameters:**

```javascript
{
    newOwnerEmail,  // Email of the user to promote
    netProfiles,    // NetProfile document
    flexOpts,       // Flex options (for maxOwnersPerNet, maxNetsPerUser limits)
    db              // Database connection
}
```

**Workflow:**

1. Validates email and finds the UserProfile
2. Checks that the target station has a call sign
3. Checks that neither the net nor the user is already at the ownership limit
4. Verifies the target is not already an owner
5. Updates both `NetProfile.owners` and `UserProfile.myNets`

#### `delNet(params)`

**Purpose:** Delete a NetProfile and clean up related data.

**Parameters:**

```javascript
{
    upid,  // UserProfile ID (must be an owner)
    npid,  // NetProfile ID to delete
    db     // Database connection
}
```

**Cleanup Operations:**

1. Confirms the calling user is an owner
2. If the net is live and the user is NCS, closes the net first (`closeNet`)
3. Removes the net from the user's `myNets` array and removes the user from `owners`
4. If this was the last owner: creates bulk unfollow jobs for all followers, then hard-deletes the NetProfile

#### `closeNet(params)`

**Purpose:** Cleanly close an active LiveNet.

**Parameters:**

```javascript
{
    netProfileDoc,  // NetProfile document
    liveNetDoc,     // LiveNet document
    quiet,          // Optional boolean: skip close report/email (default false)
    db              // Database connection
}
```

**Cleanup Process:**

1. Calls `realtimeClients.close(npid)` — this sends a `'net-close'` SSE event to all connected clients and removes the SSE entry from the middleware map
2. Sets `liveNetDoc.closing = true` and saves it
3. Unless `quiet`, generates a `NetCloseReport` and emails it to owners and superusers
4. Cleans local chat records after report generation/delivery is attempted (cleanup failure does not abort net close)
5. Deletes all `StationInteraction` documents for the net
6. Deletes the `LiveNet` document
7. Clears `netProfileDoc.liveNet` and saves the NetProfile

#### `unFollow(params)`

**Purpose:** Remove a following relationship between a user and a net.

**Parameters:**

```javascript
{
    upid,    // UserProfile ID
    npid,    // NetProfile ID
    unlink,  // 'userOnly' | 'netOnly' | 'both'
    db       // Database connection
}
```

**Unlink Options:**

- `'userOnly'`: Remove net from user's `following` list only
- `'netOnly'`: Remove user from net's `followers` list only
- `'both'`: Remove from both (complete unfollow)

#### `createBulkUnfollowJob(params)`

**Purpose:** Enqueue background unfollow jobs for bulk operations (e.g., when a net is deleted).

**Parameters:**

```javascript
{
    npids,   // Array of NetProfile IDs (length 1 or more)
    upids,   // Array of UserProfile IDs (length 1 or more)
    unlink,  // Default unlink strategy ('both'); overridden based on array shapes
    db       // Database connection
}
```

The `unlink` value is automatically set to `'userOnly'` when there is one net and many users, and `'netOnly'` when there are many nets and one user.

### User Management

#### `flagAccountForDeletion(params)`

**Purpose:** Mark a user account for deletion (GDPR/TTL compliance).

**Parameters:**

```javascript
{
    userProfileDoc,  // UserProfile document to flag
    db               // Database connection
}
```

**Process:**

1. Skips the account if `userProfileDoc.locked === true` or already flagged
2. Sets `flaggedForDeletion = true` and saves
3. Creates a `PendingAccountDelete` task queue entry for the background delete task

### Utility Functions

#### `getStationDetail(params)`

**Purpose:** Get role and check-state information for a station in a live net.

**Parameters:**

```javascript
{
    lnid,     // LiveNet ID
    station,  // Call sign
    db        // Database connection
}
```

**Returns:**

```javascript
{
    role,          // String role name (e.g., 'netcontrol')
    level,         // Numeric role level (0–3)
    checkedState   // true (in), false (out), or null (lurker)
}
```

There is no `stationDoc` in the return value.

#### `getSigReportType({ mode, sigReportTypeByMode })`

**Purpose:** Determine the expected signal-report format string for a given operating mode.

**Parameters:**

- `mode`: The net's operating mode string (e.g., `'CW'`, `'LSB'`)
- `sigReportTypeByMode`: The mapping from the `sigReportTypeByMode` flex option

**Returns:** A report-type string such as `'RST'`, `'RS'`, `'RSQ'`, or `null` — for example, `'RST'` for CW, `'RS'` for LSB/USB. This string is used to trim the calculated signal report to the correct length.

## Error Handling

All functions throw plain `Error` instances. Representative examples:

```javascript
throw new Error('checkState(): valid state options are true, false, or null');
throw new Error('Insufficient Privileges: srcStation cannot alter dstStation\'s check-state');
throw new Error('You must be checked-in to alter check-state');
throw new Error('missing liveNet doc as param or missing lookupTable');
```

## Exports

```javascript
module.exports = {
    netOwnerCheck, addNetOwner,
    checkState, delNet, closeNet,
    unFollow, hand, highlight,
    createBulkUnfollowJob, setNetRole,
    getStationDetail, roleLevels,
    flagAccountForDeletion, getSigReportType
};
```

## Integration Points

SharedNetOps is used by:

- **Controllers** — `interactionController`, `netProfileController`, `userProfileController`
- **Admin Commands** — all net admin command implementations in `lib/netAdminCommands/`
- **Background Tasks** — `closeIdleNets`, `flagAccounts`, `deleteFlaggedAccounts`, `processUnfollowJobs`

## See Also

- [Controllers](controllers.md) — How controllers use SharedNetOps
- [Net Admin Commands Reference](net-admin-commands-reference.md) — Admin command implementations
- [Database Schema](database-schema.md) — Data model relationships
- [API Reference](api-reference.md) — Endpoint documentation
