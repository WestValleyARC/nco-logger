const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'client/dist/public/css/nco-logger.css'), 'utf8');

test('desktop Station Controls use the compact three-row presentation', () => {
  const desktop = /#netcontrol-ncs-helper:not\(\[data-layout-context\^="phone"\]\):not\(\[data-layout-context\^="tablet"\]\) \.nch-controls-pane \.nch-entry-controls \{([\s\S]*?)\n\}/.exec(css)?.[1] || '';
  assert.match(desktop, /grid-template-columns: max-content 144px max-content;/);
  assert.match(desktop, /grid-template-rows: 24px 24px 24px;/);
  assert.match(desktop, /overflow-y: auto;/);
  assert.match(css, /\.nch-controls-pane \.nch-quick-checkin button \{\s*width: 90px;[^}]*min-height: 24px; height: 24px;/);
  assert.match(css, /\.nch-controls-pane \.nch-net-actions button \{\s*width: 100%; min-height: 24px; height: 24px;/);
});

test('Station Controls keep a four-row minimum without locking the frame size', () => {
  const source = fs.readFileSync(path.join(root, 'client/src/public/js/byView/liveNet/ncoLogger.js'), 'utf8');
  assert.match(source, /MIN_MODULE_ROWS = Object\.freeze\(\{ controls: 4,/);
  assert.doesNotMatch(source, /currentLayoutContext === "desktop" && moduleAvailable\("controls"\)/);
  assert.doesNotMatch(source, /if \(id === "controls"\) return "";/);
  assert.match(source, /\$\{moduleResizeZones\("controls"\)\}/);
});
