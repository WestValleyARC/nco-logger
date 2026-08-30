# Local chat system

Chat is part of the logger and has no hosted provider. Messages and moderation state are stored in
MongoDB; authenticated browsers receive updates over Server-Sent Events (SSE). A separate message
stream is keyed by both `LiveNet` and `NetProfile`.

## Authentication and access

All chat endpoints use the existing signed cookie session. The server derives callsign, display
name, and user ID from `req.user`; clients cannot override identity. The user must have a
`StationInteraction` for the active net. Net control and net loggers can moderate messages; authors
can edit or delete their own message. Editing preserves the original message ID and creation time,
updates `editedAt`, and never replaces an attachment. The `/ban` and `/unban` commands use local
`ChatBan` records.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/chat/:npid/messages` | Ordered history (up to 500), limits, and SSE path |
| `POST` | `/api/chat/:npid/messages` | Send `{ "text": "..." }` |
| `PATCH` | `/api/chat/:npid/messages/:messageId` | Edit the author's text/image caption |
| `POST` | `/api/chat/:npid/images` | Upload a raw PNG, JPEG, GIF, or WebP image |
| `GET` | `/api/chat/:npid/messages/:messageId/image` | Retrieve an authenticated image attachment |
| `DELETE` | `/api/chat/:npid/messages/:messageId` | Delete an owned or moderated message |
| `GET` | `/api/chat/:npid/events` | SSE stream for inserts and updates |

SSE sends `ready` and `message` events. `message` data has `id`, `callSign`, `displayName`, `text`,
`attachment`, `createdAt`, `editedAt`, `deleted`, `mine`, `canEdit`, and `canDelete`. Image attachments expose
only `kind`, `mimeType`, `size`, and an authenticated same-origin `url`; the storage filename is
never returned. Native `EventSource` reconnects automatically. Errors return
`{ "endpointVersion": "1.0", "error": "safe message" }` with an appropriate HTTP status.

The compact categorized emoji picker inserts ordinary Unicode and requires no external script or
provider. Chat supports text, images, message editing, message deletion, and live SSE updates.
Selecting an image uploads it immediately and shows an explicit uploading, success, or failure
status. The browser reconciles history after every SSE connection and deduplicates POST/SSE races by
stable message ID.

## Security and lifecycle

Message HTML is stripped, the browser renders with `textContent`, identifiers are validated,
message length is bounded, and a per-user rate window limits bursts. Deleted text is blanked in
storage and never returned. Image access repeats authentication and active-net membership checks.
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

The old `/api/endorse/chat/:npid` token route no longer exists. Extension code should use the local
REST endpoints and subscribe to the returned `ssePath`. No separate token or API key is required.
