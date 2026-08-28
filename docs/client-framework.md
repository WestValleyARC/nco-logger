# Client framework (homegrown) — overview

This document describes the lightweight TypeScript client libraries and the reactive patterns currently used by Ham.Live client pages. It explains the core primitives, where they live in the source tree, and how they behave at runtime.

See [client-reactive-pattern.svg](client-reactive-pattern.svg) for a visual overview of the reactive patterns described below.

Goals and constraints observed in the codebase

- Keep runtime small and dependency-free (no bundler required).
- Use native browser primitives (ES modules, Custom Elements, Shadow DOM, adoptedStyleSheets where available).
- Centralize domain update logic in a single reactive store so widgets stay simple and testable.
- Support optimistic UI with in-flight confirmation windows and server-sent confirmations (SSE or polling).

Core libraries (location)

- `client/src/public/js/lib/clientUtils.ts`

    - EndPointClient, InteractionClient, FavoriteClient, AdminClient (thin HTTP wrappers + EndPointResponse validation)
    - Looper (scheduling primitive used for polling / presence)

- `client/src/public/js/lib/stores.ts`

    - ReactiveStore<T>
    - InFlightWindowManager
    - StationIndexer
    - Concrete stores: LiveNetReactiveStore, LiveNetPresenceReactiveStore, FavoritesReactiveStore

- `client/src/public/js/lib/widgets.ts`

    - `HamLiveElement` base class and concrete custom elements (StationTable, FavoriteInsert, NetControl\*, etc.)

- `client/src/public/js/lib/presence.ts`
    - Presence helper that drives client-specific metadata used by stores and bootstraps (polling or SSE registration).

- `client/src/public/js/lib/chat.ts`

    - `ChatWidget` — local MongoDB/SSE chat integration, registered as the `<hl-chat>` custom element. `ChatClient` is exported as a backward-compatibility alias. Uses light DOM (not Shadow DOM) for Bootstrap compatibility.

- `client/src/public/js/lib/serverInfo.ts`

    - Reads the `<meta id="serverInfo" data-...>` element injected by `featureServerInfo.ejs` and exports a typed, frozen `serverInfo` object used throughout the client.

- `client/src/public/js/lib/systemNotifications.ts`

    - `SystemNotificationManager` — fetches pending system notifications from `/api/util/notifications/pending` and displays them as dismissible modals.

- `client/src/public/js/lib/logger.ts`

    - `createLogger(module)` — thin wrapper around `console.*` that respects the `logLevel` from `serverInfo`, prefixes each message with the module name, and applies per-level styling in the browser console.

Runtime patterns (as implemented)

1. Per-view entry modules (byView/\*/main.ts)

- The compiled per-view ESM modules under `/js/byView/<view>/main.js` are loaded by server-rendered EJS views as `<script type="module">`.
- In the current source, per-view `main.ts` files perform top-level initialization: they create Presence instances, instantiate EndPointClient(s) and ReactiveStore instances, and call widget initialization methods. Example: `client/src/public/js/byView/liveNet/main.ts` performs top-level startup by creating `Presence`, `EndPointClient`, `LiveNetReactiveStore`, and invoking widget `init()` functions.

2. Store as single source-of-truth (ReactiveStore<T>)

- Purpose: hold canonical view state (LiveNet details, station interactions, favorites) and broadcast changes to subscribers (widgets).
- API implemented in the codebase includes:
    - `subscribe(callback)` / `unsubscribe(callback)` — widgets call subscribe during connectedCallback and unsubscribe on disconnectedCallback.
    - `init()` — base `ReactiveStore.init()` takes no arguments; starts the main polling loop and RTT measurement. `LiveNetReactiveStore.init(client?)` overrides this and requires a `Promise<Client>` argument (providing callsign and user-level data).
    - `ingestServerResponse(resp)` — accepts server EndPointResponse objects; stores merge diffs and compute indexes via StationIndexer.
    - `delayServerDataIngest()` — called before a widget posts an optimistic change to the server; tells InFlightWindowManager to open an in-flight window, during which incoming server data does not overwrite the local optimistic state.

3. In-flight optimistic window (InFlightWindowManager)

- Measures RTT using recent request/response timestamps and calculates a short window where optimistic updates are assumed accepted by the server.
- Workflow implemented in code:
    - Widgets call network clients (e.g., InteractionClient.post); the store applies an optimistic patch and registers the pending action with InFlightWindowManager.
    - If a server confirmation arrives (SSE or next poll) that matches the in-flight op within the computed window, the optimistic change is kept and the pending op is cleared.
    - If a server response contradicts the optimistic change after the window, the store reconciles the state and the widget updates accordingly.

4. StationIndexer

- Purpose: compute efficient diffs and indexes for station lists and station-level changes so widgets can re-render small parts only.
- Keeps maps of callSign -> station record and emits small granular updates to subscribers.

5. Looper (scheduling primitive)

- Looper replaces ad-hoc setInterval usage with a small scheduler that supports:
    - drift compensation
    - stop/start
    - backoff/retry hooks
- It is used by presence polling and other periodic tasks in stores.

6. Widgets (HamLiveElement)

- Base responsibilities implemented in the code:
    - manage Shadow DOM and adopt styles
    - connect/disconnect lifecycle: subscribe/unsubscribe to `ReactiveStore`
    - small rendering helpers and slot handling
    - emit user actions by calling client wrappers (InteractionClient, FavoriteClient)
