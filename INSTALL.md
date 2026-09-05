# Installing NCO Logger

This guide covers two paths:

1. **[Local test drive](#1-local-test-drive)** — run it on your own machine with **zero accounts**,
   to try it out or develop against it. Works on **Windows, macOS, and Linux**.
2. **[Hosting for your club](#2-hosting-for-your-club)** — stand up a real instance, including the
   external accounts you'll want for email and callsign lookups.

---

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| **Node.js** | 22 LTS | The supported range is recorded in `.nvmrc` and `package.json` |
| **MongoDB** | 6 or newer (bundled `docker-compose.yml` uses `mongo:7`) | Local via Docker (recommended) or a managed database |
| **Git** | any | to clone the repository |
| **Docker Desktop** | optional | easiest way to run MongoDB locally |
| **OpenSSL** | optional | only if you opt into local HTTPS (`HTTPS=true`) and regenerate the cert |

### OS-specific setup

**Windows**
- Install Node.js (the MSI from nodejs.org) and [Docker Desktop](https://www.docker.com/products/docker-desktop/).
- Use **PowerShell** or **Git Bash**. All `npm run` scripts in this project are cross-platform.
- A throwaway dev TLS certificate is included, so OpenSSL is not required.

**macOS**
- `brew install node` and install Docker Desktop (or `brew install mongodb-community` to run Mongo natively).

**Linux**
- Install Node.js (via your distro or [nodesource](https://github.com/nodesource/distributions))
  and Docker Engine + the Compose plugin (or install `mongodb` natively).

---

## 1. Local test drive

A complete, working instance with **no paid accounts**. Every external integration is optional and
disables itself cleanly when its keys are absent. Email login still works because the local login
page displays the magic sign-in link without logging its token.

```bash
git clone https://github.com/Constant-Digital-Holdings-LLC/hamlive-oss.git hamlive-oss
cd hamlive-oss

npm install              # install dependencies
npm run dev              # does everything (see below)
```

`npm run dev` is all you need for a local run. It automatically:

- creates your `.env` from `.env.example` (so you don't have to run `npm run setup`),
- starts a local MongoDB if one isn't already running — **no Docker required** (it downloads a
  `mongod` binary on first run, which can take a minute; if you already have MongoDB running via
  Docker, natively, or pointing at a remote/Atlas URI, it detects and uses that instead), and
- compiles the TypeScript and runs the app.

Stop everything with **Ctrl+C**.

Now:

1. Open **http://localhost:3000** (plain HTTP on localhost — no certificate warning).
2. Enter any email address and submit the email sign-in form.
3. Because email delivery isn't configured, the page shows a **"Click here to finish signing in →"**
   button — click it. The token is deliberately not printed in the `npm run dev` terminal.
4. You're logged in. Set your callsign on the account page and you can create and run a net.

> Prefer HTTPS locally? Set `HTTPS=true` (and `BASE_URL=https://localhost:3000`) to serve dev over
> HTTPS with a bundled self-signed cert — your browser will then show the usual "not private" warning
> for self-signed certs, which you can click through.

**What's disabled in this mode** (all optional): Google sign-in is hidden, SMTP delivery is replaced
by an on-page development link, and QRZ enrichment is skipped. Local text chat remains available.

### MongoDB options

You don't have to do anything — `npm run dev` starts a local MongoDB for you when none is running.
If you'd rather manage MongoDB yourself, use one of these approaches:

**Bundled helper, separate terminal** (no Docker, no install, no sudo):

```bash
npm run mongo:dev        # terminal 1 — leave running (single-node replica set on :27017)
npm run dev              # terminal 2 — the app
```

> **Note:** `npm run mongo:dev` uses `mongodb-memory-server` — data is **in-memory and ephemeral**.
> Everything is lost when the process stops (Ctrl+C). The first run downloads a `mongod` binary,
> which can take a minute.

**Docker** (persistent data): run the complete authenticated development stack, including the app:

```bash
docker compose -f docker-compose.yml -f compose.dev.yml up -d --build
```

This uses `mongo:7`, a single-node replica set, and named volumes. MongoDB intentionally has no
host-published port, so a host-side `npm run dev` does not connect to this private database.

**Native install** — install MongoDB Community Server and point the app at it:

- Install MongoDB Community Server for your OS.
- Real-time updates use **change streams**, which require a **replica set** (not a standalone
  `mongod`). Start it as a single-node replica set and initiate it once:
  ```bash
  mongod --replSet rs0 --dbpath /your/data/dir
  # in another shell, once:
  mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"
  ```
- Keep the default `MONGODB_URI=mongodb://localhost:27017/hamlive?directConnection=true` in `.env`
  (the `directConnection=true` flag is what lets the driver talk to a single-node replica set).

### Stopping / resetting

If you started the Docker development stack:

```bash
docker compose -f docker-compose.yml -f compose.dev.yml down     # data persists
# Explicitly destructive; only for disposable local data:
docker compose -f docker-compose.yml -f compose.dev.yml down -v
```

If you are using the in-memory helper (`npm run mongo:dev`) or the auto-started MongoDB inside
`npm run dev`, simply press **Ctrl+C** — the process (and all data) stops cleanly.

---

## 2. Hosting for your club

To run a shared instance, you'll set environment variables (no secrets live in the code or the
committed config). Copy `.env.example` to `.env` (or set real environment variables on your host)
and fill in the values below.

### Required

| Variable | What it is |
| --- | --- |
| `NODE_ENV` | `production` for a hosted instance |
| `BASE_URL` | Public URL of your instance, e.g. `https://nets.yourclub.org` |
| `MONGODB_URI` | Connection string to your MongoDB |
| `COOKIE_SESSION_KEY` | Long random string used to authenticate the opaque session-ID cookie |
| `MAGIC_LINK_SECRET` | Long random string used to sign email login tokens |
| `PORT` | Port to listen on (your platform may set this) |

Generate strong secrets, for example:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Optional integrations and the accounts they need

Each integration is independent — enable only what you want.

| Integration | Account / where to sign up | Variables | Free tier? |
| --- | --- | --- | --- |
| **MongoDB Atlas** (database hosting) | <https://www.mongodb.com/atlas> | `MONGODB_URI` | Yes (M0) |
| **Email delivery** (SMTP) | Google Workspace SMTP relay | `MAIL_TRANSPORT`, `SMTP_*`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | Workspace service |
| **Google sign-in** (OAuth) | <https://console.cloud.google.com/apis/credentials> | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Yes |
| **Callsign lookup** (QRZ.com) | <https://www.qrz.com/page/xml_data.html> | `QRZ_USERNAME`, `QRZ_PASSWORD` | Paid XML subscription |
| **Reverse geocoding** (Azure Maps) | <https://azure.microsoft.com/products/azure-maps> | `GEO_KEY` | Yes (limited) |

Notes:
- **Email:** without SMTP, the login page displays the link in development only without logging
  its token. A production instance never exposes the link and must configure mail delivery.
- **Google OAuth:** set the authorized redirect URI to `${BASE_URL}/auth/google/redirect`.
- **Chat:** text, emoji, and image chat are local. Images are stored in the persistent
  `hamlive-chat-uploads` volume; PNG, JPEG, GIF, and WebP are supported.
- **Ads & analytics:** removed from this fork.

### Google Workspace SMTP relay (recommended for WVARC)

1. In the Google Admin Console, open **Apps → Google Workspace → Gmail → Routing → SMTP relay service**.
2. Add a relay rule and select **Only addresses in my domains** under Allowed senders. Use a
   club-owned identity such as `logger@westvalleyarc.com` or `nets@westvalleyarc.com`, not a
   volunteer's personal mailbox.
3. Under Authentication, select **Only accept mail from the specified IP addresses** and enter only
   the fixed public IP of the server hosting `logger.westvalleyarc.com`. Do not enter a broad range.
4. Enable **Require TLS encryption** and save the rule.
5. Configure the application:

   ```dotenv
   MAIL_TRANSPORT=smtp
   SMTP_HOST=smtp-relay.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_REQUIRE_TLS=true
   SMTP_USER=
   SMTP_PASS=
   EMAIL_FROM=NCO Logger <logger@westvalleyarc.com>
   EMAIL_REPLY_TO=logger@westvalleyarc.com
   ```

   `SMTP_USER` and `SMTP_PASS` are intentionally optional for IP-authenticated relay. Google OAuth
   variables are unrelated and must not be reused for SMTP.

6. Verify the domain's SPF record authorizes Google Workspace, enable Google DKIM signing, and
   maintain an appropriate DMARC record.
7. Send a test message to an external account. Confirm the visible sender is
   `NCO Logger <logger@westvalleyarc.com>`. If delivery fails, use Google Admin
   Console's Email Log Search.

`EMAIL_FROM` is required whenever SMTP delivery is enabled and must use the canonical
`NCO Logger <address@example.com>` format. Normal messages use `EMAIL_REPLY_TO` (defaulting to
`logger@westvalleyarc.com`). Contact-form delivery is the intentional exception: it retains the
configured From identity and uses the validated visitor address as Reply-To.

If the server does not have a fixed public IP, use the Gmail API with OAuth2 as the preferred
production fallback. A Google app password can be used temporarily for development, with
`SMTP_USER` and `SMTP_PASS`, but is not the recommended production design.

### Build and run

The recommended self-hosted path runs both the application and its MongoDB
replica set in Docker:

```bash
npm run setup              # creates .env with local-only generated secrets
docker compose -f docker-compose.yml -f compose.dev.yml up -d --build
docker compose -f docker-compose.yml -f compose.dev.yml ps
docker compose -f docker-compose.yml -f compose.dev.yml logs -f app
```

Open `http://localhost:3000`. MongoDB is reachable only on the private Compose
network; the application is published on the host loopback interface so a local
reverse proxy can expose it safely. Database data persists in the
`hamlive-mongo-data` named volume when the containers are replaced or stopped.

Stop the stack without deleting its database volume:

```bash
docker compose -f docker-compose.yml -f compose.dev.yml down
```

For production, set an organization-approved HTTPS `BASE_URL`, unique signing
secrets, Mongo root/application credentials, and a replica key in the root
`.env` or a deployment secret manager. Compose uses an explicitly supplied
`MONGODB_COMPOSE_URI` when present; otherwise it constructs the private,
authenticated service URI. Set `TRUST_PROXY` only to the actual proxy hop or
subnet and use `FORCE_HTTPS=true` when that trusted proxy terminates TLS.
Production startup rejects placeholder or short secrets, cleartext origins,
unauthenticated Mongo URIs, and reused signing keys. Never commit a populated
`.env`; restrict it to mode `0600`.

The authenticated Mongo layout is incompatible with an old unauthenticated
Compose data volume until an operator performs a reviewed migration. Back up
the old volume first, restore it into a separate authenticated test project,
validate count/index parity, and only then schedule the production cutover.

Health endpoints are available at `/healthz` (Node process) and `/readyz`
(Node plus MongoDB connectivity).

Set `NCO_ABANDONMENT_MINUTES` to a positive number of minutes to control how
long a non-permanent live net may remain without an active NCO or present
profile owner/co-owner before automatic closure (default: 30).

To run without Docker:

```bash
npm install
npm run build            # compile TypeScript sources (required before starting)
NODE_ENV=production npm start
```

### Hosting platform & TLS

The app is a standard Node/Express server with no platform lock-in — it runs anywhere Node runs:
Render, Fly.io, Railway, a plain VPS, etc. A `Procfile` (`web: npm start`) is included for platforms
that use it, but it's optional; `npm start` works everywhere.

In production the app listens on plain HTTP and expects **TLS to be terminated by your platform or a
reverse proxy** (nginx, Caddy, a cloud load balancer, etc.). Point the proxy at the app's `PORT` and
set `BASE_URL` to the public HTTPS URL. To force HTTP→HTTPS redirects at the app, set
`TRUST_PROXY` to the proxy address/hop and `FORCE_HTTPS=true`. Forwarded headers
are ignored unless a trusted proxy is explicitly configured. If your proxy drops idle
connections sooner/later than ~55s, tune `SSE_IDLE_TIMEOUT_MS` so real-time keep-alives fit inside
it. (In development the app serves plain HTTP on localhost by default — no certificate warning. Set
`HTTPS=true` to serve dev over HTTPS with the bundled self-signed cert; `npm run gen-certs`
regenerates it.)

### Legal pages

The privacy policy, terms of use, and cookie policy ship as **placeholders**
(`server/dist/views/privacyPolicy.ejs`, `termsOfUse.ejs`, `cookiePolicy.ejs`). Replace them with
documents appropriate to your instance and jurisdiction before going live.

### Backups

A dedicated one-shot Compose service provides the source-built backup/restore CLI and pinned
MongoDB Database Tools without adding administration tools to the web image. Run
`docker compose --profile operations run --rm backup backup --production --require-uploads`;
the database archive, upload archive, and integrity manifest persist in
`${NCO_BACKUP_DIR:-./backups}` on the host (`/backups` in the operations container). See
[docs/runbook.md](docs/runbook.md) for validation and safe restore procedures.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Your connection is not private" / `ERR_CERT_AUTHORITY_INVALID` | You're on `https://localhost` with the self-signed dev cert. Use **http://localhost:3000** (the default), or keep HTTPS and click through the warning. |
| `MongooseServerSelectionError` | MongoDB isn't running / `MONGODB_URI` is wrong. Start the full development stack shown above or check the URI. With Docker, give it ~20s on first start to initiate the replica set. |
| `$changeStream stage is only supported on replica sets` | Your MongoDB is a standalone, not a replica set. Use the bundled `docker compose` (already a replica set) or start native `mongod` with `--replSet` as shown above. |
| No login email arrives | Expected in local mode — the link appears on the login page and is not logged. For hosted instances, configure SMTP and a domain sender in `EMAIL_FROM`. |
| Google button missing | Google OAuth isn't configured. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. |
| Chat is reconnecting | Confirm MongoDB is a replica set; local chat SSE uses change streams. |

More background is in [`docs/`](docs/), starting with
[docs/developer-setup.md](docs/developer-setup.md) and [docs/runbook.md](docs/runbook.md).
