const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../client/dist/public/js/lib/loggerSplitters.js');
const layout = () => ({ items: { active: { x: 0, y: 0, w: 24, h: 14 }, chat: { x: 0, y: 14, w: 24, h: 14 } }, collapsed: {} });
const ids = ['active', 'chat'];
const minimums = { active: { w: 2, h: 4 }, chat: { w: 2, h: 5 } };

test('phone shared divider conserves the combined size, clamps both minima and survives persistence', async () => {
  const { sharedBoundaries, resizeSharedBoundary } = await load();
  const original = layout();
  const [boundary] = sharedBoundaries(original, ids);
  assert.equal(boundary.axis, 'y');
  assert.equal(sharedBoundaries(original, ids).length, 1);
  for (const requested of [-100, 4, 17, 100]) {
    const resized = resizeSharedBoundary(original, boundary, requested, minimums, ids);
    assert.equal(resized.items.active.h + resized.items.chat.h, 28);
    assert.equal(resized.items.chat.y, resized.items.active.h);
    assert.ok(resized.items.active.h >= 4 && resized.items.chat.h >= 5);
    const restored = JSON.parse(JSON.stringify(resized));
    assert.deepEqual(sharedBoundaries(restored, ids), sharedBoundaries(resized, ids));
  }
  assert.deepEqual(original, layout());
});

test('one divider moves a full column of differently sized neighboring panes atomically', async () => {
  const { sharedBoundaries, resizeSharedBoundary } = await load();
  const source = { items: { a: { x: 0, y: 0, w: 10, h: 20 }, b: { x: 10, y: 0, w: 14, h: 7 }, c: { x: 10, y: 7, w: 14, h: 13 } } };
  const visible = ['a', 'b', 'c'];
  const mins = Object.fromEntries(visible.map(id => [id, { w: 3, h: 3 }]));
  const boundaries = sharedBoundaries(source, visible);
  const vertical = boundaries.filter(item => item.axis === 'x');
  assert.equal(vertical.length, 1);
  const moved = resizeSharedBoundary(source, vertical[0], 15, mins, visible);
  assert.equal(moved.items.a.w, 15);
  assert.equal(moved.items.b.x, 15);
  assert.equal(moved.items.c.x, 15);
  assert.equal(moved.items.b.w, 9);
  assert.equal(moved.items.c.w, 9);
});

test('partial unmatched edges do not create a splitter that could introduce gaps', async () => {
  const { sharedBoundaries } = await load();
  assert.deepEqual(sharedBoundaries({ items: { a: { x: 0, y: 0, w: 10, h: 20 }, b: { x: 10, y: 0, w: 14, h: 10 } } }, ['a', 'b']), []);
});

test('edge docking splits the target without moving unrelated panes; hiding and moving clean up adjacency', async () => {
  const { dockAtEdge, sharedBoundaries, resizeSharedBoundary } = await load();
  const source = { items: { a: { x: 0, y: 0, w: 12, h: 20 }, b: { x: 12, y: 0, w: 12, h: 10 }, c: { x: 12, y: 10, w: 12, h: 10 } } };
  const visible = ['a', 'b', 'c'];
  const mins = Object.fromEntries(visible.map(id => [id, { w: 3, h: 3 }]));
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    const docked = dockAtEdge(source, 'b', 'a', edge, mins, visible);
    assert.ok(docked);
    assert.deepEqual(docked.items.c, { x: 12, y: 0, w: 12, h: 20 }, 'former neighbor fills the vacated rectangle');
    const shared = sharedBoundaries(docked, visible).find(item => [...item.before, ...item.after].includes('a') && [...item.before, ...item.after].includes('b'));
    assert.ok(shared);
    assert.ok(!sharedBoundaries(docked, ['a', 'c']).some(item => item.id === shared.id));
    docked.items.b = { x: 20, y: 30, w: 4, h: 4 };
    assert.equal(resizeSharedBoundary(docked, shared, 5, mins, visible), null);
  }
  assert.equal(dockAtEdge(source, 'a', 'a', 'left', mins, visible), null);
  assert.equal(dockAtEdge(source, 'b', 'a', 'left', { ...mins, a: { w: 10, h: 3 } }, visible), null);
});

// Run the emitted controller against small DOM doubles to verify pointer capture,
// cancellation, keyboard behavior and commit timing.
test('controller supports touch drag, rollback, keyboard resizing and saves only completed actions', async () => {
  const { LoggerSplitterControls } = await import('../client/dist/public/js/lib/loggerSplitterControls.js');
  const old = { document: global.document, ResizeObserver: global.ResizeObserver, getComputedStyle: global.getComputedStyle };
  const classes = () => ({ add() {}, remove() {}, toggle() {} });
  const handles = [];
  global.document = { body: { classList: classes() }, createElement() {
    const handle = { dataset: {}, style: {}, attributes: {}, listeners: {}, classList: classes(),
      setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(k, v) { this.listeners[k] = v; },
      focus() {}, setPointerCapture(id) { this.capture = id; }, hasPointerCapture(id) { return this.capture === id; }, releasePointerCapture() { this.capture = null; }, remove() {} };
    handles.push(handle); return handle;
  } };
  global.ResizeObserver = class { observe() {} disconnect() {} };
  global.getComputedStyle = () => ({ gap: '0' });
  let current = layout(), saves = 0;
  const dashboard = { scrollLeft: 0, scrollTop: 0, append() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }), querySelectorAll: () => [],
    querySelector(selector) { const id = selector.match(/"([^\"]+)"/)[1]; return { getBoundingClientRect() { const r = current.items[id]; return { left: r.x * 10, right: (r.x + r.w) * 10, top: r.y * 10, bottom: (r.y + r.h) * 10, width: r.w * 10, height: r.h * 10 }; } }; } };
  try {
    const controller = new LoggerSplitterControls(dashboard, { read: () => current, visible: () => ids, minimums: () => minimums, labels: { active: 'Active Log', chat: 'Chat' }, apply(next) { current = next; controller.render(); }, save() { saves++; } });
    controller.render();
    const handle = handles[0];
    assert.equal(handle.attributes.role, 'separator');
    assert.equal(handle.attributes['aria-orientation'], 'horizontal');
    assert.equal(handle.style.height, '44px');
    const event = (extra = {}) => ({ pointerId: 7, pointerType: 'touch', button: 0, currentTarget: handle, clientX: 0, clientY: 140, preventDefault() {}, stopPropagation() {}, ...extra });
    handle.listeners.pointerdown(event());
    assert.equal(handle.capture, 7);
    handle.listeners.pointermove(event({ clientY: 170 }));
    assert.equal(current.items.active.h, 17);
    assert.equal(current.items.chat.h, 11);
    assert.equal(saves, 0);
    handle.listeners.pointercancel(event());
    assert.deepEqual(current, layout());
    handle.listeners.pointerdown(event());
    handle.listeners.pointerup(event({ clientY: 180 }));
    assert.equal(current.items.active.h, 18);
    assert.equal(saves, 1);
    handle.listeners.keydown(event({ key: 'ArrowUp' }));
    assert.equal(current.items.active.h, 17);
    assert.equal(saves, 2);
    assert.equal(handles.length, 1, 'render retains the capture and focus node');
    controller.destroy();
  } finally { Object.assign(global, old); }
});