- Widgets in the code call `init(store)` functions to perform registration and rely on injected clients and serverInfo read from the DOM.

7. EventSource / SSE and polling

- `LiveNetReactiveStore` is constructed with `enableSse = true`. When the server's EndPointResponse envelope includes an `ssePath` field, the store creates a native `EventSource`, stops the short-poll `Looper` (`mainLooper.stop()`), and handles all subsequent updates via the event stream.
- `LiveNetPresenceReactiveStore` and `FavoritesReactiveStore` are constructed with `enableSse = false` and poll for the lifetime of the page.
- The server mounts SSE routes under `/api/sse/livenets/:id`. The server-side implementation is in `server/dist/lib/realtimeClients.js`. See [SSE Architecture](sse-architecture.md) for details.

8. Presence — deep dive

This project keeps presence concerns in a small `Presence` helper (see `client/src/public/js/lib/presence.ts`). The implementation intentionally re-uses existing store and Looper features rather than introducing separate scheduling logic. Key behaviors and interactions:

- Purpose and wiring

    - `Presence` is constructed with an `npid` and builds an `EndPointClient` scoped to `/api/presence/livenets/:id` (calls `.id(npid.toString())` and sets `capturePresence=true`).
    - It creates a `LiveNetPresenceReactiveStore` (a variant of `ReactiveStore`) using that `EndPointClient` and calls `store.init()` so the store begins its polling lifecycle.
    - The `Presence` helper exposes `client: Promise<Client>` which resolves once the presence store has fetched the initial payload and populated the `mainCache.client`. This promise is used by other stores (notably `LiveNetReactiveStore`) so client-specific data (callsign, user id, etc.) becomes available without blocking module initialization.

- How the store + Looper are reused for presence polling

    - The `LiveNetPresenceReactiveStore` is configured to poll (it does not use SSE registration). Internally it uses the same `ReactiveStore` primitives: an ingest path for `EndPointResponse` envelopes, a subscription model for `newData` callbacks, and a `Looper` instance to schedule repeated fetches.
    - The server sets presence endpoints to return TTLs tuned to the "away" threshold. The store/Looper use the TTL value from the endpoint response to compute when the next fetch should occur so clients refresh before they are considered away. In other words, TTL is treated as the canonical scheduling hint.
    - The ReactiveStore/Looper pair include compensatory scheduling (drift compensation and backoff hooks). This reduces the need for aggressive polling logic in `Presence` itself — the Looper will adapt to observed delays, network jitter, and recorded round-trip times when computing the next run time.

- Immediate resume signaling (visibility / focus hooks)

    - Presence attaches listeners for `visibilitychange`, `focus`, and `pageshow`. When one of these events indicates the client has regained attention, `Presence` will call `EndPointClient.show()` to immediately signal presence to the server.
    - To avoid spamming the presence endpoint on frequent focus/blur cycles, the helper applies an "away buffer" heuristic (in code, `AWAY_BUFFER_PCT = 20`): it computes `adjustedAwayInMs = serverInfo.awayInMs * (1 - AWAY_BUFFER_PCT / 100)` and ignores resume events that occur sooner than this buffer since the last resume. This means resume events only trigger an immediate presence call if the client has likely been away for a meaningful interval.
    - The presence call on resume is fire-and-forget and relies on the same EndPointClient instance and the store to reconcile any state delivered by the immediate response.

- One-shot client extraction via subscription

    - The constructor creates a one-time subscription to the presence store that waits for the first `newData` delivery. When that callback runs it immediately unsubscribes and resolves the `client` promise with `store.mainCache.client`.
    - This pattern decouples the timing of store initialization from downstream consumers: callers can `await presence.client` to obtain the client/callsign when it becomes available without blocking module top-level execution.

- How presence responses feed other stores and UI

    - Presence poll responses are standard `EndPointResponse` envelopes (see [api-reference.md](api-reference.md)). The `LiveNetPresenceReactiveStore` ingests server responses using the same `ingestServerResponse(resp)` path implemented by other stores. That means presence payloads are merged into `mainCache`, indexed via `StationIndexer` when appropriate, and broadcast to subscribers.
    - Because Presence uses the already-existing store ingest pipeline, any `newData` subscribers (widgets or other stores) receive presence updates using the same diff/merge semantics as other LiveNet updates.

- Avoiding duplicate logic and improving testability
    - By reusing `ReactiveStore` + `Looper` the presence logic avoids separate timers and duplicate retry/backoff code. Tests can exercise presence behavior by mocking MSW handlers for `/api/presence/livenets/:id` and controlling Looper timing in unit tests.
    - The use of `presence.client` promise, the one-time subscription pattern, and the documented `serverInfo` fixture make unit tests deterministic: tests can stub the presence envelope and then await the `client` promise or assert that `store.mainCache` was populated.

References

- Source: `client/src/public/js/lib/presence.ts`
- Store: `client/src/public/js/lib/stores.ts` (ReactiveStore and LiveNetPresenceReactiveStore)
- Looper: `client/src/public/js/lib/clientUtils.ts` (Looper implementation used by stores)

This document describes the client framework as it exists in the repository today.

See also

- [Overview](overview.md) — high-level application overview
- [Views & runtime hooks](views.md) — how bootstraps initialize widgets and stores
