# Logger shared splitters

Docked rectangles use one shared separator per contiguous boundary. The TypeScript
geometry module derives adjacency from visible grid rectangles; the controller
updates both sides atomically and reuses separator DOM nodes during pointer capture.
A boundary spanning several panes moves the entire matching row or column together.
Partially unmatched edges do not form a shared boundary because moving them would
create gaps. Undocked desktop panes retain the existing independent resize controls.

The existing role and orientation layout buckets persist grid proportions. Viewport
changes recalculate pixel geometry from those proportions. Phone portrait layouts
retain their compact visible stack, while hidden panes keep their saved positions.
The fixed Station Controls height in tablet portrait remains fixed.

Dragging a module onto a target edge divides the target rectangle. Its former shared
neighbor expands into the vacated space when that boundary can be healed. All changes
must remain collision free and satisfy minimum sizes. Preview coloring names the
proposed docking edge. Moving, hiding, and reset derive fresh adjacency, so no separate
stale relationship needs to be repaired in storage.

Separators support mouse, pen, and touch using Pointer Events and pointer capture.
Their 44px cross-axis targets leave room at the ends for module header controls.
Arrow keys move one grid unit. Cancellation restores the starting layout; only a
completed pointer or keyboard action saves. Selection suppression applies only during
an active drag, and touch-action is restricted to the separator. The detached native
chat host leaves space for adjacent splitter targets.

Validation: `test/logger-splitters.test.js` exercises conservation, minimum clamping,
serialization, grouped boundaries, edge docking, cleanup, touch capture/cancellation,
and keyboard saving. `test/logger-station-action-pin.test.js` distinguishes disabled
phone independent handles from available shared separators. Real Galaxy S25 pinch,
rotation, and system Back behavior still require hardware retesting.
