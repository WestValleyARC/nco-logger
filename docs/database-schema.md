# Database Schema Documentation

This document provides comprehensive documentation for the MongoDB schemas used in Ham.Live, implemented using Mongoose ODM. All models are located in `server/dist/models/` and use a centralized `modelMaker` pattern for consistency.

See [database-schema.svg](database-schema.svg) for a visual overview of the database relationships and schema structure.

## Schema Overview

The Ham.Live database consists of core, chat, configuration, notification, task, and cache collections:

- **Core Entities**: NetProfile, LiveNet, StationInteraction, UserProfile
- **Local Chat**: ChatMessage, ChatBan
- **Configuration**: FlexOption (global settings, embedded local schema in UserProfile)
- **Notifications**: SystemNotification
- **Background Processing**: PendingUnfollow, PendingAccountDelete (both in TaskQueues)
- **Tracking/Caching**: InitialReg, QrzCache, DayTracker

- **User Net Subscriptions**: Implemented via following/followers arrays, not separate collection

## Core Models

### NetProfile

**Purpose**: Template/configuration for radio nets (both recurring and one-time events)

**Schema**: `/server/dist/models/netProfile.js`

#### Fields

```javascript
{
    title: {
        type: String,
        required: true,
        unique: true,
        minlength: 4,
        maxlength: 25,
        validate: /^\w+(?:[&.'\- ]*\w+)*$/  // Alphanumeric with common punctuation
    },
    frequency: {
        type: String,
        maxlength: 20,
        validate: /^\d+[.]\d+(?:([.]\d+))?$/  // Format: "14.300" or "14.300.0"
    },
    mode: {
        type: String,
        enum: ['LSB', 'USB', 'AM', 'CW', 'FM', 'RTTY', 'FSQ', 'PSK-31',
               'FreeDV', 'Reflector', 'Olivia', 'Hell', 'JS8Call', 'CUSTOM'],
        required: true
    },
    modeDetails: {
        type: String,
        maxlength: 15,
        validate: /^\w+(?:[&. ]*\w+)*$/  // Word characters with &, dot, space separators
    },
    notes: {
        type: String,
        maxlength: 320  // Free-form text, no additional regex validation
    },
    owners: [{
        type: Schema.Types.ObjectId,
        ref: 'UserProfile'
    }],
    followers: [{
        type: Schema.Types.ObjectId,
        ref: 'UserProfile'
    }],
    liveNet: {
        type: Schema.Types.ObjectId,
        ref: 'LiveNet'  // null when net is not active
    },
    autoIn: {
        type: Boolean,
        default: false  // Auto-check-in followers when net starts
    },
    permanent: {
        type: Boolean,
        default: false  // Prevents automatic closure
    },
    restrictedSigReports: {
        type: Boolean,
        default: false  // Limits who can submit signal reports
    },
    invisible: {
        type: Boolean,
        default: false  // Hidden from public net listings
    }
}
```

#### Indexes

- `title`: Unique index (via mongoose-unique-validator)

#### Business Rules

- At least one owner required
- Cannot delete NetProfile with active LiveNet
- Frequency validation follows amateur radio standards
- Title must be unique across all nets

### LiveNet

**Purpose**: Active instance of a net session with real-time participant tracking

**Schema**: `/server/dist/models/liveNet.js`

#### Fields

```javascript
{
    lookupTable: {
        type: Map,
        of: {
            stationInteraction: {
                type: Schema.Types.ObjectId,
                ref: 'StationInteraction'
            }
        }  // Map<callSign, {stationInteraction: ObjectId}>
    },
    netProfile: {
        type: Schema.Types.ObjectId,
        ref: 'NetProfile',
        required: true
    },
    netControl: {
        type: Schema.Types.ObjectId,
        ref: 'UserProfile',
        required: true  // Net Control Station (NCS)
    },
    countdownTimer: {
        type: Number,
        min: 0,
        max: 120,
        default: 1  // Minutes
    },
    started: {
        type: Boolean,
        default: false
    },
    startedAt: {
        type: Date,
        default: null
    },
    closing: {
        type: Boolean,
        default: false  // Prevents new check-ins during shutdown
    },
    url: {
        type: String,
        required: true,
        unique: true  // Short URL for net access (e.g., "/n/abc123")
    }
}
```

#### Indexes

- `url`: Unique index
- `netProfile`: Index for profile lookups

#### Business Rules

- Only one active LiveNet per NetProfile
- URL must be globally unique
- LookupTable maps call signs to StationInteraction documents
- Closing phase prevents new participants

### StationInteraction

**Purpose**: Represents a participant's state and interaction history within a LiveNet. Local chat messages reference this user's active net participation.

**Schema**: `/server/dist/models/stationInteraction.js`

#### Fields

