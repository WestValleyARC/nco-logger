# Email templates

Ham.Live renders email locally and sends it through provider-neutral SMTP. This folder preserves
the historical net-close design as a reference; the runtime EJS template lives under
`server/dist/views/email/`.

> These files are reference only. The running app does not read them.

## Templates

| File | Sent by | Env var | When |
|------|---------|---------|------|
| [`net-close-report.html`](net-close-report.html) | `NetCloseReport` (`server/dist/lib/userNotification.js`) | Emailed to the net owner when a net closes |

When SMTP is disabled, development uses console delivery mode and no message is sent.

## Template data — `net-close-report.html`

The app passes these `dynamic_template_data` fields (Handlebars):

| Variable | Contents |
|----------|----------|
| `subject` | `"{title} - Net Close Report"` |
| `title` | net title |
| `url` | full link to the net |
| `startedAtString` | net start time (UTC string), or empty |
| `formattedAttendees` | array of `{ callSign, role, checkInTime, displayName, location, sigReport, highlight }` |

Two files are also **attached automatically by the code** (no template work needed): a CSV roster
(`…_report.csv`) and a chat-log text file (`…_chat.txt`).
