# Net Admin Commands Reference

This document provides a comprehensive reference for all Net Admin Commands available to Net Control Stations (NCS) and authorized operators in Ham.Live. These commands are implemented in `server/dist/lib/netAdminCommands/` and are available through the web interface and admin endpoints.

The URL for this page is configured in `commonConfig.yaml` as `cmd_help_url`. Operators who fork the repository should set the `CMD_HELP_URL` environment variable to point to their own hosted copy of this document so the in-app help link resolves correctly.

See [net-admin-commands-cheat-sheet.svg](net-admin-commands-cheat-sheet.svg) for a quick visual reference of all available commands and their role requirements.

## Role-Based Access Control

Commands are restricted by role levels in the following hierarchy:

| Role         | Level | Description                               |
| ------------ | ----- | ----------------------------------------- |
| `netcontrol` | 0     | Net Control Station - highest privileges  |
| `netlogger`  | 1     | Logger - can manage check-ins and logging |
| `netrelay`   | 2     | Relay station - limited privileges        |
| `netuser`    | 3     | Basic participant - lowest privileges     |

**Permission Rules:**

- Lower numeric values have higher privileges
- Users can only modify the state of users with higher numeric role levels
- Net Control (level 0) can modify anyone
- Net Users (level 3) can only check themselves in/out

**Advanced commands** (`advanced: true`) appear in the command list only for users whose level meets the command's `level` requirement, but they are not surfaced in the compact `help` summary — only via `help <command>`.

**Hidden commands** (`hidden: true`) — `nick` and `sys` — do not appear in the `help` listing at all. They are usable by anyone with sufficient level but are intentionally undocumented in-app.

## Command Reference

### Station Check-in/Check-out Commands

#### `i` - Check In Station

- **Command:** `i`
- **Permission Level:** 1 (netlogger+)
- **Usage:** `i [-h (to highlight)] <callsign> <callsign>... | -l (to check-in lurkers)`
- **Arguments:** 0-20 callsigns
- **mustBeCheckedIn:** yes
- **Purpose:** Mark one or more stations as checked-in. When no arguments provided, lists checked stations.
- **Options:**
    - `-h` - Highlight the checked-in stations
    - `-l` - Check-in all lurker stations
- **Example:** `i W1ABC K2DEF` or `i -h W1ABC` or `i -l`

#### `hi` - Check In with Highlighting

- **Command:** `hi`
- **Permission Level:** 1 (netlogger+)
- **Advanced:** yes
- **Usage:** `hi <callsign> <callsign>...`
- **Arguments:** 0-20 callsigns
- **mustBeCheckedIn:** yes
- **Purpose:** Check-in stations with automatic highlighting. Alias for `i -h`.
- **Example:** `hi W1ABC K2DEF`

#### `li` - Check In Lurkers

- **Command:** `li`
- **Permission Level:** 1 (netlogger+)
- **Advanced:** yes
- **Usage:** `li`
- **Arguments:** 0
- **mustBeCheckedIn:** yes
- **Purpose:** Check-in all lurker stations at once. Alias for `i -l`.
- **Example:** `li`

#### `o` - Check Out Station

- **Command:** `o`
- **Permission Level:** 1 (netlogger+)
- **Usage:** `o <callsign> <callsign>...`
- **Arguments:** 0-20 callsigns
- **mustBeCheckedIn:** yes
- **Purpose:** Mark one or more stations as checked-out.
- **Example:** `o W1ABC K2DEF`

#### `io` - Check In and Immediately Check Out

- **Command:** `io`
- **Permission Level:** 1 (netlogger+)
- **Usage:** `io <callsign> [<callsign>...]`
- **Arguments:** 1-20 callsigns
- **mustBeCheckedIn:** yes
- **Purpose:** Check-in stations and immediately check them out (for quick logging of short contacts).
- **Example:** `io W1ABC K2DEF`

#### `ui` - Undo Check-in

- **Command:** `ui`
- **Permission Level:** 1 (netlogger+)
- **Usage:** `ui <callsign> [<callsign>...]`
- **Arguments:** 1-20 callsigns
- **mustBeCheckedIn:** yes
- **Purpose:** Revert a station to the unchecked (lurker) state.
- **Example:** `ui W1ABC`

### Role Management Commands

