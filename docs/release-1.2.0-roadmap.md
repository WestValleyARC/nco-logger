# Release 1.2.0 roadmap

This feature branch is tracking the 1.2.0 milestone work from `dev/1.2.0` and stays isolated from the protected `release/1.2.0` branch until approval.

## Branch policy

- Work branch: `feature/1.2.0-login-account-recovery`
- Integration branch: `dev/1.2.0`
- Release branch: `release/1.2.0`
- Merge policy: all milestone work merges to `dev/1.2.0` first; the release branch is only used once the development branch is approved for release.

## Related GitHub issues

- #111 — Epic: Release 1.2.0 login, user management and recoverable account identity
- #108 — Bug: Recoverable account identity / inaccessible or unknown-email callsign lockout
- #107 — Stable account identity, username/password + Google sign-in, safe legacy enrollment and migration
- #109 — Audited console account recovery and system-administrator role management
- #110 — Permission-controlled user-management console for application administrators

## Offline-first implementation order

1. Harden the account identity model and user/session security without relying on Google credentials.
2. Complete the recovery flow so users can recover an existing account without access to the original mailbox.
3. Add audited admin/operator tooling for role and account management.
4. Wire in Google account linking only after credentials and environment setup are available.

## Working assumptions

- This repo is running without external Google OAuth credentials in the current dev environment.
- The Google integration remains intentionally deferred until the core identity, recovery, and admin flows are stable.
- The release branch remains protected and is not used for day-to-day development.
