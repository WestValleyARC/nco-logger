const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const client = fs.readFileSync(path.join(__dirname, '../client/dist/public/js/byView/myNets/main.js'), 'utf8');
const view = fs.readFileSync(path.join(__dirname, '../server/dist/views/myNets.ejs'), 'utf8');

test('net description shows the enforced character limit', () => {
  assert.match(view, /Maximum 500 characters, including formatting/);
});

test('My Nets errors identify the failed action and preserve server detail', () => {
  assert.match(client, /const actionErrorMessage = \(error, action\) =>/);
  assert.match(client, /`\$\{action\} failed: \$\{detail\}`/);
  for (const action of ['Saving net profile', 'Creating net profile', 'Adding co-owner', 'Starting scheduled net']) {
    assert.match(client, new RegExp(`actionErrorMessage\\(error, '${action}'\\)`));
  }
  assert.doesNotMatch(client, /error\.response\.data\.errorMessage/);
});