```javascript
{
    checkedState: {
        type: Boolean,
        default: null,
        enum: [true, false, null]  // true=checked-in, false=checked-out, null=spectator
    },
    role: {
        type: String,
        default: 'netuser',
        enum: ['netlogger', 'netrelay', 'netcontrol', 'netuser']
        // Not required — defaults to 'netuser'
    },
    callSign: {
        type: String,
        required: true
    },
    email: String,
    displayName: String,
    photo: String,          // URL to avatar image
    location: String,       // QTH/location
    createdBy: {
        type: String,
        enum: ['user', 'admin'],
        required: true
    },
    hand: {
        type: Boolean,
        default: false  // Hand raised for attention
    },
    highlight: {
        type: Boolean,
        default: false  // Highlighted by NCS
    },
    chatEnabled: {
        type: Boolean,
        default: true   // Per-station chat toggle
    },
    manualPushCount: {
        type: Number,
        default: 0      // SSE push optimization counter
    },
    lastSeen: Date,     // Last activity timestamp (no default)
    checkedInAt: {
        type: Date,
        default: null
    },
    userProfile: {
        type: Schema.Types.ObjectId,
        ref: 'UserProfile'
    },
    liveNet: {
        type: Schema.Types.ObjectId,
        ref: 'LiveNet'
        // Not required at schema level
    },
    netProfile: {
        type: Schema.Types.ObjectId,
        ref: 'NetProfile',
        required: true
    },
    sigReports: {
        calculated: String,  // Computed summary (e.g., "5/9", "5/7/9")
        rst: {
            type: Map,
            of: {
                r: {
                    type: Number,
                    min: 1, max: 5,
                    required: true
                },
                s: {
                    type: Number,
                    min: 1, max: 9,
                    required: true
                },
                t: {
                    type: Number,
                    min: 1, max: 9,
                    required: false  // Only for modes requiring tone
                }
            }  // Map<reportingCallSign, {r,s,t}>
        }
    }
}
```

#### Indexes

No explicit compound indexes are defined in the model. Standard `_id` index applies.

#### Business Rules

- One StationInteraction per call sign per LiveNet
- Role hierarchy: netcontrol(0) > netlogger(1) > netrelay(2) > netuser(3)
- Signal reports follow RST format (Readability/Strength/Tone)
- Call sign validation follows amateur radio standards

### UserProfile

**Purpose**: User account and preferences

**Schema**: `/server/dist/models/userProfile.js`

#### Fields

```javascript
{
    displayName: {
        type: String,
        required: true,
        minlength: 2,
        maxlength: 20,
        validate: /^[A-zÀ-ú-' ]+$/  // Letters, accents, hyphens, apostrophes, spaces
    },
    googleId: String,  // OAuth integration
    lastLogin: {
        type: Date,
        default: Date.now
    },
    callSign: {
        type: String,
        unique: true,
        sparse: true,  // Allows multiple null values
        minlength: 3,
        maxlength: 7,
        validate: /^(\d?[a-zA-Z]{1,3}|[a-zA-Z]\d[a-zA-Z]?)\d[a-zA-Z]{1,4}$/
    },
    photo: {
        type: String,
        validate: [isValidURL, 'Invalid URL format']
    },
    location: {
        type: String,
        minlength: 5,
        maxlength: 24,
        validate: /^[0-9A-zÀ-ú-', ()]+$/
    },
    newAccount: { type: Boolean, default: true },   // Account setup flag
    lastAuthVia: {
        type: String,
        enum: ['google', 'email'],
        required: true
    },
    policyConsent: { type: Boolean, default: false },
    email: {
        type: SchemaTypes.Email,
        required: true,
        unique: true,
        sparse: true   // Sparse allows deferred email population
    },
    locked: { type: Boolean, default: false },
    superUser: {
        type: Boolean,
        default: false,
        index: true    // Indexed for admin queries
    },
    verified: { type: Boolean, default: false },
    myNets: [{
        type: Schema.Types.ObjectId,
        ref: 'NetProfile'  // Nets this user owns
    }],
    following: [{
        type: Schema.Types.ObjectId,
        ref: 'NetProfile'  // Nets this user follows
    }],
    initialReg: {
        type: Schema.Types.ObjectId,
        ref: 'InitialReg'  // Call sign registration tracking
    },
    flexOptions: flexOptionsLocalSchema,  // User-specific preferences (embedded)
    flaggedForDeletion: {
        type: Boolean,
        default: false  // GDPR compliance flag
    },
    dismissedNotifications: [{
        notificationId: { type: String, required: true },
        dismissedAt: { type: Date, default: Date.now }
    }]
}
```

#### Indexes

- `email`: Unique, sparse
- `callSign`: Unique, sparse
- `superUser`: Standard index for admin queries

#### Business Rules

