# Local chat system

Chat is part of the logger and has no hosted provider. Messages and moderation state are stored in
MongoDB; authenticated browsers receive updates over Server-Sent Events (SSE). A separate message
stream is keyed by both `LiveNet` and `NetProfile`.

## Authentication and access

All chat endpoints use the existing signed cookie session. The server derives callsign, display
name, and user ID from `req.user`; clients cannot override identity. The user must have a
`StationInteraction` for the active net. Net control and net loggers can moderate messages; authors
can delete their own message. The `/ban` and `/unban` commands use local `ChatBan` records.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/chat/:npid/messages` | Ordered history (up to 500), limits, and SSE path |
| `POST` | `/api/chat/:npid/messages` | Send `{ "text": "..." }` |
| `DELETE` | `/api/chat/:npid/messages/:messageId` | Delete an owned or moderated message |
| `GET` | `/api/chat/:npid/events` | SSE stream for inserts and updates |

SSE sends `ready` and `message` events. `message` data has `id`, `callSign`, `displayName`, `text`,
`createdAt`, `editedAt`, `deleted`, `mine`, and `canDelete`. Native `EventSource` reconnects
automatically. Errors return `{ "endpointVersion": "1.0", "error": "safe message" }` with an
appropriate HTTP status.

## Security and lifecycle

Message HTML is stripped, the browser renders with `textContent`, identifiers are validated,
message length is bounded, and a per-user rate window limits bursts. Deleted text is blanked in
storage and never returned. Server timestamps and `_id` provide stable ordering.

Net close ordering is: mark closing, fetch local history, render attachments, attempt SMTP
delivery, clean chat records, then remove live-net state. History failures cannot prevent close.

```dotenv
CHAT_MAX_MESSAGE_CHARS=2000
CHAT_RATE_LIMIT_COUNT=12
CHAT_RATE_LIMIT_WINDOW_MS=10000
```

Inline image uploads from the former hosted chat integration are deliberately deferred. The
Compose file reserves a persistent `hamlive-chat-uploads` volume for that later phase.

## Migration

The old `/api/endorse/chat/:npid` token route no longer exists. Extension code should use the local
REST endpoints and subscribe to the returned `ssePath`. No separate token or API key is required.
