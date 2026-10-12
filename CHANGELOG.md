# Changelog

All notable changes to NCO Logger are recorded here. Versions follow Semantic Versioning.
The version describes the repository code; deploying it to a server is a separate step.

## [1.1.1] - 2026-10-12

Bug-fix release for the 1.1 line. No schema changes.

### Fixed

- Scheduled net rooms open for early check-ins without being treated as on
  air. (#73)
- Google sign-in account conflicts are explained, and operators can recover
  an account. (#74)
- Chat images have sensitive metadata stripped, and closed chat sessions are
  retained for seven days. (#86)
- Dashboard splitters no longer draw over the open header menu, and the
  photo viewer close button is reachable. (#70, #75)
- Logger operational tags and per-station notes reset when a new live net
  starts. Notes stay within their live occurrence, and drafts are discarded.
  (#83, #99)
- Station Controls spacing, desktop minimum height, and chat sizing within its
  module were corrected, and desktop Live Nets text matches the schedule
  cards. (#79, #81, #82, #85)

### Changed

- The Contact page now links to the address in `SUPPORT_EMAIL` instead of
  offering a message form. Set `SUPPORT_EMAIL` in `.env`. (#91)

## [1.1.0] - 2026-09-22

First stable version of the 1.1 line, following `1.1.0-alpha.1` and
`1.1.0-beta.1` through `1.1.0-beta.4`. This entry covers the work since the
original `1.0.0` public package. The beta labels were valid prerelease
identifiers; removing the suffix promotes the same 1.1 release line.

### Added

- First-party NCO operations dashboard, live station controls, NCO handoff,
  account and net profile management, and live Edit Net and Net Type controls.
  (#3, #12, #62)
- Public and private local chat with images, reactions, replies, editing,
  moderation, presence, typing indicators, and an expanded emoji picker.
  (#2, #5, #33, #58)
- Recurring net scheduling, public schedule and dashboard views, follower
  controls, reminders, optional end times, and scheduled-net lifecycle tools.
  (#10, #13, #14, #25, #26)
- Structured repeater and digital connection details for Net Profiles,
  including Fusion/WIRES-X support. (#11, #63, #64)
- Light, dark, and system appearance modes, responsive Logger layouts, and
  shared keyboard/touch-operable splitters for docked modules. (#17, #37, #57,
  #65, #66, #71)
- Branded notifications, net-close reports with CSV/chat attachments, and
  automated abandoned-net reporting. (#19, #68)

### Fixed

- Corrected scheduled-net start availability during the post-start grace
  period and strengthened scheduling reconciliation and reminder retries.
  (#24, #27, #59)
- Prevented email link scanners from consuming one-time magic-login links and
  corrected Google OAuth callback/session handling. (#51, #54, #56)
- Improved chat reconnect and display behavior, live-net card sizing,
  station-action controls, mobile photo navigation, and docked pane resizing.
  (#15, #16, #53, #60, #67, #71)

### Security and operations

- Added self-hosted Docker deployment, health/readiness checks, authenticated
  MongoDB, persistent chat storage, and production configuration validation.
  (#1, #2, #49)
- Added revocable server-side sessions, short-lived single-use magic links,
  origin and host checks, rate limits, security headers, and dependency fixes.
  (#47, #48, #49)
- Added coordinated database/upload backups, off-host replication support,
  guarded restores, CI checks, and recovery documentation. (#41, #46, #49)

### Upgrade notes

- The production security changes require reviewed secrets, TLS/proxy,
  authenticated database, SMTP, and backup settings. Existing sessions will
  need a new sign-in. Follow [RELEASE_NOTES.md](RELEASE_NOTES.md) and
  [the production release checklist](docs/production-release-checklist.md)
  before deploying.
- This 1.1.0 baseline includes merged work through PR #71. Remaining photo
  controls (#70), returning-user Google sign-in (#74), and splitter/menu
  stacking (#75) work is planned for 1.1.1 or later. Draft PR #76 addresses
  #70 and #75 after the 1.1.0 release; #74 needs its own fix. Production
  deployment and real-device acceptance are separate from this PR.

## [1.0.0] - 2026-06-05

- Initial public Ham.Live open-source package.
