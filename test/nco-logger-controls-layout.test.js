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

test('desktop Station Controls cannot be normalized below four module rows', () => {
  const source = fs.readFileSync(path.join(root, 'client/src/public/js/byView/liveNet/ncoLogger.js'), 'utf8');
  assert.match(source, /maximumRows - 4[\s\S]*?w: 6, h: 4/);
  assert.doesNotMatch(source, /maximumRows - 3[\s\S]*?w: 6, h: 3/);
});

test('chat bottom clearance uses the compact 16px gutter', () => {
  const localCss = fs.readFileSync(path.join(root, 'client/dist/public/css/local.css'), 'utf8');
  assert.match(localCss, /\.chat-messages\s*\{[^}]*padding-bottom:\s*16px;[^}]*scroll-padding-bottom:\s*16px;/s);
  assert.match(css, /hl-chat\.nch-chat-docked \.chat-messages\s*\{[^}]*padding-bottom:\s*16px !important;[^}]*scroll-padding-bottom:\s*16px;/s);
});
