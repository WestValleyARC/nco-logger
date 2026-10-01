# Chat image privacy and retention

Chat image uploads are decoded and re-encoded with Sharp before persistence. Both
public and direct messages use the same sanitizer. EXIF (including GPS, camera,
orientation, author and contact fields), XMP, IPTC, comments, embedded previews,
ICC profiles and trailing payloads are not copied. Colour is converted to sRGB;
orientation is applied to pixels before its tag is discarded. Dimensions and the
format data needed to render pixels, transparency and animation remain.

Storage names are random UUIDs. Original filenames are neither read nor stored.
Image response filenames use an opaque message ID and detected output extension.
The browser's existing generic download names also contain no original filename.
CSV/text net reports contain `[Image attachment]` placeholders for public images;
they do not include image bytes or original filenames. Direct chat is excluded
from those reports.

## Formats and resource limits

JPEG, static PNG, GIF and WebP are supported, including GIF/WebP animation timing
and loop count. JPEG is re-encoded at quality 95 with 4:4:4 chroma; it is not a
byte-for-byte archival copy. PNG/WebP preserve transparency. All eight EXIF
orientations are handled. Animated PNG is rejected because the decoder does not
preserve its animation; it is never silently flattened or passed through.
Malformed/truncated images are rejected rather than retaining original bytes.

Input and output must fit `CHAT_MAX_UPLOAD_MB`. Decoded images are limited to
20 million total pixels and 100 animation frames, with a ten-second processing
timeout and at most two simultaneous sanitizer calls per process. Busy requests
receive 503 and can be retried. Sharp's operation cache is disabled. Transformations
use memory; no original, transformed temporary file or image cache is written.

## Previously stored images

Every authenticated image response is sanitized, including legacy images. Reads
reject symlinks, non-regular files and oversized files. Authorization and private
conversation membership are checked before opening a file. Originals on disk
are not rewritten by a read. A legacy image that cannot be sanitized fails closed.
The upload directory is not exposed as a static public directory.

This change performs no historical migration or directory sweep. Unknown files
that have no database owner remain for a separately approved inventory/migration.
Existing administrative backups may still contain old unsanitized files; their
retention and recovery policies are unchanged. Restored files served by this
version pass through the sanitizer. This is not deletion of already downloaded
copies or backups.

## Seven days from close

`CHAT_RETENTION_DAYS` defaults to **7**, measured from the live session's close
time, even when report delivery succeeds immediately. Values must be integer
1–365. The expiration date is persisted at close; changing the configuration
only affects new closes. An ordinary quiet close skips the email but uses the
same retention window. Cancelled/missed preparation sessions and integrity
recovery also enqueue retention instead of deleting chat immediately.

Retained chat cannot be viewed or modified by reopening the same net profile:
chat history, image delivery, replies and mutations are scoped to its specific
live-session ID. Explicit message deletion and NCO clear actions still remove
those images immediately, as before.

A durable `ChatRetention` record saves report inputs before live records are
removed. A generation failure or SMTP failure retains those inputs and chat for
retry. Missing chat history now fails report creation instead of silently sending
an incomplete report. A minute worker processes up to 20 due jobs; failures retry
after 15 minutes. Jobs use a database lease so overlapping workers cannot claim
the same attempt. An expired lease is recoverable after process restart.

**Failed or unconfirmed delivery extends retention past seven days until it
succeeds.** SMTP-disabled console delivery and partial recipient rejection do not
count as successful delivery. When all recipients opt out, the normal report is
marked intentionally skipped. Automatic inactivity closures continue to use
their existing operational-mail outbox; retention waits for it, and requeues its
failed deliveries. Quiet closure itself does not falsely mark that email sent.
A crash after SMTP acceptance but before its database acknowledgement may cause
a duplicate report on retry; delivery is at least once, not exactly once.

## Cleanup and recovery

The worker never removes a session while its `LiveNet` record still exists.
After expiration and confirmed/skipped reporting, it unlinks that session's
attachments first, then removes chat and asset records. Any unlink error leaves
all database ownership available for retry. Missing files count as already
removed. A completed job clears its saved report inputs and the automatic-close
snapshot; minimal status/timestamp information remains for diagnostics.

`ChatImageAsset` ownership is recorded before writing a new file. Failed uploads
and interrupted database writes therefore remain discoverable. The worker also
recovers ledger-owned orphan files after the retention age, but only when their
session is inactive, no message references them, and no unfinished retention job
needs them. It does not guess ownership or delete unknown files by filename/age.
No production data cleanup or migration is run as part of development or tests.

Logs identify the opaque session/file ID and error category. `ChatRetention`
exposes `reportState`, `attempts`, `nextAttemptAt`, `lastError`, `expiresAt` and
`completedAt` for operational inspection. Investigate repeated retry messages,
fix the underlying SMTP/storage failure, and let the worker retry. Do not remove
ownership records to silence errors. Disk usage can exceed seven days while a
report or file removal remains blocked.

## Verification

`test/chat-image-privacy.test.js` generates synthetic metadata-bearing fixtures,
checks sanitized bytes and oriented pixels, covers animated GIF/WebP, exercises
both upload scopes and legacy delivery, and uses a temporary database/upload
directory for retention, report failure, unlink failure, orphan and retry tests.
No production connection/configuration is used. The existing full test suite,
TypeScript build and lint remain part of validation.
