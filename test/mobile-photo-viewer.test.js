import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL("../client/src/public/js/byView/liveNet/ncoLogger.js", import.meta.url);
const builtPath = new URL("../client/dist/public/js/byView/liveNet/ncoLogger.js", import.meta.url);
const cssPath = new URL("../client/dist/public/css/nco-logger.css", import.meta.url);

for (const [label, path] of [["source", sourcePath], ["built", builtPath]]) {
  test(`${label} photo viewer stays stable while browser chrome and pinch viewport move`, async () => {
    const code = await readFile(path, "utf8");

    assert.match(code, /function positionPhotoViewer\(\)/);
    assert.match(code, /width: "100vw", height: "100dvh"/);
    assert.doesNotMatch(code, /addEventListener\("scroll", positionPhotoViewer\)/);
    assert.match(code, /modal\.hidden = false;\s+positionPhotoViewer\(\);/);
  });

  test(`${label} photo viewer uses CloseWatcher for Android Back with history fallback`, async () => {
    const code = await readFile(path, "utf8");

    assert.match(code, /typeof window\.CloseWatcher === "function"/);
    assert.match(code, /new window\.CloseWatcher\(\)/);
    assert.match(code, /addEventListener\("close", \(\) => closePhotoViewer\(\{ consumeHistory: false \}\)\)/);
    assert.match(code, /viewerUrl\.hash = "nco-photo-viewer";/);
    assert.match(code, /window\.history\.pushState\(/);
    assert.match(code, /window\.addEventListener\("popstate", handlePhotoViewerPopState, true\);/);
  });
}

test("photo controls remain inside the safe, visible viewer area", async () => {
  const css = await readFile(cssPath, "utf8");

  assert.match(css, /\.nch-photo-viewer[\s\S]*?position: fixed;[\s\S]*?env\(safe-area-inset-top\)/);
  assert.match(css, /\.nch-photo-viewer \{[\s\S]*?z-index: 2147483600;[\s\S]*?right: auto;[\s\S]*?bottom: auto;[\s\S]*?overflow: hidden;/);
  assert.match(css, /\.nch-photo-viewer\[data-photo-kind="chat"\] \.nch-photo-card \{[\s\S]*?width: fit-content;[\s\S]*?height: fit-content;[\s\S]*?max-width: calc\(100vw[\s\S]*?max-height: calc\(100dvh/);
  assert.match(css, /button\.nch-photo-close \{ position: absolute; z-index: 2;[\s\S]*?width: 44px; height: 44px; min-width: 44px;/);
  assert.match(css, /button\.nch-photo-download \{ position: absolute; z-index: 2;[\s\S]*?width: 44px; height: 44px; min-width: 44px;/);
  assert.match(css, /\.nch-photo-viewer \.nch-photo-card h3 \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /\.nch-photo-viewer \.nch-photo-card img,[\s\S]*?max-height: var\(--nch-photo-image-max-height,/);
  assert.match(css, /max-height: var\(--nch-photo-image-max-height, max\(0px, calc\(100dvh - 160px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\)\)\);/);
});

test("header menu stays above shared dashboard splitters", async () => {
  const css = await readFile(cssPath, "utf8");
  const header = css.match(/#netcontrol-ncs-helper header \{[^}]*?z-index: (\d+);/);
  const splitter = css.match(/#netcontrol-ncs-helper \.nch-shared-splitter \{[^}]*?z-index: (\d+);/);
  assert.ok(header && splitter);
  assert.ok(Number(header[1]) > Number(splitter[1]));
});


test("mobile logger preserves browser pinch zoom and shrink-wraps photo viewers", async () => {
  const css = await readFile(cssPath, "utf8");
  const head = await readFile(new URL("../server/dist/views/partials/head.ejs", import.meta.url), "utf8");
  assert.match(head, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.doesNotMatch(head, /user-scalable=no|maximum-scale=1/i);
  assert.match(css, /touch-action: pan-y pinch-zoom;/);
  assert.match(css, /nch-photo-viewer\[data-photo-kind="chat"\][\s\S]*?width: fit-content;[\s\S]*?height: fit-content;/);
  assert.match(css, /--nch-photo-image-max-height/);
});

// Exercise the actual viewer functions with browser navigation doubles, rather
// than only asserting that a particular API name occurs in the source.
async function viewerHarness(CloseWatcher) {
  const { runInNewContext } = await import('node:vm');
  const code = await readFile(sourcePath, 'utf8');
  const pick = (name, next) => code.slice(code.indexOf(`  function ${name}(`), code.indexOf(`  function ${next}(`));
  const controls = Object.fromEntries(['photo-title', 'photo-image', 'download-photo', 'close-photo'].map(key => [key, { dataset: {}, focus() {} }]));
  const modal = { hidden: true, dataset: {}, style: {}, querySelector(selector) { return controls[selector.match(/'([^']+)'/)[1]]; } };
  const history = { state: {}, pushes: 0, backs: 0, pushState(state) { this.state = state; this.pushes++; }, back() { this.backs++; } };
  const context = { URL, window: { CloseWatcher, history, location: { href: 'https://example.test/net/1' } }, panel: { querySelector: () => modal }, safeImageUrl: () => true, DEFAULT_AVATAR: '', PHOTO_VIEWER_HISTORY_KEY: 'photo', syncNativeChatVisibility() {} };
  runInNewContext(`let photoCloseWatcher = null, photoHistoryActive = false, photoTrigger = null;
    ${pick('openPhotoViewer', 'openChatImage')}
    ${pick('closePhotoViewer', 'detailsFor')}
    globalThis.api = { openPhotoViewer, closePhotoViewer, handlePhotoViewerPopState, positionPhotoViewer };`, context);
  return { ...context.api, modal, history, controls };
}

for (const kind of ['station', 'chat']) {
  test(`${kind} viewer falls back when CloseWatcher construction fails and Back closes only the photo`, async () => {
    const viewer = await viewerHarness(class { constructor() { throw new Error('unavailable'); } });
    viewer.openPhotoViewer('https://example.test/photo.jpg', 'Photo', 'Photo', null, kind);
    assert.equal(viewer.modal.hidden, false);
    assert.equal(viewer.history.pushes, 1);
    assert.equal(viewer.controls['download-photo'].hidden, kind !== 'chat');
    viewer.openPhotoViewer('https://example.test/another.jpg', 'Another', 'Another', null, kind);
    assert.equal(viewer.history.pushes, 1, 'changing the image does not add another navigation entry');
    viewer.handlePhotoViewerPopState({ stopImmediatePropagation() {}, preventDefault() {} });
    assert.equal(viewer.modal.hidden, true);
    assert.equal(viewer.history.backs, 0, 'Back is not consumed twice');
  });
}

test('CloseWatcher close restores focus without navigating away', async () => {
  let close, destroyed = false, focused = false;
  const viewer = await viewerHarness(class {
    addEventListener(name, callback) { assert.equal(name, 'close'); close = callback; }
    destroy() { destroyed = true; }
  });
  viewer.openPhotoViewer('https://example.test/avatar.jpg', 'Avatar', 'Avatar', { focus() { focused = true; } });
  viewer.positionPhotoViewer();
  assert.equal(viewer.modal.style.height, '100dvh');
  close();
  assert.equal(viewer.modal.hidden, true);
  assert.ok(destroyed && focused);
  assert.equal(viewer.history.pushes + viewer.history.backs, 0);
});

test('explicit close consumes the fallback entry once', async () => {
  const viewer = await viewerHarness(undefined);
  viewer.openPhotoViewer('https://example.test/avatar.jpg', 'Avatar', 'Avatar');
  viewer.closePhotoViewer();
  viewer.closePhotoViewer();
  assert.equal(viewer.history.backs, 1);
});
