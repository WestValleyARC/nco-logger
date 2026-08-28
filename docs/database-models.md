# Database Models and Schema

> **📋 Document Scope:** This document provides **comprehensive database documentation** including schemas, validation rules, indexes, and relationships. **NOT covered:** Quick entity reference (see [Data Model](data-model.md)) or server architecture (see [Server Architecture](server-architecture.md)).

This document describes Ham.Live's MongoDB data models, schema definitions, and database relationships.

## Database Architecture

Ham.Live uses MongoDB with Mongoose ODM for data persistence. The database is organized into collections representing core domain entities.

### Connection Configuration

```javascript
// Environment-specific connection pools
mongoose.connect(conf.dburi, {
    maxPoolSize: conf.realtime_mongoose_poolsize
});

// Pool sizes by environment:
// Development: 5 connections (realtime)
// Production: 20 connections (realtime)
```

## Core Data Models

### 1. UserProfile Collection

Stores user account information and preferences.

**Schema Structure:**

```javascript
{
    _id: ObjectId,
    displayName: String,        // Full name for display (required, 2-20 chars)
    callSign: String,           // Amateur radio call sign (unique, sparse)
    email: String,              // Email address (unique, required)
    photo: String,              // URL to profile photo
    location: String,           // User's location (5-24 chars)
    googleId: String,           // OAuth provider field
    lastLogin: Date,            // Last login timestamp
    newAccount: Boolean,        // Account setup flag (default: true)
    lastAuthVia: String,        // 'google' or 'email' (required)
    policyConsent: Boolean,     // Privacy policy consent (default: false)
    flaggedForDeletion: Boolean, // GDPR deletion flag (default: false)
    locked: Boolean,            // Account locked flag (default: false)
    superUser: Boolean,         // Admin privileges (default: false)
    verified: Boolean,          // Account verification status (default: false)
    flexOptions: Object,        // User-specific configuration overrides
    initialReg: ObjectId,       // Reference to InitialRegTracker
    myNets: [ObjectId],         // Array of NetProfile references (nets owned)
    following: [ObjectId],      // Array of NetProfile references (nets followed)
    dismissedNotifications: [{  // Tracking for system notifications
        notificationId: String, // Reference to SystemNotification.notificationId
        dismissedAt: Date       // When user dismissed (default: now)
    }],
    createdAt: Date,
    updatedAt: Date
}
```

**Validation Rules:**

- `displayName`: Required, 2-20 characters, alphanumeric with spaces/hyphens/apostrophes
- `callSign`: Unique when present (sparse index), amateur radio format validation
- `email`: Required, unique, email format validation
- `lastAuthVia`: Required, must be 'google' or 'email'
- Custom validators for call sign format and email uniqueness

**Indexes:**

- `callSign` (unique, sparse)
- `email` (unique, sparse)
- `superUser` (standard index)

### 2. NetProfile Collection

Defines amateur radio nets and their operational parameters.

**Schema Structure:**

```javascript
{
    _id: ObjectId,              // Also serves as NPID (Net Profile ID)
    title: String,              // Net name/title (required, unique, 4-25 chars)
    frequency: String,          // Operating frequency (max 20 chars)
    mode: String,               // Operating mode (LSB, USB, AM, CW, FM, etc. - required)
    modeDetails: String,        // Additional mode information (max 15 chars)
    notes: String,              // Net description/notes (max 320 chars)
    permanent: Boolean,         // Whether net runs permanently (default: false)
    owners: [ObjectId],         // Array of UserProfile references (net controllers)
    followers: [ObjectId],      // Array of UserProfile references (net followers)
    liveNet: ObjectId,          // Reference to active LiveNet (when running)
    autoIn: Boolean,            // Auto-check-in followers when net starts (default: false)
    restrictedSigReports: Boolean, // Limits who can submit signal reports (default: false)
    invisible: Boolean,         // Hidden from public listings (default: false)
    createdAt: Date,
    updatedAt: Date
}
```

**Validation Rules:**

- `title`: Required, unique, 4-25 characters, alphanumeric with punctuation
- `frequency`: Optional, decimal format (e.g., "14.300")
- `mode`: Required, must be one of predefined amateur radio modes
- `owners`: Required, array of valid ObjectId references

