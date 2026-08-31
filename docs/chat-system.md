# Local chat system

Chat is part of the logger and has no hosted provider. Messages and moderation state are stored in
MongoDB; authenticated browsers receive updates over Server-Sent Events (SSE). A separate message
stream is keyed by both `LiveNet` and `NetProfile`.

Messages have a `scope` of `public` or `direct`. Direct messages store one authenticated sender and
one authenticated recipient. Server-side queries and live delivery require the viewer to be one of
those two users; NCO and Logger roles do not override direct-message privacy.

## Authentication and access

All chat endpoints use the existing signed cookie session. The server derives callsign, display
name, and user ID from `req.user`; clients cannot override identity. The user must have a
`StationInteraction` for the active net. Authors can edit or delete only their own messages. Net
control and net loggers can pin messages; only net control can ban a participant or clear the
current net's public chat. Editing preserves the original message ID and creation time,
updates `editedAt`, and never replaces an attachment. The `/ban` and `/unban` commands use local
`ChatBan` records.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/chat/:npid/messages` | Ordered history (up to 500), limits, and SSE path |
| `POST` | `/api/chat/:npid/messages` | Send `{ "text": "...", "replyTo": "optional-message-id" }` |
| `GET` | `/api/chat/:npid/direct/:userId/messages` | Ordered history (up to 500) between the viewer and one known net user |
| `POST` | `/api/chat/:npid/direct/:userId/messages` | Send a direct text message to one known net user |
| `POST` | `/api/chat/:npid/direct/:userId/images` | Send a direct image to one known net user |
| `PUT` | `/api/chat/:npid/direct/:userId/ignore` | Set `{ "ignored": true|false }` for the viewer's private-message preference |
| `PATCH` | `/api/chat/:npid/messages/:messageId` | Edit the author's text/image caption |
| `POST` | `/api/chat/:npid/images` | Upload a raw PNG, JPEG, GIF, or WebP image |
| `GET` | `/api/chat/:npid/messages/:messageId/image` | Retrieve an authenticated image attachment |
| `DELETE` | `/api/chat/:npid/messages/:messageId` | Delete the author's own message |
| `PUT` | `/api/chat/:npid/messages/:messageId/reaction` | Toggle one of `👍 ❤️ 😂 😮` for the current user |
| `PUT` | `/api/chat/:npid/messages/:messageId/pin` | Set pin state (NCO or Logger) |
| `POST` | `/api/chat/:npid/messages/:messageId/ban` | Ban that authenticated author from this net's chat (NCO) |
| `DELETE` | `/api/chat/:npid/messages` | Clear only this net's public chat (NCO) |
| `GET` | `/api/chat/:npid/events` | SSE stream for inserts and updates |

SSE sends `ready`, `message`, `recipients`, `preferences`, and suspension `access` events. Public
`message` events reach eligible net participants. Direct `message` events are serialized only for
the sender and recipient, and ignored incoming direct messages are omitted without notifying the
sender. `message` data includes scope, authenticated participant IDs, reply linkage,
grouped reaction counts with the current user's state, compact pin state, and server-derived action
permissions in addition to identity, content, timestamps, and attachments. Image attachments expose
only `kind`, `mimeType`, `size`, and an authenticated same-origin `url`; the storage filename is
never returned. Native `EventSource` reconnects automatically. Errors return a versioned
`{ "error": "safe message" }` payload with an appropriate HTTP status.

The recipient selector remains inside Chat and defaults to `Everyone`. Its availability indicator
means connected to the current net/session, based on the existing station `lastSeen` window; known
offline users remain selectable and can receive persisted messages later. Unread counts are
session-local, increment only for incoming messages outside the open conversation, and clear when
that conversation opens. Ignore lists persist on the authenticated `UserProfile`, affect direct
messages only, and are reversible without notifying the ignored user.

The floating emoji picker provides searchable Smileys, People, Animals, Food, Activities, Travel,
Objects, Symbols, and Flags categories. It inserts ordinary Unicode at the current caret or
selection and requires no external script or provider. Message actions appear on hover, keyboard
focus, or persistently on touch devices. Replies show a compact original-message reference and fall
back safely when it is deleted. Each user may toggle each quick reaction once; totals are grouped by
emoji. Pins are persisted on the message and represented by a compact indicator rather than a
separate panel. Selecting an image uploads it immediately and shows an
explicit uploading, success, or failure status. Posted images render as compact, contained
thumbnails. Activating a thumbnail opens an in-page lightbox with close and authenticated download
controls; Escape closes it and returns focus to the thumbnail. The browser reconciles history after
every SSE connection and deduplicates POST/SSE races by stable message ID.

The NCO Logger display settings maintain separate type scales for the Logger helpers and native
Chat. Changing one does not alter or compound the other.

## History bounds and client performance

The initial public history contains the newest 500 uncleared public messages. The initial direct
inbox reconciliation contains the newest 1,000 direct messages involving the viewer across all
peers, while opening one direct conversation fetches its newest 500 messages. Results are queried
newest-first so MongoDB can apply the limit, then reversed into chronological display order. These
windows only bound API and browser state: older database records are not deleted. The current UI
does not paginate beyond the window. The net-close transcript intentionally streams the complete
public history in batches because it is an operational export rather than an interactive view.

The client stores messages by stable ID, updates only rows whose render key changed, and limits
sorting/DOM work to the bounded active conversation. It fetches each opened direct conversation
once per widget lifecycle, keeps one EventSource, and removes document/window listeners and the SSE
stream during teardown. Image load handling preserves the reader's position when intrinsic image
dimensions become available.

## Accessibility

The recipient selector supports Tab plus Arrow Up/Down, Home, and End navigation and returns focus
when dismissed. Message actions have visible focus states, text alternatives, and remain available
on coarse-pointer/touch devices. Reaction controls expose pressed state, presence includes
Available/Unavailable text rather than color alone, and status changes use polite live regions. The
image viewer is an `aria-modal` dialog with a focus loop, Escape handling, and focus return to the
originating thumbnail. Destructive moderation actions use native confirmation dialogs.

## Security and lifecycle

Message HTML is stripped, the browser renders with `textContent`, identifiers are validated,
message length is bounded, and one shared per-user rate window limits validated text, direct,
image, edit, delete, reaction, ignore, pin, ban, and public-clear mutations. Invalid or unauthorized
requests are rejected before consuming the normal-use allowance. A limited response is `429` with
a compact safe error and `Retry-After`; the browser displays `Rate limit reached`. Deleted text is blanked in
storage and never returned. Image access repeats authentication and active-net membership checks. A
direct image additionally requires the requester to be its sender or recipient and honors the
recipient's ignore preference; random storage names are never exposed. Ban targets are derived from
the stored message author rather than client-supplied identity. Clear operations are scoped to the
current `NetProfile` and public scope; they soft-clear public messages for auditability, remove
associated public files, and do not touch direct messages, ignore preferences, or another net.
The server detects the file signature rather than trusting `Content-Type`, rejects SVG, generates
random storage names, and serves accepted files with `nosniff` and a restrictive CSP. Deleting an
image message removes its file. Server timestamps and `_id` provide stable ordering.

Net close ordering is: mark closing, fetch local history, render attachments, attempt SMTP
delivery, clean chat records, then remove live-net state. History failures cannot prevent close.

```dotenv
CHAT_MAX_MESSAGE_CHARS=2000
CHAT_RATE_LIMIT_COUNT=12
CHAT_RATE_LIMIT_WINDOW_MS=10000
CHAT_UPLOAD_DIR=/app/data/chat-uploads
CHAT_MAX_UPLOAD_MB=5
```

Compose mounts `CHAT_UPLOAD_DIR` from the persistent `hamlive-chat-uploads` volume. PNG, JPEG, GIF,
and WebP images are accepted. The configured size defaults to 5 MB and is capped at 10 MB. When a
net closes, its image references are included in the emailed history and its local files are then
removed with the rest of that net's chat data.

## Migration

MongoDB requires no offline migration. Mongoose treats messages without `scope` as public while new
records receive the `public` default. Direct records add `scope: direct` and
`recipientUserProfile`; user profiles add `ignoredPrivateUsers`. Deploying application code and
restarting the service is sufficient when this phase is eventually released. The new compound
indexes build through normal Mongoose initialization.

The old `/api/endorse/chat/:npid` token route no longer exists. Extension code should use the local
REST endpoints and subscribe to the returned `ssePath`. No separate token or API key is required.

## Known operational boundaries

- Direct messages are access-controlled to their two participants but are not end-to-end
  encrypted; the application/database operator can access stored records and must document the
  applicable privacy and retention policy.
- SSE delivery and live presence depend on MongoDB change streams, so MongoDB must run as a replica
  set. Temporary disconnects reconcile from bounded history, but messages older than those windows
  require direct database/export access because the UI has no older-history pagination.
- The rate window is process-local. It is effective for the standard single application process;
  multi-instance deployments need a shared limiter at the proxy or application layer for a global
  abuse limit.
- Images live on the configured persistent filesystem volume. Multi-instance deployments need
  shared storage, and operators must back up and monitor that volume.
- Native `EventSource`, Custom Elements, and modern ES modules are required. Current evergreen
  Chrome, Edge, Firefox, and Safari are the intended browser class; obsolete browsers need no
  compatibility fallback.