#### `l` - Promote to Logger

- **Command:** `l`
- **Permission Level:** 0 (netcontrol only)
- **Usage:** `l <callsign> [<callsign>...]`
- **Arguments:** 0-5 callsigns
- **mustBeCheckedIn:** yes
- **Purpose:** Promote station(s) to logger role (level 1).
- **Example:** `l W1ABC K2DEF`

#### `r` - Promote to Relay

- **Command:** `r`
- **Permission Level:** 1 (netlogger+)
- **Usage:** `r <callsign> [<callsign>...]`
- **Arguments:** 0-5 callsigns
- **mustBeCheckedIn:** yes
- **Purpose:** Promote station(s) to relay role (level 2).
- **Example:** `r W1ABC K2DEF`

#### `handoff` - Transfer Net Control

- **Command:** `handoff`
- **Permission Level:** 0 (netcontrol only)
- **Usage:** `handoff <callsign>`
- **Arguments:** 1 callsign (required)
- **mustBeCheckedIn:** yes
- **Purpose:** Transfer net control to another station.
- **Example:** `handoff W1ABC`

### Hand State Management

#### `hand` - Manage Hand Raised State

- **Command:** `hand`
- **Permission Level:** 1 (netlogger+)
- **Advanced:** yes
- **Usage:** `hand { -u | -d } <callsign> [-a (all)]`
- **Arguments:** 1-2 arguments
- **mustBeCheckedIn:** no
- **Purpose:** Change hand-raised state for attendees.
- **Options:**
    - `-u` - Raise hand (up)
    - `-d` - Lower hand (down)
    - `-a` - Apply to all stations
- **Example:** `hand -u W1ABC` or `hand -d -a`

### Net Management Commands

#### `close` - Close Net

- **Command:** `close`
- **Permission Level:** 0 (netcontrol only)
- **Usage:** `close`
- **Arguments:** 0
- **mustBeCheckedIn:** no
- **Purpose:** Close the current net and trigger shutdown logic.
- **Example:** `close`

#### `f` - Set Frequency

- **Command:** `f`
- **Permission Level:** 0 (netcontrol only)
- **Usage:** `f <new freq in MHz>`
- **Arguments:** 0-1 frequency value
- **mustBeCheckedIn:** yes
- **Purpose:** Change the net frequency. With no argument, displays the current frequency.
- **Example:** `f 146.52` or `f` (to display current frequency)

#### `owner` - Manage Net Owners

- **Command:** `owner`
- **Permission Level:** 0 (netcontrol only)
- **Advanced:** yes
- **Usage:** `owner [<email addr>]`
- **Arguments:** 0-1 email address
- **mustBeCheckedIn:** no
- **Purpose:** List current co-owners (no argument) or add a co-owner by email address.
- **Example:** `owner` or `owner user@example.com`

#### `nick` - Set Nickname (hidden)

- **Command:** `nick` (alias: `nickname`)
- **Permission Level:** 0 (netcontrol only)
- **Advanced:** yes
- **Hidden:** yes (does not appear in `help` listing)
- **Usage:** `nick <callsign> <newname>`
- **Arguments:** 2-4 (callsign and name parts)
- **mustBeCheckedIn:** yes
- **Purpose:** Set a display name for an **unregistered** callsign within the net. If the callsign is associated with a registered account, the command is rejected — registered users must update their display name via account settings.
- **Example:** `nick W1ABC John Smith`

### Chat Moderation Commands

These commands manage user participation in the logger's local chat.

#### `ban` - Ban Station from Chat

- **Command:** `ban`
- **Permission Level:** 0 (netcontrol only)
- **Advanced:** yes
- **Usage:** `ban <callsign> <reason>`
- **Arguments:** 2-10 (callsign and at least one word of reason required)
- **mustBeCheckedIn:** no
- **Purpose:** Ban a station from the net's chat channel.
- **Note:** Target station must be in attendance (in the lookupTable).
- **Example:** `ban W1ABC disruptive behavior`

#### `unban` - Unban Station from Chat

- **Command:** `unban`
- **Permission Level:** 0 (netcontrol only)
- **Advanced:** yes
- **Usage:** `unban <callsign>`
- **Arguments:** 1 (callsign required)
- **mustBeCheckedIn:** no
- **Purpose:** Remove a chat ban from a station.
- **Note:** Target station must be in attendance (in the lookupTable).
- **Example:** `unban W1ABC`