**Indexes:**

- `title` (unique)
- `owners` (for user's nets queries)
- `permanent` (for active net filtering)

### 3. StationInteraction Collection

Records station state and participation within nets. Local `ChatMessage` records reference the user and live net.

**Schema Structure:**

```javascript
{
    _id: ObjectId,
    liveNet: ObjectId,          // Reference to LiveNet (not required at schema level)
    netProfile: ObjectId,       // Reference to NetProfile (required)
    userProfile: ObjectId,      // Reference to UserProfile
    callSign: String,           // Station call sign (required)
    email: String,              // Station email
    displayName: String,        // Station display name
    photo: String,              // Photo URL
    location: String,           // Station location
    createdBy: String,          // 'user' or 'admin' (required)
    checkedState: Boolean,      // null=spectator, true=checked-in, false=checked-out
    checkedInAt: Date,          // When station checked in (default: null)
    lastSeen: Date,             // Last activity timestamp (no default)
    role: String,               // 'netuser', 'netlogger', 'netrelay', 'netcontrol' (default: 'netuser')
    hand: Boolean,              // Hand raised status (default: false)
    highlight: Boolean,         // Highlighted by net control (default: false)
    chatEnabled: Boolean,       // Per-station chat toggle (default: true)
    manualPushCount: Number,    // SSE push optimization counter (default: 0)
    // Signal reporting
    sigReports: {
        calculated: String,     // Computed summary (e.g., "5/9")
        rst: Map                // Map<reportingCallSign, {r, s, t?}>
    },
    createdAt: Date,
    updatedAt: Date
}
```

**Validation Rules:**

- `netProfile`: Required, valid ObjectId reference
- `liveNet`: Valid ObjectId reference (not required at schema level)
- `userProfile`: Valid ObjectId reference (can be null for unregistered participants)
- `callSign`: Required
- `role`: Not required; defaults to `'netuser'`, must be one of the allowed role values
- `checkedState`: Boolean or null only
- `createdBy`: Required, either 'user' or 'admin'

**Indexes:**

No explicit compound indexes are defined in the schema. Standard `_id` index applies.

### 4. LiveNet Collection

Represents active/running nets and their current state.

**Schema Structure:**

```javascript
{
    _id: ObjectId,
    lookupTable: Map,           // Map<callSign, {stationInteraction: ObjectId}>
    netProfile: ObjectId,       // Reference to NetProfile (required)
    netControl: ObjectId,       // Reference to UserProfile (Net Control Station - required)
    countdownTimer: Number,     // Timer value (0-120 minutes, default: 1)
    started: Boolean,           // Net started flag (default: false)
    startedAt: Date,            // When net was started (default: null)
    closing: Boolean,           // Prevents new check-ins during shutdown (default: false)
    url: String,                // Unique short URL for net access (required, unique)
    createdAt: Date,
    updatedAt: Date
}
```

**Validation Rules:**

- `netProfile`: Required, valid ObjectId reference
- `netControl`: Required, valid ObjectId reference
- `url`: Required, unique across all nets
- `countdownTimer`: Number between 0-120

**Indexes:**

- `url` (unique, via mongoose-unique-validator)

### 5. FlexOption Collection

Stores the single global runtime configuration document. The Mongoose model name is `FlexOption` (singular). A separate embedded `flexOptionsLocalSchema` is used within `UserProfile.flexOptions` — it is not a standalone collection.

**Schema Structure (global document):**

```javascript
{
    _id: ObjectId,
    scope: String,              // Always 'global' for the standalone collection
    option: {
        chat: Boolean,              // Enable chat integration (default: true)
        email: Boolean,             // Enable email notifications (default: true)
        maxNetsPerUser: Number,     // Net ownership limit (default: 7)
        maxOwnersPerNet: Number,    // Ownership sharing limit (default: 5)
        baseTtlMs: Number,          // Base SSE TTL ms (default: 15000)
        awayInMs: Number,           // Presence timeout ms (default: 25000)
        httpClientTimeout: Number,  // HTTP request timeout ms (default: 20000)
        requestRateFactor: Number,  // Rate limiting multiplier (default: 5)
        qrzDataReqTimeoutMs: Number,    // QRZ data timeout ms (default: 1000)
        qrzSessionReqTimeoutMs: Number, // QRZ session timeout ms (default: 3000)
        qrzReqQuota: Number,        // QRZ request quota (default: 1000000)
        maxFollowersPerNet: Number, // Follower limit per net (default: 500)
        maxFollowingPerUser: Number,// Following limit per user (default: 100)
        sigReportTypeByMode: {      // Signal report format per mode
            LSB: String, USB: String, AM: String, FreeDV: String,
            CW: String, Reflector: String|null, FM: String|null
        }
    },
    createdAt: Date,
    updatedAt: Date
}
```

> **Note**: `server/dist/models/flexOptions.d.ts` includes three fields (`netDetailsTtlSec`, `netListTtlSec`, `globalRefreshRate`) that are not present in the runtime `.js` schema. These exist only in the hand-written type stub.

**Embedded user schema (`flexOptionsLocalSchema`):**

```javascript
{
    option: {
        chat: Boolean,   // User chat preference override
        email: Boolean  // User email preference override
    }
}
```

### 6. SystemNotification Collection

Stores system-wide notifications for user announcements.

**Schema Structure:**

```javascript
{
    _id: ObjectId,
    notificationId: String,        // Unique identifier (e.g., "feature-x-2026-01")
    title: String,                 // Modal title (max 100 chars)
    message: String,               // HTML content for modal body (max 5000 chars)
    severity: String,              // "info" | "warning" | "critical"
    active: Boolean,               // Whether to show this notification
    expiresAt: Date,               // Optional expiration date (null = never expires)
    createdAt: Date,
    updatedAt: Date
}
```

**Validation Rules:**

- `notificationId`: Required, unique, max 100 characters
- `title`: Required, max 100 characters
- `message`: Required, max 5000 characters
- `severity`: Must be 'info', 'warning', or 'critical' (default: 'info')
- `active`: Default true

**Indexes:**

- `notificationId` (unique)
- `active` (for filtering active notifications)

**Relationships:**

- Referenced by `UserProfile.dismissedNotifications.notificationId`
- No cascade deletion (dismissal history retained)

**Location:** `server/dist/models/systemNotification.js`

> 📖 **For complete notification system documentation**, see [System Notifications](system-notifications.md).

### 7. TaskQueues Collections

Background processing queue collections for asynchronous operations.

**PendingUnfollow Schema:**

```javascript
{
    _id: ObjectId,
    unlink: String,             // 'userOnly', 'netOnly', or 'both' (required)
    upid: ObjectId,             // UserProfile reference (required)
    npid: ObjectId,             // NetProfile reference (required)
    createdAt: Date,
    updatedAt: Date
}
```

**PendingAccountDelete Schema:**

```javascript
{
    _id: ObjectId,
    upid: ObjectId,             // UserProfile reference
    createdAt: Date,
    updatedAt: Date
}
```

**Validation Rules:**

- `unlink`: Required, must be one of 'userOnly', 'netOnly', 'both'
- `upid`, `npid`: Required ObjectId references

**Indexes:**

- `upid, npid` (compound, for queue processing)

## Model Relationships

### Entity Relationship Diagram

```
UserProfile (1) ←→ (N) StationInteraction
     ↓ (N)
NetProfile (1) ←→ (N) StationInteraction
     ↓ (1)
   LiveNet

UserProfile (N) ←→ (N) NetProfile (via following/followers arrays)
UserProfile (1) ←→ (1) FlexOption (embedded flexOptionsLocalSchema)
TaskQueues → UserProfile/NetProfile (via upid/npid references)
```

### Key Relationships

1. **UserProfile ↔ NetProfile**: Many-to-many via `following`/`followers` arrays
2. **NetProfile → StationInteraction**: One-to-many (net has many interactions)
3. **UserProfile → StationInteraction**: One-to-many (user has interactions across nets)
4. **NetProfile → LiveNet**: One-to-one when active (net has current session)
5. **FlexOption (global)**: Single collection document; per-user settings are embedded in `UserProfile.flexOptions`
6. **TaskQueues → UserProfile/NetProfile**: References for background processing

## Schema Validation Patterns

### Custom Validators

```javascript
// Call sign format validation
callSignValidator: {
    validator: function(v) {
        return /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,3}[A-Z]$/.test(v);
    },
    message: 'Invalid amateur radio call sign format'
}

// Email uniqueness with custom error
emailValidator: {
    validator: function(v) {
        return UserProfile.countDocuments({
            email: v,
            _id: { $ne: this._id }
        }).then(count => count === 0);
    },
    message: 'Email address already in use'
}
```

### Enum Validation

```javascript
// StationInteraction.role (not required; defaults to 'netuser')
role: {
    type: String,
    default: 'netuser',
    enum: ['netuser', 'netlogger', 'netrelay', 'netcontrol']
}
```

## Data Integrity and Constraints

### Unique Constraints

- **UserProfile**: `callSign` and `email` must be unique globally (both sparse — null values allowed)
- **NetProfile**: `title` must be unique globally
- **LiveNet**: `url` must be unique globally
- **QrzCache**: `callSign` must be unique (sparse)
- **SystemNotification**: `notificationId` must be unique

### Referential Integrity

- Foreign key relationships enforced via `ObjectId` references
- Cascade deletion policies for dependent records
- Validation of reference existence on create/update operations

### Data Consistency Rules

1. **Station State Consistency**: A station can only be in one state per net
2. **Net Ownership**: At least one owner required per NetProfile
3. **Interaction Ordering**: Interactions must have sequential timestamps
4. **Permission Inheritance**: User level cannot exceed permissions in specific nets

## Indexing Strategy

### Indexes Defined in Schemas

The following indexes are explicitly declared in model schemas:

```javascript
UserProfile: { email: 1 }        // unique, sparse
UserProfile: { callSign: 1 }     // unique, sparse
UserProfile: { superUser: 1 }    // standard
NetProfile: { title: 1 }         // unique (via mongoose-unique-validator)
LiveNet: { url: 1 }              // unique (via mongoose-unique-validator)
QrzCache: { callSign: 1 }        // unique, sparse
SystemNotification: { notificationId: 1 }  // unique
SystemNotification: { active: 1 }
```

### Query Optimization

- **Projection**: Only fetch required fields to minimize transfer
- **Population**: Selective population of references to avoid N+1 queries
- **Aggregation**: Use MongoDB aggregation pipeline for complex queries
- **Connection pooling**: Environment-specific pool sizes for concurrent access

## Data Migration Patterns

### Schema Evolution

```javascript
// Example migration for adding new field
db.userProfiles.updateMany({ chatEnabled: { $exists: false } }, { $set: { chatEnabled: true } });

// Index creation
db.stationInteractions.createIndex({ netProfile: 1, lastSeen: -1 });
```

### Migration Approach

- **Additive changes**: New optional fields with defaults can be added without migration
- **Breaking changes**: Require explicit migration scripts run against the live database
- **Migration scripts**: Manual database operations or direct script execution

## Security Considerations

### Data Protection

- **Sensitive fields**: Email addresses and personal information protected
- **Access control**: Model-level permissions via user level system
- **Audit trail**: Track creation and modification timestamps
- **Data sanitization**: Input validation at schema level

### Privacy Controls

- **User preferences**: Respect `policyConsent` and `flaggedForDeletion` flags
- **Data retention**: Automatic cleanup of old interaction data
- **Anonymization**: Option to anonymize historical records

## Performance Monitoring

### Key Metrics

- **Query performance**: Index usage and execution time
- **Connection utilization**: Pool usage and wait times
- **Document growth**: Collection size and growth rates
- **Index efficiency**: Index hit ratios and selectivity

### Optimization Techniques

- **Query analysis**: Use `explain()` for query optimization
- **Index maintenance**: Regular index statistics updates
- **Connection tuning**: Adjust pool sizes based on load patterns
- **Aggregation optimization**: Efficient pipeline stage ordering

## See also

- [Server Architecture](server-architecture.md) — Application structure and database connection
- [Security](security.md) — Data protection and access control
- [Runtime Configuration](runtime-config.md) — FlexOptions system details
- [API Reference](api-reference.md) — Data model usage in API endpoints

(End of database models and schema documentation.)
