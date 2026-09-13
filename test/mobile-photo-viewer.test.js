import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL("../client/src/public/js/byView/liveNet/ncoLogger.js", import.meta.url);
const builtPath = new URL("../client/dist/public/js/byView/liveNet/ncoLogger.js", import.meta.url);
const cssPath = new URL("../client/dist/public/css/nco-logger.css", import.meta.url);

for (const [label, path] of [["source", sourcePath], ["built", builtPath]]) {
  test(`${label} photo viewer follows the mobile visual viewport`, async () => {
    const code = await readFile(path, "utf8");

    assert.match(code, /function positionPhotoViewer\(\)/);
    assert.match(code, /const viewport = window\.visualViewport;/);
    assert.doesNotMatch(code, /function positionPhotoViewer\(\)[\s\S]*?const top = viewport\?\.offsetTop[\s\S]*?function detailsFor/);
    assert.match(code, /left: "0px", top: "0px"/);
    assert.match(code, /const height = viewport\?\.height \|\| document\.documentElement\.clientHeight \|\| window\.innerHeight;/);
    assert.match(code, /modal\.hidden = false;\s+positionPhotoViewer\(\);/);
    assert.match(code, /window\.visualViewport\?\.addEventListener\("scroll", positionPhotoViewer\);/);
  });

  test(`${label} photo viewer consumes browser Back before leaving the logger`, async () => {
    const code = await readFile(path, "utf8");

    assert.match(code, /viewerUrl\.hash = "nco-photo-viewer";/);
    assert.match(code, /window\.history\.pushState\(/);
    assert.match(code, /function handlePhotoViewerPopState\(event\)/);
    assert.match(code, /event\?\.stopImmediatePropagation\?\.\(\);/);
    assert.match(code, /closePhotoViewer\(\{ consumeHistory: false \}\);/);
    assert.match(code, /window\.addEventListener\("popstate", handlePhotoViewerPopState\);/);
    assert.match(code, /if \(consumeHistory && photoHistoryActive\)[\s\S]*?window\.history\.back\(\);/);
  });
}

test("photo controls remain inside the safe, visible viewer area", async () => {
  const css = await readFile(cssPath, "utf8");

  assert.match(css, /\.nch-photo-viewer[\s\S]*?position: fixed;[\s\S]*?env\(safe-area-inset-top\)/);
  assert.match(css, /\.nch-photo-viewer \{[\s\S]*?right: auto;[\s\S]*?bottom: auto;[\s\S]*?overflow: hidden;/);
  assert.match(css, /\.nch-photo-viewer\[data-photo-kind="chat"\] \.nch-photo-card \{[\s\S]*?max-width: 100%;\s+max-height: 100%;/);
  assert.match(css, /button\.nch-photo-close \{ position: absolute; z-index: 2;[\s\S]*?width: 44px; height: 44px; min-width: 44px;/);
  assert.match(css, /button\.nch-photo-download \{ position: absolute; z-index: 2;[\s\S]*?width: 44px; height: 44px; min-width: 44px;/);
  assert.match(css, /\.nch-photo-viewer \.nch-photo-card h3 \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /\.nch-photo-viewer \.nch-photo-card img \{[\s\S]*?max-height: calc\(100% - 52px\);/);
});