- Email must be unique and valid
- Call sign must be unique when present (sparse allows nulls)
- Cannot follow more than maxFollowingPerUser nets
- Cannot own more than maxNetsPerUser nets

## Configuration Models

### FlexOption

**Mongoose model name**: `FlexOption` (singular). The collection stores the single global configuration document.

**Purpose**: Runtime configuration for features, limits, and operational parameters

**Schema**: `/server/dist/models/flexOptions.js`

> **Note on type stubs**: `server/dist/models/flexOptions.d.ts` declares three additional fields on the `option` object — `netDetailsTtlSec`, `netListTtlSec`, and `globalRefreshRate` — that are not present in the runtime `.js` schema. These exist only in the hand-written type stub, not in the Mongoose schema itself.

#### Global Schema (`flexOptionsGlobalSchema`)

```javascript
{
    scope: {
        type: String,
        default: 'global'
    },
    option: {
        chat: {
            type: Boolean,
            default: true  // Enable chat integration
        },
        email: {
            type: Boolean,
            default: true  // Enable email notifications
        },
        maxNetsPerUser: {
            type: Number,
            default: 7  // Net ownership limit
        },
        maxOwnersPerNet: {
            type: Number,
            default: 5  // Ownership sharing limit
        },
        baseTtlMs: {
            type: Number,
            default: 15000  // Base SSE TTL in milliseconds
        },
        awayInMs: {
            type: Number,
            default: 25000  // Presence timeout in milliseconds
        },
        httpClientTimeout: {
            type: Number,
            default: 20000  // HTTP request timeout in milliseconds
        },
        requestRateFactor: {
            type: Number,
            default: 5  // Rate limiting multiplier
        },
        qrzDataReqTimeoutMs: {
            type: Number,
            default: 1000  // QRZ data lookup timeout in milliseconds
        },
        qrzSessionReqTimeoutMs: {
            type: Number,
            default: 3000  // QRZ session request timeout in milliseconds
        },
        qrzReqQuota: {
            type: Number,
            default: 1000000  // QRZ request limit
        },
        maxFollowersPerNet: {
            type: Number,
            default: 500  // Follower limit per net
        },
        maxFollowingPerUser: {
            type: Number,
            default: 100  // Following limit per user
        },
        sigReportTypeByMode: {
            LSB: { type: String, default: 'RS' },
            USB: { type: String, default: 'RS' },
            AM: { type: String, default: 'RS' },
            FreeDV: { type: String, default: 'RS' },
            CW: { type: String, default: 'RST' },
            Reflector: { type: String, default: null },
            FM: { type: String, default: null }
        }
    }
}
```

#### Local (User) Schema (`flexOptionsLocalSchema`)

Embedded directly in `UserProfile.flexOptions`. No `scope` field.

```javascript
{
    option: {
        chat: Boolean,          // User chat preference override
        email: Boolean          // User email preference override
    }
}
```

## Background Processing Models

### PendingUnfollow

**Purpose**: Queue for processing bulk unfollow operations

```javascript
{
    unlink: {
        type: String,
        enum: ['userOnly', 'netOnly', 'both'],
        required: true
    },
    upid: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'UserProfile'
    },
    npid: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'NetProfile'
    }
}
```

### PendingAccountDelete

**Purpose**: Queue for processing account deletion operations

```javascript
{
    upid: {
        type: Schema.Types.ObjectId,
        ref: 'UserProfile'
    }
}
```

## Tracking and Cache Models

### InitialRegTracker

**Purpose**: Track call sign registration grace periods

```javascript
{
    callSign: {
        type: String,
        unique: true,
        sparse: true,        // Not required; uniqueness enforced when present
        minlength: 3,
        maxlength: 7,
        validate: /^(\d?[a-zA-Z]{1,3}|[a-zA-Z]\d[a-zA-Z]?)\d[a-zA-Z]{1,4}$/
    },
    startOfGracePeriod: {
        type: Date,
        required: true
    }
    // No timestamps (timestamps: false)
}
```

### QrzCache

**Purpose**: Cache QRZ.com callsign lookup results to reduce API calls

```javascript
{
    displayName: String,        // Full name from QRZ
    localNickname: {
        type: String,
        minlength: 2,
        maxlength: 20,
        validate: /^[A-zÀ-ú-' ]+$/
    },
    callSign: {
        type: String,
        unique: true,
        sparse: true            // Sparse to allow missing callsigns
    },
    photo: {
        type: String,
        validate: [isValidURL, 'Invalid URL format']
    },
    location: String,
    email: String,
    geo: {
        type: { type: String }, // GeoJSON type string (e.g., 'Point')
        coordinates: [Number]   // [longitude, latitude]
    }
    // + createdAt, updatedAt (timestamps: true)
}
```

