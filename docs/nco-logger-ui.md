# WVARC NCO Logger UI

The active-net page uses the first-party WVARC NCO Logger dashboard. The implementation was bootstrapped from the KE7WIL Chrome helper, but it is copied into maintained application paths and has no runtime dependency on `chrome-plugin/` or Chrome extension APIs.

## Runtime files

- `client/src/public/js/byView/liveNet/ncoLogger.js` owns the dashboard, station-row controls, keyboard/slash shortcuts, module layout, tags, notes, and chat docking.
- `client/src/public/js/byView/liveNet/ncoLoggerChatBridge.js` prevents logger slash shortcuts from being submitted to group chat.
- `client/dist/public/css/nco-logger.css` and `client/dist/public/img/nco-logger-default-avatar.svg` are first-party static assets.
- `server/dist/views/liveNet.ejs` mounts only the logger UI and the authenticated chat host; the former live-net widget layout is no longer rendered.

## Server integration

Core mutations use `POST /api/nco-logger/:id` with semantic actions rather than the legacy admin command-line endpoint. The controller enforces NCO/Logger role rules and delegates domain mutations to `sharedNetOps`.

Supported actions include check-in, highlighted check-in, checkout, in-and-out, undo check-in, Logger/Relay role changes, NCO handoff, frequency changes, station role details, net closure, and shared logger-state persistence. Existing hand/highlight controls continue to use the authenticated station-interaction endpoint.

Shared operational state is stored on the active `LiveNet` document and included in live-net responses. Updates are pushed through the existing SSE service. Shared state includes station ordering, operational tags, helper visibility, the selected station, and normalized name/location overrides.

Private station notes and personal module layout remain in browser `localStorage`; neither is written to the server. QRZ lookup for new check-ins uses the app server's configured QRZ integration, so operator credentials are not collected by this UI.

## Plugin removal

The `chrome-plugin/` directory is retained only as the imported reference until the integrated interface is accepted. It can be removed without changing the running application.