### Information and Utility Commands

#### `c` - Display Count Statistics

- **Command:** `c` (also `count`)
- **Permission Level:** 1 (netlogger+)
- **Advanced:** yes
- **Usage:** `c`
- **Arguments:** 0
- **mustBeCheckedIn:** no
- **Purpose:** Display net statistics: total count, checked-in/out split, and lurker count.
- **Example output:** `count: 12, 8-in/4-out, lurking: 3`

#### `w` - Who Am I

- **Command:** `w`
- **Permission Level:** 3 (all users)
- **Usage:** `w [<callsign>]`
- **Arguments:** 0-1 callsign
- **mustBeCheckedIn:** no
- **Purpose:** Display role, level, and owner status for yourself or a specified callsign.
- **Output format:** `<callsign>: <role>/<level> [owner:true|false]`
- **Example:** `w` or `w W1ABC`

#### `help` - Display Help

- **Command:** `help` (alias: `?`)
- **Permission Level:** 3 (all users)
- **Usage:** `help [<command>]`
- **Arguments:** 0-1 command name
- **mustBeCheckedIn:** no
- **Purpose:** Display available commands (filtered to your permission level) or detailed usage for a specific command. Hidden commands (`nick`, `sys`) do not appear in the general listing.
- **Example:** `help` or `help hand` or `?`

#### `sys` - System Statistics (hidden)

- **Command:** `sys`
- **Permission Level:** 1 (netlogger+)
- **Advanced:** yes
- **Hidden:** yes (does not appear in `help` listing)
- **Usage:** `sys`
- **Arguments:** 0
- **mustBeCheckedIn:** yes
- **Purpose:** Report server process uptime, 5-minute load average, CPU count, and free memory.
- **Example output:** `(node) process uptime 02:14:33, load_5 0.42 (cores: 2), freemem 812MiB`

---

## Command Categories by Permission Level

### Level 0 (Net Control Only)

- `ban` — ban station from chat (advanced)
- `close` — close net
- `f` — set/show frequency
- `handoff` — transfer net control
- `l` — promote to logger
- `nick` — set nickname for unregistered callsign (advanced, hidden)
- `owner` — manage net owners (advanced)
- `unban` — unban station from chat (advanced)

### Level 1 (Logger and Above)

- `c` — display count statistics (advanced)
- `hand` — manage hand state (advanced)
- `hi` — check in with highlighting (advanced)
- `i` — check in station
- `io` — check in and out
- `li` — check in lurkers (advanced)
- `o` — check out station
- `r` — promote to relay
- `sys` — system statistics (advanced, hidden)
- `ui` — undo check-in

### Level 3 (All Users)

- `help` / `?` — display help
- `w` — who am I

---

## Usage Notes

1. **Callsign Format:** Commands accept callsigns in standard format (case-insensitive)
2. **Multiple Arguments:** Many commands accept multiple callsigns separated by spaces
3. **Options:** Some commands support flags like `-h` (highlight) or `-l` (lurkers)
4. **Permission Validation:** All commands validate the user's role level before execution
5. **Audit Logging:** Command execution is logged for audit purposes
6. **Real-time Updates:** Command results are broadcast via SSE to all connected clients

## Error Handling

Commands will fail with appropriate error messages if:

- Insufficient permission level
- Invalid callsign format
- Station not found in net
- Invalid argument count
- System errors

## See Also

- [Shared Net Operations](shared-net-ops.md) - Underlying domain logic and role system
- [Overview](overview.md) - System architecture and component relationships
- [Controllers](controllers.md) - HTTP endpoints that invoke these commands

## Implementation Details

- **Source Location:** `server/dist/lib/netAdminCommands/`
- **Base Classes:** Commands extend `NetAdminCmd`, `RoleModifier`, or `CheckStateApplicator`
- **Command Store:** Runtime command registry with permission and metadata management
- **Database Operations:** All commands use transaction-safe database operations
- **SSE Broadcasting:** Results are broadcast to connected clients via Server-Sent Events
- **Help URL:** Configured via `CMD_HELP_URL` env var (defaults to this document's GitHub URL in `commonConfig.yaml`)