> There is no `data` blob, no `cachedAt` field, and no `ttl` field. Cache freshness is managed by `updatedAt` (auto-set by Mongoose timestamps).

### DayTracker

**Purpose**: Track which days of the week background processing has run

```javascript
{
    Mon: { type: Boolean, default: false },
    Tue: { type: Boolean, default: false },
    Wed: { type: Boolean, default: false },
    Thu: { type: Boolean, default: false },
    Fri: { type: Boolean, default: false },
    Sat: { type: Boolean, default: false },
    Sun: { type: Boolean, default: false }
    // + createdAt, updatedAt (timestamps: true)
}
```

> There is no `day` date field and no `processed` boolean field. Each document tracks all seven days as Boolean flags.

## Relationships and Referential Integrity

### Primary Relationships

```
UserProfile (1) ←→ (N) NetProfile [owners/myNets]
UserProfile (1) ←→ (N) NetProfile [followers/following]
NetProfile (1) ←→ (0..1) LiveNet
LiveNet (1) ←→ (N) StationInteraction
UserProfile (1) ←→ (N) StationInteraction
UserProfile (1) ←→ (0..1) InitialRegTracker
```

### Referential Integrity Rules

1. **Cascading Deletes**: When NetProfile is deleted:

    - Remove from all users' myNets and following arrays
    - Close active LiveNet
    - Create PendingUnfollow jobs for cleanup

2. **Orphan Prevention**: StationInteraction documents:

    - Must reference valid LiveNet and NetProfile
    - Should reference valid UserProfile (can be null for non-registered participants)

3. **Consistency Checks**: Background tasks verify:
    - LiveNet.netProfile matches StationInteraction.netProfile
    - UserProfile arrays match NetProfile arrays
    - No orphaned documents exist

## Indexes and Performance

### Critical Indexes

```javascript
// Explicitly defined in schemas
NetProfile: { title: 1 }         // Unique (via mongoose-unique-validator)
LiveNet: { url: 1 }              // Unique (via mongoose-unique-validator)
UserProfile: { email: 1 }        // Unique, sparse
UserProfile: { callSign: 1 }     // Unique, sparse
UserProfile: { superUser: 1 }    // Standard index
QrzCache: { callSign: 1 }        // Unique, sparse
SystemNotification: { notificationId: 1 }  // Unique
SystemNotification: { active: 1 }
```

### Performance Considerations

- **Lookup Tables**: LiveNet.lookupTable uses MongoDB Map type for O(1) call sign lookups
- **Sparse Indexes**: Call sign indexes allow multiple null values while enforcing uniqueness among non-null entries
- **Background Processing**: Task queues use ObjectId references for efficient lookup

## Data Migration Patterns

### Schema Evolution

When modifying schemas:

1. **Additive Changes**: New optional fields can be added directly
2. **Breaking Changes**: Require migration scripts
3. **Index Changes**: Use background index builds for large collections
4. **Validation Changes**: Test against existing data first

### Common Migration Tasks

```javascript
// Add new field with default value
db.netProfiles.updateMany({}, { $set: { newField: defaultValue } });

// Migrate data format
db.stationInteractions.updateMany({ oldField: { $exists: true } }, { $rename: { oldField: 'newField' } });

// Clean up orphaned references
db.stationInteractions.deleteMany({
    liveNet: { $nin: db.liveNets.distinct('_id') }
});
```

## Validation and Constraints

### Data Validation Layers

1. **Mongoose Schema Validation**: Type checking, required fields, enums
2. **Custom Validators**: Format validation (call signs, URLs, etc.)
3. **Pre-save Hooks**: Complex business rule validation
4. **Application Logic**: SharedNetOps functions provide additional validation

### Error Handling

All validation errors follow consistent patterns:

- Required field errors: "Field is required"
- Format errors: "Invalid format for field"
- Enum errors: "Value not in allowed list"
- Custom errors: Business-specific messages

## Testing Data Patterns

### Test Database Setup

```javascript
// Minimal valid NetProfile
const testNetProfile = {
    title: 'Test Net',
    frequency: '14.300',
    mode: 'USB',
    owners: [testUserId]
};

// Minimal valid UserProfile
const testUserProfile = {
    displayName: 'Test User',
    email: 'test@example.com',
    callSign: 'K1TEST'
};

// Valid StationInteraction
const testStationInteraction = {
    callSign: 'K1TEST',
    liveNet: testLiveNetId,
    netProfile: testNetProfileId,
    userProfile: testUserProfileId
};
```

## See Also

- [SharedNetOps](shared-net-ops.md) — Domain logic using these models
- [Data Model](data-model.md) — High-level relationships overview
- [API Reference](api-reference.md) — How schemas map to API responses
- [Controllers](controllers.md) — How controllers use these models
