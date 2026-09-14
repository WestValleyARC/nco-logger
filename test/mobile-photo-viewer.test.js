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
