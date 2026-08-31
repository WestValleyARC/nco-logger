# Local chat system

Chat is part of the logger and has no hosted provider. Messages and moderation state are stored in
MongoDB; authenticated browsers receive updates over Server-Sent Events (SSE). A separate message
stream is keyed by both `LiveNet` and `NetProfile`.

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
| `PATCH` | `/api/chat/:npid/messages/:messageId` | Edit the author's text/image caption |
| `POST` | `/api/chat/:npid/images` | Upload a raw PNG, JPEG, GIF, or WebP image |
| `GET` | `/api/chat/:npid/messages/:messageId/image` | Retrieve an authenticated image attachment |
| `DELETE` | `/api/chat/:npid/messages/:messageId` | Delete the author's own message |
| `PUT` | `/api/chat/:npid/messages/:messageId/reaction` | Toggle one of `👍 ❤️ 😂 😮` for the current user |
| `PUT` | `/api/chat/:npid/messages/:messageId/pin` | Set pin state (NCO or Logger) |
| `POST` | `/api/chat/:npid/messages/:messageId/ban` | Ban that authenticated author from this net's chat (NCO) |
| `DELETE` | `/api/chat/:npid/messages` | Clear only this net's public chat (NCO) |
| `GET` | `/api/chat/:npid/events` | SSE stream for inserts and updates |

SSE sends `ready`, `message`, and suspension `access` events. `message` data includes reply linkage,
grouped reaction counts with the current user's state, compact pin state, and server-derived action
permissions in addition to identity, content, timestamps, and attachments. Image attachments expose
only `kind`, `mimeType`, `size`, and an authenticated same-origin `url`; the storage filename is
never returned. Native `EventSource` reconnects automatically. Errors return
`{ "endpointVersion": "1.0", "error": "safe message" }` with an appropriate HTTP status.

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

## Security and lifecycle

Message HTML is stripped, the browser renders with `textContent`, identifiers are validated,
message length is bounded, and a per-user rate window limits bursts. Deleted text is blanked in
storage and never returned. Image access repeats authentication and active-net membership checks.
Ban targets are derived from the stored message author rather than client-supplied identity. Clear
operations are scoped to the current `NetProfile`; they soft-clear public messages for auditability,
remove associated files, and do not touch another net or any separate private/helper channel.
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

MongoDB requires no offline migration. Mongoose adds the optional `replyTo`, `reactions`,
`pinnedAt`, `pinnedBy`, and `clearedAt` fields as messages are created or changed; existing messages
continue to read with empty/default interaction state. Deploying application code and restarting the
service is sufficient when this phase is eventually released.

The old `/api/endorse/chat/:npid` token route no longer exists. Extension code should use the local
REST endpoints and subscribe to the returned `ssePath`. No separate token or API key is required.
