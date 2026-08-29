# Data Model Quick Reference

> **Document Scope:** This document provides a **quick reference** to Ham.Live's main Mongoose models, fields, and relationships. **Not covered:** Implementation details, validation rules, indexes, or performance considerations (see [Database Models](database-models.md) for comprehensive documentation).

This document provides a quick reference to Ham.Live's main Mongoose models, fields and relationships.

> For comprehensive documentation including validation rules, indexes, performance considerations, and implementation details, see [Database Models](database-models.md).

## Core Collections

### NetProfile

Template/configuration for radio nets.

**Key Fields:**

- `title`, `frequency`, `mode`, `modeDetails` — Net identification
- `owners: ObjectId[]` → UserProfile — Net controllers
- `followers: ObjectId[]` → UserProfile — Users following this net
- `liveNet: ObjectId` → LiveNet — Current active session
- `autoIn`, `permanent`, `restrictedSigReports` — Configuration flags

### UserProfile

User account and preferences.

**Key Fields:**

- `displayName`, `callSign`, `email`, `photo`, `location` — User info
- `flexOptions` — User-specific configuration overrides
- `myNets: ObjectId[]` → NetProfile — Nets owned by user
- `following: ObjectId[]` → NetProfile — Nets followed by user (favorites functionality)
- `flaggedForDeletion`, `superUser` — Account flags

**Note**: User "favorites" are implemented via the `following` array in UserProfile and corresponding `followers` array in NetProfile, not as a separate collection.

### StationInteraction

Station state and participation within a net. Local chat messages reference the station's user and live net.

**Key Fields:**

- `callSign`, `displayName`, `photo`, `location` — Station info
- `checkedState` — `true` (checked in), `false` (checked out), `null` (spectator)
- `role` — `'netcontrol'`, `'netlogger'`, `'netrelay'`, `'netuser'`
- `hand`, `highlight` — Visual state flags
- `sigReports` — Signal report data structure
- `userProfile: ObjectId` → UserProfile
- `liveNet: ObjectId` → LiveNet
- `netProfile: ObjectId` → NetProfile

### LiveNet

Active/running net session.

**Key Fields:**

- `lookupTable: Map<CallSign, { stationInteraction: ObjectId }>` — Station lookup
- `netProfile: ObjectId` → NetProfile — Net configuration
- `netControl: ObjectId` → UserProfile — Current net control operator
- `started`, `closing` — Net state flags
- `countdownTimer` — Minutes (0–120, default 1)
- `url` — Short URL for net access

## Supporting Collections

### FlexOption

Runtime configuration. The Mongoose model name is `FlexOption` (singular). One global document lives in the `flexoptions` collection; per-user settings are embedded in `UserProfile.flexOptions`.

**Key Fields:**

- `scope` — Always `'global'` for the standalone collection
- `option` — Configuration key-value pairs (see [Database Models](database-models.md) for the full list)

### SystemNotification

System-wide announcements displayed to all users as dismissible modal dialogs.

**Key Fields:**

- `notificationId` — Unique string identifier (e.g., `'feature-x-2026-01'`)
- `title`, `message` — Display content
- `severity` — `'info'`, `'warning'`, or `'critical'`
- `active` — Whether to show this notification (default: true)
- `expiresAt` — Optional expiration date (null = never expires)

Referenced by `UserProfile.dismissedNotifications[].notificationId`. See [System Notifications](system-notifications.md) for the full lifecycle.

### InitialReg

Call sign registration tracking.

**Key Fields:**

- `callSign` — Registered call sign

### TaskQueues

Background processing queues.

**Key Collections:**

- `PendingUnfollow` — Async unsubscription processing
- `PendingAccountDelete` — User account cleanup workflow

**Key Fields:**

- `upid`, `npid` — User/Net references for processing
- `unlink` — Type of unfollow operation ('userOnly', 'netOnly', 'both')

For test fixtures, craft documents that follow these shapes and include the fields used by controllers (e.g., `LiveNet.lookupTable` maps callsigns to StationInteraction ids).

## See also

- [Database Models](database-models.md) — Complete MongoDB schema and validation documentation
- [Database Schema](database-schema.md) — Comprehensive schema with field-level detail
- [Shared Net Operations](shared-net-ops.md) — Business logic using these models
- [API Reference](api-reference.md) — Endpoints that operate on these models
- [Controllers](controllers.md) — Which controllers use these models
- [Types](types.md) — TypeScript interfaces and typesupport
