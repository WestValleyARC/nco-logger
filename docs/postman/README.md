# Ham.Live Postman Collection

This Postman collection is designed for **internal testing and development** of Ham.Live API endpoints.

## Authentication Required

Most Ham.Live API endpoints require authentication via session cookies. Since the app uses Google OAuth (which requires browser redirects), you must manually obtain session cookies.

The session cookie is named **`session`** (the default name used by the `cookie-session` npm package, keyed by `conf.cookie_session_key`). Its value is base64url-encoded JSON containing the Passport session.

## Setup Instructions

### Method 1: Browser Cookie Extraction (Recommended)

1. **Authenticate in Browser:**

    - Navigate to your Ham.Live instance (local or production)
    - Click "Sign in with Google" and complete the OAuth flow, or use the magic-link email flow
    - Ensure you are logged in successfully

2. **Extract Session Cookie:**

    - Open browser Developer Tools (F12)
    - Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
    - Navigate to **Cookies** for your domain
    - Find the cookie named **`session`**
    - Copy the cookie **value**

3. **Configure Postman:**

    - Open the Ham.Live collection in Postman
    - Go to collection **Settings** → **Cookies** tab
    - Click **Add Cookie**
    - Set **Domain** to your Ham.Live domain (e.g. `localhost:3000` or `ham.live`)
    - Set **Name** to `session`
    - Set **Value** to the copied cookie value
    - Click **Save**

4. **Test Authentication:**
    - Run the "GET LiveNet Details" request
    - If you get a 200 response with data, you are authenticated
    - If you get 401/403, check your cookie setup

### Method 2: Magic Link Alternative

1. **Request Magic Link:**

    - Use the "Request Magic Link" endpoint in the collection
    - Replace `your-email@example.com` with your actual email
    - Send the request

2. **Complete Authentication:**
    - Check your email for the magic link
    - Click the link in the **same browser where Postman is running**
    - This will set the session cookie automatically

## Collection Organization

- **Authentication Setup** — instructions and magic-link auth
- **Data API Endpoints** — LiveNets list and details, NetProfiles CRUD
- **Station Interactions** — signal reports, hands, check-ins (`POST /api/station/interactions/:id`)
- **Admin Commands** — net admin command list and execution (`GET /api/admin/interactions/:id`, `POST /api/admin/interactions/:id`)
- **Local Chat** — history/send (`GET|POST /api/chat/:id/messages`) and moderation
- **Utility Endpoints** — notifications pending/dismiss, location resolution, account recovery

## Variables

Update these collection variables for your environment:

- `baseUrl` — your Ham.Live instance URL (`http://localhost:3000` for local dev)
- `netProfileId` — a valid NetProfile id from your system (check the database or the list endpoint)

## Endpoints Reference

The following table summarises the endpoints included in the collection. See [API Reference](../api-reference.md) for full documentation of each.

### Public / Unauthenticated

| Method | Path                    | Description                 |
| ------ | ----------------------- | --------------------------- |
| GET    | `/api/data/livenets`    | List active nets            |

### REQ_LOGIN (any authenticated user)

| Method | Path                                            | Description                               |
| ------ | ----------------------------------------------- | ----------------------------------------- |
| GET    | `/api/data/userprofiles`                        | Get own user profile                      |
| PATCH  | `/api/data/userprofiles/:id`                    | Update own profile                        |
| DELETE | `/api/data/userprofiles/:id`                    | Delete own account                        |
| GET    | `/api/util/resolvelocation`                     | Resolve lat/lon to location string        |
| GET    | `/api/util/undeleteme`                          | Recover a flagged-for-deletion account    |
| GET    | `/api/util/notifications/pending`               | Fetch unseen system notifications         |
| POST   | `/api/util/notifications/:notificationId/dismiss` | Dismiss a notification                  |

### REQ_CALLSIGN (authenticated user with confirmed callsign)

| Method | Path                                          | Description                                      |
| ------ | --------------------------------------------- | ------------------------------------------------ |
| GET    | `/api/data/livenets/:id`                      | LiveNet details for a single net                 |
| POST   | `/api/data/livenets/:id`                      | Start a live net (net owner)                     |
| GET    | `/api/presence/livenets/:id`                  | Presence-only snapshot                           |
| GET    | `/api/data/netprofiles`                       | List net profiles                                |
| POST   | `/api/data/netprofiles`                       | Create net profile                               |
| PATCH  | `/api/data/netprofiles/:id`                   | Update net profile                               |
| DELETE | `/api/data/netprofiles/:id`                   | Delete net profile                               |
| POST   | `/api/station/interactions/:id`                            | Post station interaction (sig report, hand, etc.) |
| GET    | `/api/admin/interactions/:id`                              | List net admin commands for net                  |
| POST   | `/api/admin/interactions/:id`                              | Execute net admin command                        |
| GET    | `/api/chat/:id/messages`                      | Get local chat history and SSE path              |
| POST   | `/api/chat/:id/messages`                      | Send a local chat message                        |
| DELETE | `/api/chat/:id/messages/:messageId`           | Delete an owned or moderated chat message        |

## Important Notes

- Endpoints marked with REQ_CALLSIGN require a confirmed callsign on the account in addition to a valid session
- Session cookies expire — you may need to re-authenticate periodically
- Replace placeholder IDs in variables with real IDs from your system
- Local development typically runs on `http://localhost:3000`

## Troubleshooting

**401/403 Errors:**

- Check that your session cookie is correctly set and the name is `session`
- Verify the cookie domain matches your `baseUrl`
- Re-authenticate if the session expired

**404 Errors:**

- Verify the `baseUrl` variable is correct
- Check that the endpoint paths match your server implementation

**Invalid ID Errors:**

- Update collection variables with actual IDs from your database
- Use the "GET LiveNets List" endpoint to find valid `netProfileId` values
