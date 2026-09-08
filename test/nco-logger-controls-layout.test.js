const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'client/dist/public/css/nco-logger.css'), 'utf8');

test('desktop Station Controls fit within the four-row default module', () => {
  assert.match(css, /:not\(\[data-layout-context\^="phone"\]\):not\(\[data-layout-context\^="tablet"\]\) \.nch-entry-controls \{ overflow-y: auto; \}/);
  assert.match(css, /:not\(\[data-layout-context\^="phone"\]\):not\(\[data-layout-context\^="tablet"\]\) \.nch-quick-checkin button \{ min-height: 30px; \}/);
  assert.match(css, /:not\(\[data-layout-context\^="phone"\]\):not\(\[data-layout-context\^="tablet"\]\) \.nch-net-actions button \{ min-height: 30px; \}/);
});
