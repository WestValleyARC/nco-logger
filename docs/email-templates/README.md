# NCO Logger email system

NCO Logger renders multipart HTML and plain-text email locally and sends it through
provider-neutral SMTP. All messages use the shared EJS shell at
`server/dist/views/email/shell.ejs`; structured message content and delivery live in
`server/dist/lib/email/` and `server/dist/lib/userNotification.js`.

## Current messages

| Message | Subject | Trigger | Recipients and preference behavior |
|---|---|---|---|
| Magic sign-in | `Sign in to NCO Logger` | User requests an email sign-in link | Requested address; required authentication mail |
| Account inactivity warning | `NCO Logger account inactivity warning` | Account reaches the configured three-year policy threshold | Account address; required account notice |
| Contact-form delivery | `NCO Logger contact: {subject}` | Visitor submits Contact NCO Logger | `logger@westvalleyarc.com`; visitor receives no confirmation |
| Manual net start | `{title} is going live {time}` | Owner starts an unscheduled net | Followers with Email Notifications enabled |
| Scheduled reminder | `{title} is scheduled to begin soon` | Occurrence enters the approximately ten-minute reminder window | Followers with Email Notifications enabled; occurrence state prevents routine duplicate sends |
| Inactivity auto-close | `NCO Logger automatically closed {title}` | NCO Logger automatically closes an abandoned non-permanent net | Stored owners/co-owners; mandatory operational notice that bypasses Email Notifications |
| Net-close report | `{title} - Net Close Report` | A non-quiet net close completes | Owners/co-owners plus superusers with Email Notifications enabled |

Scheduled creation, ordinary edits, cancellations, missed occurrences, and the scheduled ON AIR
transition do not generate additional follower email. Automatic inactivity close uses the quiet
close path and does not also generate a net-close report.

The close report retains two attachments: a CSV attendee report and a plain-text chat log.

## Delivery and identity

- SMTP delivery requires `MAIL_TRANSPORT=smtp`, `SMTP_HOST`, and a valid `EMAIL_FROM` formatted as
  `NCO Logger <address@example.com>`.
- Normal Reply-To defaults to `logger@westvalleyarc.com` and can be supplied through
  `EMAIL_REPLY_TO`.
- Contact-form delivery keeps the configured From identity and uses only the validated visitor
  address as its Reply-To exception.
- Public message content links to **Contact NCO Logger** at `/views/contact`; it does not publish
  the internal mailbox as the support path.
- `BASE_URL` supplies the public HTTP(S) origin for absolute email links.

When SMTP is disabled, no message is sent. Development magic-link behavior remains documented in
`docs/authentication.md`.

## No-send review fixtures

Render representative HTML and text for all seven messages to a temporary developer directory:

```bash
node scripts/render-email-review.js /tmp/nco-logger-email-review
```

The output includes one HTML file, one text file, and a manifest containing subjects, headers,
links, recipients, and attachment metadata. The command renders only and never calls SMTP.
