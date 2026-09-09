const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('My Nets gives actionable persistent validation feedback', () => {
  const client = fs.readFileSync(path.join(__dirname, '../client/dist/public/js/byView/myNets/main.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server/dist/controllers/netProfileController.js'), 'utf8');
  assert.match(client, /Welcome notes are too long/);
  assert.match(client, /notesEditor\.focus\(\)/);
  assert.match(client, /Add at least one connection, frequency, or operating mode/);
  assert.doesNotMatch(client, /setTimeout\(\(\) => \{\s*setNetProfileMode\('new'\)/);
  assert.match(server, /validateConnections/);
  assert.match(server, /validateNotesLength/);
  assert.match(server, /err\.message \|\| 'Unable to create the net profile'/);
});
